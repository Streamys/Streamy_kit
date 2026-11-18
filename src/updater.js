// Streamy Kit 업데이트: GitHub Releases에서 최신 설치 파일을 받아 조용히 설치하고 다시 실행
// 릴리스 규칙: 태그 vX.Y.Z, 첨부 파일 StreamyKit-Setup-X.Y.Z-x64.exe (GitHub Actions가 자동으로 만들어 붙임)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'Streamys/Streamy_kit';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const ALLOWED = `https://github.com/${REPO}/releases/download/`;

let ctx = null;
let state = { status: 'idle' };   // idle | checking | latest | available | downloading | ready | error
let info = null;                  // { version, notes, url, size, page }
let file = null;

function init(c) { ctx = c; }
function emit(patch) { state = { ...state, ...patch }; ctx.send('update:state', { ...state, current: ctx.app.getVersion(), info }); }

// 1.10.0 > 1.9.3 처럼 숫자로 비교
function newer(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0; }
  return false;
}

async function check(manual) {
  if (['downloading', 'ready'].includes(state.status)) return state;
  emit({ status: 'checking', error: '', manual: !!manual });
  try {
    const r = await ctx.net.fetch(API, { headers: { 'User-Agent': 'StreamyKit-Updater', Accept: 'application/vnd.github+json' } });
    if (r.status === 404) { emit({ status: 'latest' }); return state; }          // 아직 릴리스가 없음
    if (!r.ok) throw new Error('업데이트 서버 응답 ' + r.status);
    const j = await r.json();
    const version = String(j.tag_name || '').replace(/^v/i, '');
    const asset = (j.assets || []).find((a) => /^StreamyKit-Setup-.*-x64\.exe$/i.test(a.name));
    if (!version || !newer(version, ctx.app.getVersion())) { info = null; emit({ status: 'latest' }); return state; }
    if (!asset || !String(asset.browser_download_url).startsWith(ALLOWED)) { info = null; emit({ status: 'latest' }); return state; }  // 설치 파일이 아직 안 붙음
    info = { version, notes: String(j.body || '').slice(0, 2000), url: asset.browser_download_url, size: asset.size, page: j.html_url };
    ctx.log.info('update', `available ${version} (current ${ctx.app.getVersion()})`);
    emit({ status: 'available' });
  } catch (e) {
    ctx.log.warn('update', 'check failed', e.message);
    emit({ status: manual ? 'error' : 'idle', error: '업데이트를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.' });
  }
  return state;
}

async function download() {
  if (!info) throw new Error('받을 업데이트가 없어요.');
  if (state.status === 'ready' && file && fs.existsSync(file)) return state;
  const dir = path.join(os.tmpdir(), 'streamy-kit-update');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `StreamyKit-Setup-${info.version}-x64.exe`);
  const part = dest + '.part';
  emit({ status: 'downloading', progress: 0, error: '' });
  try {
    const r = await ctx.net.fetch(info.url, { headers: { 'User-Agent': 'StreamyKit-Updater' } });
    if (!r.ok || !r.body) throw new Error('다운로드 실패 (' + r.status + ')');
    const total = Number(r.headers.get('content-length')) || info.size || 0;
    const out = fs.createWriteStream(part);
    const reader = r.body.getReader();
    let got = 0, lastEmit = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
      got += value.length;
      const now = Date.now();
      if (now - lastEmit > 250) { lastEmit = now; emit({ progress: total ? Math.min(99, Math.floor((got / total) * 100)) : 0 }); }
    }
    await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
    if (info.size && got !== info.size) throw new Error(`파일 크기가 맞지 않아요 (${got}/${info.size})`);
    fs.renameSync(part, dest);
    file = dest;
    ctx.log.info('update', 'downloaded', dest, got);
    emit({ status: 'ready', progress: 100 });
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch {}
    ctx.log.error('update', 'download failed', e);
    emit({ status: 'available', error: '업데이트를 받지 못했어요: ' + e.message });
    throw e;
  }
  return state;
}

// 설치 파일을 조용히(/S) 실행. 설치가 끝나면 설치 파일이 Streamy Kit을 다시 켬(/relaunch)
function launchInstaller() {
  if (!file || !fs.existsSync(file)) throw new Error('설치 파일이 없어요.');
  ctx.log.info('update', 'launch installer', file);
  const p = spawn(file, ['/S', '/relaunch'], { detached: true, stdio: 'ignore', windowsHide: false });
  p.unref();
}

module.exports = { init, check, download, launchInstaller, newer };
