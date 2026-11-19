
const CHZZK = 'https://openapi.chzzk.naver.com';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const pass = async (r) => new Response(await r.text(), { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
const CONTACT = 'tiredblack07782@gmail.com';
const page = (title, body) => new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{background:#0e0e10;color:#e8e8ea;font-family:'Malgun Gothic',system-ui,sans-serif;max-width:760px;margin:0 auto;padding:40px 20px;line-height:1.75}h1{color:#fff}h1 b{color:#e11d2e}h2{color:#fff;margin-top:32px;font-size:18px}a{color:#ff4d5e}small{color:#888}</style></head><body>${body}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const HOME = `<h1>Streamy <b>Kit</b></h1><p>Streamy Kit은 치지직 · 유튜브 · SOOP 스트리머를 위한 윈도우용 방송 프로그램이에요. 화면 구성, 동시 송출, 통합 채팅, 버추얼 연동, 방송 제목·태그 바꾸기를 한 곳에서 할 수 있어요.</p><p>유튜브 계정 연결은 사용자가 직접 로그인해서 허용한 경우에만, 그 사용자의 방송 제목 · 설명 · 태그 · 카테고리를 바꾸는 데만 쓰여요.</p><p><a href="/privacy">개인정보처리방침</a> · <a href="/terms">이용약관</a> · <a href="https://github.com/Streamys/Streamy_kit">GitHub</a></p><p><small>문의: ${CONTACT}</small></p>`;
const PRIVACY = `<h1>개인정보처리방침</h1><p><small>Streamy Kit · 시행일 2026년 11월 19일</small></p>
<h2>1. 무엇을 쓰나요</h2><p>사용자가 Streamy Kit에서 치지직 또는 유튜브 계정을 직접 연결(로그인 후 허용)하면, 해당 플랫폼이 발급한 접근 토큰으로 다음만 합니다.</p><ul><li>채널 이름 확인 (연결된 계정 표시)</li><li>사용자가 입력한 방송 제목 · 설명 · 태그 · 카테고리를 그 사용자의 방송에 적용하고, 현재 설정을 불러오기</li></ul>
<h2>2. 어디에 저장되나요</h2><p>토큰과 방송 정보는 <b>사용자 PC에만</b> 윈도우 보안 저장소로 암호화해 저장됩니다. Streamy 서버에는 저장하지 않습니다. 로그인 중계 서버는 로그인 코드를 토큰으로 바꾸는 요청을 전달만 하고, 아무 내용도 기록하거나 보관하지 않습니다.</p>
<h2>3. 다른 곳에 주나요</h2><p>판매 · 공유 · 광고에 쓰지 않습니다. 요청은 사용자가 연결한 플랫폼(네이버 치지직, Google/YouTube)으로만 보내집니다.</p>
<h2>4. YouTube API 서비스</h2><p>Streamy Kit은 YouTube API 서비스를 사용합니다. 유튜브 기능을 쓰면 <a href="https://www.youtube.com/t/terms">YouTube 서비스 약관</a>에 동의하는 것으로 보며, Google의 처리는 <a href="https://policies.google.com/privacy">Google 개인정보처리방침</a>을 따릅니다.</p>
<h2>5. 연결 끊기 · 삭제</h2><p>앱의 방송 탭에서 "로그아웃"을 누르면 토큰이 PC에서 지워지고 플랫폼에 취소 요청을 보냅니다. Google은 <a href="https://myaccount.google.com/permissions">Google 계정 → 서드파티 연결</a>에서도 언제든 권한을 취소할 수 있습니다. 앱을 지우면 저장된 정보도 함께 지워집니다.</p>
<h2>6. 문의</h2><p>${CONTACT}</p>`;
const TERMS = `<h1>이용약관</h1><p><small>Streamy Kit · 시행일 2026년 11월 19일</small></p><p>Streamy Kit은 GPL-2.0 이상 라이선스로 무료 배포되는 프로그램이며, 있는 그대로 제공됩니다. 각 방송 플랫폼(치지직, YouTube, SOOP)의 약관과 정책은 사용자가 직접 지켜야 합니다. 유튜브 기능을 쓰면 <a href="https://www.youtube.com/t/terms">YouTube 서비스 약관</a>에 동의하는 것으로 봅니다. 문의: ${CONTACT}</p>`;
const str = (v, max = 4096) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/') return page('Streamy Kit', HOME);
    if (p === '/privacy') return page('Streamy Kit 개인정보처리방침', PRIVACY);
    if (p === '/terms') return page('Streamy Kit 이용약관', TERMS);
    if (p === '/health') {
      return json({ ok: true, name: 'streamy-relay', chzzk: !!(env.CHZZK_CLIENT_ID && env.CHZZK_CLIENT_SECRET), google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) });
    }

    if (p === '/chzzk/token' && req.method === 'POST') {
      if (!env.CHZZK_CLIENT_ID || !env.CHZZK_CLIENT_SECRET) return json({ message: '중계 서버에 치지직 키가 없어요' }, 500);
      const b = await req.json().catch(() => ({}));
      let body;
      if (b.grantType === 'authorization_code' && str(b.code) && str(b.state)) {
        body = { grantType: 'authorization_code', clientId: env.CHZZK_CLIENT_ID, clientSecret: env.CHZZK_CLIENT_SECRET, code: b.code, state: b.state };
      } else if (b.grantType === 'refresh_token' && str(b.refreshToken)) {
        body = { grantType: 'refresh_token', clientId: env.CHZZK_CLIENT_ID, clientSecret: env.CHZZK_CLIENT_SECRET, refreshToken: b.refreshToken };
      } else return json({ message: '잘못된 요청' }, 400);
      return pass(await fetch(`${CHZZK}/auth/v1/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    }
    if (p === '/chzzk/revoke' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (!str(b.token)) return json({ message: '잘못된 요청' }, 400);
      return pass(await fetch(`${CHZZK}/auth/v1/token/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: env.CHZZK_CLIENT_ID, clientSecret: env.CHZZK_CLIENT_SECRET, token: b.token, tokenTypeHint: b.tokenTypeHint === 'refresh_token' ? 'refresh_token' : 'access_token' }) }));
    }
    if (p === '/chzzk/categories' && req.method === 'GET') {
      const q = str(url.searchParams.get('query'), 100);
      if (!q) return json({ message: '검색어가 없어요' }, 400);
      return pass(await fetch(`${CHZZK}/open/v1/categories/search?query=${encodeURIComponent(q)}&size=20`, { headers: { 'Client-Id': env.CHZZK_CLIENT_ID, 'Client-Secret': env.CHZZK_CLIENT_SECRET } }));
    }

    if (p === '/google/token' && req.method === 'POST') {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: 'not_configured', error_description: '중계 서버에 구글 키가 없어요' }, 500);
      const b = await req.json().catch(() => ({}));
      const f = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET });
      if (b.grant_type === 'authorization_code' && str(b.code) && str(b.redirect_uri, 200) && /^http:\/\/127\.0\.0\.1:17890\//.test(b.redirect_uri)) {
        f.set('grant_type', 'authorization_code'); f.set('code', b.code); f.set('redirect_uri', b.redirect_uri);
        if (str(b.code_verifier, 200)) f.set('code_verifier', b.code_verifier);
      } else if (b.grant_type === 'refresh_token' && str(b.refresh_token)) {
        f.set('grant_type', 'refresh_token'); f.set('refresh_token', b.refresh_token);
      } else return json({ error: 'invalid_request' }, 400);
      return pass(await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: f.toString() }));
    }

    return json({ message: 'not found' }, 404);
  },
};
