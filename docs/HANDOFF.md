# Streamy Kit 인수인계 (2026-11-20 기준)

> 다음 작업자가 바로 이어갈 수 있게 정리한 문서입니다. 기능 소개는 `README.md`, 기획은 `docs/PLAN.md`를 보세요.

## 0. 한눈에

| 항목 | 상태 |
|---|---|
| 최신 버전 | **v0.26.7** (`package.json` = GitHub 최신 릴리스 `v0.26.7`, 빠른 업데이트 ZIP) |
| 최신 설치 파일 | **v0.26.2** 릴리스의 `StreamyKit-Setup-0.26.2-x64.exe` (켜면 최신 패치까지 자동으로 올라감) |
| 빠른 업데이트 최소 설치 버전 | `build/patch-min-base` = **0.8.2** |
| 작업 트리 | 이 문서 · `build/shot.js` 추가 커밋 외 **커밋 안 된 변경 없음** (아래 6절) |
| 보류 | **업데이트 전자서명 검증 · 바탕화면 폴더 업데이트 차단**, **실제 방송(송출) 테스트** — 사용자가 "나중에"로 보류 |
| 사용자 | 한국어 · 반말 · 캐주얼. 디자인 피드백은 Claude Design 캔버스 댓글로 줌 |

---

## 1. 완료한 변경 (이번 세션, v0.15 → v0.26.7)

모든 변경은 `main`에 푸시됐고, 버전을 올린 커밋마다 `quick-release.yml`이 빠른 업데이트 릴리스를 만들었습니다.

### 화면 · 디자인
- **소스**: 왼쪽 [＋ 추가] → 오버레이(왼쪽 종류 목록 · 오른쪽 설정 · [＋ 이 장면에 넣기] · "넣고 나서 창 닫지 않기"), 끌어서 순서, [삭제] 버튼으로 끌어 빼기, 사진 파일 · URL 창에 끌어다 놓기 (v0.15 ~ v0.20)
- **장면**: [＋ 추가] [삭제], 끌어서 순서, [삭제]로 끌어 빼기 (v0.19)
- **탭 6개**: 방송 · 채팅 · 소스 · 버추얼 · 사운드 · 설정 (v0.21 버추얼, v0.25.1 사운드)
- **소스 탭**: 고른 소스 설정 칸(고른 게 있을 때만) · 방송 타이머(타이머 소스가 있을 때만)
- **설정 탭 정리**: 채널 연결 · ON AIR 체크 · 단축키 · 정보 칸 삭제, 화질 → 방송 탭 (v0.23). GPL 고지는 업데이트 칸 밑 "오픈소스 라이선스" 한 줄로 남김
- **방송 정보**: [통합] [치지직] [유튜브] [SOOP] 탭, 플랫폼별 "통합 내용 사용 / 따로 설정", 적용할 곳 칩, 플랫폼별 적용 (v0.24). 데이터: `cfg.bc` (`title/tags/desc` 공통, `own.{chzzk,youtube,soop}`, `toCz/toYt/toSoop`, `czCat`, `ytCat`, `auto`)
- **화면 꾸미기**(제목줄 [레이아웃]): 글자 크기(webFrame 줌) · 글꼴(설치 감지 + 파일 가져오기 → `userData/fonts`) · 칸 끌어서 3기둥 배치 · 기둥 너비 · 칸 높이 (v0.18 ~ v0.19). 데이터: `cfg.layout2`, `cfg.customFonts`
- **테마**: 순흰색/순검정 대신 포인트 색이 살짝 섞인 바탕(`applyAccent`에서 계산), 밝게 모드 칸 대비 강화 (v0.16.1 ~ v0.16.3)
- **아이콘**: 이모지 → 직접 그린 단색 SVG (`src/renderer/icons.js`, `currentColor`), 앱 아이콘도 포인트 색 (v0.15.3 ~ v0.16)
- **확인 · 안내 창**: `uiConfirm()` · `uiNotice()` (앱 디자인, 삭제류는 빨강, Esc/Enter) (v0.20.1, v0.26)
- **체크 상자** 새 디자인 (v0.26.1), **엔진 준비 화면**(어두운 전체 덮개 + 채워지는 막대, 상자 없음) (v0.26.3 ~ v0.26.5)
- **최소화 오버레이** 새 디자인(앱 테마 · 포인트 색 · 글꼴 따라감) (v0.25)
- **글 줄이기 · 줄 맞춤**: 설명 문구 숨김, 카드 제목/여백/버튼 통일, 사운드 % 위치, 아이콘+글자 세로 정렬 (v0.22 ~ v0.22.1), 플랫폼 뱃지(색 점 · 치/유/숲) 제거 — 채팅 메시지 안 표시만 유지 (v0.24.1)

### 동작 · 안정성
- **v0.28.0 소스별 따로 녹화**: 방송 탭 [녹화] 카드에서 최대 3개 소스 선택. 녹화 시 `녹화폴더/날짜 시간/`에 `전체 화면.mkv` + `소스이름.mkv` + `편집 프로젝트 (프리미어 · 다빈치).xml`(FCP7 xmeml: V1 전체, V2~ 소스, A1~ 전체 화면 파일의 소리 트랙). 구현: 소스마다 `VideoFactory` 캔버스를 하나 더 만들고, 현재 장면에 그 캔버스 전용 숨은 항목(`scene.add(src, transform, ctx)`)을 꽉 채워 넣어 `AdvancedRecording.video = ctx`로 녹화. Streamlabs libobs는 `item->canvas == NULL`인 항목을 **모든 캔버스에 그리므로** 녹화 중엔 사용자 항목을 전부 `item.video = this.video`로 묶음(`pinMain`). 숨은 항목은 `engine.isoItems`로 관리, `uItems()`로 목록 · 선택 · 저장 · 클릭에서 제외, 장면 바꾸면 `isoAttach`로 옮김. **실기기 미확인** — 특히 NVENC 동시 세션 수, 장면 전환 중 화면, xml 가져오기.
- **v0.28.0~0.28.1 방송 · 녹화 따로 보이기**: 소스 선택 후 편집 막대 [방송] [녹화] 켜고 끄기(눈 아이콘, 끄면 줄 그음; 둘 다 끄기는 막고 눈 버튼 안내). 미리보기 가이드에 빗금 + "방송 제외 / 녹화 제외", 소스 목록에 빠진 쪽 표시. 항목 `streamVisible/recordingVisible` + `Global.multipleRendering`(따로 보이기 항목이 하나라도 있을 때만 켬; 방송 · 녹화 중엔 못 바꿔서 다음부터 적용). 장면 저장에 `where` 필드. 소스 목록에 '방송만/녹화만' 표시. **실기기 미확인**.
- **v0.27.0 녹화 트랙 분리**: 사운드 탭 [녹화 트랙 분리]. 트랙 1 = 전체 소리(방송과 같음), 소리마다 2~6 중 하나 선택(장면 소스 소리는 한 줄로 묶음). 켜면 `AdvancedRecordingFactory` + `AudioTrackFactory`로 mkv 다중 트랙 녹화, 끄면 기존 단순 녹화. 각 입력의 `audioMixers`는 `1 | 고른 트랙`으로 항상 설정(송출은 트랙 1만 씀). 설정은 `cfg.recTracks {on,map,scene}`. **실기기 미확인** — 녹화 후 편집 프로그램에서 트랙 수 · 이름 확인 필요.
- **엔진 조회 크래시 회피** (v0.19.1 ~ v0.21.2): 이 사용자 PC에서 `engine.choices()`(임시 private 소스로 속성 조회)가 **엔진(obs64)을 죽임**. 이제 `engine.choices()`는 빈 배열을 돌려주고,
  - 모니터: `src/monitors.ps1`(EnumDisplayDevices, `EDD_GET_DEVICE_INTERFACE_NAME`)로 OBS `monitor_id` 형식 장치 ID를 읽음 (main `app:displays`)
  - 창 · 게임: `windows.ps1` 창 목록 (`windows:get`)
  - 웹캠: `navigator.mediaDevices` 라벨 → `"<이름>:"` (dshow 이름 매칭)
  - 0.19.2 ~ 0.21.0에서 `monitor_id: 'DUMMY'`로 넣은 모니터는 시작 시 자동으로 진짜 ID로 교체 (`fixMon`)
- **업데이트 버그**: "업데이트 vnull" — 원인은 `button:has(>span[data-ic]){display:inline-flex!important}`가 `[hidden]`을 덮어씀 → `[hidden][hidden][hidden]{display:none!important}` (v0.24.3). 업데이터 상태 가드 · 두 번 적용 방지 · 바탕화면 정리 정규식(m[1]||m[3]) 수정 (v0.22.3)
- 업데이트 확인 캐시 끔 (`cache: 'no-store'` + `?t=`) (v0.18.1)
- **엔진이 느리게 켜지는 PC**: 엔진 켜는 동안 '응답 없음' 창을 330초까지 안 띄움(`engine:booting`), 지난번 걸린 시간(`cfg.bootMs`)으로 막대 진행 (v0.26.3 ~ v0.26.4)
- **사운드**: 목록이 칸 높이를 다 씀(기존 max-height 130px 제거), 스크롤바가 % 가리지 않게, 음소거 아이콘 대비 (v0.25.2 ~ v0.25.4)
- **블루투스 이어폰 마이크 감지**: 버즈 · 에어팟 마이크 사용 시 윈도우 통화 모드(HFP)로 음질 저하 → 안내 + [다른 마이크 고르기 / 마이크 끄기 / 그대로 쓰기], 마이크 `사용 안 함`(`__off__`) (v0.26.6)
- **VTube Studio**: 자동 실행 옵션 삭제 — [켜기] · [연결]을 눌렀을 때만 (v0.26.2). 연결 실패 시 노란 "!" 한 줄 + 순서 안내 창 (v0.26)
- **채널**: 치지직 · 유튜브 채널은 방송 정보 로그인 계정에서 자동 (`syncChzzkChannel`) (v0.22.2, v0.23)
- **보안**: 스트림 키를 `safeStorage`로 암호화해 `settings.json`의 `keysEnc`에 저장 (기존 평문 `keys`는 읽어서 다음 저장 때 전환) (v0.26.7)
- **문서**: README를 v0.26 기준으로 갱신 (v0.26.7)

---

## 2. 미완료 작업

| 작업 | 상태 / 메모 |
|---|---|
| **업데이트 전자서명 검증** | **보류 (사용자 "나중에")**. 계획: Ed25519. 사용자가 자기 PC에서 키를 만들어 비밀키를 GitHub Secret `PATCH_SIGN_KEY`에 넣고, 공개키(base64 DER SPKI)만 전달 → `quick-release.yml`이 ZIP 서명(`.sig`) 첨부, `updater.js`가 공개키로 검증 후에만 적용. **비밀키를 채팅 · 저장소에 두지 말 것** |
| **바탕화면 `Streamy Kit 업데이트` 폴더 업데이트 차단** | **보류**. 서명 검증과 함께 "개발자 모드에서만"으로 제한 예정. 지금은 누구나 ZIP을 넣으면 코드가 실행됨 |
| **실제 방송(송출) 테스트** | **보류**. 실제 RTMP 송출 · 다중 송출 · 장시간 안정성 · 방송 정보 실제 적용(치지직/유튜브) · 자동 적용 미확인 |
| SOOP 연동 | SOOP 개발자 앱 심사 대기. 통과 시 Client ID(앱) + Secret(Cloudflare Worker env `SOOP_CLIENT_ID/SECRET`), `/oauth/soop`, relay 라우트, 방송 정보 · 채팅 연결. 워커 `/privacy`에 SOOP 언급 추가 필요 |
| 버추얼 지킴이 | 논의만 함. 방어선 0~4 (버추얼 모드 · 넣을 때 · 보이게 되는 순간 · 방송 직전 점검 · 방송 중 감시 + 비상 키), Streamy Kit 창 캡처 제외(`setContentProtection`) — 사용자 결정 대기 항목: 민감 프로그램 목록, 자동 가리기 여부, 비상 단축키, 얼굴 방송에도 적용할지 |
| 화면 권한 줄이기 | `nodeIntegration: true`, `contextIsolation: false` → preload 구조로 이전 (큰 작업, 여러 번에 나눠서) |
| 자동 테스트 | 없음. `build/shot.js` 화면 캡처 검사를 CI에서 돌리는 것부터 |
| 트래킹 모드 | 아이디어 단계 (마우스 따라 확대) |
| 클라이언트 시크릿 교체 | 세션 초반에 치지직 · Google Client Secret이 채팅에 붙여 넣어졌음 → **재발급 권장** (재발급 후 Worker env만 바꾸면 됨) |

---

## 3. 알려진 버그 · 위험

1. **업데이트 무결성 없음** (2절) — GitHub 계정 탈취 또는 바탕화면 폴더에 ZIP을 넣으면 임의 코드 실행.
2. **boot.js 실패 시 같은 프로세스에서 기본 버전 실행** (`src/boot.js` 50행 이후) — 패치 `main.js`가 이미 IPC 핸들러를 등록한 뒤 던지면, 기본 `main.js`가 중복 등록으로 망가져 **창 없는 프로세스가 남고 single-instance 잠금 때문에 다시 안 켜짐** (0.21.1에서 실제 발생, `taskkill /IM "Streamy Kit.exe" /F`로 해결). 기본 설치본의 boot.js라 빠른 업데이트로 못 고침 → **설치 파일 새로 낼 때 `app.relaunch(); app.exit()` 방식으로** 고칠 것. 교훈: `main.js` 최상단(앱 ready 전)에서 `screen` 같은 모듈 쓰지 말 것.
3. **엔진 속성 조회 크래시** — `createPrivate` 후 `properties` 조회가 엔진을 죽이는 PC가 있음. 새 기능에서 `engine.listProp/probe`를 쓰지 말 것.
4. **모니터 ID 매칭** — `monitors.ps1` 목록과 Electron 화면 목록을 x · y 정렬로 맞춤. 배치가 특이한 다중 모니터에서 번호가 어긋날 수 있음 (실기 확인은 듀얼 1920×1080 한 번).
5. **엔진 시작이 화면 스레드를 막음** — `engine.start()` 동기. 내장 그래픽 노트북 첫 실행 83초 확인(백신 검사 추정). 막대는 시간 기준 가짜 진행.
6. **CSS 덮어쓰기 누적** — `style.css` 1,299줄, `!important` 133개. 뒤에 붙인 규칙이 앞 규칙을 이기는 구조라 회귀가 잦음 (vnull · hidden 사례). 정리 필요.
7. **app.js 2,391줄 단일 파일**, 죽은 코드: 예전 레일 추가 메뉴(`#addMenu`, `renderAddMenu`, 끌어서 추가), v0.17 `cfg.layout`/`lay-swap` CSS.
8. 채팅은 일부 플랫폼 내부 API 의존 — 플랫폼 변경 시 깨질 수 있음.
9. 블루투스 마이크 감지는 이름 정규식(`BT_MIC`) 기반 — `galaxy` 등 넓게 잡아 오탐 가능, 실기 미확인.
10. 데모 화면 캡처는 `settings.json`(리눅스 userData)을 공유 → 이전 캡처의 테마 · 배치가 남음. 캡처 JS에서 `cfg.layout2=JSON.parse(JSON.stringify(LAY_DEF))` 등으로 초기화.

---

## 4. 실행 · 빌드 · 테스트

```bash
npm ci                                   # electron 43.7.6
npm run demo                             # 엔진 없이 화면만 (STREAMY_DEMO=1, 어느 OS든)
SHOT_OUT=/tmp/a.png SHOT_JS="openTab('sources');" xvfb-run -a npx electron build/shot.js --no-sandbox   # 화면 캡처
node --check src/main.js && node -e "new Function(require('fs').readFileSync('src/renderer/app.js','utf8'))"   # 문법 확인 (매 변경 후 실행해 왔음)
bash build/make-patch.sh                 # dist/StreamyKit-Patch-<버전>.zip (src만)
bash build/build-win.sh                  # 윈도우 설치 파일 (리눅스에서 NSIS, OBS 엔진 다운로드)
```

**배포**
1. `package.json` `version` 올리기 → 커밋 → `main` 푸시
2. `quick-release.yml`이 `v<버전>` 릴리스 + 패치 ZIP 게시 (1분 안팎) → 켜진 앱이 받아 재시작
3. 설치 파일이 필요하면 `release.yml` 수동 실행 (이 세션에서는 GraphQL이 막혀 REST로 실행):
   `gh api -X POST repos/Streamys/Streamy_kit/actions/workflows/release.yml/dispatches -f ref=main -f 'inputs[tag]=v<버전>'`
   (엔진 · Electron이 바뀌면 `build/patch-min-base`도 올릴 것)

**로그**: `%APPDATA%\Streamy Kit\logs\streamy-kit.log` — 엔진 시작 시간, 크래시 직전 동작(`last actions`), 시작 4초 뒤 소스 상태(`[source] 종류 이름 가로x세로`)가 찍힘.

### 실제 확인 결과 (사실만)
| 확인 | 결과 |
|---|---|
| 데모 화면 캡처 (리눅스 xvfb) | 각 변경마다 탭 · 오버레이 · 창 캡처로 확인 |
| 사용자 데스크톱 (Windows, NVENC, 듀얼 1920×1080) | v0.26.7까지 정상 시작, 엔진 시작 **약 0.9초**. 모니터 소스 0×0 → 0.21.2 이후 **1920×1080** 확인. 0.19.0/0.19.1 엔진 조회 크래시 · 0.21.1 시작 실패는 로그로 확인 후 수정 |
| 사용자 노트북 (내장 그래픽, QSV) | 첫 실행 엔진 시작 **83초**, 중간에 '응답 없음' 재시작 → 이후 정상 |
| GitHub | `main` = 로컬, 최신 릴리스 v0.26.7, 설치 파일 빌드(`release.yml`, v0.26.2) 성공 |
| **미확인** | 실제 송출 · 다중 송출 · 방송 정보 실제 적용 · VTS 실제 연결 · 끌어다 놓기(네이티브 미리보기 위) · 장면 끌기 · 글꼴 파일 가져오기 · 블루투스 마이크 감지 · 스트림 키 암호화 전환 후 키 유지(사용자에게 확인 요청함) · 웹캠 이름 매칭(`"이름:"`) |

---

## 5. 다음 할 일 (우선순위)

1. **실제 방송 테스트** *(보류 — 사용자 일정 대기)*: 치지직 · 유튜브 동시 송출 1~2시간, 방송 정보 적용 · 자동 적용, 로그로 드롭 · 크래시 확인
2. **업데이트 전자서명 + 바탕화면 폴더 차단** *(보류 — 사용자가 `PATCH_SIGN_KEY` 넣고 공개키 줄 때)*
3. 치지직 · Google Client Secret 재발급 (Worker env 교체)
4. 스트림 키 암호화 전환 실기 확인, 블루투스 마이크 감지 실기 확인
5. 자동 검사: `build/shot.js` + 문법 확인을 CI(빠른 릴리스 전)에 붙이기
6. 버추얼 지킴이 + Streamy Kit 창 캡처 제외 (사용자 결정 항목 먼저)
7. SOOP 연동 (심사 통과 시)
8. 다음 설치 파일 낼 때: `boot.js` 실패 시 relaunch로 변경, `patch-min-base` 갱신
9. 화면 권한 줄이기 (contextIsolation + preload), `app.js` 기능별 분리, CSS 정리 · 죽은 코드 제거
10. 트래킹 모드

---

## 6. 커밋하지 않은 변경 · 저장소 밖 자료

- **저장소**: 이 문서(`docs/HANDOFF.md`)와 `build/shot.js`를 함께 커밋. 그 밖에 커밋 안 된 변경 없음 (`git status` 깨끗했음).
- **저장소 밖 (세션 작업 공간, 다음 작업자 접근 불가)**: 화면 캡처 PNG들, `/tmp/minishot.js`(최소화 오버레이 캡처용 — 필요하면 `build/shot.js`처럼 다시 만들면 됨), 디자인 캔버스 보드 파일 사본.
- **디자인 캔버스 (Claude Design 아티팩트)**: `6c9c1f80-d490-4cc0-9605-2443dfb55af2` — 사용자가 댓글로 피드백. "지금 앱 화면" 보드들은 v0.22.1 ~ v0.25 기준 캡처라 일부(v0.26 체크 상자 · 안내 창 · 엔진 준비 화면 · 6탭)는 반영 안 됨.
- **비밀 값**: 저장소에 없음. Client Secret은 Cloudflare Worker(`streamy-relay`) env에만. 앱에는 Client ID만.
