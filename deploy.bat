@echo off
rem Weekly planner deploy: double-click to bump cache version, commit and push.
rem Optional: deploy.bat "commit message"
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
echo.
pause
