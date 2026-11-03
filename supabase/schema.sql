-- 주간 플래너: 서버 저장용 테이블 + "본인 데이터만" 접근 규칙
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전함.

-- 일정 / 카테고리: 한 줄 = 한 항목. data 에 앱의 일정·카테고리 객체를 그대로 저장
create table if not exists public.events (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id         text    not null check (char_length(id) between 1 and 40),
  data       jsonb   not null check (pg_column_size(data) < 8192),
  deleted    boolean not null default false,   -- 지운 일정도 표시만 남겨서 다른 기기에서도 지워지게
  updated_at bigint  not null,                 -- 기기에서 고친 시각 (ms)
  primary key (user_id, id)
);

create table if not exists public.categories (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id         text    not null check (char_length(id) between 1 and 40),
  data       jsonb   not null check (pg_column_size(data) < 8192),
  deleted    boolean not null default false,
  updated_at bigint  not null,
  primary key (user_id, id)
);

-- 숨긴 카테고리 같은 설정 (사용자당 한 줄)
create table if not exists public.prefs (
  user_id    uuid   primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb  not null default '{}'::jsonb check (pg_column_size(data) < 8192),
  updated_at bigint not null default 0
);

-- 본인 것만 읽고 쓰기 (RLS)
alter table public.events     enable row level security;
alter table public.categories enable row level security;
alter table public.prefs      enable row level security;

drop policy if exists "own rows" on public.events;
drop policy if exists "own rows" on public.categories;
drop policy if exists "own rows" on public.prefs;
create policy "own rows" on public.events     for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.categories for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.prefs      for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 오래된 기기가 더 새 내용을 덮어쓰지 않게: 예전 시각의 수정이면 무시
create or replace function public.keep_newer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists keep_newer on public.events;
drop trigger if exists keep_newer on public.categories;
drop trigger if exists keep_newer on public.prefs;
create trigger keep_newer before update on public.events     for each row execute function public.keep_newer();
create trigger keep_newer before update on public.categories for each row execute function public.keep_newer();
create trigger keep_newer before update on public.prefs      for each row execute function public.keep_newer();
