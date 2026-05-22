@echo off
title AI Sprite Animation Studio Launcher
cd /d "%~dp0"
echo ===================================================
echo     AI Sprite Animation Studio Launcher
echo ===================================================
echo.

:: Check for Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH. Please install Python.
    pause
    exit /b 1
)

:: Check for Node/NPM
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js/NPM is not installed or not in PATH. Please install Node.js.
    pause
    exit /b 1
)

:: Set up backend environment
echo [1/4] Checking backend virtual environment...
if not exist "backend\venv" (
    echo       Creating Python virtual environment...
    python -m venv backend\venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

echo [2/4] Installing/updating backend requirements...
backend\venv\Scripts\pip install -r backend\requirements.txt -q
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install backend dependencies.
    pause
    exit /b 1
)

:: Set up frontend environment
echo [3/4] Checking frontend dependencies...
if not exist "frontend\node_modules" (
    echo       Installing frontend npm packages (this may take a minute)...
    cd /d "%~dp0\frontend"
    npm install
    cd /d "%~dp0"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install frontend dependencies.
        pause
        exit /b 1
    )
)

:: Start services
echo [4/4] Starting Sprite Studio Servers...
echo.

echo   - Starting FastAPI backend on http://127.0.0.1:8000
start "Sprite Studio Backend" /Min cmd /c "backend\venv\Scripts\python.exe backend\app_server.py"

echo   - Starting Vite frontend on http://localhost:5173
start "Sprite Studio Frontend" /Min cmd /c "cd /d frontend && npm run dev"

echo.
echo Waiting for servers to initialize...
timeout /t 4 /nobreak >nul

echo Opening browser...
start http://localhost:5173/

echo.
echo ===================================================
echo   Sprite Animation Studio is now running!
echo   - Frontend: http://localhost:5173/
echo   - Backend API: http://127.0.0.1:8000
echo.
echo   Press any key to close this launcher.
echo   (The servers run in separate minimized windows in the taskbar).
echo ===================================================
pause
