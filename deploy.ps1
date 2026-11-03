# 주간 플래너 배포: 서비스워커 캐시 버전 +1 -> 커밋 -> GitHub 푸시
# 사용법
#   deploy.bat 더블클릭                 (커밋 메시지는 날짜로 자동)
#   deploy.bat "카드 디자인 수정"        (메시지 직접 지정)
#   powershell -File deploy.ps1 -DryRun (아무것도 안 바꾸고 할 일만 미리보기)
param(
  [string]$Message,
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

function Step($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host ""; Write-Host "[실패] $t" -ForegroundColor Red; exit 1 }

# 0) git 저장소 확인
$inside = git rev-parse --is-inside-work-tree 2>$null
if ($inside -ne 'true') { Fail "이 폴더는 git 저장소가 아니에요." }

# 1) 바뀐 파일이 있는지
$changes = git status --porcelain
if (-not $changes) {
  Write-Host "바뀐 파일이 없어서 올릴 게 없어요." -ForegroundColor Yellow
  exit 0
}
Step "바뀐 파일"
$changes | ForEach-Object { Write-Host "    $_" }

# 2) 서비스워커 캐시 버전 +1 (아이폰이 새 버전을 확실히 받도록)
$sw = Join-Path $PSScriptRoot 'sw.js'
$utf8 = New-Object System.Text.UTF8Encoding $false   # BOM 없는 UTF-8 (한글 주석 보존)
if (Test-Path $sw) {
  $text = [System.IO.File]::ReadAllText($sw, $utf8)
  $m = [regex]::Match($text, 'planner-v(\d+)')
  if ($m.Success) {
    $newVer = 'planner-v' + ([int]$m.Groups[1].Value + 1)
    Step "캐시 버전: $($m.Value) -> $newVer"
    if (-not $DryRun) {
      $text = $text.Remove($m.Index, $m.Length).Insert($m.Index, $newVer)
      [System.IO.File]::WriteAllText($sw, $text, $utf8)
    }
  }
}

# 3) 커밋
if (-not $Message) { $Message = "update: " + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
Step "커밋 메시지: $Message"

if ($DryRun) {
  Write-Host ""
  Write-Host "[미리보기] 실제로는 아무것도 바꾸지 않았어요. -DryRun 없이 실행하면 위 내용대로 올라가요." -ForegroundColor Yellow
  exit 0
}

git add -A
git commit -m $Message
if ($LASTEXITCODE -ne 0) { Fail "커밋에 실패했어요." }

# 4) 푸시 (원격에 새 커밋이 있으면 먼저 받아서 합친 뒤 다시 푸시)
Step "GitHub에 올리는 중..."
git push
if ($LASTEXITCODE -ne 0) {
  Step "원격이 앞서 있어서 먼저 받아와 합칠게요 (pull --rebase)"
  git pull --rebase --autostash
  if ($LASTEXITCODE -ne 0) { Fail "자동으로 합치지 못했어요. 'git status'로 충돌 파일을 확인해 주세요." }
  git push
  if ($LASTEXITCODE -ne 0) { Fail "푸시에 실패했어요. 로그인(토큰) 상태를 확인해 주세요." }
}

Write-Host ""
Write-Host "[완료] 배포됐어요! 1~2분 뒤 아이폰에서 앱을 완전히 껐다 켜면 새 버전이 떠요." -ForegroundColor Green
