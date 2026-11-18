#!/usr/bin/env bash
# Streamy Kit 윈도우 설치 파일 빌드 (리눅스 / 맥 / WSL에서 실행)
# 필요: node 20+, curl, tar, makensis (NSIS 3)
#   Ubuntu: sudo apt install nsis   |   macOS: brew install makensis
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ELECTRON="43.7.6"          # obs-studio-node가 빌드된 Electron 버전과 반드시 같아야 함
OSN="0.27.40"              # obs-studio-node (Streamlabs) 버전
OSN_URL="https://s3-us-west-2.amazonaws.com/obsstudionodes3.streamlabs.com/osn-${OSN}-release-win64.tar.gz"
VC_URL="https://aka.ms/vs/17/release/vc_redist.x64.exe"
CACHE="$ROOT/.cache"
OUT="$ROOT/dist/Streamy Kit-win32-x64"

mkdir -p "$CACHE"
cd "$ROOT"

echo "▶ 1/5 의존성 설치"
npm install --no-audit --no-fund

echo "▶ 2/5 OBS 엔진(obs-studio-node ${OSN}) 받기"
if [ ! -d "$CACHE/osn-${OSN}/obs-studio-node" ]; then
  curl -fL -o "$CACHE/osn-${OSN}.tar.gz" "$OSN_URL"
  mkdir -p "$CACHE/osn-${OSN}"
  tar -xzf "$CACHE/osn-${OSN}.tar.gz" -C "$CACHE/osn-${OSN}"
fi

echo "▶ 3/5 Electron 윈도우 패키징"
rm -rf "$OUT"
npx --yes @electron/packager . "Streamy Kit" --platform=win32 --arch=x64 \
  --electron-version="$ELECTRON" --out=dist --overwrite --no-asar \
  --ignore='^/dist' --ignore='^/build' --ignore='^/docs' --ignore='^/\.cache' --ignore='demo-preview' \
  --app-copyright="Streamy (GPL-2.0-or-later)" \
  --win32metadata.CompanyName=Streamy --win32metadata.ProductName="Streamy Kit" --win32metadata.FileDescription="Streamy Kit"

echo "▶ 4/5 OBS 엔진 넣기 (디버그 파일 제외)"
APP="$OUT/resources/app/node_modules"
mkdir -p "$APP"
cp -a "$CACHE/osn-${OSN}/obs-studio-node" "$APP/"
find "$APP/obs-studio-node" \( -name '*.pdb' -o -name '*.lib' \) -delete

echo "▶ 5/5 설치 파일 만들기 (NSIS, 10분 정도 걸려요)"
[ -f "$ROOT/build/vc_redist.x64.exe" ] || curl -fL -o "$ROOT/build/vc_redist.x64.exe" "$VC_URL"
( cd "$ROOT/build" && makensis -V2 -DVERSION="$VERSION" installer.nsi )

echo "✔ 완료: dist/StreamyKit-Setup-${VERSION}-x64.exe"
