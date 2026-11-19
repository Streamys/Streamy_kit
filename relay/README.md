# Streamy 로그인 중계 서버

치지직·유튜브 **비밀키(Secret)를 앱 밖에 두기 위한** 작은 서버예요. Cloudflare Workers 무료 요금제로 돌아가요.

- 앱 → 이 서버로 로그인 코드를 보냄 → 서버가 비밀키를 붙여 치지직/구글에서 토큰을 받아 돌려줌
- 아무것도 저장하지 않아요 (토큰은 사용자 PC에만 남음)
- 코드: [`worker.js`](worker.js)

## 처음 만들기 (5분)

1. https://dash.cloudflare.com 가입 / 로그인
2. 왼쪽 **Workers & Pages** → **만들기(Create)** → **Hello World로 시작** → 이름 `streamy-relay` → **배포(Deploy)**
3. **코드 편집(Edit code)** → 왼쪽 파일 내용을 전부 지우고 `worker.js` 내용을 붙여 넣기 → **배포(Deploy)**
4. Worker 화면 → **설정(Settings)** → **변수 및 비밀(Variables and Secrets)** → **추가**
   | 이름 | 유형 | 값 |
   |---|---|---|
   | `CHZZK_CLIENT_ID` | 텍스트 | 치지직 Client ID |
   | `CHZZK_CLIENT_SECRET` | **비밀(Secret)** | 치지직 Client Secret |
   | `GOOGLE_CLIENT_ID` | 텍스트 | (나중에) 구글 클라이언트 ID |
   | `GOOGLE_CLIENT_SECRET` | **비밀(Secret)** | (나중에) 구글 보안 비밀번호 |
5. 브라우저에서 `https://streamy-relay.<내 주소>.workers.dev/health` 열기 → `"chzzk":true` 나오면 성공
6. 그 주소를 `src/broadcast.js`의 `STREAMY.relay`에 넣고 새 버전 배포

## 비밀키를 바꿀 때
치지직 개발자 센터에서 Secret을 새로 발급 → 4번의 `CHZZK_CLIENT_SECRET` 값만 바꾸면 끝 (앱 업데이트 필요 없음).
