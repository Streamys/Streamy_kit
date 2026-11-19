// Streamy Kit — 미리보기 편집 가이드 (마우스가 통과하는 투명 창 위에 그림)
// 받는 데이터 (이 창 기준 px): { items:[{x,y,w,h,name,state:'norm'|'hover'|'sel'}], guides:[{x1,y1,x2,y2}], size, hint, dragging, flash }
'use strict';
const { ipcRenderer } = require('electron');
const cv = document.getElementById('c');
const g = cv.getContext('2d');
let RED = '#E11D2E', RED2 = '#FF4D5E', TINT = 'rgba(225,29,46,.10)'; const FONT = "'Pretendard','Malgun Gothic',system-ui,sans-serif";
let data = { items: [] };

function fit() {
  const z = window.devicePixelRatio || 1;
  const w = Math.round(innerWidth * z), h = Math.round(innerHeight * z);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  g.setTransform(z, 0, 0, z, 0, 0);
}
function pill(text, x, y, { bg = RED, fg = '#fff', size = 12, bold = 800, align = 'left', vAlign = 'top' } = {}) {
  g.font = `${bold} ${size}px ${FONT}`;
  const tw = g.measureText(text).width, ph = size + 9, pw = tw + 14;
  let px = align === 'center' ? x - pw / 2 : align === 'right' ? x - pw : x;
  let py = vAlign === 'bottom' ? y - ph : y;
  px = Math.max(2, Math.min(innerWidth - pw - 2, px)); py = Math.max(2, Math.min(innerHeight - ph - 2, py));
  g.fillStyle = bg; g.beginPath(); g.roundRect(px, py, pw, ph, 6); g.fill();
  g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, px + 7, py + ph / 2 + 0.5);
  return { x: px, y: py, w: pw, h: ph };
}
function handle(x, y, big) {
  const s = big ? 14 : 11;
  g.fillStyle = '#fff'; g.strokeStyle = RED; g.lineWidth = 2.5;
  g.beginPath(); g.roundRect(x - s / 2, y - s / 2, s, s, 3); g.fill(); g.stroke();
}
function edgeHandle(x, y, horizontal) {
  const w = horizontal ? 22 : 8, h = horizontal ? 8 : 22;
  g.fillStyle = '#fff'; g.strokeStyle = RED; g.lineWidth = 2.5;
  g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, 4); g.fill(); g.stroke();
}
function draw() {
  fit();
  g.clearRect(0, 0, innerWidth, innerHeight);
  const items = data.items || [];
  // 1) 모든 소스: 옅은 점선 (어디에 뭐가 있는지)
  for (const it of items) {
    if (it.state !== 'norm') continue;
    g.setLineDash([4, 4]); g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.28)';
    g.strokeRect(it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1);
  }
  g.setLineDash([]);
  // 2) 스냅 안내선
  for (const l of data.guides || []) {
    g.strokeStyle = '#F5B700'; g.lineWidth = 1.5; g.setLineDash([6, 4]);
    g.beginPath(); g.moveTo(l.x1, l.y1); g.lineTo(l.x2, l.y2); g.stroke();
  }
  g.setLineDash([]);
  // 3) 마우스를 올린 소스
  for (const it of items) {
    if (it.state !== 'hover') continue;
    g.fillStyle = TINT; g.fillRect(it.x, it.y, it.w, it.h);
    g.setLineDash([7, 5]); g.lineWidth = 2; g.strokeStyle = RED2; g.strokeRect(it.x + 1, it.y + 1, it.w - 2, it.h - 2); g.setLineDash([]);
    pill(`${it.name} · 클릭해서 선택`, it.x + 6, it.y + 6, { bg: 'rgba(11,11,13,.85)', size: 12 });
  }
  // 4) 선택한 소스: 굵은 테두리 + 모서리 손잡이 + 크기 + 사용법
  for (const it of items) {
    if (it.state !== 'sel') continue;
    g.lineWidth = 2.5; g.strokeStyle = RED; g.strokeRect(it.x + 1, it.y + 1, it.w - 2, it.h - 2);
    // 변 가운데: 자르기 손잡이 (가로 막대 / 세로 막대)
    for (const [hx, hy, hor] of [[it.x + it.w / 2, it.y, true], [it.x + it.w / 2, it.y + it.h, true], [it.x, it.y + it.h / 2, false], [it.x + it.w, it.y + it.h / 2, false]]) edgeHandle(hx, hy, hor);
    for (const [hx, hy] of [[it.x, it.y], [it.x + it.w, it.y], [it.x, it.y + it.h], [it.x + it.w, it.y + it.h]]) handle(hx, hy, true);
    // 이름 + 크기 (위에 공간이 없으면 안쪽 위에)
    const above = it.y > 30, ty = above ? it.y - 5 : it.y + 6;
    const tag = pill(it.name, it.x + (above ? 0 : 6), ty, { vAlign: above ? 'bottom' : 'top' });
    if (data.size) pill(data.size, tag.x + tag.w + 4, tag.y, { bg: 'rgba(11,11,13,.9)', size: 12 });
  }
  // 5) 사용법 안내 (아래 가운데)
  if (data.hint) pill(data.hint, innerWidth / 2, innerHeight - 10, { bg: 'rgba(11,11,13,.82)', fg: '#E4E4E7', bold: 700, size: 12, align: 'center', vAlign: 'bottom' });
}
let raf = 0;
const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
ipcRenderer.on('ov:draw', (_e, d) => {
  data = d || { items: [] };
  if (data.color) { RED = data.color[0]; RED2 = data.color[1]; TINT = data.color[2]; }   // 테마 포인트 색
  later();
});
window.addEventListener('resize', later);

// 화면 확인용 (개발 전용)
if (process.env.STREAMY_DEMO_GUIDE) {
  data = {
    items: [
      { x: 0, y: 0, w: innerWidth, h: innerHeight, name: '🖥️ 모니터 1', state: 'norm' },
      { x: innerWidth * 0.72, y: innerHeight * 0.05, w: innerWidth * 0.25, h: innerHeight * 0.14, name: '⏱️ 타이머', state: 'hover' },
      { x: innerWidth * 0.05, y: innerHeight * 0.58, w: innerWidth * 0.3, h: innerHeight * 0.36, name: '📷 웹캠', state: 'sel' },
    ],
    guides: [{ x1: innerWidth * 0.05, y1: 0, x2: innerWidth * 0.05, y2: innerHeight }],
    size: '576 × 324 · 30%', hint: '안쪽 = 이동 · 모서리 □ = 크기 · 변 가운데 ▬ = 자르기 · 방향키 1px (Shift 10px)',
  };
  setTimeout(draw, 50);
}
