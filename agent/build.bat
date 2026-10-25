@echo off
setlocal
cd /d "%~dp0"
where pyinstaller >nul 2>nul
if errorlevel 1 python -m pip install --disable-pip-version-check -U pyinstaller
python -m PyInstaller --noconfirm --clean storagebear.spec
if errorlevel 1 exit /b 1
if not exist "..\desktop\resources\backend" mkdir "..\desktop\resources\backend"
copy /y "dist\storagebear.exe" "..\desktop\resources\backend\storagebear.exe" >nul
echo Agent built: desktop\resources\backend\storagebear.exe
