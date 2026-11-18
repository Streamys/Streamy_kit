# Streamy Kit v0.3 (OBS 엔진 + 자체 UI)

치지직 · 유튜브 · SOOP 스트리머를 위한 방송 프로그램.
화면(UI)은 Electron으로 새로 만들고, 캡처 · 인코딩 · 송출은 **OBS Studio 엔진**(obs-studio-node 경유)을 사용합니다.

## 기능
- 장면: 사용자가 직접 추가 · 이름 변경 · 삭제 · 순서 변경, F1~F9 전환, 페이드 전환
- 소스: 모니터 화면 · 프로그램 창 · 게임 · 웹캠 · 이미지 · 텍스트 · 웹페이지(알림창) · 타이머 · 버추얼(Spout2) · 단색 배경
- 미리보기에서 소스를 클릭해 선택, 끌어서 이동, 모서리를 끌어 크기 조절 (자석: 가장자리/가운데, Alt로 끄기), 방향키 미세 이동
- 오디오 믹서: 데스크톱 · 마이크 · 앱별 소리마다 실시간 레벨 막대(막대 뒤에서 소리에 따라 움직임) + 볼륨 + 음소거
- 사운드 분리: 디스코드 · 크롬 · 엣지 · 웨일 · 스포티파이 · 멜론 앱별 캡처
- 장면 / 소스 / 오디오 설정 자동 저장 (%APPDATA%\Streamy Kit)
- 보이는 타이머 (경과 시간 / 카운트다운)
- 송출: 치지직 · 유튜브 · SOOP 프리셋, 그래픽카드 인코더 자동 선택, 자동 재연결
- 녹화 (MKV, 내 동영상\Streamy Kit)

## 구조
```
src/main.js              Electron 메인 (창, 트레이, 종료 처리)
src/server.js            로컬 서버 127.0.0.1:17890 (타이머 오버레이)
src/renderer/engine.js   OBS 엔진 래퍼 (장면, 소스, 오디오, 송출, 녹화)
src/renderer/app.js      화면 로직
src/renderer/index.html  화면
build/installer.nsi      윈도우 설치 파일 (NSIS)
```

## 빌드 (리눅스/맥에서도 윈도우용 생성 가능)
1. `npm install`
2. obs-studio-node 윈도우 빌드 받기: `https://s3-us-west-2.amazonaws.com/obsstudionodes3.streamlabs.com/osn-0.27.40-release-win64.tar.gz`
   (Electron 43.7.6용. 버전을 바꾸면 Electron 버전도 맞춰야 함)
3. `npx electron-packager . "Streamy Kit" --platform=win32 --arch=x64 --electron-version=43.7.6 --out=dist --no-asar --ignore='^/dist' --ignore='^/build'`
4. 받은 `obs-studio-node` 폴더를 `dist/Streamy Kit-win32-x64/resources/app/node_modules/`에 복사 (.pdb 삭제 가능)
5. `build/`에 `vc_redist.x64.exe`를 받아 두고 `makensis -DVERSION=0.3.0 build/installer.nsi` → `dist/StreamyKit-Setup-<버전>-x64.exe`

## 라이선스
GPL-2.0-or-later. OBS Studio(GPL-2.0-or-later), obs-studio-node(GPL-2.0)를 사용합니다. `build/NOTICE.txt` 참고.
