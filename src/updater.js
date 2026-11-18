// Streamy Kit 업데이트: GitHub Releases에서 최신 설치 파일을 받아 조용히 설치하고 다시 실행
// 릴리스 규칙: 태그 vX.Y.Z, 첨부 파일 StreamyKit-Setup-X.Y.Z-x64.exe (GitHub Actions가 자동으로 만들어 붙임)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const unzip = require('./unzip');

const REPO = 'Streamys/Streamy_kit';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const ALLOWED = `https://github.com/${REPO}/releases/download/`;

let ctx = null;
let localDir = null;              // 바탕화면\Streamy Kit 업데이트
const LOCAL_RE = /^StreamyKit-(?:Setup-(\d+\.\d+\.\d+)-x64\.(exe|zip)|Patch-(\d+\.\d+\.\d+)\.zip)$/i;   // 설치 파일 또는 빠른 업데이트
const baseVersion = () => (global.STREAMY && global.STREAMY.baseVersion) || ctx.app.getVersion();
const patchRoot = () => (global.STREAMY && global.STREAMY.patchRoot) || path.join(ctx.app.getPath('appData'), 'Streamy Kit', 'patch');
let state = { status: 'idle' };   // idle | checking | latest | available | downloading | ready | error
let info = null;                  // { version, notes, url, size, page }
let file = null;

function init(c) {
  ctx = c;
  try {
    const desktop = ctx.app.getPath('desktop');
    localDir = path.join(desktop, 'Streamy Kit 업데이트');
    fs.mkdirSync(localDir, { recursive: true });
    // 폴더에 파일이 들어오면 바로 확인 (바탕화면 자체도 확인)
    let t = null;
    const kick = () => { clearTimeout(t); t = setTimeout(() => checkLocal(false), 400); };
    for (const d of [localDir, desktop]) { try { fs.watch(d, { persistent: false }, (_ev, name) => { if (!name || LOCAL_RE.test(String(name))) kick(); }); } catch {} }
    // OneDrive 바탕화면은 알림이 늦거나 빠질 때가 있어서 3초마다 한 번 더 확인 (폴더 목록만 봐서 가벼움)
    setInterval(() => { if (!['downloading', 'ready', 'available'].includes(state.status)) checkLocal(false); }, 3000);
  } catch (e) { ctx.log.warn('update', 'local folder', e.message); localDir = null; }
}
function folder() { return localDir; }

// 바탕화면 / 업데이트 폴더에서 지금보다 새 설치 파일 찾기
function findLocal() {
  if (!localDir) return null;
  let best = null;
  for (const d of [localDir, path.dirname(localDir)]) {
    let names = []; try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      const m = n.match(LOCAL_RE); if (!m) continue;
      const patch = !!m[3], version = m[1] || m[3], kind = patch ? 'patch' : m[2].toLowerCase();
      const full = path.join(d, n);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile() || st.size < (patch ? 1024 : 1024 * 1024)) continue;     // 아직 복사 중이거나 깨진 파일 제외
      if (!newer(version, ctx.app.getVersion())) continue;
      if (patch) {   // 빠른 업데이트가 이 설치 버전에서 쓸 수 있는지 (patch.json의 minBase)
        let meta = null; try { meta = JSON.parse(unzip.readText(full, 'patch.json') || 'null'); } catch {}
        if (!meta || meta.version !== version || (meta.minBase && newer(meta.minBase, baseVersion()))) continue;
      }
      const rank = { patch: 3, exe: 2, zip: 1 }[kind];
      if (!best || newer(version, best.version) || (version === best.version && rank > best.rank)) best = { version, file: full, kind, size: st.size, mtime: st.mtimeMs, rank };
    }
  }
  return best;
}
async function checkLocal(manual) {
  if (['downloading', 'ready'].includes(state.status)) return state;
  const l = findLocal();
  if (!l) { if (manual) return null; if (info && info.local) { info = null; emit({ status: 'latest' }); } return null; }
  if (info && info.local === l.file && state.status === 'available') return state;    // 이미 알림
  // 파일이 아직 복사 중일 수 있으니 크기가 잠깐 그대로인지 확인
  await new Promise((r) => setTimeout(r, 500));
  try { if (fs.statSync(l.file).size !== l.size) return checkLocal(manual); } catch { return null; }
  info = { version: l.version, notes: `${l.kind === 'patch' ? '빠른 업데이트' : '설치 파일'}: ${path.basename(l.file)}`, local: l.file, kind: l.kind, size: l.size, patch: l.kind === 'patch' };
  ctx.log.info('update', `local update ${l.version} at ${l.file}`);
  emit({ status: 'available', error: '' });
  return state;
}
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
  if (await checkLocal(true)) return state;            // 바탕화면 파일이 있으면 그걸로
  try {
    const r = await ctx.net.fetch(API, { headers: { 'User-Agent': 'StreamyKit-Updater', Accept: 'application/vnd.github+json' } });
    if (r.status === 404) { emit({ status: 'latest', checkedAt: Date.now() }); return state; }          // 아직 릴리스가 없음
    if (!r.ok) throw new Error('업데이트 서버 응답 ' + r.status);
    const j = await r.json();
    const version = String(j.tag_name || '').replace(/^v/i, '');
    state.checkedAt = Date.now(); state.remoteLatest = version;
    if (!version || !newer(version, ctx.app.getVersion())) { info = null; emit({ status: 'latest' }); return state; }
    const ok = (a) => a && String(a.browser_download_url).startsWith(ALLOWED);
    // 빠른 업데이트(src만)가 있고 지금 설치 버전에서 쓸 수 있으면 그걸로 (몇 초, 허용 창 없음). 아니면 설치 파일
    const patchAsset = (j.assets || []).find((a) => a.name === `StreamyKit-Patch-${version}.zip`);
    const minBase = (String(j.body || '').match(/minBase[:=\s]+(\d+\.\d+\.\d+)/i) || [])[1];
    const setupAsset = (j.assets || []).find((a) => /^StreamyKit-Setup-.*-x64\.exe$/i.test(a.name));
    let asset = null, kind = null;
    if (ok(patchAsset) && !(minBase && newer(minBase, baseVersion()))) { asset = patchAsset; kind = 'patch'; }
    else if (ok(setupAsset)) { asset = setupAsset; kind = 'exe'; }
    if (!asset) { info = null; emit({ status: 'latest' }); return state; }     // 파일이 아직 안 붙음
    info = { version, notes: String(j.body || '').slice(0, 2000), url: asset.browser_download_url, size: asset.size, page: j.html_url, kind, patch: kind === 'patch', remote: true };
    ctx.log.info('update', `github ${kind} ${version} available (current ${ctx.app.getVersion()})`);
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
  const dest = path.join(dir, info.kind === 'patch' ? `StreamyKit-Patch-${info.version}.zip` : `StreamyKit-Setup-${info.version}-x64.exe`);
  const part = dest + '.part';
  if (info.local) {
    emit({ status: 'downloading', progress: 30, error: '' });
    try {
      if (info.kind === 'patch') { await applyPatch(info.local, info.version); file = info.local; emit({ status: 'ready', progress: 100 }); return state; }
      if (info.kind === 'zip') await unzipExe(info.local, dir, dest);
      else fs.copyFileSync(info.local, dest);
      file = dest;
      emit({ status: 'ready', progress: 100 });
      return state;
    } catch (e) {
      ctx.log.error('update', 'local prepare failed', e);
      emit({ status: 'available', error: '업데이트 파일을 준비하지 못했어요: ' + e.message });
      throw e;
    }
  }
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
    if (info.kind === 'patch') await applyPatch(dest, info.version);     // 받은 빠른 업데이트를 바로 풀어 둠
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

// ZIP 안의 설치 파일 꺼내기 (자체 ZIP 풀기 — PowerShell보다 훨씬 빠름)
async function unzipExe(zip, dir, dest) {
  const e = unzip.list(zip).entries.find((x) => /^StreamyKit-Setup-.*\.exe$/i.test(path.basename(x.name)));
  if (!e) throw new Error('ZIP 안에 설치 파일이 없어요');
  await unzip.extractEntry(zip, e, dest + '.part');
  fs.renameSync(dest + '.part', dest);
}

// 빠른 업데이트: %APPDATA%\Streamy Kit\patch\<버전> 에 풀고 다음 실행부터 그 코드로 켜짐 (관리자 권한 불필요)
async function applyPatch(zip, version) {
  const root = patchRoot();
  const tmp = path.join(root, `${version}.tmp-${Date.now()}`), dir = path.join(root, version);
  fs.mkdirSync(root, { recursive: true });
  try {
    await unzip.extractAll(zip, tmp);
    const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'patch.json'), 'utf8'));
    if (meta.version !== version) throw new Error('버전 정보가 맞지 않아요');
    if (meta.minBase && newer(meta.minBase, baseVersion())) throw new Error(`이 빠른 업데이트는 설치 버전 ${meta.minBase} 이상이 필요해요`);
    for (const f of ['src/main.js', 'src/renderer/index.html', 'src/renderer/app.js']) if (!fs.existsSync(path.join(tmp, f))) throw new Error('빠진 파일이 있어요: ' + f);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    fs.rmSync(path.join(root, `bad-${version}`), { force: true });
    fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ version, at: Date.now(), from: path.basename(zip) }));
    ctx.log.info('update', `patch ${version} ready at ${dir}`);
  } catch (e) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} throw e; }
}
function isPatch() { return !!(info && info.kind === 'patch' && state.status === 'ready'); }

// 설치 파일을 조용히(/S) 실행. 설치가 끝나면 설치 파일이 Streamy Kit을 다시 켬(/relaunch)
// 설치 파일 실행. 설치 파일은 관리자 권한이 필요해서, 일반 실행(spawn)으로는 윈도우 허용 창이 안 뜨고 막혀요(EACCES).
// → PowerShell Start-Process -Verb RunAs 로 실행해서 윈도우 허용(UAC) 창을 띄움.
//   "예"를 누르면 설치 시작 → true, "아니요"를 누르거나 실패하면 오류 (앱은 그대로 켜져 있음)
function launchInstaller() {
  return new Promise((resolve, reject) => {
    if (!file || !fs.existsSync(file)) return reject(new Error('설치 파일이 없어요.'));
    ctx.log.info('update', 'launch installer (elevated)', file);
    const q = (x) => "'" + String(x).replace(/'/g, "''") + "'";
    const ps = `try { Start-Process -FilePath ${q(file)} -ArgumentList '/S','/relaunch' -Verb RunAs -ErrorAction Stop; exit 0 } catch { if ($_.Exception.Message -match 'cancel|취소') { exit 2 } ; Write-Error $_.Exception.Message; exit 1 }`;
    let err = '';
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => { ctx.log.error('update', 'powershell failed', e); reject(new Error('설치 파일을 실행하지 못했어요: ' + e.message)); });
    p.on('exit', (code) => {
      if (code === 0) { ctx.log.info('update', 'installer started'); return resolve(true); }
      ctx.log.warn('update', 'installer not started', code, err.trim());
      if (code === 2 || /cancel|취소/i.test(err)) return reject(new Error('윈도우 허용 창에서 "아니요"를 눌러서 업데이트를 취소했어요.'));
      reject(new Error('설치 파일을 실행하지 못했어요. 바탕화면 업데이트 폴더의 ZIP을 풀어서 직접 실행해 주세요.'));
    });
  });
}

// 이미 설치된 버전 이하의 업데이트 파일은 업데이트 폴더에서 정리 (폴더에 계속 쌓이지 않게)
function cleanupLocal() {
  if (!localDir) return;
  let names = []; try { names = fs.readdirSync(localDir); } catch { return; }
  for (const n of names) {
    const m = n.match(LOCAL_RE); if (!m) continue;
    if (!newer(m[1], ctx.app.getVersion())) { try { fs.unlinkSync(path.join(localDir, n)); ctx.log.info('update', 'removed old update file', n); } catch {} }
  }
  try { fs.rmSync(path.join(os.tmpdir(), 'streamy-kit-update'), { recursive: true, force: true }); } catch {}
  // 지금 쓰는 것보다 오래된 빠른 업데이트 폴더 정리
  try {
    const root = patchRoot(), cur = ctx.app.getVersion();
    for (const n of fs.readdirSync(root)) {
      const full = path.join(root, n);
      if (/\.tmp-\d+$/.test(n)) { fs.rmSync(full, { recursive: true, force: true }); continue; }
      if (/^\d+\.\d+\.\d+$/.test(n) && n !== cur && !newer(n, cur)) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch {}
}

module.exports = { init, check, checkLocal, download, launchInstaller, newer, folder, cleanupLocal, isPatch, applyPatch };
