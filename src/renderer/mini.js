// Streamy Kit — 최소화 오버레이 (방송 상태 + 선택한 플랫폼의 최근 채팅)
'use strict';
const { ipcRenderer } = require('electron');
const { UI_ICON } = require('./icons.js');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PN = { chzzk: '치지직', youtube: '유튜브', soop: 'SOOP' };

let cfg = { platforms: ['chzzk', 'youtube', 'soop'], opacity: 30, count: 5 };
let msgs = [];

const AV = ['#F7C6D3', '#C9E8F7', '#D6CCF7', '#C8EED9', '#FBE2B8', '#F9CFC2', '#CDE0FA', '#E2D4F0'];
const avColor = (n) => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV[h % AV.length]; };
const hexRgb = (h) => { const n = parseInt(String(h || '#E5577E').replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
$('restore').innerHTML = UI_ICON('expand'); $('close').innerHTML = UI_ICON('x');
function applyCfg() {
  // 투명도 30% = 배경이 70%만 보임 (글자는 항상 선명하게) · 앱과 같은 밝게/어둡게 · 포인트 색 · 글꼴
  $('box').style.setProperty('--a', String(Math.max(0.15, 1 - (Number(cfg.opacity) || 0) / 100)));
  document.body.classList.toggle('dark', !!cfg.dark);
  const a = cfg.accent || '#E5577E', [r, g, b] = hexRgb(a);
  document.documentElement.style.setProperty('--red', a);
  document.documentElement.style.setProperty('--soft', `rgba(${r},${g},${b},${cfg.dark ? 0.18 : 0.12})`);
  document.documentElement.style.setProperty('--font', cfg.font ? `'${cfg.font}','Pretendard','Malgun Gothic',system-ui,sans-serif` : '');
  renderChats();
}
function renderChats() {
  const list = msgs.filter((m) => cfg.platforms.includes(m.p) && m.kind !== 'system').slice(-(cfg.count || 5));
  const box = $('chats');
  if (!cfg.platforms.length) { box.innerHTML = '<div class="empty">플랫폼을 골라 주세요</div>'; return; }
  if (!list.length) { box.innerHTML = '<div class="empty">채팅을 기다리는 중</div>'; return; }
  box.innerHTML = list.map((m) => {
    const body = (m.parts || []).map((x) => (x.t === 'img' ? `<img src="${esc(x.src)}" alt="${esc(x.alt)}" referrerpolicy="no-referrer">` : esc(x.v))).join('');
    return `<div class="cm ${m.kind || ''}"><span class="av" style="background:${avColor(m.nick)}">${esc(String(m.nick || '?').slice(0, 1).toUpperCase())}</span><div class="tx">${m.amount ? `<span class="amt">${esc(m.amount)}</span>` : ''}<span class="nk">${esc(m.nick)}</span><span class="msg">${body}</span></div></div>`;
  }).join('');
}
function renderState(s) {
  const pill = $('pill');
  pill.className = 'pill' + (s.state === 'live' ? ' live' : s.state === 'wait' ? ' wait' : '');
  $('label').textContent = s.label || '오프라인';
  $('time').textContent = s.time || '';
  const parts = [];
  if (s.scene) parts.push(`<b>${esc(s.scene)}</b>`);
  if (s.viewers != null) parts.push(`${UI_ICON('eye')}<b>${Number(s.viewers).toLocaleString('ko-KR')}</b>`);
  if (s.state === 'live' && s.kbps != null) parts.push(`<b>${s.kbps.toLocaleString('ko-KR')}</b>kbps`);
  if (s.state === 'live' && s.drop) parts.push(`드롭 <b>${s.drop.toFixed(1)}%</b>`);
  if (s.rec) parts.push('<b class="rec">녹화 중</b>');
  $('stats').innerHTML = parts.map((x) => `<span>${x}</span>`).join('');
}

ipcRenderer.on('mini:config', (_e, c) => { cfg = { ...cfg, ...c }; applyCfg(); });
ipcRenderer.on('mini:state', (_e, s) => renderState(s));
ipcRenderer.on('chat:messages', (_e, list) => { msgs.push(...list.filter((m) => !m.recent)); if (msgs.length > 80) msgs = msgs.slice(-80); renderChats(); });
$('restore').addEventListener('click', () => ipcRenderer.send('mini:restore'));
$('close').addEventListener('click', () => ipcRenderer.send('mini:hide'));
$('box').addEventListener('dblclick', () => ipcRenderer.send('mini:restore'));
applyCfg();

// 화면 확인용 (개발 전용)
if (process.env.STREAMY_DEMO) {
  renderState({ state: 'live', label: 'LIVE · 치지직 + 유튜브', time: '1:24:07', scene: '게임 방송', viewers: 1284, kbps: 7980, drop: 0 });
  msgs = [
    { p: 'chzzk', nick: '치즈냥', parts: [{ t: 'text', v: '오늘 방송 화질 미쳤다 ㄷㄷ' }] },
    { p: 'youtube', nick: 'MinJun Kim', parts: [{ t: 'text', v: '유튜브에서 보고 있어요!' }] },
    { p: 'chzzk', kind: 'donation', nick: '후원왕', amount: '10,000치즈', parts: [{ t: 'text', v: '방송 잘 보고 있어요 화이팅!!' }] },
    { p: 'soop', nick: '숲속주민', parts: [{ t: 'text', v: 'SOOP에서도 같이 봐요 ㅎㅎ' }] },
    { p: 'youtube', kind: 'donation', nick: 'Jiwoo', amount: '₩5,000', parts: [{ t: 'text', v: '슈퍼챗 첫 후원!' }] },
    { p: 'chzzk', nick: 'ㅇㅇ', parts: [{ t: 'text', v: 'ㅋㅋㅋㅋㅋㅋㅋ 이거 진짜 웃기다 ㅋㅋ' }] },
  ];
  renderChats();
}
