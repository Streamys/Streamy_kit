// Streamy Kit — 통합 채팅 수집기 (메인 프로세스)
// 치지직 · 유튜브 · SOOP 채팅을 읽어서 같은 모양으로 바꿔 화면에 보내요. (읽기 전용)
// 세 플랫폼 모두 공식 채팅 API가 아니라 웹 페이지가 쓰는 방식을 따라가요. 플랫폼이 바뀌면 고쳐야 할 수 있어요.
'use strict';
const WebSocket = require('ws');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const RETRY_OFFLINE = { chzzk: 30000, soop: 30000, youtube: 60000 };   // 방송 꺼져 있을 때 다시 확인 간격
const RETRY_ERROR = 20000;

let ctx = null;            // { net, log, send }
const conns = {};          // platform → connector
let queue = [];
let flushT = null;
let seq = 0;

function emitMessage(m) {
  m.id = m.id || `${m.p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
  m.ts = m.ts || Date.now();
  queue.push(m);
  if (queue.length > 400) queue = queue.slice(-400);
  if (!flushT) flushT = setTimeout(() => { flushT = null; const q = queue; queue = []; if (q.length) ctx.send('chat:messages', q); }, 120);
}
const status = {};         // platform → { state, detail, url, videoId }
function setStatus(p, s) {
  status[p] = { ...(status[p] || {}), ...s };
  ctx.send('chat:status', { p, ...status[p] });
}

async function getJson(url, opt = {}) {
  const r = await ctx.net.fetch(url, { ...opt, headers: { 'User-Agent': UA, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function getText(url, opt = {}) {
  const r = await ctx.net.fetch(url, { ...opt, headers: { 'User-Agent': UA, ...(opt.headers || {}) } });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.text();
}
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');
const text = (v) => ({ t: 'text', v: String(v ?? '') });

// ---------------------------------------------------------------- 공통 연결기 뼈대
class Connector {
  constructor(p, id) { this.p = p; this.id = id; this.stopped = false; this.timer = null; }
  start() { this.stopped = false; this.run(); }
  stop() { this.stopped = true; clearTimeout(this.timer); this.close(); setStatus(this.p, { state: 'off', detail: '' }); }
  kick() { if (this.stopped || this.state === 'live') return; clearTimeout(this.timer); this.run(); }
  later(ms) { clearTimeout(this.timer); if (!this.stopped) this.timer = setTimeout(() => this.run(), ms); }
  async run() {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try { await this.connect(); }
    catch (e) {
      if (this.stopped) return;
      if (e.offline) { this.state = 'wait'; setStatus(this.p, { state: 'wait', detail: e.message }); this.later(RETRY_OFFLINE[this.p]); }
      else { this.state = 'error'; ctx.log.warn('chat', this.p, e.message); setStatus(this.p, { state: 'error', detail: e.message }); this.later(RETRY_ERROR); }
    } finally { this.busy = false; }
  }
  live(extra = {}) { this.state = 'live'; setStatus(this.p, { state: 'live', detail: '', ...extra }); }
  dropped(why) {          // 연결이 끊김 → 잠깐 뒤 다시 시도
    if (this.stopped) return;
    this.close();
    this.state = 'wait'; setStatus(this.p, { state: 'wait', detail: why || '다시 연결하는 중' });
    this.later(3000);
  }
  close() {}
}
const offline = (msg) => Object.assign(new Error(msg), { offline: true });

// ---------------------------------------------------------------- 치지직
class Chzzk extends Connector {
  async connect() {
    const st = (await getJson(`https://api.chzzk.naver.com/polling/v2/channels/${this.id}/live-status`))?.content;
    if (!st || st.status !== 'OPEN' || !st.chatChannelId) throw offline('방송 대기 중');
    const cid = st.chatChannelId;
    const tok = (await getJson(`https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${cid}&chatType=STREAMING`));
    if (tok?.code === 42601) throw new Error('연령 제한 방송은 채팅을 읽을 수 없어요');
    const accTkn = tok?.content?.accessToken;
    if (!accTkn) throw new Error('채팅 토큰을 받지 못했어요');
    const server = (Math.abs([...cid].reduce((a, c) => a + c.charCodeAt(0), 0)) % 9) + 1;
    const ws = new WebSocket(`wss://kr-ss${server}.chat.naver.com/chat`, { headers: { Origin: 'https://chzzk.naver.com', 'User-Agent': UA } });
    this.ws = ws; this.cid = cid;
    const base = { ver: '2', svcid: 'game', cid };
    const send = (o) => { try { ws.send(JSON.stringify(o)); } catch {} };
    const ping = () => { clearTimeout(this.pingT); this.pingT = setTimeout(() => { send({ cmd: 0, ver: '2' }); ping(); }, 20000); };
    ws.on('open', () => send({ ...base, cmd: 100, tid: 1, bdy: { uid: null, devType: 2001, accTkn, auth: 'READ' } }));
    ws.on('message', (raw) => {
      let j; try { j = JSON.parse(raw.toString()); } catch { return; }
      switch (j.cmd) {
        case 10100: this.sid = j.bdy?.sid; this.live({ url: `https://chzzk.naver.com/live/${this.id}/chat` }); send({ ...base, cmd: 5101, tid: 2, sid: this.sid, bdy: { recentMessageCount: 30 } }); break;
        case 0: send({ cmd: 10000, ver: '2' }); break;
        case 93101: case 93102: case 15101: {
          const list = Array.isArray(j.bdy) ? j.bdy : (j.bdy?.messageList || []);
          for (const c of list) this.parse(c, j.cmd === 15101);
          break;
        }
      }
      ping();
    });
    ws.on('close', () => { if (this.ws === ws) this.dropped('연결이 끊겨서 다시 붙는 중'); });
    ws.on('error', (e) => ctx.log.warn('chat', 'chzzk ws', e.message));
    // chatChannelId는 방송 중에 바뀔 수 있어요 → 30초마다 확인
    clearInterval(this.watchT);
    this.watchT = setInterval(async () => {
      try {
        const s = (await getJson(`https://api.chzzk.naver.com/polling/v2/channels/${this.id}/live-status`))?.content;
        if (!s || s.status !== 'OPEN') { this.close(); this.state = 'wait'; setStatus(this.p, { state: 'wait', detail: '방송 종료' }); this.later(RETRY_OFFLINE.chzzk); }
        else if (s.chatChannelId && s.chatChannelId !== this.cid) this.dropped('채팅방이 바뀌어서 다시 붙는 중');
      } catch {}
    }, 30000);
  }
  parse(c, recent) {
    let profile = {}; let extras = {};
    try { profile = JSON.parse(c.profile || 'null') || {}; } catch {}
    try { extras = JSON.parse(c.extras || 'null') || {}; } catch {}
    const type = Number(c.msgTypeCode || c.messageTypeCode || 1);
    const raw = String(c.msg ?? c.content ?? '');
    const hidden = (c.msgStatusType || c.messageStatusType) === 'HIDDEN';
    if (hidden) return;
    // {:이모티콘:} → 이미지
    const emojis = extras.emojis || {};
    const parts = [];
    let last = 0;
    raw.replace(/\{:([^:{}]+):\}/g, (m, name, i) => {
      if (i > last) parts.push(text(raw.slice(last, i)));
      const src = safeUrl(emojis[name]);
      parts.push(src ? { t: 'img', src, alt: name } : text(m));
      last = i + m.length; return m;
    });
    if (last < raw.length) parts.push(text(raw.slice(last)));
    const role = profile.userRoleCode;
    const m = { p: 'chzzk', nick: profile.nickname || (extras.isAnonymous ? '익명' : '알 수 없음'), parts, recent, ts: Number(c.msgTime || c.messageTime) || Date.now(),
      badge: role === 'streamer' ? '스트리머' : role === 'streaming_chat_manager' || role === 'streaming_channel_manager' ? '매니저' : '' };
    if (type === 10) { m.kind = 'donation'; m.amount = `${Number(extras.payAmount || 0).toLocaleString('ko-KR')}치즈`; }
    else if (type === 11) { m.kind = 'sub'; m.amount = `${extras.month || 1}개월 구독`; }
    else if (type === 30) { m.kind = 'system'; }
    else m.kind = 'chat';
    emitMessage(m);
  }
  close() {
    clearTimeout(this.pingT); clearInterval(this.watchT);
    const ws = this.ws; this.ws = null;
    if (ws) { try { ws.removeAllListeners('close'); ws.on('error', () => {}); ws.close(); } catch {} }
  }
}

// ---------------------------------------------------------------- 유튜브 (InnerTube, API 키 없이)
function ytLiveUrl(id) {
  const s = String(id).trim();
  let m;
  if ((m = s.match(/(?:v=|youtu\.be\/|\/live\/)([\w-]{11})/))) return `https://www.youtube.com/watch?v=${m[1]}`;
  if ((m = s.match(/(UC[\w-]{22})/))) return `https://www.youtube.com/channel/${m[1]}/live`;
  if ((m = s.match(/@([\w.\-]+)/))) return `https://www.youtube.com/@${m[1]}/live`;
  if (/^[\w.\-]+$/.test(s)) return `https://www.youtube.com/@${s}/live`;
  return '';
}
function ytAllMessages(top) {
  // "인기 채팅" 토큰을 "모든 채팅" 토큰으로 바꾸기 (protobuf 1바이트, youtube-chat-next 참고)
  try {
    const buf = Buffer.from(decodeURIComponent(top).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const at = []; for (let i = 0; i < buf.length - 1; i++) if (buf[i] === 0x08 && buf[i + 1] === 0x04) at.push(i);
    if (at.length !== 1) return top;
    buf[at[0] + 1] = 0x01;
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  } catch { return top; }
}
class YouTube extends Connector {
  async connect() {
    const url = ytLiveUrl(this.id);
    if (!url) throw new Error('유튜브 채널 주소를 확인해 주세요');
    let html;
    try { html = await getText(url, { headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' } }); }
    catch (e) { if (e.status === 404) throw offline('방송 대기 중'); throw e; }
    const vid = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})">/)?.[1];
    if (!vid) throw offline('방송 대기 중');
    if (/['"]isReplay['"]:\s*true/.test(html)) throw offline('방송 대기 중 (지난 방송)');
    const key = html.match(/['"]INNERTUBE_API_KEY['"]:\s*['"](.+?)['"]/)?.[1];
    const ver = html.match(/['"]clientVersion['"]:\s*['"]([\d.]+?)['"]/)?.[1];
    const top = html.match(/"liveChatRenderer"\s*:\s*\{.*?"continuations"\s*:\s*\[\s*\{\s*"reloadContinuationData"\s*:\s*\{\s*"continuation"\s*:\s*"([^"]+)"/s)?.[1];
    if (!key || !ver) throw new Error('유튜브 페이지 형식이 바뀌었어요');
    if (!top) throw offline('채팅이 꺼져 있거나 방송 대기 중');
    this.vid = vid; this.key = key; this.ver = ver; this.cont = ytAllMessages(top); this.first = true;
    this.live({ videoId: vid, url: `https://www.youtube.com/live_chat?is_popout=1&v=${vid}&dark_theme=1` });
    this.poll();
  }
  async poll() {
    if (this.stopped || this.state !== 'live') return;
    let wait = 3000;
    try {
      const r = await ctx.net.fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${this.key}&prettyPrint=false`, {
        method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: this.ver, hl: 'ko', gl: 'KR' } }, continuation: this.cont }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lc = (await r.json())?.continuationContents?.liveChatContinuation;
      if (!lc) { this.state = 'wait'; setStatus(this.p, { state: 'wait', detail: '방송 종료', videoId: '' }); return this.later(RETRY_OFFLINE.youtube); }
      for (const a of lc.actions || []) this.parse(a, this.first);
      this.first = false;
      const c = lc.continuations?.[0];
      const next = c?.invalidationContinuationData || c?.timedContinuationData || c?.reloadContinuationData;
      if (!next?.continuation) { this.state = 'wait'; setStatus(this.p, { state: 'wait', detail: '방송 종료', videoId: '' }); return this.later(RETRY_OFFLINE.youtube); }
      this.cont = next.continuation;
      wait = Math.min(8000, Math.max(1000, Number(next.timeoutMs) || 3000));
    } catch (e) {
      ctx.log.warn('chat', 'youtube poll', e.message);
      if (++this.fails > 5) { this.fails = 0; return this.dropped('다시 연결하는 중'); }
      wait = 5000;
    }
    this.fails = 0;
    clearTimeout(this.pollT);
    this.pollT = setTimeout(() => this.poll(), wait);
  }
  parse(a, recent) {
    const it = a.addChatItemAction?.item; if (!it) return;
    const r = it.liveChatTextMessageRenderer || it.liveChatPaidMessageRenderer || it.liveChatPaidStickerRenderer || it.liveChatMembershipItemRenderer;
    if (!r) return;
    const runs = r.message?.runs || r.headerSubtext?.runs || [];
    const parts = runs.map((x) => {
      if ('text' in x) return text(x.text);
      const th = x.emoji?.image?.thumbnails || [];
      const src = safeUrl(th[0]?.url);
      const alt = x.emoji?.shortcuts?.[0] || x.emoji?.emojiId || '';
      return src ? { t: 'img', src, alt } : text(alt);
    });
    const badges = (r.authorBadges || []).map((b) => b.liveChatAuthorBadgeRenderer?.icon?.iconType || (b.liveChatAuthorBadgeRenderer?.customThumbnail ? 'MEMBER' : ''));
    const m = { p: 'youtube', id: 'yt-' + r.id, nick: (r.authorName?.simpleText || '').replace(/^@/, ''), parts, recent, ts: Number(r.timestampUsec) / 1000 || Date.now(),
      badge: badges.includes('OWNER') ? '스트리머' : badges.includes('MODERATOR') ? '매니저' : badges.includes('MEMBER') ? '멤버' : '' };
    if (it.liveChatPaidMessageRenderer || it.liveChatPaidStickerRenderer) { m.kind = 'donation'; m.amount = r.purchaseAmountText?.simpleText || ''; }
    else if (it.liveChatMembershipItemRenderer) { m.kind = 'sub'; m.amount = '멤버십'; }
    else m.kind = 'chat';
    emitMessage(m);
  }
  close() { clearTimeout(this.pollT); this.state = 'off'; }
}

// ---------------------------------------------------------------- SOOP (soop-chat 참고)
const FS = '\x0c';
function soopPacket(op, body) {
  const b = Buffer.from(body, 'utf8');
  return Buffer.concat([Buffer.from(`\x1b\x09${op}${String(b.length).padStart(6, '0')}00`, 'latin1'), b]);
}
class Soop extends Connector {
  async live_info() {
    const body = new URLSearchParams({ bid: this.id, bno: '', type: 'live', pwd: '', player_type: 'html5', stream_type: 'common', quality: 'HD', mode: 'landing', from_api: '0', is_revive: 'false' }).toString();
    let last;
    for (const host of ['live.sooplive.com', 'live.sooplive.co.kr']) {
      try {
        return await getJson(`https://${host}/afreeca/player_live_api.php?bjid=${encodeURIComponent(this.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      } catch (e) { last = e; }
    }
    throw last;
  }
  async connect() {
    const root = await this.live_info();
    const ch = root?.CHANNEL || root || {};
    const res = Number(ch.RESULT ?? root.RESULT);
    if (res !== 1) {
      if (res === 0) throw offline('방송 대기 중');
      if (res === -6 || res === -8) throw new Error('19세 방송은 로그인이 필요해서 채팅을 못 읽어요');
      if (String(ch.BPWD).toUpperCase() === 'Y' || res === -1988) throw new Error('비밀번호 방송은 채팅을 못 읽어요');
      throw offline('방송 대기 중');
    }
    if (String(ch.BPWD).toUpperCase() === 'Y') throw new Error('비밀번호 방송은 채팅을 못 읽어요');
    const chatNo = String(ch.CHATNO || ''), domain = String(ch.CHDOMAIN || '').toLowerCase(), port = Number(ch.CHPT);
    if (!chatNo || !domain || !port) throw new Error('SOOP 채팅 정보를 못 받았어요');
    const ws = new WebSocket(`wss://${domain}:${port + 1}/Websocket/${encodeURIComponent(this.id)}`, 'chat', { headers: { Origin: 'https://play.sooplive.com', 'User-Agent': UA } });
    ws.binaryType = 'nodebuffer';
    this.ws = ws; this.buf = Buffer.alloc(0); this.joined = false;
    ws.on('open', () => { try { ws.send(soopPacket('0001', `${FS}${FS}${FS}16${FS}`)); } catch {} });
    ws.on('message', (data) => this.onData(Buffer.isBuffer(data) ? data : Buffer.from(data), ws, chatNo));
    ws.on('close', () => { if (this.ws === ws) this.dropped('연결이 끊겨서 다시 붙는 중'); });
    ws.on('error', (e) => ctx.log.warn('chat', 'soop ws', e.message));
    clearInterval(this.keepT);
    this.keepT = setInterval(() => { try { ws.send(soopPacket('0000', FS)); } catch {} }, 60000);
    clearInterval(this.watchT);
    this.watchT = setInterval(async () => {   // 방송이 꺼졌는지 1분마다 확인
      try { const r = await this.live_info(); if (Number((r?.CHANNEL || r)?.RESULT) === 0) { this.close(); this.state = 'wait'; setStatus(this.p, { state: 'wait', detail: '방송 종료' }); this.later(RETRY_OFFLINE.soop); } } catch {}
    }, 60000);
  }
  onData(chunk, ws, chatNo) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 14) {
      if (this.buf[0] !== 0x1b || this.buf[1] !== 0x09) {
        const i = this.buf.indexOf(Buffer.from([0x1b, 0x09]), 1);
        this.buf = i < 0 ? Buffer.alloc(0) : this.buf.subarray(i);
        continue;
      }
      const op = this.buf.toString('latin1', 2, 6), len = Number(this.buf.toString('latin1', 6, 12));
      if (!/^\d{4}$/.test(op) || !Number.isFinite(len)) { this.buf = this.buf.subarray(2); continue; }
      if (this.buf.length < 14 + len) break;
      const t = this.buf.toString('utf8', 14, 14 + len);
      this.buf = this.buf.subarray(14 + len);
      const i = t.indexOf(FS);
      const f = (i >= 0 ? t.slice(i + 1) : t).split(FS);
      this.handle(op, f, ws, chatNo);
    }
  }
  handle(op, f, ws, chatNo) {
    switch (op) {
      case '0001': if (!this.joined) { try { ws.send(soopPacket('0002', `${FS}${chatNo}${FS.repeat(5)}`)); } catch {} } break;
      case '0002': if (!this.joined) { this.joined = true; this.live({ url: `https://play.sooplive.com/${encodeURIComponent(this.id)}` }); } break;
      case '0005': {
        if (f.length < 7) return;
        const flag1 = Number(String(f[6] || '').split('|')[0]) || 0;
        emitMessage({ p: 'soop', kind: 'chat', nick: f[5] || f[1] || '', parts: [text(String(f[0] || '').replace(/\r/g, ''))],
          badge: flag1 & 4 ? '스트리머' : (flag1 & 256 || flag1 & 64) ? '매니저' : flag1 & 32768 ? '열혈' : flag1 & 32 ? '팬' : '' });
        break;
      }
      case '0018': if (f.length >= 4) emitMessage({ p: 'soop', kind: 'donation', nick: f[2], amount: `별풍선 ${Number(f[3]) || 0}개`, parts: [] }); break;
      case '0033': if (f.length >= 6) emitMessage({ p: 'soop', kind: 'donation', nick: f[4], amount: `별풍선 ${Number(f[5]) || 0}개`, parts: [] }); break;
      case '0087': if (f.length >= 10) emitMessage({ p: 'soop', kind: 'donation', nick: f[3], amount: `애드벌룬 ${Number(f[9]) || 0}개`, parts: f[4] ? [text(f[4])] : [] }); break;
      case '0105': if (f.length >= 5) emitMessage({ p: 'soop', kind: 'donation', nick: f[3], amount: `영상풍선 ${Number(f[4]) || 0}개`, parts: [] }); break;
    }
  }
  close() {
    clearInterval(this.keepT); clearInterval(this.watchT);
    const ws = this.ws; this.ws = null; this.joined = false;
    if (ws) { try { ws.removeAllListeners('close'); ws.on('error', () => {}); ws.close(); } catch {} }
  }
}

// ---------------------------------------------------------------- 바깥에서 쓰는 함수
const CLASSES = { chzzk: Chzzk, youtube: YouTube, soop: Soop };
function init(c) { ctx = c; }
// channels: { chzzk, youtube, soop } — 바뀐 것만 다시 연결
function configure(channels = {}) {
  for (const p of Object.keys(CLASSES)) {
    const id = String(channels[p] || '').trim();
    const cur = conns[p];
    if (cur && cur.id === id) continue;
    if (cur) { cur.stop(); delete conns[p]; }
    if (!id) { status[p] = { state: 'off', detail: '' }; ctx.send('chat:status', { p, state: 'off', detail: '' }); continue; }
    const c = new CLASSES[p](p, id); conns[p] = c;
    setStatus(p, { state: 'wait', detail: '연결 확인 중', url: '', videoId: '' });
    c.start();
  }
  return snapshot();
}
function kick() { for (const c of Object.values(conns)) c.kick(); }      // 방송 시작 직후 바로 다시 확인
function snapshot() { return { ...status }; }
function stopAll() { for (const c of Object.values(conns)) c.stop(); }

module.exports = { init, configure, kick, snapshot, stopAll, _test: { ytLiveUrl, ytAllMessages, soopPacket, Soop, Chzzk, YouTube } };
