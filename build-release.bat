@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [1/4] 检查构建环境...
where python >nul 2>nul || (echo 未找到 Python，请安装 64 位 Python 3.10 或更高版本并勾选 Add to PATH。& exit /b 1)
where node >nul 2>nul || (echo 未找到 Node.js，请安装 Node.js 18 LTS 或更高版本。& exit /b 1)
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)" || (echo Python 版本过低，PyInstaller 6 需要 Python 3.9 或更高版本。& exit /b 1)
node -e "if (Number(process.versions.node.split('.')[0]) < 18) process.exit(1)" || (echo Node.js 版本过低，需要 18 或更高版本。& exit /b 1)

echo [2/4] 构建本地代理...
call agent\build.bat || (echo 本地代理构建失败。& exit /b 1)
if not exist "desktop\resources\backend\storagebear.exe" (echo 未生成 desktop\resources\backend\storagebear.exe。& exit /b 1)

echo [3/4] 安装 Electron 构建依赖...
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
if not defined ELECTRON_BUILDER_BINARIES_MIRROR set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
if not exist "desktop\node_modules\electron\package.json" (
  pushd desktop
  call npm install --no-audit --no-fund || (popd & echo Electron 依赖安装失败。& exit /b 1)
  popd
)
if not exist "desktop\node_modules\electron-builder\package.json" (
  pushd desktop
  call npm install --no-audit --no-fund || (popd & echo Electron 构建依赖安装失败。& exit /b 1)
  popd
)

echo [4/4] 生成 Windows 安装包...
pushd desktop
call npm run dist:win || (popd & echo 安装包构建失败。& exit /b 1)
popd
echo.
echo 完成：desktop\release\StorageBear-Setup-0.1.7.exe
echo 安装时才会联网获取 Visual C++ 运行库，并启用 WebDAV 客户端。
exit /b 0
