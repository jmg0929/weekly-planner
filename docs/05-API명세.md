# 05. API 명세

클라이언트(`index.html`)가 호출하는 **모든** 외부 엔드포인트. 서버 쪽 코드는 없고 Supabase(GoTrue Auth + PostgREST)와 공개 API를 직접 호출한다.

## 1. 공통

| 항목 | 값 |
|---|---|
| Base URL | `https://<project-ref>.supabase.co` (코드의 `SB_URL`) |
| 공통 헤더 | `apikey: <publishable key>` (코드의 `SB_KEY`, 공개용 — RLS로 보호), `Content-Type: application/json` |
| 인증 헤더 | 로그인 후 요청: `Authorization: Bearer <access_token>` |
| 캐시 | 모든 Supabase 요청 `cache: "no-store"` + 서비스워커 캐시 대상 아님 |
| 래퍼 | Auth: `authReq(path, body, token, method="POST")` · REST: `api(method, path, body, extraHeaders)` (호출 전 `token()`으로 갱신) |
| Auth 오류 변환 | 응답이 `!ok`면 `Error(message = msg ‖ error_description ‖ message ‖ "HTTP <status>")`, `status`, `code = error_code ‖ code ‖ error` |
| REST 오류 변환 | `!ok`면 `Error("HTTP <status> <본문 앞 120자>")`. `401`이면 `auth.expires_at = 0` (다음 호출에서 강제 갱신) |
| 네트워크 실패 | `fetch`가 `TypeError` → 동기화 상태 `오프라인` |

## 2. Auth API (`/auth/v1`)

### 2.1 요약

| # | 기능 | 메서드 | 경로 | 토큰 | 호출 위치 |
|---|---|---|---|---|---|
| A1 | 가입 | POST | `/auth/v1/signup?redirect_to=<앱 주소>` | — | `doAuth("signup")` |
| A2 | 로그인 | POST | `/auth/v1/token?grant_type=password` | — | `doAuth("login")`, `changePw()`(현재 비밀번호 확인) |
| A3 | 토큰 갱신 | POST | `/auth/v1/token?grant_type=refresh_token` | — | `token()` |
| A4 | 인증번호 확인 | POST | `/auth/v1/verify` | — | `verifyCode()` |
| A5 | 가입 인증번호 재발송 | POST | `/auth/v1/resend` | — | `acctCodeResend` (가입) |
| A6 | 비밀번호 찾기 (인증번호 발송) | POST | `/auth/v1/recover?redirect_to=<앱 주소>` · 재발송은 쿼리 없이 `/auth/v1/recover` | — | `acctForgot`, `acctCodeResend` (재설정) |
| A7 | 사용자 정보 | GET | `/auth/v1/user` | ● | 예전 재설정 링크 처리(호환용) |
| A8 | 비밀번호 변경 | PUT | `/auth/v1/user` | ● | `changePw()`, `saveRecovery()` |
| A9 | 로그아웃 (이 기기만) | POST | `/auth/v1/logout?scope=local` | ● | 로그아웃, 합치기 취소, 재설정 취소, 메일 링크 토큰 폐기 |

> `redirect_to`는 메일 **링크** 방식(v41~v42)의 복귀 주소로, 인증번호 방식(v43)에서도 요청에 남아 있다. 링크로 열려도 로그인하지 않는다([03-시스템설계 §4.6](03-시스템설계.md#46-메일-링크-해시-처리-호환용-로그인-안-함)).

### 2.2 상세

#### A1. 가입

| 항목 | 내용 |
|---|---|
| 요청 본문 | `{ "email": string, "password": string }` |
| 클라이언트 사전 검증 | 이메일·비밀번호 비어 있으면 "이메일과 비밀번호를 입력해 주세요", 비밀번호 6자 미만이면 "비밀번호는 6자 이상" |
| 응답 (메일 확인 켜짐) | 세션 없음, 사용자 객체(`user` 또는 최상위). 앱이 쓰는 필드: `identities` |
| 응답 처리 | `access_token` 있으면 즉시 `startSession()` · `identities`가 빈 배열이면 "이미 가입된 이메일 · 로그인을 눌러 주세요" · 그 외 → 인증번호 화면 |
| 서버 부수효과 | 6자리 인증번호 메일 발송 |

#### A2. 로그인 (비밀번호 grant)

| 항목 | 내용 |
|---|---|
| 요청 본문 | `{ "email": string, "password": string }` |
| 응답 (200) | `{ access_token, refresh_token, expires_in, user: { id, email, ... } }` |
| 앱 저장 | `{ access_token, refresh_token, expires_at = now + expires_in·1000, user: { id, email } }` |
| 오류 | `invalid_credentials` → "이메일 또는 비밀번호가 틀려요" · `email_not_confirmed` → 인증번호 화면("메일 인증이 아직이에요 · 다시 보내기를 눌러 주세요") |
| 비밀번호 변경용 재확인 | `invalid_credentials`면 "현재 비밀번호가 틀려요", 성공 시 새 세션 저장 후 A8 |

#### A3. 토큰 갱신

| 항목 | 내용 |
|---|---|
| 조건 | `now ≥ expires_at − 60초` 일 때 API 호출 전 |
| 요청 본문 | `{ "refresh_token": string }` |
| 응답 | A2와 같은 세션 → 저장 |
| 동시성 | 진행 중인 갱신 Promise(`refreshing`)를 공유 → 중복 갱신 방지 |
| 오류 | `400/401/403` → 세션 만료 처리(`auth` 삭제, `sync` 유지, 상태 `다시 로그인`) · 그 외(네트워크 등) → 세션 유지, 다음에 재시도 |

#### A4. 인증번호 확인

| 항목 | 내용 |
|---|---|
| 요청 본문 | `{ "type": "email" \| "recovery", "email": string, "token": "6자리" }` |
| 클라이언트 사전 검증 | `^\d{6}$` 아니면 "메일로 온 숫자 6자리를 입력해 주세요" · 5분 경과면 "시간 초과 · 다시 보내기를 눌러 주세요" (요청 안 함) |
| 응답 | 세션 (`access_token`, `user` 없으면 "인증 실패" 처리) |
| 처리 | `email` → `startSession()` · `recovery` → 메모리 `recov`에 보관 후 새 비밀번호 화면 |
| 오류 | `otp_expired` 등 → "인증번호가 틀렸거나 만료됐어요", 칸 빨강·비움 |
| 서버 설정 | Email OTP 만료 300초 (대시보드 설정) |

#### A5. 재발송 (가입)

| 항목 | 내용 |
|---|---|
| 요청 본문 | `{ "type": "signup", "email": string }` |
| 성공 | "다시 보냈어요", 칸 비움, 5분 타이머 재시작 |
| 오류 | `over_request_rate_limit` / `429` → "잠시 후 다시 시도해 주세요" |

#### A6. 비밀번호 찾기

| 항목 | 내용 |
|---|---|
| 요청 본문 | `{ "email": string }` |
| 클라이언트 사전 검증 | 이메일 비면 "이메일을 입력해 주세요" |
| 성공 | 인증번호 화면 — **계정이 없어도 같은 화면** (계정 존재 여부 비노출) |

#### A7. 사용자 정보 (호환용)

| 항목 | 내용 |
|---|---|
| 용도 | 예전 재설정 링크(`#access_token&type=recovery`)로 열린 경우, 토큰 주인의 이메일만 확인해 화면에 표시 |
| 응답 | `{ id, email, ... }` — 앱은 `email`만 사용 |
| 오류 | "링크가 만료됐어요 · 다시 요청해 주세요" |

#### A8. 비밀번호 변경

| 항목 | 내용 |
|---|---|
| 요청 본문 | `{ "password": string }` |
| 클라이언트 사전 검증 | 6자 이상, 두 칸 일치("새 비밀번호가 서로 달라요"), 현재와 다름("지금과 같은 비밀번호예요") |
| 오류 | `same_password` → "지금과 같은 비밀번호예요" · `weak_password` → "비밀번호는 6자 이상" · `reauthentication_needed` → "다시 로그인한 뒤 시도해 주세요" |

#### A9. 로그아웃

| 항목 | 내용 |
|---|---|
| 쿼리 | `scope=local` — 이 토큰의 세션만 종료, 다른 기기 세션 유지 |
| 요청 본문 | `{}` |
| 오류 처리 | 무시 (로컬 상태는 항상 정리) |

## 3. REST API (`/rest/v1`, PostgREST)

| # | 기능 | 메서드 | 경로 | 추가 헤더 | 본문 | 응답 |
|---|---|---|---|---|---|---|
| R1 | 일정 받기 | GET | `/rest/v1/events?select=id,data,deleted,updated_at` | | — | `[{id, data, deleted, updated_at}]` (RLS로 내 행만) |
| R2 | 카테고리 받기 | GET | `/rest/v1/categories?select=id,data,deleted,updated_at` | | — | 위와 같음 |
| R3 | 설정 받기 | GET | `/rest/v1/prefs?select=data,updated_at` | | — | `[{data, updated_at}]` (0~1행) |
| R4 | 일정 올리기 | POST | `/rest/v1/events?on_conflict=user_id,id` | `Prefer: resolution=merge-duplicates,return=minimal` | `[{user_id, id, data, deleted, updated_at}]` | `201`, 본문 없음 |
| R5 | 카테고리 올리기 | POST | `/rest/v1/categories?on_conflict=user_id,id` | 위와 같음 | 위와 같음 | `201` |
| R6 | 설정 올리기 | POST | `/rest/v1/prefs?on_conflict=user_id` | 위와 같음 | `[{user_id, data, updated_at}]` | `201` |
| R7 | 할 일 받기 (v45) | GET | `/rest/v1/todos?select=id,data,deleted,updated_at` | | — | R1과 같음. **표가 없으면 `404`(`PGRST205`) → 할 일만 건너뛰고 동기화는 성공 처리** |
| R8 | 할 일 올리기 (v45) | POST | `/rest/v1/todos?on_conflict=user_id,id` | R4와 같음 | R4와 같음 | `201` (R7에서 표 없음이면 보내지 않음) |
| R9 | 할 일 카테고리 받기 (v45) | GET | `/rest/v1/todo_categories?select=id,data,deleted,updated_at` | | — | R7과 같은 규칙 |
| R10 | 할 일 카테고리 올리기 (v45) | POST | `/rest/v1/todo_categories?on_conflict=user_id,id` | R4와 같음 | R4와 같음 | `201` (R9에서 표 없음이면 보내지 않음) |

> **나눠 받기 (v46)** — R1 · R2 · R7 · R9는 실제로 `&order=id.asc&limit=1000`을 붙여 보내고, 1000행이 오면 `&id=gt.<마지막 id>`를 붙여 다음 쪽을 이어 받는다. Supabase(PostgREST)는 설정상 한 응답에 최대 1000행만 주고 나머지는 경고 없이 잘라내므로, 이 처리가 없으면 1000행을 넘는 데이터가 다른 기기에 내려오지 않는다.

| 항목 | 설명 |
|---|---|
| upsert | `on_conflict` + `merge-duplicates` → `INSERT ... ON CONFLICT DO UPDATE`. 서버 `keep_newer` 트리거가 옛 시각 업데이트를 무시 |
| 일괄 전송 | 종류별로 미업로드(`pend`) 항목을 **한 번의 배열 요청**으로 |
| 삭제 | 별도 DELETE 없음 → `deleted: true, data: {}` upsert (tombstone) |
| `user_id` | 본문에 `auth.user.id`를 넣지만, 서버 RLS `WITH CHECK`가 토큰의 uid와 다르면 거부 |
| 병렬 | R1~R3은 `Promise.all`로 동시, R4~R6도 동시 |
| 응답 정제 | R1~R3 결과는 `ID_RE`·`sanitizeEvent`·`sanitizeCats`·prefs 키 검사 후 반영 |

## 4. 오류 → 한국어 메시지 매핑

`authMsg(e)` (위에서부터 먼저 맞는 것):

| 조건 (code 또는 message 정규식) | 표시 문구 |
|---|---|
| `navigator.onLine === false` | 인터넷 연결을 확인해 주세요 |
| `invalid_credentials` · `/invalid login/i` | 이메일 또는 비밀번호가 틀려요 |
| `user_already_exists` · `/already registered/i` | 이미 가입된 이메일 · 로그인을 눌러 주세요 |
| `same_password` · `/different from the old/i` | 지금과 같은 비밀번호예요 |
| `weak_password` · `/password should/i` | 비밀번호는 6자 이상 |
| `reauthentication_needed` | 다시 로그인한 뒤 시도해 주세요 |
| `email_not_confirmed` · `/not confirmed/i` | 메일 인증이 아직이에요 |
| `otp_expired` · `/token has expired\|invalid.*otp\|otp.*invalid/i` | 인증번호가 틀렸거나 만료됐어요 |
| `signup_disabled` · `/signups not allowed/i` | 가입이 닫혀 있어요 |
| `email_address_invalid` · `validation_failed` · `/email.*invalid\|invalid.*email/i` | 이메일 형식을 확인해 주세요 |
| `over_request_rate_limit` · HTTP `429` | 잠시 후 다시 시도해 주세요 |
| 그 외 | 실패 · (원문 60자) |

화면별 추가 문구 (클라이언트 검증·흐름):

| 상황 | 문구 |
|---|---|
| 로그인/가입 칸 비움 | 이메일과 비밀번호를 입력해 주세요 |
| 비밀번호 찾기 이메일 비움 | 이메일을 입력해 주세요 |
| 비밀번호 변경 · 현재 비밀번호 틀림 | 현재 비밀번호가 틀려요 |
| 새 비밀번호 불일치 | 새 비밀번호가 서로 달라요 |
| 인증번호 6자리 아님 | 메일로 온 숫자 6자리를 입력해 주세요 |
| 인증번호 시간 초과 | 시간 초과 · 다시 보내기를 눌러 주세요 |
| 합치기 취소 | 로그인 취소됨 |
| 재설정 완료(로그인 안 된 경우) | 비밀번호 변경됨 · 새 비밀번호로 로그인 |
| 메일 링크 오류 | 링크가 만료됐어요 · 다시 요청해 주세요 / 링크 오류 · 다시 요청해 주세요 |

동기화 오류(`sync()` catch) → 상태:

| 원인 | `sy.err` | 메뉴 표시 |
|---|---|---|
| 토큰 갱신 실패(`signedOut`) | `relogin` | 다시 로그인 (빨강) |
| `TypeError` 또는 오프라인 | `offline` | 오프라인 (경고색 아님) |
| 그 외 (HTTP 4xx/5xx 등) | 오류 메시지 | 오류 (빨강), 시트에 메시지 80자 |

## 5. 기타 외부 호출

| # | 대상 | 메서드 · URL | 시점 | 실패 처리 |
|---|---|---|---|---|
| X1 | Nager.Date 공휴일 | `GET https://date.nager.at/api/v3/PublicHolidays/{year}/KR` | 화면에 보이는 연도의 캐시가 없거나 14일 경과 | 무시하고 캐시 사용, 같은 연도 중복 요청 방지(`pendingYears`) |
| X2 | Pretendard 글꼴 | `GET https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css` (+ 글꼴 파일) | 페이지 로드 | 시스템 글꼴로 대체 (`-apple-system`, `Apple SD Gothic Neo` 등), SW가 캐시 |

| 응답 처리 (X1) | 내용 |
|---|---|
| 사용 필드 | `date`, `localName`(없으면 `name`) |
| 제외 | `name`이 `Constitution Day`(제헌절), `Labour Day`(노동절) |
| 출력 | 이름은 `esc()` 후 `innerHTML` |
