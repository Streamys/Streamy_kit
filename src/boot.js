// Streamy Kit — 시작 파일 (빠른 업데이트 로더)
// 설치된 프로그램(엔진 · Electron)은 그대로 두고, 화면/기능 코드(src)만 바뀐 "빠른 업데이트"가 있으면 그걸로 켭니다.
//   빠른 업데이트 위치: %APPDATA%\Streamy Kit\patch\<버전>\src  (관리자 권한 필요 없음)
// 안전장치: 빠른 업데이트로 두 번 연속 제대로 못 켜지면 그 버전은 건너뛰고 설치된 기본 버전으로 켭니다.
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const Module = require('module');

const BASE_VERSION = app.getVersion();
// 빠른 업데이트 코드도 설치 폴더의 모듈(ws, obs-studio-node 등)을 찾을 수 있게
process.env.NODE_PATH = [path.join(app.getAppPath(), 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();

const newer = (a, b) => {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0), pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0; }
  return false;
};
const ROOT = path.join(app.getPath('appData'), 'Streamy Kit', 'patch');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, d) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); } catch {} };

global.STREAMY = { baseVersion: BASE_VERSION, patch: null, patchRoot: ROOT, markGood() {} };

let entry = path.join(__dirname, 'main.js');
try {
  const cur = readJson(path.join(ROOT, 'current.json'));
  if (cur && cur.version && newer(cur.version, BASE_VERSION)) {
    const dir = path.join(ROOT, cur.version);
    const meta = readJson(path.join(dir, 'patch.json')) || {};
    const bootFile = path.join(ROOT, 'booting.json');
    const boot = readJson(bootFile) || {};
    const tries = boot.version === cur.version ? (boot.tries || 0) : 0;
    const bad = fs.existsSync(path.join(ROOT, `bad-${cur.version}`));
    const okBase = !meta.minBase || !newer(meta.minBase, BASE_VERSION);
    if (!bad && okBase && tries < 2 && fs.existsSync(path.join(dir, 'src', 'main.js'))) {
      writeJson(bootFile, { version: cur.version, tries: tries + 1 });
      entry = path.join(dir, 'src', 'main.js');
      global.STREAMY.patch = cur.version;
      global.STREAMY.markGood = () => { try { fs.rmSync(bootFile, { force: true }); } catch {} };
      app.getVersion = () => cur.version;
    } else if (tries >= 2 && !bad) {
      writeJson(path.join(ROOT, `bad-${cur.version}`), { at: Date.now() });     // 계속 실패 → 이 버전 건너뜀
    }
  }
} catch {}

try { require(entry); }
catch (e) {
  // 빠른 업데이트 코드가 아예 안 불러와지면 즉시 기본 버전으로
  if (entry !== path.join(__dirname, 'main.js')) {
    writeJson(path.join(ROOT, `bad-${global.STREAMY.patch}`), { at: Date.now(), error: String(e && e.stack || e) });
    app.getVersion = () => BASE_VERSION; global.STREAMY.patch = null;
    require('./main.js');
  } else throw e;
}
