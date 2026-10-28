@echo off
chcp 65001 >nul
title DSH Sidebar Spider - push to GitHub
echo.
echo DSH Sidebar Spider - one-click push to GitHub
echo repo:   %~dp0
echo remote: https://github.com/yanx215241-a11y/dsh-sidebar-spider
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push-to-github.ps1"
if errorlevel 1 (
  echo.
  echo [FAILED] see the messages above.
  pause
)
exit /b 0
