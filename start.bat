@echo off
title Lovable Clone - Local Agent Server
color 0A

echo.
echo  ██╗      ██████╗ ██╗   ██╗ █████╗ ██████╗ ██╗     ███████╗
echo  ██║     ██╔═══██╗██║   ██║██╔══██╗██╔══██╗██║     ██╔════╝
echo  ██║     ██║   ██║██║   ██║███████║██████╔╝██║     █████╗
echo  ██║     ██║   ██║╚██╗ ██╔╝██╔══██║██╔══██╗██║     ██╔══╝
echo  ███████╗╚██████╔╝ ╚████╔╝ ██║  ██║██████╔╝███████╗███████╗
echo  ╚══════╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝
echo.
echo  AI Coding Agent - Local Helper
echo  ================================
echo.

REM Check Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo         Download from https://python.org/downloads
    echo         Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
pip install -r agent_server\requirements.txt --quiet --disable-pip-version-check
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies. Check your internet connection.
    pause
    exit /b 1
)

echo [2/3] Starting local agent server on http://localhost:8000 ...
echo.
echo  Your sandbox projects will be saved in: %~dp0sandbox\
echo.
echo  Next step: Open the Lovable website in your browser.
echo  (The website URL was shared with you separately.)
echo.
echo  Press Ctrl+C to stop the server.
echo  ─────────────────────────────────────────────────────
echo.

cd agent_server
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

pause
