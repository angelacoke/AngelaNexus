@echo off
setlocal
cd /d "%~dp0"
where gh >nul 2>nul
if errorlevel 1 (
    echo 未找到 GitHub CLI: gh
    echo 安装：winget install --id GitHub.cli
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\AngelaNexus-CI.ps1"
echo.
if errorlevel 1 (echo AngelaNexus CI 验证失败.) else (echo AngelaNexus 全项目 CI 验证成功.)
pause
exit /b %errorlevel%
