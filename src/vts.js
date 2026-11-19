// Streamy Kit — VTube Studio 연동 (메인 프로세스)
// VTube Studio 공식 API(내 PC 안 WebSocket, 기본 8001번)로 모델 · 표정 · 단축키 · 위치를 조종하고,
// VTube Studio를 뒤에서 자동으로 켜 줍니다. 화면은 Spout2로 받아요 (엔진 쪽).
'use strict';
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PLUGIN = { pluginName: 'Streamy Kit', pluginDeveloper: 'Streamy' };
const STEAM_APP_ID = '1325860';             // VTube Studio (Steam)
let ctx = null;                              // { app, log, shell, send, getWindows }
let ws = null, seq = 0, pending = new Map();
let state = { status: 'off', detail: '', port: 8001, model: null };   // off | connecting | waiting-allow | connected | error
let cfgFile = '', cfg = { token: '', port: 8001, exePath: '' };
let retryT = null, wantConnect = false;

function load() { try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) }; } catch {} }
function persist() { try { fs.writeFileSync(cfgFile, JSON.stringify(cfg)); } catch (e) { ctx.log.warn('vts', 'save', e.message); } }
function emit(patch) { state = { ...state, ...patch, port: cfg.port, hasToken: !!cfg.token, exePath: cfg.exePath }; ctx.send('vts:status', state); }

function init(c) {
  ctx = c;
  cfgFile = path.join(ctx.app.getPath('userData'), 'vtube-studio.json');
  load();
}

// ---------------------------------------------------------------- 요청 / 응답
function request(type, data = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('VTube Studio에 연결되지 않았어요'));
    const requestID = `sk${Date.now().toString(36)}${(seq++).toString(36)}`;
    const t = setTimeout(() => { pending.delete(requestID); reject(new Error('VTube Studio 응답이 없어요')); }, timeout);
    pending.set(requestID, { resolve, reject, t, type });
    ws.send(JSON.stringify({ apiName: 'VTubeStudioPublicAPI', apiVersion: '1.0', requestID, messageType: `${type}Request`, data }));
  });
}
function onMessage(raw) {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  const p = pending.get(m.requestID);
  if (!p) { if (m.messageType && m.messageType.endsWith('Event')) ctx.send('vts:event', m); return; }
  pending.delete(m.requestID); clearTimeout(p.t);
  if (m.messageType === 'APIError') p.reject(Object.assign(new Error(m.data?.message || 'VTube Studio 오류'), { code: m.data?.errorID }));
  else p.resolve(m.data || {});
}

// ---------------------------------------------------------------- 연결 + 허용(토큰)
async function connect() {
  wantConnect = true;
  clearTimeout(retryT);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return state;
  emit({ status: 'connecting', detail: '' });
  await new Promise((resolve) => {
    const sock = new WebSocket(`ws://127.0.0.1:${cfg.port}`);
    ws = sock;
    let opened = false;
    sock.on('open', () => { opened = true; resolve(); });
    sock.on('message', onMessage);
    sock.on('error', () => {});
    sock.on('close', () => {
      for (const [, p] of pending) { clearTimeout(p.t); p.reject(new Error('VTube Studio 연결이 끊겼어요')); }
      pending.clear();
      if (ws === sock) ws = null;
      if (!opened) resolve();
      emit({ status: wantConnect ? 'off' : 'off', detail: opened ? '연결이 끊겼어요' : 'VTube Studio가 꺼져 있거나 API가 꺼져 있어요', model: null });
      if (wantConnect) { clearTimeout(retryT); retryT = setTimeout(() => connect().catch(() => {}), 5000); }   // 켜지면 알아서 다시 붙음
    });
  });
  if (!ws || ws.readyState !== WebSocket.OPEN) return state;
  try {
    await authenticate();
    emit({ status: 'connected', detail: '' });
    refreshModel().catch(() => {});
  } catch (e) {
    ctx.log.warn('vts', 'auth', e.message);
    emit({ status: 'error', detail: e.message });
  }
  return state;
}
async function authenticate() {
  if (cfg.token) {
    const r = await request('Authentication', { ...PLUGIN, authenticationToken: cfg.token });
    if (r.authenticated) return true;
    cfg.token = ''; persist();       // 토큰이 취소됨 → 다시 허용 받기
  }
  emit({ status: 'waiting-allow', detail: 'VTube Studio 화면에서 "허용"을 눌러 주세요' });
  const t = await request('AuthenticationToken', { ...PLUGIN, pluginIcon: icon() }, 5 * 60 * 1000);
  cfg.token = t.authenticationToken; persist();
  const r = await request('Authentication', { ...PLUGIN, authenticationToken: cfg.token });
  if (!r.authenticated) throw new Error('VTube Studio에서 허용되지 않았어요');
  return true;
}
function icon() {
  // 128x128 PNG (base64). 없으면 생략
  try { const f = path.join(__dirname, 'renderer', 'vts-icon.png'); return fs.readFileSync(f).toString('base64'); } catch { return undefined; }
}
function disconnect() { wantConnect = false; clearTimeout(retryT); if (ws) { try { ws.close(); } catch {} } emit({ status: 'off', detail: '' }); }

// ---------------------------------------------------------------- 조종
async function refreshModel() {
  const cur = await request('CurrentModel');
  emit({ model: cur.modelLoaded ? { id: cur.modelID, name: cur.modelName, pos: cur.modelPosition } : null });
  return cur;
}
async function models() { return (await request('AvailableModels')).availableModels || []; }
async function loadModel(modelID) { await request('ModelLoad', { modelID }, 20000); return refreshModel(); }
async function hotkeys() { return (await request('HotkeysInCurrentModel')).availableHotkeys || []; }
async function trigger(hotkeyID) { return request('HotkeyTrigger', { hotkeyID }); }
async function expressions() { return (await request('ExpressionState', { details: false })).expressions || []; }
async function setExpression(expressionFile, active) { return request('ExpressionActivation', { expressionFile, active: !!active, fadeTime: 0.25 }); }
async function move(p) {
  const d = { timeInSeconds: 0.12, valuesAreRelativeToModel: false };
  for (const k of ['positionX', 'positionY', 'rotation', 'size']) if (Number.isFinite(p[k])) d[k] = p[k];
  return request('MoveModel', d);
}

// ---------------------------------------------------------------- VTube Studio 켜기
// 1) 기억해 둔 실행 파일  2) Steam 기본 설치 위치들  3) steam:// 로 실행
function steamLibraries() {
  const roots = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
  const libs = new Set(roots);
  for (const r of roots) {
    try {
      const vdf = fs.readFileSync(path.join(r, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch {}
  }
  return [...libs];
}
function findExe() {
  if (cfg.exePath && fs.existsSync(cfg.exePath)) return cfg.exePath;
  for (const lib of steamLibraries()) {
    const f = path.join(lib, 'steamapps', 'common', 'VTube Studio', 'VTube Studio.exe');
    if (fs.existsSync(f)) return f;
  }
  return '';
}
function rememberExe(p) { if (p && /vtube studio\.exe$/i.test(p) && p !== cfg.exePath) { cfg.exePath = p; persist(); emit({}); } }
function isRunning() { return (ctx.getWindows() || []).some((w) => /^vtube studio\.exe$/i.test(w.exe)); }
async function launch() {
  if (isRunning()) return { ok: true, already: true };
  const exe = findExe();
  if (exe) {
    try {
      require('child_process').spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }).unref();
      ctx.log.info('vts', 'launch', exe);
      return { ok: true, via: 'exe' };
    } catch (e) { ctx.log.warn('vts', 'launch exe failed', e.message); }
  }
  try { await ctx.shell.openExternal(`steam://rungameid/${STEAM_APP_ID}`); ctx.log.info('vts', 'launch via steam'); return { ok: true, via: 'steam' }; }
  catch (e) { return { ok: false, error: 'VTube Studio를 찾지 못했어요. Steam에서 설치했는지 확인해 주세요.' }; }
}
function setPort(port) { const n = Number(port); if (n > 0 && n < 65536) { cfg.port = n; persist(); emit({}); } }
function forget() { cfg.token = ''; persist(); disconnect(); }
function status() { return { ...state, port: cfg.port, hasToken: !!cfg.token, exePath: cfg.exePath }; }

module.exports = { init, connect, disconnect, status, models, loadModel, hotkeys, trigger, expressions, setExpression, move, refreshModel, launch, isRunning, rememberExe, setPort, forget };
