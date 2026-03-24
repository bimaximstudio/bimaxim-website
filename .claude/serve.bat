@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 3000
