@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [1/4] �?查构建环�?...
where python >nul 2>nul || (echo �?找到 Python，�?�安�? 64 �? Python 3.10 或更高版�?并勾�? Add to PATH�?& exit /b 1)
where node >nul 2>nul || (echo �?找到 Node.js，�?�安�? Node.js 18 LTS 或更高版�?�?& exit /b 1)
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)" || (echo Python 版本过低，PyInstaller 6 �?�? Python 3.9 或更高版�?�?& exit /b 1)
node -e "if (Number(process.versions.node.split('.')[0]) < 18) process.exit(1)" || (echo Node.js 版本过低，需�? 18 或更高版�?�?& exit /b 1)

echo [2/4] 构建�?地代�?...
call agent\build.bat || (echo �?地代理构建失败�??& exit /b 1)
if not exist "desktop\resources\backend\storagebear.exe" (echo �?生成 desktop\resources\backend\storagebear.exe�?& exit /b 1)

echo [3/4] 安�?? Electron 构建依赖...
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
if not defined ELECTRON_BUILDER_BINARIES_MIRROR set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
if not exist "desktop\node_modules\electron\package.json" (
  pushd desktop
  call npm install --no-audit --no-fund || (popd & echo Electron 依赖安�?�失败�??& exit /b 1)
  popd
)
if not exist "desktop\node_modules\electron-builder\package.json" (
  pushd desktop
  call npm install --no-audit --no-fund || (popd & echo Electron 构建依赖安�?�失败�??& exit /b 1)
  popd
)

echo [4/4] 生成 Windows 安�?�包...
pushd desktop
call npm run dist:win || (popd & echo 安�?�包构建失败�?& exit /b 1)
popd
echo.
echo 完成：desktop\release\StorageBear-Setup-0.3.1.exe
echo 安�?�时才会联网获取 Visual C++ 运�?�库，并�?�? WebDAV 客户�?�?
exit /b 0
