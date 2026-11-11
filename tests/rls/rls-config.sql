-- RLS 설정 점검 — 테이블이 새로 생겨도 "RLS를 깜빡"하면 CI가 실패하도록 (public 스키마 전체 대상)
-- 실행: psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/rls/rls-config.sql
do $$
declare bad text;
begin
  -- 1) RLS가 꺼진 테이블
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then raise exception 'RLS가 꺼진 테이블: %', bad; end if;

  -- 2) RLS는 켰지만 정책이 하나도 없는 테이블 (모두 막히긴 하지만 실수일 가능성이 큼)
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);
  if bad is not null then raise exception '정책이 없는 테이블: %', bad; end if;

  -- 3) 로그인 안 한 사용자(anon) · 모두(public)에게 열린 정책
  select string_agg(tablename || '.' || policyname, ', ') into bad
  from pg_policies
  where schemaname = 'public' and ('anon' = any (roles) or 'public' = any (roles));
  if bad is not null then raise exception 'anon/public에 열린 정책: %', bad; end if;

  -- 4) 모든 정책이 본인 확인(auth.uid())을 읽기 · 쓰기 양쪽에 거는지
  select string_agg(tablename || '.' || policyname, ', ') into bad
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') not like '%auth.uid()%'
         or (cmd in ('ALL', 'INSERT', 'UPDATE') and coalesce(with_check, '') not like '%auth.uid()%'));
  if bad is not null then raise exception '본인 확인이 빠진 정책: %', bad; end if;

  -- 5) search_path가 고정되지 않은 public 함수 (스키마 바꿔치기 공격 — Supabase 보안 점검 항목과 같음)
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then raise exception 'search_path가 고정되지 않은 함수: %', bad; end if;

  raise notice 'RLS 설정 점검 통과 (public 테이블 % 개)',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p'));
end $$;
