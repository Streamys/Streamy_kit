// Streamy 로그인 중계 서버 (Cloudflare Workers)
// 비밀키(Client Secret)는 여기 "환경 변수"에만 있고, 앱 안에는 없어요.
// 앱이 로그인 코드 / 갱신 토큰을 보내면 → 비밀키를 붙여서 치지직·구글에 대신 요청하고 결과만 돌려줘요.
// 아무것도 저장하지 않아요 (토큰은 사용자 PC에만 남음).
//
// 환경 변수 (Cloudflare → Workers → 이 Worker → 설정 → 변수 및 비밀):
//   CHZZK_CLIENT_ID      치지직 Client ID
//   CHZZK_CLIENT_SECRET  치지직 Client Secret   (← "비밀" 유형으로)
//   GOOGLE_CLIENT_ID     (나중에) 구글 OAuth 클라이언트 ID
//   GOOGLE_CLIENT_SECRET (나중에) 구글 보안 비밀번호  (← "비밀" 유형으로)

const CHZZK = 'https://openapi.chzzk.naver.com';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const pass = async (r) => new Response(await r.text(), { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
const str = (v, max = 4096) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/' || p === '/health') {
      return json({ ok: true, name: 'streamy-relay', chzzk: !!(env.CHZZK_CLIENT_ID && env.CHZZK_CLIENT_SECRET), google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) });
    }

    // ---- 치지직: 로그인 코드 → 토큰 / 토큰 갱신
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
    // ---- 치지직: 로그아웃(토큰 취소)
    if (p === '/chzzk/revoke' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (!str(b.token)) return json({ message: '잘못된 요청' }, 400);
      return pass(await fetch(`${CHZZK}/auth/v1/token/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: env.CHZZK_CLIENT_ID, clientSecret: env.CHZZK_CLIENT_SECRET, token: b.token, tokenTypeHint: b.tokenTypeHint === 'refresh_token' ? 'refresh_token' : 'access_token' }) }));
    }
    // ---- 치지직: 카테고리 검색 (앱 키가 필요한 API)
    if (p === '/chzzk/categories' && req.method === 'GET') {
      const q = str(url.searchParams.get('query'), 100);
      if (!q) return json({ message: '검색어가 없어요' }, 400);
      return pass(await fetch(`${CHZZK}/open/v1/categories/search?query=${encodeURIComponent(q)}&size=20`, { headers: { 'Client-Id': env.CHZZK_CLIENT_ID, 'Client-Secret': env.CHZZK_CLIENT_SECRET } }));
    }

    // ---- 구글(유튜브): 로그인 코드 → 토큰 / 토큰 갱신
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
