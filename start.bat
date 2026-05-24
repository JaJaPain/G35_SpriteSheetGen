@echo off
title AI Sprite Animation Studio Launcher
cd /d "%~dp0"

:: Kill any existing process on port 5173 (frontend)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo Cleaning up existing process on port 5173...
    taskkill /f /pid %%a >nul 2>&1
)

:: Kill any existing process on port 8000 (backend)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo Cleaning up existing process on port 8000...
    taskkill /f /pid %%a >nul 2>&1
)

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
call npm --version >nul 2>&1
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
    echo       Installing frontend npm packages - this may take a minute...
    cd /d "%~dp0\frontend"
    call npm install
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

:: Check and start Ollama in background
ollama --version >nul 2>&1
if %errorlevel% equ 0 (
    echo   - Starting Ollama AI Service in background - Models: C:\AIModels...
    set OLLAMA_MODELS=C:\AIModels
    start "Ollama Service" /Min cmd /c "ollama serve"
) else (
    echo   - [WARNING] Ollama is not installed or not in PATH. Quality Control verification will be disabled.
)

echo   - Starting FastAPI backend on http://127.0.0.1:8000
start "Sprite Studio Backend" /Min cmd /c "backend\venv\Scripts\python.exe backend\app_server.py"

echo   - Starting Vite frontend on http://localhost:5173
start "Sprite Studio Frontend" /Min cmd /c "cd /d frontend && npm run dev"

echo.
echo Waiting for servers to initialize...
powershell -Command "for ($i=0; $i -lt 30; $i++) { $c = New-Object System.Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', 5173); if ($c.Connected) { $c.Close(); break } } catch {} $c.Close(); Start-Sleep -Seconds 1 }"

echo Opening browser...
start http://127.0.0.1:5173/

echo.
echo ===================================================
echo   Sprite Animation Studio is now running!
echo   - Frontend: http://127.0.0.1:5173/
echo   - Backend API: http://127.0.0.1:8000
echo.
echo   Press any key to close this launcher.
echo   (The servers run in separate minimized windows in the taskbar).
echo ===================================================
pause
