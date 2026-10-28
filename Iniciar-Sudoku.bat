@echo off
setlocal
cd /d "%~dp0"
title Sudoku Anerothico PRO - Servidor local
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor-local.ps1"
if errorlevel 1 (
  echo.
  echo Nao foi possivel iniciar o Sudoku. Verifique se o Windows PowerShell esta disponivel.
  pause
)
