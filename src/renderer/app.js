// Streamy Kit — 화면 로직 (v0.5)
'use strict';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { Engine, SOURCE_TYPES, PLATFORMS, ENCODERS } = require('./engine.js');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const info = ipcRenderer.sendSync('app:info');
const rlog = (level, ...a) => { try { ipcRenderer.send('log', level, ...a.map((x) => (x instanceof Error ? x.stack || x.message : x))); } catch {} };
window.addEventListener('error', (e) => rlog('error', 'window.onerror', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => rlog('error', 'unhandledrejection', e.reason));
const engine = new Engine();
let engineOk = false;
const DEMO = !!process.env.STREAMY_DEMO;

// ================================================================== 설정 저장
const DEFAULTS = {
  keys: { chzzk: '', youtube: '', soop: '' }, encoder: 'auto',
  appAudio: [], audioState: {}, devices: {}, showViewers: false, channels: { chzzk: '' },
  timer: { mode: 'stopwatch', minutes: 10, label: '', theme: 'red' }, quality: '1080p60',
};
const scenesFile = path.join(path.dirname(info.settingsFile), 'scenes.json');
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(info.settingsFile, 'utf8'));
    return { ...DEFAULTS, ...s, keys: { ...DEFAULTS.keys, ...(s.keys || {}) }, timer: { ...DEFAULTS.timer, ...(s.timer || {}) }, channels: { ...DEFAULTS.channels, ...(s.channels || {}) } };
  } catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
let cfg = loadSettings();
// 예전 형식(window 문자열) → 실행 파일 이름
cfg.appAudio = (cfg.appAudio || []).map((a) => ({ exe: a.exe || String(a.window || '').split(':').pop(), label: a.label })).filter((a) => a.exe);
delete cfg.audioApps; delete cfg.platform;
const writeJson = (f, d) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(d, null, 2)); fs.renameSync(f + '.tmp', f); } catch (e) { rlog('error', 'writeJson', e); } };
let saveT = null, sceneT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => writeJson(info.settingsFile, cfg), 300); }
function saveScenes() { if (!engineOk) return; clearTimeout(sceneT); sceneT = setTimeout(() => { try { writeJson(scenesFile, engine.serialize()); } catch (e) { rlog('error', 'saveScenes', e); } }, 600); }
function saveAudioState() {
  if (!engineOk) return;
  cfg.audioState = {}; for (const a of engine.audioList()) cfg.audioState[a.name] = { vol: a.vol, muted: a.muted };
  cfg.appAudio = engine.appAudioList().map((a) => ({ exe: a.exe, label: a.label }));
  save();
}

// ================================================================== 알림 / 오류 처리
let toastT = null;
function toast(msg, err = false) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, err ? 7000 : 3500);
}
function guard(fn) {
  return (...a) => {
    if (!engineOk && !DEMO) return toast('방송 엔진이 아직 준비되지 않았어요.', true);
    try { const r = fn(...a); if (r && r.catch) r.catch((e) => { rlog('error', e); toast(e.message || String(e), true); }); }
    catch (e) { rlog('error', e); toast(e.message || String(e), true); }
  };
}
function openTab(name) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name));
  if (name === 'sound') soundTabOpened(); else soundTabClosed();
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));

// ================================================================== 창 버튼
$('winMin').addEventListener('click', () => ipcRenderer.send('win:minimize'));
$('winMax').addEventListener('click', () => ipcRenderer.send('win:toggle-max'));
$('winClose').addEventListener('click', () => ipcRenderer.send('win:close'));
document.querySelector('.titlebar').addEventListener('dblclick', (e) => { if (e.target.closest('button,.viewers,.stats')) return; ipcRenderer.send('win:toggle-max'); });
ipcRenderer.on('win:maximized', (_e, max) => {
  $('winMaxIcon').innerHTML = max ? '<rect x="2" y="4" width="6" height="6" rx="1"/><path d="M4 4V2.8A.8.8 0 0 1 4.8 2H9.2a.8.8 0 0 1 .8.8v4.4a.8.8 0 0 1-.8.8H8"/>' : '<rect x="2.5" y="2.5" width="7" height="7" rx="1"/>';
  $('winMax').title = max ? '이전 크기로' : '최대화';
});

// ================================================================== 장면 (정사각형 버튼)
let renamingScene = null;
function renderScenes() {
  const box = $('sceneTiles'); box.innerHTML = '';
  if (!engineOk && !DEMO) { box.innerHTML = '<div class="hint">엔진 준비 중…</div>'; return; }
  const list = DEMO ? demo.scenes : engine.scenes;
  const cur = DEMO ? demo.current : engine.currentId;
  list.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'tile' + (s.id === cur ? ' on' : '');
    if (renamingScene === s.id) {
      b.innerHTML = '<input>';
      const inp = b.querySelector('input'); inp.value = s.name;
      let finished = false;
      const done = (ok) => { if (finished) return; finished = true; renamingScene = null; if (ok && inp.value.trim()) guard(() => { engine.renameScene(s.id, inp.value.trim()); saveScenes(); })(); renderScenes(); renderSources(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
      inp.addEventListener('blur', () => done(true));
      inp.addEventListener('click', (e) => e.stopPropagation());
      setTimeout(() => { inp.focus(); inp.select(); });
    } else {
      let cnt = s.n || 0; if (!DEMO) { try { cnt = s.scene.getItems().length; } catch {} }
      b.innerHTML = `${i < 9 ? `<kbd>F${i + 1}</kbd>` : ''}<span class="cnt">${cnt}개</span><b>${esc(s.name)}</b>`;
      b.title = s.name;
      b.addEventListener('click', guard(() => { if (DEMO) { demo.current = s.id; renderScenes(); return; } engine.switchScene(s.id); saveScenes(); }));
      b.addEventListener('dblclick', () => { if (DEMO) return; renamingScene = s.id; renderScenes(); });
      b.addEventListener('contextmenu', guard(async (e) => {
        e.preventDefault(); if (DEMO) return;
        const r = await ipcRenderer.invoke('app:confirm', { title: '장면', message: `'${s.name}' 장면을 어떻게 할까요?`, buttons: ['삭제', '왼쪽으로', '오른쪽으로', '취소'] });
        if (r === 0) engine.removeScene(s.id); if (r === 1) engine.moveScene(s.id, -1); if (r === 2) engine.moveScene(s.id, 1);
        saveScenes();
      }));
    }
    box.appendChild(b);
  });
  const add = document.createElement('button'); add.className = 'tile add'; add.textContent = '+'; add.title = '장면 추가';
  add.addEventListener('click', guard(() => { if (DEMO) return; const sc = engine.addScene(); engine.switchScene(sc.id, true); renamingScene = sc.id; renderScenes(); saveScenes(); }));
  box.appendChild(add);
}
engine.on('scenes', renderScenes);

// ================================================================== 소스 목록 (다중 선택 / 이름·이모지 편집)
let editingItem = null;
function renderSources() {
  const ul = $('sourceList'); ul.innerHTML = '';
  $('srcSceneName').textContent = DEMO ? '게임 방송' : engineOk && engine.currentScene ? engine.currentScene.name : '장면';
  const items = DEMO ? demo.items : engineOk ? engine.items() : [];
  if (!items.length) ul.innerHTML = '<li class="empty">아직 소스가 없어요. <b>＋ 추가</b>를 눌러 모니터 화면이나 게임을 넣어 보세요.</li>';
  for (const it of items) {
    const li = document.createElement('li');
    if (editingItem === it.id) {
      li.className = 'editing';
      li.innerHTML = '<input class="emo" maxlength="4" title="이모지"><input class="nmi">';
      const emo = li.querySelector('.emo'), nmi = li.querySelector('.nmi');
      emo.value = it.icon; nmi.value = it.name;
      let finished = false;
      const done = (ok) => {
        if (finished) return; finished = true; editingItem = null;
        if (ok) guard(() => { engine.renameSource(it.name, nmi.value.trim() || it.name, emo.value.trim()); saveScenes(); })();
        renderSources();
      };
      for (const inp of [emo, nmi]) {
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
        inp.addEventListener('click', (e) => e.stopPropagation());
      }
      li.addEventListener('focusout', () => setTimeout(() => { if (!li.contains(document.activeElement)) done(true); }, 0));
      setTimeout(() => { nmi.focus(); nmi.select(); });
    } else {
      li.className = (it.selected ? 'on' : '') + (it.visible ? '' : ' hidden');
      li.innerHTML = `<span class="ic">${esc(it.icon)}</span><span class="nm">${esc(it.name)}</span><button class="eye" title="보이기/숨기기">${it.visible ? '👁' : '◌'}</button>`;
      li.addEventListener('click', guard((e) => {
        if (DEMO) return;
        engine.select(it.id, e.shiftKey ? 'range' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'single');
      }));
      li.addEventListener('dblclick', guard(() => { if (DEMO) return; editingItem = it.id; renderSources(); }));
      li.querySelector('.eye').addEventListener('click', guard((e) => { e.stopPropagation(); if (DEMO) return; engine.setVisible(it.id, !it.visible); saveScenes(); }));
    }
    ul.appendChild(li);
  }
  renderEditBar();
}
function selIds() { return engineOk ? [...engine.sel] : []; }
function renderEditBar() {
  const bar = $('editBar'), name = $('selName'), size = $('selSize');
  const hint = '끌어서 이동 · 모서리를 끌어 크기 조절 · Alt = 자석 끄기';
  if (DEMO) { bar.classList.add('has-sel'); name.innerHTML = '선택: <b>웹캠</b> · ' + hint; size.textContent = '576 × 324 · 30%'; return; }
  const ids = selIds();
  bar.classList.toggle('has-sel', ids.length === 1);
  if (!ids.length) { name.innerHTML = '미리보기에서 소스를 클릭하면 선택돼요 · ' + hint; size.textContent = ''; return; }
  if (ids.length > 1) { name.innerHTML = `<b>${ids.length}개</b> 선택됨 · 🗑 또는 Delete로 한 번에 삭제`; size.textContent = ''; return; }
  const it = engine.items().find((x) => x.id === ids[0]);
  name.innerHTML = it ? `선택: <b>${esc(it.icon)} ${esc(it.name)}</b> · ${hint}` : hint;
  updateSizeLabel();
}
function updateSizeLabel() {
  const id = engine.primary; const el = $('selSize');
  if (id == null || engine.sel.size !== 1) { el.textContent = ''; return; }
  try {
    const it = engine.itemObj(id); if (!it) return;
    const r = engine.itemRect(it);
    el.textContent = r.w > 0 ? `${Math.round(r.w)} × ${Math.round(r.h)} · ${Math.round((r.w / engine.width) * 100)}%` : '';
  } catch {}
}
let propsFor = null;
engine.on('items', () => {
  renderSources();
  if (engineOk) { const ids = selIds(); if (ids.length !== 1) { $('propsBody').innerHTML = ''; propsFor = null; } else if (propsFor !== ids[0]) showProps(); }
  clearTimeout(countT); countT = setTimeout(renderScenes, 150);
});
let countT = 0;
$('srcUp').addEventListener('click', guard(() => { for (const id of selIds()) engine.moveItem(id, 1); saveScenes(); }));
$('srcDown').addEventListener('click', guard(() => { for (const id of selIds().reverse()) engine.moveItem(id, -1); saveScenes(); }));
$('srcDel').addEventListener('click', guard(() => removeSelected()));
document.querySelectorAll('[data-fit]').forEach((b) => b.addEventListener('click', guard(() => { const id = engine.primary; if (id != null) { engine.fitItem(id, b.dataset.fit); updateSizeLabel(); saveScenes(); } })));
async function removeSelected() {
  const ids = selIds(); if (!ids.length) return toast('삭제할 소스를 먼저 골라 주세요.');
  const names = engine.items().filter((x) => ids.includes(x.id)).map((x) => x.name);
  const msg = names.length === 1 ? `'${names[0]}'을(를) 이 장면에서 뺄까요?` : `선택한 ${names.length}개 소스를 이 장면에서 뺄까요?\n${names.join(', ')}`;
  const r = await ipcRenderer.invoke('app:confirm', { title: '소스 삭제', message: msg, buttons: ['삭제', '취소'] });
  if (r === 0) { engine.removeItems(ids); saveScenes(); }
}

// ================================================================== 소스 추가 (소스 탭 안에서)
let addKind = null;
$('srcAdd').addEventListener('click', () => {
  const box = $('addBox'); box.hidden = !box.hidden;
  $('srcAdd').classList.toggle('open', !box.hidden);
  $('srcAdd').textContent = box.hidden ? '＋ 추가' : '✕ 닫기';
  if (!box.hidden) { addKind = null; renderTypes(); renderAddForm(); }
});
function closeAdd() { $('addBox').hidden = true; $('srcAdd').classList.remove('open'); $('srcAdd').textContent = '＋ 추가'; }
function renderTypes() {
  const g = $('typeGrid'); g.innerHTML = '';
  for (const [k, t] of Object.entries(SOURCE_TYPES)) {
    const b = document.createElement('button');
    b.className = 'type' + (addKind === k ? ' on' : '');
    b.innerHTML = `<span>${t.icon}</span>${esc(t.label)}`;
    if (engineOk && !engine.available(k)) { b.disabled = true; b.title = '이 PC에서는 쓸 수 없어요'; }
    b.addEventListener('click', () => { addKind = k; renderTypes(); renderAddForm(); });
    g.appendChild(b);
  }
}
function optionList(items, empty) {
  if (!items.length) return empty ? `<option value="">${esc(empty)}</option>` : '';
  return items.map((x) => `<option value="${esc(x.value)}">${esc(x.name)}</option>`).join('');
}
const PICK_LABEL = { monitor: '모니터', window: '프로그램 창', game: '게임 창', webcam: '웹캠' };
function pickOptions(kind) {
  const first = kind === 'game' ? '<option value="">전체 화면 게임 자동 감지</option>' : '';
  let items = []; try { items = engineOk ? engine.choices(kind) : []; } catch (e) { rlog('error', 'choices', e); }
  return first + optionList(items, kind === 'game' ? '' : '찾지 못했어요');
}
function sourceForm(kind, prefix, cur = {}) {
  const t = SOURCE_TYPES[kind];
  let h = '';
  if (t.prop) {
    h += `<label class="field">${PICK_LABEL[kind]}<div class="row" style="margin:6px 0 0"><select id="${prefix}Pick">${pickOptions(kind)}</select><button class="ghost" id="${prefix}Refresh" title="다시 찾기">↻</button></div></label>`;
    if (kind === 'webcam') h += '<p class="hint">웹캠은 처음에 왼쪽 아래에 들어가요. 미리보기에서 <b>끌어서 옮기고 모서리로 크기</b>를 맞추세요.</p>';
    if (kind === 'game') h += '<p class="hint">특정 게임만 잡으려면 게임을 켠 상태에서 ↻를 누르고 고르세요.</p>';
  }
  if (t.file) h += `<label class="field">이미지 파일<div class="key-row"><input id="${prefix}File" readonly placeholder="파일을 골라 주세요" value="${esc(cur.file || '')}"><button class="ghost" id="${prefix}Browse">찾기</button></div></label>`;
  if (t.text) {
    h += `<label class="field">내용<textarea id="${prefix}Text" rows="2">${esc(cur.text || '텍스트')}</textarea></label>
      <div class="grid2"><label class="field">크기<input id="${prefix}Size" type="number" min="12" max="400" value="${esc((cur.font && cur.font.size) || 96)}"></label>
      <label class="field">색<input id="${prefix}Color" type="color" value="#ffffff"></label></div>
      <label class="check"><input type="checkbox" id="${prefix}Outline" ${cur.outline ? 'checked' : ''}> 검은 테두리</label>`;
  }
  if (t.url) h += `<label class="field">주소 (투네이션·위플랩 알림창 URL 등)<input id="${prefix}Url" placeholder="https://" value="${esc(cur.url || '')}"></label>
      <div class="grid2"><label class="field">가로<input id="${prefix}W" type="number" value="${esc(cur.width || 800)}"></label><label class="field">세로<input id="${prefix}H" type="number" value="${esc(cur.height || 600)}"></label></div>`;
  if (kind === 'color') h += `<label class="field">색<input id="${prefix}Color" type="color" value="#0e0e10"></label>`;
  if (kind === 'virtual') h += '<p class="hint">VTube Studio·VSeeFace 설정에서 <b>Spout2 출력</b>을 켜 주세요. 다른 프로그램은 <b>게임</b>에서 창을 골라 잡으세요.</p>';
  if (kind === 'timer') h += '<p class="hint">오른쪽 위에 들어가요. 조작은 <b>타이머</b> 탭에서 해요.</p>';
  return h;
}
function readForm(prefix) {
  const v = (id) => { const el = $(prefix + id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
  const pick = $(prefix + 'Pick');
  return { value: v('Pick'), label: pick && pick.selectedOptions[0] ? pick.selectedOptions[0].textContent : '', file: v('File'), text: v('Text'), size: v('Size'), color: v('Color'), outline: v('Outline'), url: v('Url'), width: v('W'), height: v('H'), timerUrl: info.timerUrl };
}
function bindForm(kind, prefix) {
  const r = $(prefix + 'Refresh');
  if (r) r.addEventListener('click', guard(() => { $(prefix + 'Pick').innerHTML = pickOptions(kind); }));
  const b = $(prefix + 'Browse');
  if (b) b.addEventListener('click', async () => { const f = await ipcRenderer.invoke('app:pick-image'); if (f) $(prefix + 'File').value = f; });
}
function renderAddForm() {
  const box = $('addForm');
  if (!addKind) { box.innerHTML = ''; return; }
  const t = SOURCE_TYPES[addKind];
  box.innerHTML = sourceForm(addKind, 'a') + '<button class="primary-sm" id="aAdd">현재 장면에 추가</button>';
  bindForm(addKind, 'a');
  $('aAdd').addEventListener('click', guard(() => {
    const opt = readForm('a');
    if (t.prop && addKind !== 'game' && !opt.value) return toast('목록에서 골라 주세요.', true);
    if (t.file && !opt.file) return toast('이미지 파일을 골라 주세요.', true);
    if (t.url && !/^https?:\/\//.test(opt.url || '')) return toast('http(s)로 시작하는 주소를 넣어 주세요.', true);
    if (['webcam', 'monitor', 'window'].includes(addKind) && opt.label) opt.name = opt.label.replace(/^\[[^\]]*\]:?\s*/, '').slice(0, 40);
    const r = engine.addSource(addKind, opt);
    saveScenes(); closeAdd();
    toast(`'${r.name}'을(를) 넣었어요. 미리보기에서 끌어서 위치를 맞추세요.`);
  }));
}
function showProps() {
  const ids = selIds(), body = $('propsBody');
  propsFor = ids.length === 1 ? ids[0] : null;
  if (propsFor == null) { body.innerHTML = ''; return; }
  const it = engine.items().find((x) => x.id === propsFor); if (!it) { body.innerHTML = ''; return; }
  const s = engine.sourceSettings(it.name);
  const t = s ? SOURCE_TYPES[s.kind] || {} : {};
  if (!s || !(t.prop || t.file || t.text || t.url || s.kind === 'color')) { body.innerHTML = ''; return; }
  body.innerHTML = `<h4>${esc(it.icon)} ${esc(it.name)} 설정</h4>` + sourceForm(s.kind, 'p', s.settings) + '<button class="primary-sm" id="pSave">적용</button>';
  bindForm(s.kind, 'p');
  if (t.prop) { const cur = s.settings[t.prop]; if (cur != null) $('pPick').value = cur; }
  $('pSave').addEventListener('click', guard(() => {
    const opt = readForm('p');
    if (t.prop && !opt.value && s.kind !== 'game') return toast('목록에서 골라 주세요.', true);
    engine.updateSource(it.name, s.kind, opt); saveScenes(); toast('적용했어요.');
  }));
}

// ================================================================== 미리보기에서 끌기 / 크기 조절
const prev = $('preview');
let drag = null, raf = 0, pending = null;
function toCanvas(e) {
  const r = prev.getBoundingClientRect(), z = window.devicePixelRatio || 1;
  const pr = engine.previewRect(r.width * z, r.height * z);
  const k = engine.width / pr.w;
  return { x: ((e.clientX - r.left) * z - pr.x) * k, y: ((e.clientY - r.top) * z - pr.y) * k, px: k * z };
}
function cornerAt(rect, p) {
  const tol = 12 * p.px;
  const cs = { tl: [rect.x, rect.y], tr: [rect.x + rect.w, rect.y], bl: [rect.x, rect.y + rect.h], br: [rect.x + rect.w, rect.y + rect.h] };
  for (const [k, [x, y]] of Object.entries(cs)) if (Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol) return k;
  return null;
}
function snap(v, size, total, tol) { for (const t of [0, total / 2 - size / 2, total - size]) if (Math.abs(v - t) < tol) return t; return v; }
prev.addEventListener('mousedown', (e) => {
  if (!engineOk || e.button !== 0) return;
  try {
    const p = toCanvas(e), selId = engine.sel.size === 1 ? engine.primary : null;
    if (selId != null) {
      const it = engine.itemObj(selId);
      if (it) {
        const c = cornerAt(engine.itemRect(it), p);
        if (c) { const r = engine.normalize(selId); if (!r || r.w <= 0) return; drag = { mode: 'resize', id: selId, corner: c, start: r, p0: p }; e.preventDefault(); return; }
      }
    }
    const hit = engine.hitTest(p.x, p.y);
    if (!hit) { engine.clearSelection(); renderSources(); return; }
    if (e.ctrlKey) { engine.select(hit.id, 'toggle'); return; }
    if (!engine.sel.has(hit.id) || engine.sel.size > 1) engine.select(hit.id, 'single');
    drag = { mode: 'move', id: hit.id, start: engine.normalize(hit.id), p0: p };
    e.preventDefault();
  } catch (err) { rlog('error', 'mousedown', err); }
});
let hoverT = 0;
window.addEventListener('mousemove', (e) => {
  if (!engineOk) return;
  if (!drag) {
    const now = Date.now(); if (now - hoverT < 60) return; hoverT = now;
    let cls = '';
    const selId = engine.sel.size === 1 ? engine.primary : null;
    if (selId != null && e.target === prev) {
      try {
        const it = engine.itemObj(selId), p = toCanvas(e);
        if (it) { const rect = engine.itemRect(it), c = cornerAt(rect, p); if (c) cls = c === 'tl' || c === 'br' ? 'c-nwse' : 'c-nesw'; else if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) cls = 'c-move'; }
      } catch {}
    }
    prev.className = 'preview has-engine ' + cls;
    return;
  }
  const p = toCanvas(e);
  const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y, s = drag.start, tol = 12 * p.px;
  if (!s) return;
  if (drag.mode === 'move') {
    let x = s.x + dx, y = s.y + dy;
    if (!e.altKey) { x = snap(x, s.w, engine.width, tol); y = snap(y, s.h, engine.height, tol); }
    pending = { id: drag.id, x, y, w: null };
  } else {
    const left = drag.corner.includes('l'), top = drag.corner.includes('t');
    const ax = left ? s.x + s.w : s.x, ay = top ? s.y + s.h : s.y;
    const sx = left ? -1 : 1, sy = top ? -1 : 1, ratio = s.w / s.h;
    let w = Math.max(16, s.w + sx * dx), h = Math.max(16, s.h + sy * dy);
    if (w / h > ratio) h = w / ratio; else w = h * ratio;
    if (!e.altKey) { const ex = ax + sx * w; for (const t of [0, engine.width]) if (Math.abs(ex - t) < tol) { w = Math.abs(t - ax); h = w / ratio; } }
    pending = { id: drag.id, x: left ? ax - w : ax, y: top ? ay - h : ay, w };
    $('selSize').textContent = `${Math.round(w)} × ${Math.round(h)} · ${Math.round((w / engine.width) * 100)}%`;
  }
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) { try { engine.setItemRect(pending.id, pending.x, pending.y, pending.w); } catch {} pending = null; } });
});
window.addEventListener('mouseup', () => { if (drag) { drag = null; updateSizeLabel(); saveScenes(); } });
window.addEventListener('keydown', (e) => {
  if (!engineOk || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const n = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'].indexOf(e.key);
  if (n >= 0 && engine.scenes[n]) { e.preventDefault(); engine.switchScene(engine.scenes[n].id); saveScenes(); return; }
  if (e.key === 'Delete' && engine.sel.size) { removeSelected(); return; }
  if (e.key === 'Escape') { engine.clearSelection(); renderSources(); return; }
  const id = engine.sel.size === 1 ? engine.primary : null; if (id == null) return;
  const step = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (mv) { e.preventDefault(); const r = engine.normalize(id); engine.setItemRect(id, r.x + mv[0], r.y + mv[1], null); saveScenes(); }
});

// ================================================================== 메인 사운드 (막대 뒤에서 소리 레벨이 움직임)
const meterEls = {};
function renderMixer() {
  const box = $('mixer'); box.innerHTML = '';
  for (const k of Object.keys(meterEls)) delete meterEls[k];
  const list = DEMO ? demo.audio : engineOk ? engine.audioList() : [];
  if (!list.length) { box.innerHTML = '<div class="hint">엔진이 준비되면 오디오가 여기 표시돼요.</div>'; return; }
  for (const a of list) {
    const row = document.createElement('div');
    row.className = 'ch' + (a.muted ? ' muted' : '');
    row.innerHTML = `<button class="mute" title="음소거">${a.muted ? '✕' : '🔊'}</button><div class="nm">${esc(a.label)}<span class="dot"></span></div><span class="pct"></span>
      <div class="bar"><div class="lvl"></div><div class="pk"></div><div class="ticks"></div><input type="range" min="0" max="100"></div>`;
    const r = row.querySelector('input'), pct = row.querySelector('.pct');
    r.value = Math.round(a.vol * 100); pct.textContent = r.value + '%';
    r.addEventListener('input', () => { if (!DEMO) engine.setVolume(a.name, r.value / 100); pct.textContent = r.value + '%'; });
    r.addEventListener('change', saveAudioState);
    row.querySelector('.mute').addEventListener('click', guard(() => { if (DEMO) return; engine.setMuted(a.name, !a.muted); saveAudioState(); }));
    box.appendChild(row);
    meterEls[a.name] = { row, lvl: row.querySelector('.lvl'), pk: row.querySelector('.pk'), shown: 0, peak: 0, peakT: 0 };
  }
}
engine.on('audio', () => { renderMixer(); renderSepApps(); });
function meterLoop() {
  const now = Date.now();
  for (const [name, m] of Object.entries(meterEls)) {
    const L = DEMO ? demo.level(name, now) : engine.levels[name];
    const fresh = L && now - L.t < 500;
    const target = fresh ? L.level : 0;
    m.shown = target > m.shown ? target : Math.max(target, m.shown - 0.02);
    m.lvl.style.width = (m.shown * 100).toFixed(1) + '%';
    const pk = fresh ? L.peak : 0;
    if (pk >= m.peak || now - m.peakT > 1200) { m.peak = pk; m.peakT = now; }
    m.pk.style.left = (m.peak * 100).toFixed(1) + '%'; m.pk.style.opacity = m.peak > 0.02 ? 1 : 0;
    m.row.classList.toggle('active', m.shown > 0.08);
  }
  // 사운드 탭 카드 레벨
  for (const c of document.querySelectorAll('.acard[data-exe]')) {
    const s = liveLevels[c.dataset.exe.toLowerCase()];
    const v = s && now - s.t < 800 ? s.v : 0;
    const prevV = Number(c.dataset.v || 0), shown = v > prevV ? v : Math.max(v, prevV - 0.03);
    c.dataset.v = shown; c.querySelector('.lv').style.width = (shown * 100).toFixed(1) + '%';
    c.classList.toggle('playing', shown > 0.03);
  }
  requestAnimationFrame(meterLoop);
}
requestAnimationFrame(meterLoop);
$('soundGear').addEventListener('click', () => openTab('sound'));

// ================================================================== 사운드 탭: 지금 나오는 소리 → 끌어다 분리
let liveApps = [];          // [{ exe, desc, title, peak }]
const liveLevels = {};      // exe(lower) -> { v, t }
let liveSeen = {};          // exe(lower) -> 마지막으로 보인 시각 (잠깐 조용해도 목록에서 바로 안 사라지게)
let soundOpen = false, liveRenderT = 0;
function soundTabOpened() {
  if (soundOpen) return; soundOpen = true;
  renderDevices(); renderLiveApps(); renderSepApps();
  if (!DEMO) ipcRenderer.send('audio-sessions:start');
}
function soundTabClosed() { if (!soundOpen) return; soundOpen = false; if (!DEMO) ipcRenderer.send('audio-sessions:stop'); }
ipcRenderer.on('audio-sessions', (_e, data) => {
  if (!Array.isArray(data)) { if (data && data.error) rlog('warn', 'audio-sessions', data.error); return; }
  const now = Date.now();
  for (const a of data) {
    const k = a.exe.toLowerCase();
    if (/^(streamy kit|obs64|audiodg)\.exe$/i.test(a.exe)) continue;
    liveLevels[k] = { v: Math.min(1, Math.sqrt(a.peak || 0) * 1.2), t: now };
    liveSeen[k] = { ...a, t: now };
  }
  for (const [k, v] of Object.entries(liveSeen)) if (now - v.t > 15000) delete liveSeen[k];
  if (now - liveRenderT > 1000) { liveRenderT = now; renderLiveApps(); }
});
function appLabel(a) { return (a.desc || a.title || a.exe.replace(/\.exe$/i, '')).slice(0, 28); }
function renderLiveApps() {
  const box = $('liveApps');
  const sep = new Set((engineOk ? engine.appAudioList() : DEMO ? demo.sep : []).map((x) => (x.exe || '').toLowerCase()));
  const list = DEMO ? demo.live : Object.values(liveSeen);
  const items = list.filter((a) => !sep.has(a.exe.toLowerCase())).sort((a, b) => a.exe.localeCompare(b.exe));
  const sig = items.map((a) => a.exe).join('|');
  if (box.dataset.sig === sig && box.children.length) return;   // 목록이 같으면 다시 안 그림 (끌기 중 깜빡임 방지)
  box.dataset.sig = sig; box.innerHTML = '';
  if (!items.length) { box.innerHTML = `<div class="empty">${DEMO || soundOpen ? '소리를 내는 프로그램이 없어요.<br>유튜브나 음악을 틀어 보세요.' : ''}</div>`; return; }
  for (const a of items) box.appendChild(card(a, false));
}
function renderSepApps() {
  const box = $('sepApps'); box.innerHTML = '';
  const list = engineOk ? engine.appAudioList() : DEMO ? demo.sep : [];
  if (!list.length) { box.innerHTML = '<div class="empty">여기로 끌어다 놓으면<br>그 프로그램 소리만 따로 잡혀요</div>'; return; }
  for (const a of list) box.appendChild(card({ exe: a.exe, desc: a.label, name: a.name }, true));
}
function card(a, inSep) {
  const c = document.createElement('div');
  c.className = 'acard' + (inSep ? ' in' : ''); c.draggable = true; c.dataset.exe = a.exe;
  c.innerHTML = `<div class="lv"></div><span class="dot"></span><div class="nm">${esc(inSep ? a.desc : appLabel(a))}<small>${esc(a.exe)}</small></div>${inSep ? '<button class="x" title="빼기">✕</button>' : ''}`;
  c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ exe: a.exe, label: inSep ? a.desc : appLabel(a), from: inSep ? 'sep' : 'live', name: a.name })); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
  c.addEventListener('dragend', () => c.classList.remove('dragging'));
  if (inSep) c.querySelector('.x').addEventListener('click', guard(() => { if (DEMO) return; engine.removeAudio(a.name); saveAudioState(); renderLiveApps(); }));
  else c.addEventListener('dblclick', () => addSep(a.exe, appLabel(a)));
  return c;
}
const addSep = guard((exe, label) => {
  if (DEMO) return;
  engine.addAppAudio(exe, label); saveAudioState();
  $('liveApps').dataset.sig = ''; renderLiveApps();
  toast(`'${label}' 소리를 따로 잡았어요. 메인 화면 사운드에서 볼륨을 조절하세요.`);
});
for (const [zoneId, accept] of [['sepApps', 'live'], ['liveApps', 'sep']]) {
  const z = $(zoneId);
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', (e) => { if (!z.contains(e.relatedTarget)) z.classList.remove('over'); });
  z.addEventListener('drop', (e) => {
    e.preventDefault(); z.classList.remove('over');
    let d = null; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch {}
    if (!d || d.from !== accept) return;
    if (accept === 'live') addSep(d.exe, d.label);
    else guard(() => { if (DEMO) return; engine.removeAudio(d.name); saveAudioState(); $('liveApps').dataset.sig = ''; renderLiveApps(); })();
  });
}
function renderDevices() {
  if (!engineOk) { for (const id of ['devDesktop', 'devMic']) $(id).innerHTML = '<option>엔진 준비 중</option>'; return; }
  for (const [sel, name, kind] of [['devDesktop', '데스크톱 소리', 'desktop'], ['devMic', '마이크', 'mic']]) {
    const el = $(sel); el.innerHTML = optionList(engine.audioDevices(kind), '장치 없음');
    el.value = cfg.devices[kind] || 'default';
    el.onchange = guard(() => { engine.setAudioDevice(name, el.value); cfg.devices[kind] = el.value; save(); toast('장치를 바꿨어요.'); });
  }
}

// ================================================================== 통합 시청자 (👁)
const viewers = { chzzk: null };
function renderViewers() {
  const eye = $('viewerEye'), num = $('viewerTotal'), det = $('viewerDetail');
  eye.classList.toggle('on', cfg.showViewers);
  eye.textContent = cfg.showViewers ? '👁' : '🙈';
  if (!cfg.showViewers) { num.textContent = '•••'; num.classList.add('masked'); det.textContent = ''; return; }
  num.classList.remove('masked');
  if (DEMO) { num.textContent = '1,284'; det.textContent = '치지직 912 · 유튜브 372'; return; }
  if (!cfg.channels.chzzk) { num.textContent = '-'; det.textContent = '설정에서 채널 연결'; return; }
  const parts = []; if (viewers.chzzk != null) parts.push(['치지직', viewers.chzzk]);
  num.textContent = parts.length ? parts.reduce((a, [, n]) => a + n, 0).toLocaleString('ko-KR') : '-';
  det.textContent = parts.length ? parts.map(([k, n]) => `${k} ${n.toLocaleString('ko-KR')}`).join(' · ') : '방송 중이 아니에요';
}
async function pollViewers() {
  if (!cfg.channels.chzzk) { viewers.chzzk = null; renderViewers(); return; }
  try { const r = await ipcRenderer.invoke('viewers:fetch', { chzzk: cfg.channels.chzzk }); viewers.chzzk = r.chzzk ?? null; } catch {}
  renderViewers();
}
$('viewerEye').addEventListener('click', () => { cfg.showViewers = !cfg.showViewers; save(); renderViewers(); if (cfg.showViewers) pollViewers(); });
$('chzzkId').value = cfg.channels.chzzk || '';
$('chzzkId').addEventListener('change', () => {
  const v = $('chzzkId').value.trim().replace(/^.*chzzk\.naver\.com\/(live\/)?/, '').replace(/[/?#].*$/, '');
  $('chzzkId').value = v; cfg.channels.chzzk = v; save();
  if (v && !/^[0-9a-f]{32}$/i.test(v)) toast('치지직 채널 ID는 32자리예요. 채널 주소 chzzk.naver.com/ 뒤의 값을 넣어 주세요.', true); else pollViewers();
});
setInterval(pollViewers, 60000);

// ================================================================== 방송 탭: 키 하나 입력 → 플랫폼 추측
let streamStates = {};
const STATE_TEXT = { off: '오프라인', ready: '대기 중', starting: '연결 중…', live: 'LIVE', reconnecting: '재연결 중…', stopping: '종료 중…', err: '오류' };
function platformState(k) {
  const s = streamStates[k];
  if (s && s.state !== 'off') return s.state;
  if (s && s.error) return 'err';
  return cfg.keys[k] ? 'ready' : 'off';
}
// 붙여 넣은 값에서 키와 플랫폼을 추측. 서버 주소째로 붙여 넣어도 키만 뽑아냄
function guessKey(raw) {
  let v = String(raw || '').trim().replace(/^["']|["']$/g, '');
  let platform = null;
  const url = v.match(/^(rtmps?:\/\/\S+)\/([^/\s]+)$/i);
  if (url) {
    const host = url[1].toLowerCase();
    if (host.includes('navercorp') || host.includes('chzzk')) platform = 'chzzk';
    else if (host.includes('youtube')) platform = 'youtube';
    else if (host.includes('sooplive') || host.includes('afreeca')) platform = 'soop';
    v = url[2];
  }
  if (!platform && /^[a-z0-9]{4}(-[a-z0-9]{4}){4}$/i.test(v)) platform = 'youtube';   // 유튜브: xxxx-xxxx-xxxx-xxxx-xxxx
  return { key: v, platform };
}
function maskKey(k) { return k.length <= 4 ? '••••' : '••••••' + k.slice(-4); }
function showGuess() {
  const raw = $('keyInput').value; const box = $('keyGuess');
  if (!raw.trim()) { box.hidden = true; return; }
  const g = guessKey(raw);
  box.hidden = false;
  $('kgMsg').innerHTML = g.platform
    ? `<b>${esc(PLATFORMS[g.platform].name)}</b> 키로 보여요. 맞으면 눌러서 저장하세요.`
    : '어느 플랫폼 키인가요? 눌러서 저장하세요.';
  const btns = $('kgBtns'); btns.innerHTML = '';
  for (const [k, p] of Object.entries(PLATFORMS)) {
    const b = document.createElement('button');
    b.className = g.platform === k ? 'guess' : '';
    b.innerHTML = esc(p.name) + (cfg.keys[k] ? '<small>기존 키 바꾸기</small>' : '<small>새로 저장</small>');
    b.addEventListener('click', () => saveKey(k, g.key));
    btns.appendChild(b);
  }
}
function saveKey(k, key) {
  if (streamStates[k] && streamStates[k].state !== 'off') return toast('방송 중인 플랫폼의 키는 바꿀 수 없어요.', true);
  if (!key) return;
  cfg.keys[k] = key; save();
  $('keyInput').value = ''; $('keyGuess').hidden = true;
  if (streamStates[k]) delete streamStates[k].error;
  renderKeyList(); toast(`${PLATFORMS[k].name} 스트림 키를 저장했어요.`);
}
$('keyInput').addEventListener('input', showGuess);
$('keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const g = guessKey($('keyInput').value); if (g.platform) saveKey(g.platform, g.key); } });
$('keyShow').addEventListener('click', () => { const k = $('keyInput'), show = k.type === 'password'; k.type = show ? 'text' : 'password'; $('keyShow').textContent = show ? '숨기기' : '보기'; });
document.querySelectorAll('[data-help]').forEach((b) => b.addEventListener('click', () => ipcRenderer.invoke('app:open-url', PLATFORMS[b.dataset.help].keyHelp)));
function renderKeyList() {
  const box = $('keyList'); box.innerHTML = '';
  const saved = Object.keys(PLATFORMS).filter((k) => cfg.keys[k]);
  if (!saved.length) { box.innerHTML = '<div class="key-empty">아직 저장된 키가 없어요</div>'; return; }
  for (const k of saved) {
    const st = platformState(k);
    const item = document.createElement('div'); item.className = 'key-item';
    const cls = { live: 'live', ready: 'ready', err: 'err', starting: 'wait', reconnecting: 'wait', stopping: 'wait' }[st] || '';
    item.innerHTML = `<b>${esc(PLATFORMS[k].name)}</b><span class="pstate ${cls}"><i></i><span>${esc(STATE_TEXT[st] || st)}</span></span><code>${esc(maskKey(cfg.keys[k]))}</code><button class="x" title="키 지우기">✕</button>`;
    item.querySelector('.x').addEventListener('click', () => {
      if (streamStates[k] && streamStates[k].state !== 'off') return toast('방송 중에는 지울 수 없어요.', true);
      cfg.keys[k] = ''; save(); delete streamStates[k]; renderKeyList();
    });
    box.appendChild(item);
    const err = streamStates[k] && streamStates[k].error;
    if (err) { const e = document.createElement('div'); e.className = 'key-err'; e.textContent = err; box.appendChild(e); }
  }
}
function renderPlatforms() { renderKeyList(); }
function renderPlatformStates() { renderKeyList(); }

// 인코더: 콤보박스 + 자동 버튼(이 PC에서 가장 좋은 걸 골라 줌)
function encList() { return DEMO ? ENCODERS.filter((e) => ['obs_nvenc_h264_tex', 'obs_x264'].includes(e.id)) : engineOk ? engine.availableEncoders() : []; }
function renderEncoders() {
  const sel = $('encSel'), list = encList();
  if (!list.length) { sel.innerHTML = '<option>엔진 준비 중</option>'; $('encHint').textContent = ''; return; }
  sel.innerHTML = list.map((e) => `<option value="${e.id}">${esc(e.label)} — ${e.hw ? '그래픽카드' : 'CPU 사용'}</option>`).join('');
  let cur = cfg.encoder && list.some((e) => e.id === cfg.encoder) ? cfg.encoder : list[0].id;
  if (cfg.encoder !== cur) { cfg.encoder = cur; save(); }
  sel.value = cur; engine.encoderPref = cur;
  const e = list.find((x) => x.id === cur);
  $('encHint').textContent = e.id === list[0].id ? `${e.label} — 이 PC에서 가장 좋은 인코더예요.` : `${e.label}을(를) 쓰고 있어요. 자동을 누르면 ${list[0].label}(으)로 돌아가요.`;
}
$('encSel').addEventListener('change', () => {
  if (engine.streaming) { renderEncoders(); return toast('방송 중에는 인코더를 바꿀 수 없어요.', true); }
  cfg.encoder = $('encSel').value; save(); renderEncoders();
});
$('encAuto').addEventListener('click', () => {
  if (engine.streaming) return toast('방송 중에는 인코더를 바꿀 수 없어요.', true);
  const list = encList(); if (!list.length) return;
  cfg.encoder = list[0].id; save(); renderEncoders(); toast(`자동으로 ${list[0].label}을(를) 골랐어요.`);
});

let liveSince = 0;
function setTopState() {
  const sts = Object.entries(streamStates).filter(([, s]) => s.state !== 'off');
  const live = sts.filter(([, s]) => s.state === 'live');
  const pill = $('livePill'), btn = $('btnLive');
  let text, cls;
  if (live.length) { text = 'LIVE · ' + live.map(([k]) => PLATFORMS[k].name).join(' + '); cls = ' live'; }
  else if (sts.length) { text = STATE_TEXT[sts[0][1].state] || '연결 중…'; cls = ' wait'; }
  else { text = '오프라인'; cls = ''; }
  pill.className = 'live-pill' + cls; $('liveText').textContent = text;
  btn.classList.toggle('live', sts.length > 0);
  btn.querySelector('span').textContent = sts.length ? (live.length ? '방송 종료' : text) : '방송 시작';
  btn.disabled = sts.length > 0 && !live.length && sts.every(([, s]) => s.state === 'stopping');
  liveSince = live.length ? Math.min(...live.map(([, s]) => s.startedAt || Date.now())) : 0;
  if (!liveSince) $('liveTime').textContent = '';
}
engine.on('stream', (states) => {
  const before = streamStates; streamStates = states;
  for (const [k, s] of Object.entries(states)) {
    const b = before[k] || {};
    if (s.state === 'live' && b.state !== 'live') toast(`${PLATFORMS[k].name} 방송이 시작됐어요!`);
    if (s.state === 'off' && b.state && b.state !== 'off') s.error ? toast(`${PLATFORMS[k].name}: ${s.error}`, true) : toast(`${PLATFORMS[k].name} 방송을 종료했어요.`);
  }
  renderPlatformStates(); setTopState();
});
$('btnLive').addEventListener('click', guard(async () => {
  if (DEMO) return;
  if (engine.streaming) {
    const r = await ipcRenderer.invoke('app:confirm', { title: '방송 종료', message: '방송을 종료할까요?', buttons: ['종료', '취소'] });
    if (r === 0) engine.stopStream(); return;
  }
  const targets = Object.entries(cfg.keys).filter(([, key]) => key).map(([platform, key]) => ({ platform, key }));
  if (!targets.length) { openTab('stream'); return toast('방송 탭에서 스트림 키를 하나 이상 넣어 주세요.', true); }
  streamStates = {}; engine.startStream(targets);
}));
engine.on('record', (r) => {
  $('btnRec').classList.toggle('on', r.state === 'on');
  if (r.state === 'on') toast('녹화를 시작했어요. 저장 위치: ' + info.recordDir);
  if (r.state === 'off') r.error ? toast(r.error, true) : toast('녹화를 저장했어요.');
});
$('btnRec').addEventListener('click', guard(() => { if (DEMO) return; engine.recording ? engine.stopRecording() : engine.startRecording(info.recordDir); }));

setInterval(() => {
  if (liveSince) { const s = Math.floor((Date.now() - liveSince) / 1000); $('liveTime').textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  if (!engineOk) return;
  try {
    const st = engine.stats();
    $('sCpu').textContent = st.cpu != null ? st.cpu.toFixed(0) + '%' : '-';
    $('sFps').textContent = st.fps != null ? st.fps.toFixed(0) : '-';
    $('sKbps').textContent = st.kbps != null ? Math.round(st.kbps) + 'kbps' : '-';
    $('sDrop').textContent = st.dropped != null && st.sent ? ((st.dropped / Math.max(1, st.sent)) * 100).toFixed(1) + '%' : '-';
  } catch {}
}, 1000);

// ================================================================== 타이머
let tState = null, tSkew = 0;
function timerListen() {
  const es = new EventSource(info.timerUrl.replace('/overlay/timer', '/api/timer/events'));
  es.onmessage = (e) => { tState = JSON.parse(e.data); tSkew = tState.now - Date.now(); };
  es.onerror = () => { es.close(); setTimeout(timerListen, 2000); };
}
setInterval(() => {
  if (!tState) return;
  let ms = tState.baseMs;
  if (tState.running) { const el = Date.now() + tSkew - tState.startedAt; ms = tState.mode === 'stopwatch' ? tState.baseMs + el : Math.max(0, tState.baseMs - el); }
  if (tState.mode === 'countdown') ms += 999;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), p = (n) => String(n).padStart(2, '0');
  $('timerBig').textContent = h ? `${h}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}, 200);
const timer = (a) => ipcRenderer.invoke('timer:action', a);
document.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => timer({ type: b.dataset.t, minutes: $('tMin').value })));
$('tApply').addEventListener('click', () => { cfg.timer = { mode: $('tMode').value, minutes: Number($('tMin').value), label: $('tLabel').value, theme: $('tTheme').value }; save(); timer({ type: 'config', ...cfg.timer }); toast('타이머 설정을 적용했어요.'); });

// ================================================================== 설정
$('quality').value = cfg.quality;
$('quality').addEventListener('change', () => { cfg.quality = $('quality').value; save(); toast('저장했어요. Streamy Kit을 다시 시작하면 적용돼요.'); });
$('srcLink').addEventListener('click', () => ipcRenderer.invoke('app:open-url', 'https://github.com/Streamys/Streamy_kit'));
$('btnRetry').addEventListener('click', () => ipcRenderer.send('app:relaunch'));
$('btnRestart').addEventListener('click', () => ipcRenderer.send('app:relaunch'));
$('btnLogs').addEventListener('click', () => ipcRenderer.invoke('app:open-path', info.logDir));
$('btnLogs2').addEventListener('click', () => ipcRenderer.invoke('app:open-path', info.logDir));
$('gpuOff').addEventListener('change', async () => { const v = await ipcRenderer.invoke('app:set-gpu', $('gpuOff').checked); $('gpuOff').checked = v; toast('저장했어요. 다시 시작하면 적용돼요.'); });

// ================================================================== 미리보기 위치 맞추기 (창 크기 바뀔 때 바로 따라감)
let layoutRaf = 0;
function layoutDisplay() {
  if (!engineOk || layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    const r = prev.getBoundingClientRect(), z = window.devicePixelRatio || 1;
    try { engine.moveDisplay(r.left * z, r.top * z, r.width * z, r.height * z); } catch (e) { rlog('warn', 'moveDisplay', e); }
  });
}
new ResizeObserver(layoutDisplay).observe(prev);
new ResizeObserver(layoutDisplay).observe($('previewWrap'));
window.addEventListener('resize', layoutDisplay);

// ================================================================== 시작 (화면 먼저 → 엔진은 그 다음)
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
function engineError(e) {
  rlog('error', 'engine start failed', e);
  engineOk = false;
  $('previewEmpty').classList.add('err');
  $('engineMsg').textContent = e.message || String(e);
  $('engineSub').textContent = '다시 시작해도 안 되면 로그 폴더의 streamy-kit.log 파일을 보내 주세요.';
}
async function boot() {
  $('ver').textContent = 'v' + info.version;
  $('gpuOff').checked = !!info.gpuOff;
  engine.encoderPref = cfg.encoder || 'auto';
  renderPlatforms(); renderEncoders(); setTopState(); timerListen(); renderViewers(); pollViewers();
  $('tMode').value = cfg.timer.mode; $('tMin').value = cfg.timer.minutes; $('tLabel').value = cfg.timer.label; $('tTheme').value = cfg.timer.theme;
  timer({ type: 'config', ...cfg.timer });
  renderScenes(); renderSources(); renderMixer();
  if (DEMO) { demoMode(); return; }

  await nextFrame();
  try { await ipcRenderer.invoke('engine:prepare'); } catch (e) { rlog('warn', 'prepare', e); }
  await nextFrame();
  const q = { '1080p60': [1920, 1080, 60], '1080p30': [1920, 1080, 30], '720p60': [1280, 720, 60] }[cfg.quality] || [1920, 1080, 60];
  const t0 = performance.now();
  try {
    engine.start({ osnDir: info.osnDir, dataDir: info.dataDir, width: q[0], height: q[1], fps: q[2] });
    rlog('info', `engine started in ${Math.round(performance.now() - t0)}ms`, 'encoders:', engine.encoderTypes().join(','));
    engineOk = true;
  } catch (e) { engineError(e); return; }
  try {
    let saved = null; try { saved = JSON.parse(fs.readFileSync(scenesFile, 'utf8')); } catch {}
    if (saved && saved.scenes && saved.scenes.length) engine.load(saved);
  } catch (e) { rlog('error', 'scene load', e); toast('저장된 장면을 불러오지 못했어요. 새 장면으로 시작해요.', true); }
  if (!engine.scenes.length) engine.addScene('장면 1');
  try { engine.setupAudio(cfg); } catch (e) { rlog('error', 'audio setup', e); }
  for (const [kind, name] of [['desktop', '데스크톱 소리'], ['mic', '마이크']]) if (cfg.devices[kind]) { try { engine.setAudioDevice(name, cfg.devices[kind]); } catch {} }
  try {
    engine.createDisplay(ipcRenderer.sendSync('app:window-handle'));
    prev.classList.add('has-engine');
    layoutDisplay();
  } catch (e) { rlog('error', 'display', e); toast('미리보기 화면을 만들지 못했어요. 설정 → 문제 해결에서 그래픽 가속을 꺼 보세요.', true); }
  renderScenes(); renderSources(); renderMixer(); renderTypes(); renderEncoders();
  if (soundOpen) renderDevices();
  rlog('info', `ready in ${Math.round(performance.now() - t0)}ms`);
  if (!engine.items().length) { openTab('sources'); $('srcAdd').click(); toast('＋ 추가에서 모니터 화면이나 게임부터 넣어 보세요.'); }
}

// 개발용 화면 미리보기 (윈도우가 아닌 환경에서 STREAMY_DEMO=1)
const demo = {
  scenes: [{ id: 'a', name: '게임 방송', n: 3 }, { id: 'b', name: '저챗', n: 2 }, { id: 'c', name: '쉬는 시간', n: 1 }, { id: 'd', name: '합방', n: 4 }], current: 'a',
  items: [{ id: 3, name: '웹캠', icon: '📷', visible: true, selected: true }, { id: 2, name: '타이머', icon: '⏱️', visible: true, selected: true }, { id: 1, name: '모니터 1', icon: '🖥️', visible: true }],
  audio: [{ name: 'd', label: '데스크톱 소리', vol: 0.8, muted: false }, { name: 'm', label: '마이크', vol: 0.72, muted: false }, { name: 'dc', label: '디스코드', vol: 0.55, muted: false }, { name: 'ch', label: 'Google Chrome', vol: 0.4, muted: false }],
  sep: [{ name: 'dc', label: '디스코드', exe: 'Discord.exe' }, { name: 'ch', label: 'Google Chrome', exe: 'chrome.exe' }],
  live: [{ exe: 'Spotify.exe', desc: 'Spotify', peak: 0.4 }, { exe: 'msedge.exe', desc: 'Microsoft Edge', peak: 0.2 }, { exe: 'League of Legends.exe', desc: 'League of Legends', peak: 0.6 }, { exe: 'KakaoTalk.exe', desc: '카카오톡', peak: 0 }],
  level(name, now) { const base = { d: 0.62, m: 0.5, dc: 0.32, ch: 0 }[name] || 0; const v = base ? base + Math.sin(now / 170 + name.length) * 0.12 + Math.sin(now / 53) * 0.05 : 0; return { level: Math.max(0, v), peak: Math.max(0, base + 0.15), t: now }; },
};
function demoMode() {
  const img = document.createElement('img'); img.src = 'demo-preview.png'; img.className = 'demo-shot'; prev.appendChild(img);
  const sel = document.createElement('div'); sel.className = 'demo-sel'; sel.innerHTML = '<i></i><i></i><i></i><i></i>';
  Object.assign(sel.style, { left: '2.5%', top: '62%', width: '27%', height: '34%' }); prev.appendChild(sel);
  prev.classList.add('has-engine');
  $('sCpu').textContent = '6%'; $('sFps').textContent = '60';
  cfg.keys = { chzzk: 'sk_live_8d2f91c7a4', youtube: 'abcd-efgh-ijkl-mnop-qrst', soop: '' }; streamStates = { chzzk: { state: 'live', startedAt: Date.now() - 5047000 }, youtube: { state: 'live', startedAt: Date.now() - 5047000 } };
  renderPlatforms(); setTopState(); $('keyInput').value = 'rtmp://stream.sooplive.co.kr/app/streamy1234-5678'; showGuess();
  renderScenes(); renderSources(); renderMixer(); renderViewers(); renderEncoders();
  setInterval(() => { const now = Date.now(); for (const a of demo.live) liveLevels[a.exe.toLowerCase()] = { v: a.peak ? a.peak + Math.sin(now / 120 + a.exe.length) * 0.15 : 0, t: now }; for (const a of demo.sep) liveLevels[a.exe.toLowerCase()] = { v: 0.35 + Math.sin(now / 90) * 0.1, t: now }; }, 100);
}

// ================================================================== 종료
ipcRenderer.on('app:request-quit', async () => {
  if (engine.streaming) {
    const r = await ipcRenderer.invoke('app:confirm', { title: 'Streamy Kit 종료', message: '방송 중이에요. 방송을 끝내고 종료할까요?', buttons: ['종료', '취소'] });
    if (r !== 0) { ipcRenderer.send('app:quit-cancelled'); return; }
  }
  ipcRenderer.send('app:quitting');
  rlog('info', 'shutting down');
  try { if (engineOk) { writeJson(scenesFile, engine.serialize()); saveAudioState(); writeJson(info.settingsFile, cfg); } } catch (e) { rlog('error', 'save on quit', e); }
  try { engine.shutdown(); } catch (e) { rlog('error', 'shutdown', e); }
  ipcRenderer.send('app:ready-to-quit');
});

boot();
