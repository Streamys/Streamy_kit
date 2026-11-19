// 로컬 오버레이 서버: OBS 브라우저 소스/독이 여기 페이지를 불러옴
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 17890;
const PAGES = {
  '/overlay/timer': 'overlays/timer.html',
};

// 타이머 상태 (서버가 단일 진실 원천)
const timer = {
  mode: 'stopwatch', // 'stopwatch' | 'countdown'
  running: false,
  baseMs: 0,          // 정지 상태에서 누적된 시간(스톱워치) 또는 남은 시간(카운트다운)
  startedAt: 0,
  label: '',
  theme: 'red',
};

function snapshot() {
  return { ...timer, now: Date.now() };
}

const clients = new Set();
function broadcast() {
  const data = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(data);
}

function currentMs() {
  if (!timer.running) return timer.baseMs;
  const elapsed = Date.now() - timer.startedAt;
  return timer.mode === 'stopwatch' ? timer.baseMs + elapsed : Math.max(0, timer.baseMs - elapsed);
}

function applyAction(a) {
  switch (a.type) {
    case 'start':
      if (!timer.running) { timer.startedAt = Date.now(); timer.running = true; }
      break;
    case 'pause':
      if (timer.running) { timer.baseMs = currentMs(); timer.running = false; }
      break;
    case 'reset':
      timer.running = false;
      timer.baseMs = timer.mode === 'countdown' ? (Number(a.minutes) || 10) * 60000 : 0;
      break;
    case 'config':
      timer.running = false;
      if (a.mode === 'stopwatch' || a.mode === 'countdown') timer.mode = a.mode;
      if (typeof a.label === 'string') timer.label = a.label.slice(0, 40);
      if (typeof a.theme === 'string') timer.theme = a.theme;
      timer.baseMs = timer.mode === 'countdown' ? (Number(a.minutes) || 10) * 60000 : 0;
      break;
  }
  broadcast();
}

function start() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/api/timer/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/timer' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
      req.on('end', () => {
        try { applyAction(JSON.parse(body || '{}')); } catch { /* ignore */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(snapshot()));
      });
      return;
    }
    // 로그인 돌아오는 곳 (치지직 / 구글) → 메인 프로세스가 토큰으로 바꿈
    const m = /^\/oauth\/(chzzk|google)$/.exec(url.pathname);
    if (m) {
      const done = (ok, msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Streamy Kit</title><body style="background:#0e0e10;color:#fff;font-family:'Malgun Gothic',sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:42px">${ok ? '✅' : '⚠️'}</div><h2>${ok ? '연결됐어요!' : '연결하지 못했어요'}</h2><p style="color:#aaa">${String(msg || '').replace(/[<>&]/g, '')}</p><p style="color:#aaa">이 창은 닫아도 돼요. Streamy Kit으로 돌아가세요.</p></div></body>`);
      };
      const q = Object.fromEntries(url.searchParams);
      if (!oauthHandler) return done(false, '준비가 안 됐어요');
      Promise.resolve(oauthHandler(m[1], q)).then((r) => done(true, r || ''), (e) => done(false, e.message));
      return;
    }
    const file = PAGES[url.pathname];
    if (file) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(path.join(__dirname, file)).pipe(res);
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  server.on('error', (e) => console.error('[server]', e.message));
  server.listen(PORT, '127.0.0.1');
  return server;
}

let oauthHandler = null;
module.exports = { start, applyAction, PORT, onOAuth: (fn) => { oauthHandler = fn; }, url: (p) => `http://127.0.0.1:${PORT}${p}` };
