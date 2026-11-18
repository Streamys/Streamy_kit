// 아주 작은 ZIP 풀기 (저장/deflate만, PowerShell보다 훨씬 빠름). 업데이트 파일 전용
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

function list(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tail = Math.min(size, 65557);
    const buf = Buffer.alloc(tail);
    fs.readSync(fd, buf, 0, tail, size - tail);
    let eocd = -1;
    for (let i = tail - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('ZIP 파일이 아니에요');
    const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 목록이 깨졌어요');
      const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), elen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), off = cd.readUInt32LE(p + 42);
      const flags = cd.readUInt16LE(p + 8);
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
      out.push({ name, method, csize, usize, off });
      p += 46 + nlen + elen + clen;
    }
    return { entries: out, fd: null };
  } finally { fs.closeSync(fd); }
}
function dataStart(file, off) {
  const fd = fs.openSync(file, 'r');
  try {
    const h = Buffer.alloc(30); fs.readSync(fd, h, 0, 30, off);
    if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP 항목이 깨졌어요');
    return off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  } finally { fs.closeSync(fd); }
}
// 한 항목을 파일로
async function extractEntry(file, e, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (e.csize === 0) { fs.writeFileSync(dest, ''); return; }
  const start = dataStart(file, e.off);
  const src = fs.createReadStream(file, { start, end: start + e.csize - 1, highWaterMark: 1 << 20 });
  if (e.method === 0) await pipeline(src, fs.createWriteStream(dest));
  else if (e.method === 8) await pipeline(src, zlib.createInflateRaw(), fs.createWriteStream(dest));
  else throw new Error('지원하지 않는 압축 방식이에요 (' + e.method + ')');
  if (fs.statSync(dest).size !== e.usize) throw new Error('압축 푼 크기가 맞지 않아요: ' + e.name);
}
// 전체를 폴더로 (폴더 밖으로 나가는 경로는 막음)
async function extractAll(file, dir) {
  const { entries } = list(file);
  const root = path.resolve(dir);
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const dest = path.resolve(root, e.name);
    if (!dest.startsWith(root + path.sep)) throw new Error('잘못된 경로: ' + e.name);
    await extractEntry(file, e, dest);
  }
  return entries.filter((e) => !e.name.endsWith('/')).map((e) => e.name);
}
// 한 파일만 텍스트로 읽기 (patch.json 확인용)
function readText(file, name) {
  const e = list(file).entries.find((x) => x.name === name); if (!e) return null;
  const start = dataStart(file, e.off);
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(e.csize); fs.readSync(fd, b, 0, e.csize, start); return (e.method === 8 ? zlib.inflateRawSync(b) : b).toString('utf8'); }
  finally { fs.closeSync(fd); }
}
module.exports = { list, extractEntry, extractAll, readText };
