// Streamy Kit — 방송 정보(제목 · 태그 · 설명 · 카테고리) 바꾸기: 치지직 + 유튜브
// 기본: Streamy가 등록한 앱으로 로그인 (사용자는 "로그인"만 누름).
//   비밀키(Secret)는 앱 안에 없고 Streamy 중계 서버(relay/worker.js, Cloudflare)에만 있어요.
//   앱 → 중계 서버로 로그인 코드를 보내면, 서버가 비밀키를 붙여 토큰을 받아 줘요.
// 고급: 설정에서 자기 앱 정보(Client ID/Secret)를 넣으면 중계 서버 없이 직접 요청.
// 로그인 토큰은 윈도우 보안 저장(safeStorage)으로 암호화해서 내 PC에만 저장돼요.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHZZK_REDIRECT = 'http://localhost:17890/oauth/chzzk';
const GOOGLE_REDIRECT = 'http://127.0.0.1:17890/oauth/google';
const CHZZK_API = 'https://openapi.chzzk.naver.com';
const YT_API = 'https://www.googleapis.com/youtube/v3';
// Streamy 기본 앱 (공개돼도 되는 값만)
const STREAMY = {
  relay: 'https://streamy-relay.tiredblack07782.workers.dev',                                                   // 중계 서버 주소 (예: https://streamy-relay.xxx.workers.dev)
  chzzkClientId: '5d62b982-08a0-4300-a4df-b9bf7849d92a',
  googleClientId: '317824846180-cl31dfapp2s7nneciukph980cbhl7pb1.apps.googleusercontent.com',
};

let ctx = null;        // { app, net, log, shell, safeStorage, send }
let file = '';
let data = { chzzk: { clientId: '', secret: '', token: null, channel: null }, youtube: { clientId: '', secret: '', token: null, channel: null } };
const waiting = {};
const custom = (p) => !!(data[p].clientId && data[p].secret);
const builtin = (p) => !!(STREAMY.relay && (p === 'chzzk' ? STREAMY.chzzkClientId : STREAMY.googleClientId));
const clientIdOf = (p) => custom(p) ? data[p].clientId : (p === 'chzzk' ? STREAMY.chzzkClientId : STREAMY.googleClientId);
const relay = (pth) => STREAMY.relay.replace(/\/$/, '') + pth;    // state → { platform, verifier, resolve, reject, t }

// ---------------------------------------------------------------- 저장 (비밀값은 암호화)
const enc = (o) => { const s = JSON.stringify(o); try { if (ctx.safeStorage.isEncryptionAvailable()) return 'e:' + ctx.safeStorage.encryptString(s).toString('base64'); } catch {} return 'p:' + Buffer.from(s).toString('base64'); };
const dec = (s) => { try { if (s.startsWith('e:')) return JSON.parse(ctx.safeStorage.decryptString(Buffer.from(s.slice(2), 'base64'))); if (s.startsWith('p:')) return JSON.parse(Buffer.from(s.slice(2), 'base64').toString()); } catch {} return null; };
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const p of ['chzzk', 'youtube']) {
      const r = raw[p] || {};
      data[p] = { clientId: r.clientId || '', secret: r.secret ? (dec(r.secret) || '') : '', token: r.token ? dec(r.token) : null, channel: r.channel || null };
    }
  } catch {}
}
function persist() {
  const out = {};
  for (const p of ['chzzk', 'youtube']) { const d = data[p]; out[p] = { clientId: d.clientId, secret: d.secret ? enc(d.secret) : '', token: d.token ? enc(d.token) : '', channel: d.channel }; }
  try { fs.writeFileSync(file, JSON.stringify(out)); } catch (e) { ctx.log.warn('broadcast', 'save', e.message); }
}
function status() {
  const s = {};
  for (const p of ['chzzk', 'youtube']) { const d = data[p]; s[p] = { hasApp: custom(p) || builtin(p), builtin: builtin(p), custom: custom(p), clientId: d.clientId, connected: !!(d.token && d.token.refresh), channel: d.channel }; }
  s.redirect = { chzzk: CHZZK_REDIRECT, youtube: GOOGLE_REDIRECT };
  return s;
}
const emit = () => ctx.send('bc:status', status());

function init(c) {
  ctx = c;
  file = path.join(ctx.app.getPath('userData'), 'broadcast-info.json');
  load();
}

// ---------------------------------------------------------------- HTTP 도우미
async function http(url, opt = {}) {
  const r = await ctx.net.fetch(url, opt);
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : {}; } catch {}
  return { ok: r.ok, status: r.status, j, text };
}
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null)).toString();

// ---------------------------------------------------------------- 앱 정보
function setApp(platform, { clientId, secret }) {
  const d = data[platform]; if (!d) throw new Error('알 수 없는 플랫폼');
  const id = String(clientId || '').trim(), sec = String(secret || '').trim();
  if (id !== d.clientId || (sec && sec !== d.secret)) { d.token = null; d.channel = null; }
  d.clientId = id; if (sec) d.secret = sec;
  persist(); emit(); return status();
}
function logout(platform) {
  const d = data[platform]; if (!d) return status();
  if (platform === 'chzzk' && d.token && d.token.access) {
    const t = { token: d.token.refresh || d.token.access, tokenTypeHint: d.token.refresh ? 'refresh_token' : 'access_token' };
    const req = custom('chzzk') ? http(`${CHZZK_API}/auth/v1/token/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: d.clientId, clientSecret: d.secret, ...t }) })
      : builtin('chzzk') ? http(relay('/chzzk/revoke'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }) : null;
    if (req) req.catch(() => {});
  }
  if (platform === 'youtube' && d.token && d.token.refresh) http(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(d.token.refresh)}`, { method: 'POST' }).catch(() => {});
  d.token = null; d.channel = null; persist(); emit(); return status();
}

// ---------------------------------------------------------------- 로그인 (브라우저 → 내 PC 17890번으로 돌아옴)
function login(platform) {
  if (!data[platform]) throw new Error('알 수 없는 플랫폼');
  if (!custom(platform) && !builtin(platform)) throw new Error(platform === 'youtube' ? '유튜브 로그인은 아직 준비 중이에요.' : '로그인 준비가 안 됐어요.');
  const d = { clientId: clientIdOf(platform) };
  const state = crypto.randomBytes(16).toString('hex');
  let url, verifier = null;
  if (platform === 'chzzk') {
    url = `https://chzzk.naver.com/account-interlock?${form({ clientId: d.clientId, redirectUri: CHZZK_REDIRECT, state })}`;
  } else {
    verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    url = `https://accounts.google.com/o/oauth2/v2/auth?${form({ client_id: d.clientId, redirect_uri: GOOGLE_REDIRECT, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube', access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' })}`;
  }
  for (const k of Object.keys(waiting)) if (waiting[k].platform === platform) { clearTimeout(waiting[k].t); delete waiting[k]; }
  const p = new Promise((resolve, reject) => {
    waiting[state] = { platform, verifier, resolve, reject, t: setTimeout(() => { delete waiting[state]; reject(new Error('로그인 시간이 지났어요. 다시 눌러 주세요.')); }, 10 * 60 * 1000) };
  });
  ctx.shell.openExternal(url);
  return p;
}
// server.js가 /oauth/<chzzk|google> 요청을 받으면 여기로
async function onCallback(which, q) {
  const platform = which === 'google' ? 'youtube' : 'chzzk';
  const w = waiting[q.state];
  if (!w || w.platform !== platform) throw new Error('Streamy Kit에서 "연결"을 다시 눌러 주세요.');
  delete waiting[q.state]; clearTimeout(w.t);
  try {
    if (q.error) throw new Error(q.error === 'access_denied' ? '허용하지 않았어요.' : q.error);
    if (!q.code) throw new Error('로그인 코드가 없어요.');
    const d = data[platform];
    if (platform === 'chzzk') {
      const r = await chzzkToken({ grantType: 'authorization_code', code: q.code, state: q.state });
      const c = r.j && (r.j.content || r.j);
      if (!r.ok || !c || !c.accessToken) throw new Error(`치지직 토큰 받기 실패 (${r.status}) ${(r.j && r.j.message) || ''}`);
      d.token = { access: c.accessToken, refresh: c.refreshToken, exp: Date.now() + (Number(c.expiresIn) || 86400) * 1000 - 60000 };
    } else {
      const r = await googleToken({ grant_type: 'authorization_code', code: q.code, redirect_uri: GOOGLE_REDIRECT, code_verifier: w.verifier });
      if (!r.ok || !r.j || !r.j.access_token) throw new Error(`구글 토큰 받기 실패 (${r.status}) ${(r.j && (r.j.error_description || r.j.error)) || ''}`);
      d.token = { access: r.j.access_token, refresh: r.j.refresh_token, exp: Date.now() + (Number(r.j.expires_in) || 3600) * 1000 - 60000 };
    }
    persist();
    await fetchChannel(platform).catch((e) => ctx.log.warn('broadcast', 'channel', e.message));
    emit();
    w.resolve(status());
    return `${platform === 'chzzk' ? '치지직' : '유튜브'}${data[platform].channel ? ` · ${data[platform].channel.name}` : ''}`;
  } catch (e) { w.reject(e); throw e; }
}

// ---------------------------------------------------------------- 토큰 요청 (내 앱 정보면 직접, 아니면 Streamy 중계 서버)
function chzzkToken(body) {
  const d = data.chzzk;
  if (custom('chzzk')) return http(`${CHZZK_API}/auth/v1/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, clientId: d.clientId, clientSecret: d.secret }) });
  return http(relay('/chzzk/token'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function googleToken(body) {
  const d = data.youtube;
  if (custom('youtube')) return http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ ...body, client_id: d.clientId, client_secret: d.secret }) });
  return http(relay('/google/token'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ---------------------------------------------------------------- 토큰 갱신
async function accessToken(platform) {
  const d = data[platform];
  if (!d.token) throw new Error(`${platform === 'chzzk' ? '치지직' : '유튜브'} 계정을 먼저 연결해 주세요.`);
  if (d.token.access && d.token.exp > Date.now()) return d.token.access;
  if (!d.token.refresh) throw new Error('다시 연결해 주세요.');
  if (platform === 'chzzk') {
    // 치지직 갱신 토큰은 한 번만 쓸 수 있어서, 받자마자 새 걸로 저장
    const r = await chzzkToken({ grantType: 'refresh_token', refreshToken: d.token.refresh });
    const c = r.j && (r.j.content || r.j);
    if (!r.ok || !c || !c.accessToken) { d.token = null; persist(); emit(); throw new Error('치지직 연결이 만료됐어요. 다시 연결해 주세요.'); }
    d.token = { access: c.accessToken, refresh: c.refreshToken || d.token.refresh, exp: Date.now() + (Number(c.expiresIn) || 86400) * 1000 - 60000 };
  } else {
    const r = await googleToken({ grant_type: 'refresh_token', refresh_token: d.token.refresh });
    if (!r.ok || !r.j || !r.j.access_token) { if (r.j && r.j.error === 'invalid_grant') { d.token = null; persist(); emit(); } throw new Error('유튜브 연결이 만료됐어요. 다시 연결해 주세요.'); }
    d.token = { ...d.token, access: r.j.access_token, exp: Date.now() + (Number(r.j.expires_in) || 3600) * 1000 - 60000 };
  }
  persist();
  return d.token.access;
}
async function api(platform, url, opt = {}) {
  const tok = await accessToken(platform);
  const r = await http(url, { ...opt, headers: { Authorization: `Bearer ${tok}`, ...(opt.body ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) } });
  if (r.status === 401) { data[platform].token.exp = 0; const t2 = await accessToken(platform); return http(url, { ...opt, headers: { Authorization: `Bearer ${t2}`, ...(opt.body ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) } }); }
  return r;
}
const errMsg = (r, name) => {
  const j = r.j || {};
  const m = (j.error && (j.error.message || j.error)) || j.message || r.text.slice(0, 200);
  if (r.status === 403 && /quota/i.test(String(m))) return `${name}: 오늘 쓸 수 있는 API 양을 다 썼어요. 내일 다시 해 주세요.`;
  if (r.status === 403) return `${name}: 권한이 없어요 (${m}). 개발자 센터에서 권한을 확인해 주세요.`;
  return `${name} 오류 (${r.status}) ${m}`;
};

async function fetchChannel(platform) {
  if (platform === 'chzzk') {
    const r = await api('chzzk', `${CHZZK_API}/open/v1/users/me`);
    const c = r.j && r.j.content;
    if (r.ok && c) data.chzzk.channel = { id: c.channelId, name: c.channelName };
  } else {
    const r = await api('youtube', `${YT_API}/channels?part=snippet&mine=true`);
    const c = r.j && r.j.items && r.j.items[0];
    if (r.ok && c) data.youtube.channel = { id: c.id, name: c.snippet.title };
  }
  persist();
}

// ---------------------------------------------------------------- 치지직
async function chzzkCategories(query) {
  const d = data.chzzk;
  let r;
  if (custom('chzzk')) r = await http(`${CHZZK_API}/open/v1/categories/search?${form({ query, size: 20 })}`, { headers: { 'Client-Id': d.clientId, 'Client-Secret': d.secret } });
  else if (builtin('chzzk')) r = await http(relay(`/chzzk/categories?${form({ query })}`));
  else throw new Error('치지직 로그인 준비가 안 됐어요.');
  if (!r.ok) throw new Error(errMsg(r, '치지직 카테고리 검색'));
  return ((r.j.content && r.j.content.data) || []).map((c) => ({ type: c.categoryType, id: c.categoryId, name: c.categoryValue, img: c.posterImageUrl }));
}
async function chzzkGet() {
  const r = await api('chzzk', `${CHZZK_API}/open/v1/lives/setting`);
  if (!r.ok) throw new Error(errMsg(r, '치지직 방송 설정 읽기'));
  const c = r.j.content || {};
  return { title: c.defaultLiveTitle || '', tags: c.tags || [], category: c.category ? { type: c.category.categoryType, id: c.category.categoryId, name: c.category.categoryValue } : null };
}
// 치지직 태그: 띄어쓰기 · 특수문자 안 됨, 최대 5개
const chzzkTag = (t) => String(t).replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣぁ-ゟ゠-ヿ一-龯]/g, '').slice(0, 15);
async function chzzkApply(info) {
  const body = {};
  if (info.title != null && String(info.title).trim()) body.defaultLiveTitle = String(info.title).slice(0, 100);   // 빈 제목은 안 됨
  if (Array.isArray(info.tags)) body.tags = [...new Set(info.tags.map(chzzkTag).filter(Boolean))].slice(0, 5);
  if (info.chzzkCategory && info.chzzkCategory.id) { body.categoryType = info.chzzkCategory.type; body.categoryId = info.chzzkCategory.id; }
  else if (info.chzzkCategory === null) body.categoryId = '';      // 빈 값 = 카테고리 지우기
  const r = await api('chzzk', `${CHZZK_API}/open/v1/lives/setting`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(errMsg(r, '치지직'));
  return true;
}

// ---------------------------------------------------------------- 유튜브
// 지금 방송(라이브 중 → 없으면 예정)을 찾음. 스트림 키 방송은 '기본 방송(persistent)'이라 broadcastType=all 필요
async function ytFind() {
  for (const st of ['active', 'upcoming']) {
    const r = await api('youtube', `${YT_API}/liveBroadcasts?${form({ part: 'id,snippet,status', broadcastStatus: st, broadcastType: 'all', maxResults: 5 })}`);
    if (!r.ok) throw new Error(errMsg(r, '유튜브 방송 찾기'));
    const items = r.j.items || [];
    if (items.length) return items.find((b) => b.status && b.status.lifeCycleStatus === 'live') || items[0];
  }
  return null;
}
async function youtubeGet() {
  const b = await ytFind();
  if (!b) return null;
  const v = await api('youtube', `${YT_API}/videos?part=snippet&id=${b.id}`);
  const vs = v.ok && v.j.items && v.j.items[0] ? v.j.items[0].snippet : {};
  return { id: b.id, title: b.snippet.title, description: b.snippet.description || '', tags: vs.tags || [], categoryId: vs.categoryId || '' };
}
async function youtubeApply(info) {
  const b = await ytFind();
  if (!b) throw new Error('유튜브: 지금 방송이나 예정된 방송을 찾지 못했어요. 방송을 시작한 뒤 다시 해 주세요.');
  const sn = b.snippet;
  const title = info.title != null && String(info.title).trim() ? String(info.title).slice(0, 100) : sn.title;
  const description = info.description != null ? String(info.description).slice(0, 5000) : sn.description;
  // 1) 방송 제목 · 설명 (예정 시작 시간은 원래 값 그대로 보내야 함)
  const r1 = await api('youtube', `${YT_API}/liveBroadcasts?part=snippet`, { method: 'PUT', body: JSON.stringify({ id: b.id, snippet: { title, description, scheduledStartTime: sn.scheduledStartTime || sn.actualStartTime || new Date().toISOString() } }) });
  if (!r1.ok) throw new Error(errMsg(r1, '유튜브 제목'));
  // 2) 태그 · 카테고리 (영상 정보)
  const warn = [];
  if (Array.isArray(info.tags) || info.youtubeCategory) {
    const v = await api('youtube', `${YT_API}/videos?part=snippet&id=${b.id}`);
    const cur = v.ok && v.j.items && v.j.items[0] ? v.j.items[0].snippet : null;
    if (cur) {
      const snippet = { title, description, categoryId: info.youtubeCategory || cur.categoryId || '20', tags: Array.isArray(info.tags) ? info.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 30) : (cur.tags || []), defaultLanguage: cur.defaultLanguage };
      const r2 = await api('youtube', `${YT_API}/videos?part=snippet`, { method: 'PUT', body: JSON.stringify({ id: b.id, snippet }) });
      if (!r2.ok) warn.push(errMsg(r2, '유튜브 태그'));
    }
  }
  return { id: b.id, warn };
}

// ---------------------------------------------------------------- 한 번에 적용
async function apply(info, targets) {
  const out = {};
  await Promise.all((targets || []).map(async (p) => {
    try {
      if (p === 'chzzk') out.chzzk = { ok: await chzzkApply(info) };
      else if (p === 'youtube') { const r = await youtubeApply(info); out.youtube = { ok: true, warn: r.warn }; }
    } catch (e) { ctx.log.warn('broadcast', p, e.message); out[p] = { ok: false, error: e.message }; }
  }));
  return out;
}

module.exports = { init, status, setApp, login, logout, onCallback, chzzkCategories, chzzkGet, youtubeGet, apply };
