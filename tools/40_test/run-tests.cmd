@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-tests.ps1"
if /i not "%~1"=="nopause" pause
