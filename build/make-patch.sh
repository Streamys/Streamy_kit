#!/usr/bin/env bash
# 빠른 업데이트 ZIP 만들기 (화면/기능 코드 src만 담음 → 몇 백 KB, 관리자 권한 없이 몇 초 만에 적용)
#   사용: build/make-patch.sh [minBase]
#   minBase = 이 패치를 쓸 수 있는 최소 "설치" 버전. Electron · 엔진 · node_modules(의존성)가 바뀌면
#             빠른 업데이트로는 안 되고 설치 파일(build-win.sh)로 내야 해요.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
MIN=${1:-0.8.2}
OUT="dist/StreamyKit-Patch-$V.zip"
tmp=$(mktemp -d)
cp -r src "$tmp/src"
rm -f "$tmp/src/renderer/demo-preview.png"
printf '{"version":"%s","minBase":"%s","built":"%s"}\n' "$V" "$MIN" "$(date -u +%FT%TZ)" > "$tmp/patch.json"
(cd "$tmp" && zip -qr -9 out.zip patch.json src)
mkdir -p dist && mv "$tmp/out.zip" "$OUT" && rm -rf "$tmp"
echo "$OUT ($(du -h "$OUT" | cut -f1))"
