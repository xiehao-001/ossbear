#!/bin/sh
set -e
cd "$(dirname "$0")"
python3 -m pip install --disable-pip-version-check -U pyinstaller
python3 -m PyInstaller --noconfirm --clean storagebear.spec
mkdir -p ../desktop/resources/backend
cp dist/storagebear ../desktop/resources/backend/storagebear
echo "Agent built: desktop/resources/backend/storagebear"
