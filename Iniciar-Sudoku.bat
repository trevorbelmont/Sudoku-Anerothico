@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Sudoku Aneróthico PRÓ v6.0 - Servidor local
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor-local.ps1"
if errorlevel 1 (
  echo.
  echo [ERRO] O servidor terminou com um erro. Leia a mensagem acima.
  echo.
  pause
)
endlocal
