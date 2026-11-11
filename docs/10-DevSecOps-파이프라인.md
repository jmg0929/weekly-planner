# 10. DevSecOps 파이프라인 — 1단계: CI 보안 자동화

> 사람이 "기억해서" 하던 검사를 **코드로 강제**한다. 커밋 직전(내 PC) → push 직후(GitHub Actions) → 배포 직전(`deploy.ps1`) 세 곳에서 같은 규칙을 검사한다.
> 도입: 2026-11-11, 커밋 `be7a5d5` · 앱 코드(`index.html`)는 바꾸지 않음 → 캐시 버전 그대로(`planner-v58`)

## 1. 왜 만들었나

| 이전 상태 | 위험 | 1단계에서 바꾼 것 |
|---|---|---|
| 문법 검사 · 서비스워커 테스트를 **수동**으로 실행 ([08-테스트 §4](08-테스트.md#4-회귀-테스트-방법)) | 깜빡하면 깨진 코드가 그대로 배포 | push마다 CI가 자동 실행, 배포 스크립트도 실패 시 중단 |
| "service_role 키는 쓰지 않는다"가 **문서의 약속**뿐 ([07-보안설계 §3](07-보안설계.md#3-구현된-보안-통제) 비밀 관리) | 실수로 서버 키를 커밋하면 공개 저장소에 영구 노출 → RLS 무력화 | 커밋 직전 · CI 두 겹의 비밀값 검사 |
| XSS 방어(`esc()` · 정제 함수)가 **코드 리뷰 습관**에 의존 (위협 T6) | 새 화면을 만들 때 `esc()` 하나만 빠져도 저장형 XSS | 이 프로젝트 전용 Semgrep 규칙으로 `esc()` 없는 `innerHTML`을 차단 |

## 2. 전체 흐름

```mermaid
flowchart LR
  subgraph PC["내 PC"]
    C["git commit"] --> H{"pre-commit 훅<br/>secret-guard · gitleaks · 문법"}
    H -- 실패 --> X1["커밋 막힘"]
    D["deploy.ps1"] --> DC{"배포 전 검사<br/>문법 · SW 테스트 · 비밀값"}
    DC -- 실패 --> X2["버전 안 올리고 중단"]
  end
  H -- 통과 --> P["git push"]
  DC -- 통과 --> P
  subgraph GA["GitHub Actions"]
    P --> T["test<br/>문법 · SW 테스트 · 규칙 테스트"]
    P --> S["secrets<br/>gitleaks 전체 이력 + 일부러 실패시키기"]
    P --> SA["sast<br/>Semgrep 사용자 규칙"]
    P --> Q["CodeQL<br/>security-extended"]
  end
  SA -- SARIF --> SEC["Security 탭<br/>Code scanning"]
  Q -- SARIF --> SEC
  P --> GH["GitHub Pages 배포"]
```

> 지금은 검사와 Pages 배포가 **나란히** 돈다 (검사가 실패해도 배포는 됨). 검사 통과 → 승인 → 배포 순서의 게이트는 3단계에서 Pages 배포를 Actions로 옮기며 적용 (§8).

## 3. 구성 요소

| 단계 | 도구 | 막는 것 | 관련 위협 | 파일 |
|---|---|---|---|---|
| 커밋 직전 | `secret-guard.js` (Node, 설치 불필요) + gitleaks(설치돼 있으면) | 서버 키 · 개인 키 · AWS · GitHub 토큰 커밋 | 비밀 노출 | `.githooks/pre-commit`, `scripts/secret-guard.js` |
| CI `test` | Node 24 | 스크립트 문법 오류, manifest 형식, SW 캐시 범위(TC-14), 비밀값 규칙 회귀 | 가용성 · B-03 회귀 | `scripts/check-syntax.js`, `tests/*.test.js` |
| CI `secrets` | gitleaks 8.30.1 | **전체 이력**의 비밀값 (지운 커밋 포함) | 비밀 노출 | `.gitleaks.toml` |
| CI `sast` | Semgrep 1.182.1 사용자 규칙 3개 | `esc()` 없는 `innerHTML`, `eval` 류, 클라이언트의 서버 키 | T6 (XSS) | `.semgrep/planner-xss.yaml` |
| CodeQL | GitHub CodeQL `security-extended` | 일반 JS 취약점 패턴 (DOM XSS, 안전하지 않은 정규식 등) | 전반 | `.github/workflows/codeql.yml` |
| 배포 직전 | `deploy.ps1` 1.5단계 | 위 검사를 통과하지 못한 배포 | — | `deploy.ps1` |

## 4. 비밀값 검사

### 4.1 규칙
| 규칙 | 찾는 것 | 비고 |
|---|---|---|
| gitleaks 기본 규칙 전체 | 클라우드 · SaaS 토큰 등 | `useDefault = true` |
| `supabase-secret-key` (추가) | `sb_secret_…` | 새 형식 서버 키 — RLS 무시 |
| `supabase-service-role-jwt` (추가) | JWT 본문에 `"role":"service_role"` | base64 정렬 3가지(`c2VydmljZV9yb2xl` · `NlcnZpY2Vfcm9sZ` · `zZXJ2aWNlX3JvbG`)를 모두 찾음 |
| `secret-guard.js` | 위 2개 + 개인 키 · AWS · GitHub 토큰 | JWT는 **실제로 디코딩**해서 `role`을 확인 → anon 키는 통과 |

### 4.2 처음 돌렸을 때: 1건 → 검토 → 좁은 예외
| 항목 | 내용 |
|---|---|
| 발견 | 기본 규칙 `generic-api-key`가 `index.html`의 `SB_KEY`(커밋 `89f1255`부터) 탐지 |
| 판단 | publishable 키 = 브라우저로 내려가는 **공개값**. 권한은 서버 RLS가 막음 ([07-보안설계](07-보안설계.md)). 유출 아님 |
| 조치 | 예외를 **값의 형식** `sb_publishable_…`으로만 좁게 등록 (파일 · 규칙 전체 예외 X), 근거를 설정 파일 주석에 기록 |
| 결과 | 커밋 50개 전체 이력 → 0건 |

### 4.3 "검사가 고장 나서 조용히 통과"하는 것을 막기 (canary)
CI가 실행될 때마다 임시 폴더에 **가짜 서버 키를 만들어** gitleaks에 넣고, 종료 코드 42(유출 발견)가 나와야만 통과한다. 규칙 파일이 깨지거나 예외가 너무 넓어지면 이 단계가 빨간불이 된다. 가짜 키는 실행 중에만 만들어서 저장소에는 키 모양 문자열이 없다 (`tests/secret-guard.test.js`도 같은 방식).

## 5. Semgrep 사용자 규칙 — "이 프로젝트의 약속"을 코드로

### 5.1 규칙
| ID | 방식 | 내용 |
|---|---|---|
| `planner-innerhtml-unescaped` | **taint(데이터 흐름) 분석** | 출처(`.title` · `.name` · `.location` · `.emoji` · `.email` · 입력칸 `.value` · `location.hash` · `localStorage.getItem`)가 `esc()`를 거치지 않고 `innerHTML` · `outerHTML` · `insertAdjacentHTML` · `document.write`에 닿으면 오류. `h += …` 누적, `forEach` 안 누적, `list.map(…).join("")` 콜백 반환값까지 추적 |
| `planner-string-to-code` | 패턴 | `eval`, `new Function`, 문자열 `setTimeout/setInterval` |
| `planner-server-key-in-client` | 정규식 | 클라이언트 코드의 `service_role` · `sb_secret_` |

### 5.2 규칙도 테스트한다
`.semgrep/planner-xss.js`에 `// ruleid:`(잡아야 함) · `// ok:`(잡으면 안 됨) 표시를 단 예제(잡아야 할 8곳 · 잡으면 안 되는 7곳) — `index.html`의 실제 모양(이어 붙이기 · 루프 누적 · `map().join` · `esc()` 감싼 경우 · 숫자만 넣는 경우 · `textContent`)을 흉내 냄. CI에서 `semgrep --test`로 규칙이 바뀔 때마다 확인.

### 5.3 실제 코드에 처음 돌렸을 때: 오탐 3건 → 원인 분석 → 근거를 남긴 예외
| 위치 | 탐지 | 원인 | 판정 |
|---|---|---|---|
| `index.html` 2132 · 2644 (최근 입력 목록) | `box.innerHTML = list.map(…)` | `list = recentFrom(…, 입력칸.value)` — Semgrep은 "오염된 값을 인자로 받은 함수의 결과도 오염"으로 봄 | `recentFrom`은 입력을 **검색어로만** 쓰고 저장된 항목을 돌려줌. 항목 제목은 그리는 곳에서 `esc()` → 안전 |
| 2422 (카테고리 편집 목록) | `catList.innerHTML = h` | `h += emoGrid(editCat.emoji)` | `emoGrid`는 고정 목록 `EMOJIS`로만 버튼을 만들고 인자는 "선택됨" 비교에만 씀 → 안전 |

조치: 두 함수를 규칙의 sanitizer로 등록하고 **검토 날짜 · 근거를 규칙 파일에 주석으로** 남김 (코드에 `nosemgrep`을 흩뿌리지 않음). 검토 중 `map()` 콜백 반환값을 놓치는 규칙 결함도 발견해 sink를 보강 → 규칙 테스트 3/3 통과, 실제 코드 0건.

### 5.4 진짜로 잡는지 확인 (변이 테스트)
검사용 사본에서 카테고리 필터의 `esc(c.name)` 하나를 `c.name`으로 바꾸자 **1건 탐지** — 보고된 줄 번호 2359가 `index.html`의 `menuFilterEl.innerHTML=h;`와 정확히 일치.

### 5.5 HTML 안 스크립트를 검사하는 방법
Semgrep은 `.html` 안의 `<script>`를 읽지 못함 → `scripts/extract-inline-js.js`가 스크립트를 꺼내면서 **앞에 빈 줄을 채워 줄 번호를 `index.html`과 같게** 만듦. CI는 SARIF 결과의 파일 경로만 `index.html`로 바꿔 Security 탭에 올림 → 경고를 누르면 원본 줄로 바로 이동. 문법 검사(`node --check`) 오류 줄 번호도 같은 방식으로 원본과 일치.

## 6. 공급망 보안 · 최소 권한

| 항목 | 적용 |
|---|---|
| Action 고정 | 태그(`@v7`)가 아니라 **커밋 해시**로 고정, 옆에 버전 주석. 태그는 옮겨질 수 있음 |
| 버전 쿨다운 | 공개된 지 **2주 이상** 지난 버전만 사용 (CodeQL Action v4.39.0 · Semgrep 1.182.1 — 더 새 버전이 있었지만 갓 나온 버전은 제외) |
| 도구 무결성 | gitleaks는 공식 릴리스 + **SHA-256 체크섬 확인** 후 설치 |
| 토큰 권한 | 워크플로 기본 `contents: read`, Security 탭에 올리는 job만 `security-events: write` |
| 자격 증명 | `checkout`에 `persist-credentials: false` — 이후 단계가 저장소 토큰을 쓰지 못함 |
| 동시 실행 | `concurrency` + `cancel-in-progress`로 같은 브랜치의 이전 실행 취소 |
| 외부 전송 | `SEMGREP_SEND_METRICS=off`, `--metrics=off` |

## 7. 검증 결과

| 검증 | 결과 |
|---|---|
| 문법 검사 | index.html 스크립트 2개 · sw.js · manifest 통과 |
| 서비스워커 테스트 (TC-14) | 8/8 통과 |
| `secret-guard` 규칙 테스트 | 9/9 (잡아야 할 6 · 통과시켜야 할 3) |
| gitleaks 전체 이력 | 커밋 50개 · 0건 (예외 등록 후) |
| gitleaks canary | 가짜 키 4종(새 형식 1 + JWT 정렬 3) 모두 탐지, 기본 `jwt` 규칙과 함께 7건 |
| pre-commit 훅 | 임시 저장소에서 가짜 서버 키를 스테이징 → 커밋 막힘, 값은 출력하지 않고 파일:줄 · 규칙만 표시 |
| Semgrep 규칙 테스트 | 3/3 규칙 통과 |
| Semgrep 실제 코드 | 0건 (오탐 3건 검토 후) · 변이 테스트 1건 탐지 |
| `deploy.ps1 -DryRun` | 배포 전 검사 단계 통과 |
| GitHub Actions 첫 실행 | (아래 §7.1) |

### 7.1 GitHub Actions 첫 실행 (커밋 `be7a5d5`, 2026-11-11)

| 워크플로 · job | 결과 | 걸린 시간 | 비고 |
|---|---|---|---|
| CI · 문법 · 테스트 | 성공 | 6초 | 문법 · TC-14 · secret-guard 규칙 테스트 |
| CI · 비밀값 검사 (gitleaks) | 성공 | 7초 | 체크섬 확인 설치 → 전체 이력 0건 → canary 탐지 확인 |
| CI · 정적 분석 (Semgrep) | 성공 | 32초 | 규칙 테스트 → 검사 0건 → SARIF를 Security 탭에 업로드 |
| CodeQL (javascript) | 성공 | 65초 | `security-extended` 분석 완료. 경고 목록은 저장소 주인만 보는 Security 탭에서 확인 |
| (기존) GitHub Pages 배포 | 성공 | — | 검사와 나란히 실행 |

## 8. 한계 · 다음 단계

| 항목 | 현재 | 다음 |
|---|---|---|
| 배포 게이트 | 검사와 Pages 배포가 나란히 실행 | **3단계**: Pages 배포를 Actions로 옮겨 `검사 통과 → Environment 승인(Required reviewers) → 배포`, main 브랜치 보호 |
| Semgrep 범위 | 클라이언트 JS taint는 함수 안(intraprocedural)만 추적 | 새 화면 패턴이 생기면 테스트 예제부터 추가 |
| 서버(클라우드) 설정 | RLS는 SQL 파일 + 수동 확인 | **2단계**: 로컬 Supabase(Docker)로 "A가 B의 행을 읽을 수 있나" 자동 테스트 |
| 실행 중 앱 점검 | 없음 | **2단계**: OWASP ZAP baseline 주간 스캔 → 이슈 자동 등록, `<meta>` CSP |
| 커밋 직전 훅 | 저장소마다 `git config core.hooksPath .githooks` 한 번 필요 | — (안 켜도 CI에서 다시 걸림) |
