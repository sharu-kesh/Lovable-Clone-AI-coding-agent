#!/bin/bash
# Lovable Clone - Local Agent Server Startup Script (Mac / Linux)
# Usage: bash start.sh

echo ""
echo " ██╗      ██████╗ ██╗   ██╗ █████╗ ██████╗ ██╗     ███████╗"
echo " ██║     ██╔═══██╗██║   ██║██╔══██╗██╔══██╗██║     ██╔════╝"
echo " ██║     ██║   ██║██║   ██║███████║██████╔╝██║     █████╗"
echo " ██║     ██║   ██║╚██╗ ██╔╝██╔══██║██╔══██╗██║     ██╔══╝"
echo " ███████╗╚██████╔╝ ╚████╔╝ ██║  ██║██████╔╝███████╗███████╗"
echo " ╚══════╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝"
echo ""
echo " AI Coding Agent - Local Helper"
echo " ================================"
echo ""

# Navigate to the repo root (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check Python is installed
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] Python 3 is not installed."
    echo "        Install it from https://python.org/downloads"
    exit 1
fi

echo "[1/3] Installing dependencies..."
pip3 install -r agent_server/requirements.txt --quiet --disable-pip-version-check
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install dependencies. Check your internet connection."
    exit 1
fi

echo "[2/3] Starting local agent server on http://localhost:8000 ..."
echo ""
echo " Your sandbox projects will be saved in: $SCRIPT_DIR/sandbox/"
echo ""
echo " Next step: Open the Lovable website in your browser."
echo " (The website URL was shared with you separately.)"
echo ""
echo " Press Ctrl+C to stop the server."
echo " ─────────────────────────────────────────────────────"
echo ""

cd agent_server
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
