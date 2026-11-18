// 간단한 파일 로그: %APPDATA%\Streamy Kit\logs\streamy-kit.log (2MB 넘으면 .old로 교체)
const fs = require('fs');
const path = require('path');

let file = null;
function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'streamy-kit.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.old');
  } catch { file = null; }
  return file;
}
function write(level, src, args) {
  const line = `[${new Date().toISOString()}] [${level}] [${src}] ` + args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? safeJson(a) : String(a))).join(' ');
  try { if (file) fs.appendFileSync(file, line + '\n'); } catch {}
  if (level === 'ERROR') console.error(line); else console.log(line);
}
function safeJson(o) { try { return JSON.stringify(o); } catch { return String(o); } }
module.exports = {
  init,
  dir: () => (file ? path.dirname(file) : null),
  info: (src, ...a) => write('INFO', src, a),
  warn: (src, ...a) => write('WARN', src, a),
  error: (src, ...a) => write('ERROR', src, a),
};
