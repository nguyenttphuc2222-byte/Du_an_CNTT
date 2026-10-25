@echo off
cd /d "%~dp0"
docker compose up -d --build
if errorlevel 1 (
  echo Please start Docker Desktop and try again.
  pause
  exit /b 1
)
echo Demo URL: http://localhost:3000
pause
