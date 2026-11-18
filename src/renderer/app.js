// Streamy Kit — 화면 로직 (v0.8)
'use strict';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { Engine, SOURCE_TYPES, PLATFORMS, ENCODERS, VIRTUAL_APPS, VIRTUAL_SPOTS, VIRTUAL_DEFAULT, appOfExe, exeOf } = require('./engine.js');

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
  appAudio: [], audioState: {}, devices: {}, showViewers: false, channels: { chzzk: '', youtube: '', soop: '' },
  timer: { mode: 'stopwatch', minutes: 10, label: '', theme: 'red' }, quality: '1080p60',
  mode: 'setup', airOnLive: true, chatLog: false,
  mini: { on: true, platforms: ['chzzk', 'youtube', 'soop'], opacity: 30, count: 5 },
  virtualAuto: true, virtualAutoDone: [],
};
const scenesFile = path.join(path.dirname(info.settingsFile), 'scenes.json');
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(info.settingsFile, 'utf8'));
    return { ...DEFAULTS, ...s, keys: { ...DEFAULTS.keys, ...(s.keys || {}) }, timer: { ...DEFAULTS.timer, ...(s.timer || {}) }, channels: { ...DEFAULTS.channels, ...(s.channels || {}) }, mini: { ...DEFAULTS.mini, ...(s.mini || {}) } };
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
let mode = 'setup', tabBeforeAir = 'stream';
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
const PICK_LABEL = { monitor: '모니터', window: '프로그램 창', game: '게임 창', webcam: '웹캠', virtual: '버추얼 프로그램 창' };
function pickOptions(kind) {
  const first = kind === 'game' ? '<option value="">전체 화면 게임 자동 감지</option>' : '';
  if (kind === 'virtual') return virtualPickOptions('') || '<option value="">찾지 못했어요 — 프로그램을 켜고 ↻</option>';
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
  if (kind === 'virtual') h += `<label class="field">연결 방식<select id="${prefix}Method"><option value="game">창 바로 잡기 · 투명 배경 (추천)</option><option value="spout">Spout2 (VTube Studio·VSeeFace·Warudo에서 Spout2를 켰을 때)</option></select></label>
      <p class="hint">켜져 있는 프로그램만 목록에 나와요. 더 쉬운 방법: 위의 <b>🧸 버추얼 원클릭 연결</b>.</p>`;
  if (kind === 'timer') h += '<p class="hint">오른쪽 위에 들어가요. 조작은 <b>타이머</b> 탭에서 해요.</p>';
  return h;
}
function readForm(prefix) {
  const v = (id) => { const el = $(prefix + id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
  const pick = $(prefix + 'Pick');
  return { virt: $(prefix + 'Method') ? { ...VIRTUAL_DEFAULT, ...(cfg.virtualLast || {}), method: v('Method') } : undefined, value: v('Pick'), label: pick && pick.selectedOptions[0] ? pick.selectedOptions[0].textContent : '', file: v('File'), text: v('Text'), size: v('Size'), color: v('Color'), outline: v('Outline'), url: v('Url'), width: v('W'), height: v('H'), timerUrl: info.timerUrl };
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
    if (t.prop && addKind !== 'game' && !opt.value && !(addKind === 'virtual' && opt.virt?.method === 'spout')) return toast('목록에서 골라 주세요.', true);
    if (addKind === 'virtual') opt.name = appOfExe(exeOf(opt.value))?.name || '버추얼';
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
  if (s && s.kind === 'virtual') { renderVirtualProps(it.name, engine.getVirtual(it.name), s.settings.window, engine.getVirtual(it.name).method); return; }
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
  if (!engineOk || e.button !== 0 || mode === 'air') return;
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
  if (mode === 'air') return;     // ON AIR 화면에서는 소스 이동/삭제 단축키 막기
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
      <div class="bar"><div class="lvl"></div><div class="pkw"><div class="pk"></div></div><div class="ticks"></div><input type="range" min="0" max="100"></div>`;
    const r = row.querySelector('input'), pct = row.querySelector('.pct');
    r.value = Math.round(a.vol * 100); pct.textContent = r.value + '%';
    r.addEventListener('input', () => { if (!DEMO) engine.setVolume(a.name, r.value / 100); pct.textContent = r.value + '%'; });
    r.addEventListener('change', saveAudioState);
    row.querySelector('.mute').addEventListener('click', guard(() => { if (DEMO) return; engine.setMuted(a.name, !a.muted); saveAudioState(); }));
    box.appendChild(row);
    meterEls[a.name] = { row, lvl: row.querySelector('.lvl'), pk: row.querySelector('.pkw'), shown: 0, peak: 0, peakT: 0, drawn: -1, drawnPk: -1 };
  }
}
engine.on('audio', () => { renderMixer(); renderSepApps(); });
// 레벨은 엔진에서 1초에 수십 번 들쑥날쑥 들어와요 → 화면에서는 시간 기준으로 부드럽게 따라가게 (올라갈 땐 빠르게, 내려갈 땐 천천히)
let meterT = performance.now();
const ease = (cur, target, dt, up, down) => cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? up : down)));
function meterLoop(ts = performance.now()) {
  const dt = Math.min(0.1, Math.max(0, (ts - meterT) / 1000)); meterT = ts;
  const now = Date.now();
  for (const [name, m] of Object.entries(meterEls)) {
    const L = DEMO ? demo.level(name, now) : engine.levels[name];
    const fresh = L && now - L.t < 500;
    m.shown = ease(m.shown, fresh ? L.level : 0, dt, 0.05, 0.28);
    const pk = fresh ? L.peak : 0;
    if (pk >= m.peak) { m.peak = pk; m.peakT = now; }
    else if (now - m.peakT > 900) m.peak = Math.max(pk, m.peak - dt * 0.45);     // 잠깐 멈췄다가 천천히 내려옴
    const w = Math.round(m.shown * 1000) / 10, p = Math.round(m.peak * 1000) / 10;
    if (w !== m.drawn) { m.lvl.style.clipPath = `inset(0 ${(100 - w).toFixed(1)}% 0 0)`; m.drawn = w; }
    if (p !== m.drawnPk) { m.pk.style.transform = `translateX(${p}%)`; m.pk.style.opacity = m.peak > 0.02 ? 1 : 0; m.drawnPk = p; }
    m.row.classList.toggle('active', m.shown > 0.08);
  }
  // 사운드 탭 카드 레벨
  for (const c of document.querySelectorAll('.acard[data-exe]')) {
    const s = liveLevels[c.dataset.exe.toLowerCase()];
    const v = s && now - s.t < 800 ? s.v : 0;
    const shown = ease(Number(c.dataset.v || 0), v, dt, 0.06, 0.35);
    c.dataset.v = shown; c.querySelector('.lv').style.clipPath = `inset(0 ${(100 - shown * 100).toFixed(1)}% 0 0)`;
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

// ================================================================== 채팅 탭 (통합 + 플랫폼별 공식 창)
const CHAT_P = { chzzk: '치지직', youtube: '유튜브', soop: 'SOOP' };
const chat = { view: 'all', status: {}, hidden: new Set(cfg.chatHidden || []), stick: true, unseen: 0, webs: {} };
const CHAT_MAX = 300;
function normYt(v) {
  v = v.trim(); let m;
  if ((m = v.match(/(UC[\w-]{22})/))) return m[1];
  if ((m = v.match(/@([\w.\-]+)/))) return '@' + m[1];
  if ((m = v.match(/(?:v=|youtu\.be\/|\/live\/)([\w-]{11})/))) return v;     // 방송 주소 그대로
  return v.replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/[/?#].*$/, '');
}
function normSoop(v) { return v.trim().replace(/^https?:\/\/(ch\.|play\.|www\.)?sooplive\.(co\.kr|com)\/(station\/)?/, '').replace(/[/?#].*$/, ''); }
$('ytId').value = cfg.channels.youtube || '';
$('soopId').value = cfg.channels.soop || '';
$('ytId').addEventListener('change', () => { const v = normYt($('ytId').value); $('ytId').value = v; cfg.channels.youtube = v; save(); chatConfigure(); });
$('soopId').addEventListener('change', () => { const v = normSoop($('soopId').value); $('soopId').value = v; cfg.channels.soop = v; save(); chatConfigure(); });
$('chzzkId').addEventListener('change', () => chatConfigure());
async function chatConfigure() {
  const ch = { ...cfg.channels }; if (ch.chzzk && !/^[0-9a-f]{32}$/i.test(ch.chzzk)) ch.chzzk = '';
  try { const st = await ipcRenderer.invoke('chat:configure', ch); for (const [p, v] of Object.entries(st || {})) chat.status[p] = { p, ...v }; } catch (e) { rlog('error', 'chat configure', e); }
  renderChatState(); renderChatWeb();
}
const STATE_KO = { off: '연결 안 함', wait: '방송 대기', live: '연결됨', error: '오류' };
function renderChatState() {
  const box = $('chatState');
  const on = Object.keys(CHAT_P).filter((p) => cfg.channels[p]);
  box.innerHTML = on.map((p) => { const st = chat.status[p] || { state: 'wait' };
    return `<span class="cs ${st.state}${chat.hidden.has(p) ? ' hide' : ''}" data-p="${p}" title="${esc(st.detail || STATE_KO[st.state] || '')} · 클릭하면 숨기기/보이기"><i></i>${CHAT_P[p]} ${esc(st.state === 'live' ? '' : STATE_KO[st.state] || '')}</span>`; }).join('');
  const anyLive = on.some((p) => chat.status[p]?.state === 'live');
  $('chatDot').className = 'tab-dot' + (chat.unseen && chat.view !== 'open' ? ' new' : anyLive ? ' live' : '');
  if (!on.length) {
    $('chatFeed').innerHTML = `<div class="chat-empty"><b>채널을 연결하면 여기에 채팅이 모여요</b><br>설정 탭 → 채널 연결에 치지직 · 유튜브 · SOOP 채널을 한 번만 넣어 주세요.<br><button id="chatGoSettings">채널 연결하러 가기</button></div>`;
    $('chatGoSettings').onclick = () => { openTab('settings'); $('chzzkId').focus(); };
  } else if (!$('chatFeed').querySelector('.cm')) {
    $('chatFeed').innerHTML = `<div class="chat-empty">${anyLive ? '채팅을 기다리는 중…' : '방송이 켜지면 채팅이 자동으로 붙어요.'}</div>`;
  }
}
$('chatState').addEventListener('click', (e) => {
  const el = e.target.closest('.cs'); if (!el) return;
  const p = el.dataset.p; chat.hidden.has(p) ? chat.hidden.delete(p) : chat.hidden.add(p);
  cfg.chatHidden = [...chat.hidden]; save();
  document.querySelectorAll('#chatFeed .cm').forEach((x) => { x.hidden = chat.hidden.has(x.dataset.p); });
  renderChatState();
});
function chatHtml(m) {
  const body = (m.parts || []).map((x) => (x.t === 'img' ? `<img src="${esc(x.src)}" alt="${esc(x.alt)}" title="${esc(x.alt)}" loading="lazy" referrerpolicy="no-referrer">` : esc(x.v))).join('');
  const t = new Date(m.ts || Date.now()); const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  return `<i class="pd ${m.p}" title="${CHAT_P[m.p]} · ${hm}"></i>${m.badge ? `<span class="bd${m.badge === '스트리머' ? ' st' : ''}">${esc(m.badge)}</span>` : ''}`
    + `${m.amount ? `<span class="amt">${esc(m.amount)}</span>` : ''}<span class="nk">${esc(m.nick)}</span><span class="tx">${body}</span>`;
}
function addChat(list) {
  const feed = $('chatFeed');
  feed.querySelector('.chat-empty')?.remove();
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  const frag = document.createDocumentFragment();
  for (const m of list) {
    const d = document.createElement('div');
    d.className = `cm p-${m.p} ${m.kind || 'chat'}${m.recent ? ' recent' : ''}`;
    d.dataset.p = m.p; d.hidden = chat.hidden.has(m.p);
    d.innerHTML = chatHtml(m);
    frag.appendChild(d);
  }
  feed.appendChild(frag);
  while (feed.children.length > CHAT_MAX) feed.firstElementChild.remove();
  if (atBottom || chat.stick) { feed.scrollTop = feed.scrollHeight; chat.stick = true; }
  else { chat.unseen += list.filter((m) => !m.recent).length; $('chatMore').hidden = !chat.unseen; $('chatMore').textContent = `새 채팅 ${chat.unseen}개 ↓`; }
  if (!$('tab-chat').classList.contains('on') && list.some((m) => !m.recent)) $('chatDot').className = 'tab-dot new';
}
$('chatFeed').addEventListener('scroll', () => {
  const f = $('chatFeed'); chat.stick = f.scrollHeight - f.scrollTop - f.clientHeight < 40;
  if (chat.stick) { chat.unseen = 0; $('chatMore').hidden = true; }
});
$('chatMore').addEventListener('click', () => { const f = $('chatFeed'); f.scrollTop = f.scrollHeight; chat.stick = true; chat.unseen = 0; $('chatMore').hidden = true; });
document.querySelector('.tabs button[data-tab="chat"]').addEventListener('click', () => { if (chat.view === 'all') { const f = $('chatFeed'); if (chat.stick) f.scrollTop = f.scrollHeight; } renderChatState(); });

// 플랫폼별: 공식 채팅창을 그대로 (로그인하면 거기서 채팅 입력 가능)
function webUrl(p) {
  const id = cfg.channels[p]; if (!id) return '';
  if (p === 'chzzk') return /^[0-9a-f]{32}$/i.test(id) ? `https://chzzk.naver.com/live/${id}/chat` : '';
  if (p === 'youtube') return chat.status.youtube?.url || '';
  if (p === 'soop') return `https://play.sooplive.com/${encodeURIComponent(id)}`;
  return '';
}
function renderChatWeb() {
  const p = chat.view, box = $('chatWeb');
  $('chatAll').hidden = p !== 'all'; box.hidden = p === 'all';
  for (const [k, w] of Object.entries(chat.webs)) w.el.hidden = k !== p;
  if (p === 'all') return;
  box.querySelector('.chat-empty')?.remove();
  const url = webUrl(p);
  let w = chat.webs[p];
  if (w && w.url !== url) { w.el.remove(); delete chat.webs[p]; w = null; }
  if (!url) {
    const msg = !cfg.channels[p] ? `<b>${CHAT_P[p]} 채널이 연결되지 않았어요</b><br><button id="chatGoSettings2">채널 연결하러 가기</button>`
      : p === 'youtube' ? '<b>유튜브 방송이 켜지면 채팅창이 떠요</b><br>방송 시작 후 몇 초 안에 자동으로 나타나요.' : '<b>채널 ID를 확인해 주세요</b>';
    box.insertAdjacentHTML('beforeend', `<div class="chat-empty">${msg}</div>`);
    const b = $('chatGoSettings2'); if (b) b.onclick = () => openTab('settings');
    return;
  }
  if (!w) {
    const el = document.createElement('div'); el.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
    el.innerHTML = `<div class="bar"><span>${CHAT_P[p]} 공식 채팅창 · 로그인하면 여기서 채팅 입력도 돼요</span><button data-a="reload">새로고침</button><button data-a="open">브라우저로</button></div>`;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:chat');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', url);
    if (p === 'soop') wv.addEventListener('dom-ready', () => wv.insertCSS('#webplayer,#player_area,.player_area,#player,.htmlplayer_wrap{display:none!important}').catch(() => {}));
    el.appendChild(wv);
    el.querySelector('[data-a=reload]').onclick = () => { try { wv.reload(); } catch {} };
    el.querySelector('[data-a=open]').onclick = () => ipcRenderer.invoke('app:open-url', url);
    box.appendChild(el);
    w = chat.webs[p] = { el, url };
  }
  w.el.hidden = false;
}
$('chatSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  chat.view = b.dataset.v;
  $('chatSwitch').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  renderChatWeb();
  if (chat.view === 'all') { const f = $('chatFeed'); if (chat.stick) f.scrollTop = f.scrollHeight; }
});
ipcRenderer.on('chat:messages', (_e, list) => addChat(list));
ipcRenderer.on('chat:status', (_e, st) => {
  const prev = chat.status[st.p] || {};
  chat.status[st.p] = st; renderChatState();
  if (st.p === 'youtube' && prev.url !== st.url && chat.view === 'youtube') renderChatWeb();
  if (st.state === 'live' && prev.state !== 'live') addChat([{ p: st.p, kind: 'system', nick: '', parts: [{ t: 'text', v: `${CHAT_P[st.p]} 채팅에 연결됐어요` }] }]);
});

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
    if (s.state === 'live' && b.state !== 'live') { toast(`${PLATFORMS[k].name} 방송이 시작됐어요!`); if (cfg.airOnLive) setMode('air'); }
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
  setTimeout(() => ipcRenderer.invoke('chat:kick').catch(() => {}), 8000);   // 방송이 플랫폼에 잡히면 채팅 바로 연결
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

// ================================================================== 업데이트
let upd = { status: 'idle' };
function renderUpdate() {
  const btn = $('updBtn'), txt = $('updText'), bar = $('updBar');
  const v = upd.info && upd.info.version;
  $('updCur').textContent = 'Streamy Kit v' + info.version;
  $('updStatus').textContent = { idle: '확인 전', checking: '확인하는 중…', latest: '최신 버전이에요', available: `새 버전 v${v}이(가) 있어요`, downloading: `v${v} 받는 중… ${upd.progress || 0}%`, ready: `v${v} 설치 준비 완료`, error: upd.error || '확인 실패' }[upd.status] || '';
  if (upd.error && upd.status === 'available') $('updStatus').textContent = upd.error;
  $('updCheck').textContent = upd.status === 'available' || upd.status === 'ready' ? `v${v}로 업데이트` : '업데이트 확인';
  $('updCheck').disabled = upd.status === 'checking' || upd.status === 'downloading';
  const notes = $('updNotes'); notes.hidden = !(v && upd.info.notes); notes.textContent = v ? upd.info.notes : '';
  const show = ['available', 'downloading', 'ready'].includes(upd.status);
  btn.hidden = !show;
  btn.classList.toggle('busy', upd.status === 'downloading');
  txt.textContent = upd.status === 'downloading' ? `받는 중 ${upd.progress || 0}%` : upd.status === 'ready' ? `v${v} 설치하기` : `업데이트 v${v}`;
  bar.style.width = upd.status === 'downloading' ? (upd.progress || 0) + '%' : '0';
}
ipcRenderer.on('update:state', (_e, st) => {
  const was = upd.status; upd = st; renderUpdate();
  if (st.status === 'available' && was !== 'available' && !st.error) toast(`새 버전 v${st.info.version}이(가) 나왔어요. 위쪽 업데이트 버튼을 누르세요.`);
  if (st.status === 'latest' && st.manual) toast('지금 최신 버전이에요.');
  if (st.status === 'error' && st.manual) toast(st.error, true);
});
async function doUpdate() {
  if (upd.status === 'downloading') return;
  if (engine.streaming) return toast('방송 중에는 업데이트할 수 없어요. 방송을 끝낸 뒤 눌러 주세요.', true);
  if (engine.recording) return toast('녹화 중에는 업데이트할 수 없어요.', true);
  const v = upd.info && upd.info.version; if (!v) return;
  const r = await ipcRenderer.invoke('app:confirm', { title: '업데이트', message: `Streamy Kit v${v}로 업데이트할까요?` + (upd.info.local ? ' (바탕화면 파일)' : ''), detail: '설치하는 동안 잠깐 꺼졌다가 자동으로 다시 켜져요. 장면과 설정은 그대로 유지돼요.', buttons: ['업데이트', '나중에'] });
  if (r !== 0) return;
  try {
    await ipcRenderer.invoke('update:download');
    toast('설치를 시작해요. 윈도우가 허용을 물어보면 "예"를 눌러 주세요. 끝나면 자동으로 다시 켜져요.');
    await ipcRenderer.invoke('update:install');
  } catch (e) { toast('업데이트 실패: ' + (e.message || e), true); }
}
$('updBtn').addEventListener('click', doUpdate);
$('updFolder').addEventListener('click', () => ipcRenderer.invoke('update:folder'));
$('updCheck').addEventListener('click', async () => {
  if (upd.status === 'available' || upd.status === 'ready') return doUpdate();
  try { await ipcRenderer.invoke('update:check'); } catch {}
});
// 업데이트 설치가 시작되면: 저장하고 엔진 정리 후 종료 (설치가 끝나면 자동으로 다시 켜짐)
ipcRenderer.on('app:quit-for-update', () => {
  ipcRenderer.send('app:quitting');
  rlog('info', 'quit for update');
  try { if (engineOk) { writeJson(scenesFile, engine.serialize()); saveAudioState(); writeJson(info.settingsFile, cfg); } } catch (e) { rlog('error', 'save on update', e); }
  try { engine.shutdown(); } catch (e) { rlog('error', 'shutdown', e); }
  ipcRenderer.send('app:ready-to-quit');
});

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
  renderPlatforms(); renderEncoders(); setTopState(); timerListen(); renderViewers(); pollViewers(); renderUpdate(); if (!DEMO) chatConfigure(); else renderChatState();
  renderMiniSettings(); miniConfigSend(); setChatLog(cfg.chatLog, true);
  if (cfg.mode === 'air' || process.env.STREAMY_MODE === 'air') setMode('air', true);
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
    if (mode === 'air') engine.setDrawUI(false);
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
  cfg.channels = { chzzk: 'a'.repeat(32), youtube: '@streamy', soop: 'streamy' };
  chat.status = { chzzk: { p: 'chzzk', state: 'live' }, youtube: { p: 'youtube', state: 'live' }, soop: { p: 'soop', state: 'wait' } };
  addChat([
    { p: 'chzzk', nick: '치즈냥', parts: [{ t: 'text', v: '오늘 방송 화질 미쳤다 ㄷㄷ' }], badge: '' },
    { p: 'youtube', nick: 'MinJun Kim', parts: [{ t: 'text', v: '유튜브에서 보고 있어요!' }] },
    { p: 'chzzk', nick: '매니저봇', parts: [{ t: 'text', v: '공지: 오늘은 10시까지 방송합니다' }], badge: '매니저' },
    { p: 'chzzk', kind: 'donation', nick: '후원왕', amount: '10,000치즈', parts: [{ t: 'text', v: '방송 잘 보고 있어요 화이팅!!' }] },
    { p: 'youtube', nick: 'streamy_fan', parts: [{ t: 'text', v: '사운드 분리 어떻게 한 거예요?' }], badge: '멤버' },
    { p: 'soop', nick: '숲속주민', parts: [{ t: 'text', v: 'SOOP에서도 같이 봐요 ㅎㅎ' }], badge: '팬' },
    { p: 'youtube', kind: 'donation', nick: 'Jiwoo', amount: '₩5,000', parts: [{ t: 'text', v: '슈퍼챗 첫 후원!' }] },
    { p: 'soop', kind: 'donation', nick: '별풍요정', amount: '별풍선 100개', parts: [] },
    { p: 'chzzk', kind: 'sub', nick: '정기구독러', amount: '6개월 구독', parts: [{ t: 'text', v: '반년 됐네요' }] },
    { p: 'chzzk', nick: 'ㅇㅇ', parts: [{ t: 'text', v: 'ㅋㅋㅋㅋㅋㅋㅋ' }] },
  ]);
  renderChatState(); if (process.env.STREAMY_TAB) openTab(process.env.STREAMY_TAB);
  if (process.env.STREAMY_TAB === 'sources') {
    renderVtFound([], '');
    $('vtFound').innerHTML = '<span class="vf on"><i></i>VTube Studio · 연결됨</span><span class="vf"><i></i>VSeeFace · 꺼짐</span>';
    renderVirtualProps('VTube Studio', { ...VIRTUAL_DEFAULT, crop: { left: 320, right: 320, top: 0, bottom: 0 } }, 'VTube Studio:UnityWndClass:VTube Studio.exe', 'game');
  }
  upd = { status: 'available', info: { version: '0.6.1', notes: '- 사운드 탭 개선\n- 버그 수정' } }; renderUpdate();
  setInterval(() => { const now = Date.now(); for (const a of demo.live) liveLevels[a.exe.toLowerCase()] = { v: a.peak ? a.peak + Math.sin(now / 120 + a.exe.length) * 0.15 : 0, t: now }; for (const a of demo.sep) liveLevels[a.exe.toLowerCase()] = { v: 0.35 + Math.sin(now / 90) * 0.1, t: now }; }, 100);
}


// ================================================================== 세팅 / ON AIR 화면
function setMode(m, quiet) {
  if (m === mode) return;
  mode = m;
  document.body.classList.toggle('mode-air', m === 'air');
  $('modeSw').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  if (m === 'air') {
    tabBeforeAir = document.querySelector('.tabs button.on')?.dataset.tab || 'stream';
    openTab('chat');
    if (engineOk) { try { engine.clearSelection(); engine.setDrawUI(false); } catch {} renderSources(); }
  } else {
    openTab(tabBeforeAir === 'chat' ? 'stream' : tabBeforeAir);
    if (engineOk) engine.setDrawUI(true);
  }
  layoutDisplay();
  if (!quiet) { cfg.mode = m; save(); }
}
$('modeSw').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });
$('airOnLive').checked = cfg.airOnLive !== false;
$('airOnLive').addEventListener('change', () => { cfg.airOnLive = $('airOnLive').checked; save(); });

// ================================================================== 채팅 기록 (파일 저장)
async function setChatLog(on, quiet) {
  cfg.chatLog = !!on; save();
  try { await ipcRenderer.invoke('chat:log', { on: cfg.chatLog }); } catch (e) { rlog('error', 'chat log', e); }
  $('chatLog').classList.toggle('on', cfg.chatLog); $('chatLog').textContent = cfg.chatLog ? '기록 중' : '기록';
  $('chatLogOn').checked = cfg.chatLog;
  if (!quiet) toast(cfg.chatLog ? '채팅 기록을 시작했어요. 문서 › Streamy Kit › 채팅 로그에 날짜별로 저장돼요.' : '채팅 기록을 껐어요.');
}
$('chatLog').addEventListener('click', () => setChatLog(!cfg.chatLog));
$('chatLogOn').addEventListener('change', () => setChatLog($('chatLogOn').checked));
$('chatLogDir').addEventListener('click', () => ipcRenderer.invoke('chat:log-open'));
$('chatLogDir2').addEventListener('click', () => ipcRenderer.invoke('chat:log-open'));

// ================================================================== 최소화 오버레이
function miniConfigSend() { ipcRenderer.send('mini:config', { ...cfg.mini }); }
function renderMiniSettings() {
  const m = cfg.mini;
  $('miniOn').checked = m.on;
  $('miniOp').value = m.opacity; $('miniOpV').textContent = m.opacity + '%';
  $('miniCount').value = String(m.count);
  $('miniPlat').querySelectorAll('button').forEach((b) => b.classList.toggle('on', m.platforms.includes(b.dataset.p)));
}
$('miniOn').addEventListener('change', () => { cfg.mini.on = $('miniOn').checked; save(); miniConfigSend(); });
$('miniOp').addEventListener('input', () => { cfg.mini.opacity = Number($('miniOp').value); $('miniOpV').textContent = cfg.mini.opacity + '%'; save(); miniConfigSend(); });
$('miniCount').addEventListener('change', () => { cfg.mini.count = Number($('miniCount').value); save(); miniConfigSend(); });
$('miniPlat').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const set = new Set(cfg.mini.platforms); set.has(b.dataset.p) ? set.delete(b.dataset.p) : set.add(b.dataset.p);
  cfg.mini.platforms = [...set]; save(); renderMiniSettings(); miniConfigSend();
});
$('miniTest').addEventListener('click', () => ipcRenderer.send('mini:toggle'));
// 오버레이에 보낼 방송 상태 (1초마다)
function miniState() {
  const live = Object.entries(streamStates).filter(([, s]) => s.state === 'live');
  const any = Object.values(streamStates).some((s) => s.state && s.state !== 'off');
  let st = {}; try { st = engineOk ? engine.stats() : {}; } catch {}
  const total = viewers.chzzk;
  return {
    state: live.length ? 'live' : any ? 'wait' : 'off', label: $('liveText').textContent, time: $('liveTime').textContent,
    platforms: live.map(([k]) => k), viewers: cfg.showViewers && total != null ? total : null,
    kbps: st.kbps != null ? Math.round(st.kbps) : null, drop: st.dropped != null && st.sent ? (st.dropped / Math.max(1, st.sent)) * 100 : null,
    fps: st.fps != null ? Math.round(st.fps) : null, rec: !!(engineOk && engine.recording), scene: engineOk && engine.currentScene ? engine.currentScene.name : (DEMO ? '게임 방송' : ''),
  };
}
setInterval(() => { try { ipcRenderer.send('mini:state', miniState()); } catch {} }, 1000);

// ================================================================== 버추얼: 원클릭 연결 · 자동 감지 · 세부 설정
const VT_TIP = '배경이 안 지워지면: 버추얼 프로그램 설정에서 <b>투명 배경</b>을 켜거나, 아래 배경 처리에서 <b>크로마키</b>를 고르세요.';
function virtualApps() { try { return engineOk ? engine.findVirtualApps() : []; } catch (e) { rlog('warn', 'findVirtualApps', e); return []; } }
function virtualSourceFor(exe) { return engineOk ? engine.virtualSources().find((v) => v.exe === exe) : null; }
function connectVirtual(found, { auto = false } = {}) {
  const exe = exeOf(found.value);
  const have = virtualSourceFor(exe);
  if (have) {
    // 이미 있으면 현재 장면에 없을 때만 넣고, 창을 다시 잡아요
    const inScene = engine.items().find((x) => x.name === have.name);
    if (!inScene) { engine.currentScene.scene.add(engine.sources[have.name].input); engine.applyVirtual(have.name); }
    engine.rehookVirtual(have.name, found.value);
    const it = engine.items().find((x) => x.name === have.name); if (it) engine.select(it.id, 'single');
    saveScenes();
    if (!auto) toast(`${found.app.name}을(를) 다시 연결했어요.`);
    return;
  }
  const r = engine.addSource('virtual', { value: found.value, name: found.app.name, virt: { ...VIRTUAL_DEFAULT, ...(cfg.virtualLast || {}), crop: { ...VIRTUAL_DEFAULT.crop } } });
  saveScenes();
  if (mode !== 'air') openTab('sources');
  toast(`${auto ? '자동으로 ' : ''}${found.app.name}을(를) 화면에 띄웠어요. 위치·크기·배경은 소스 탭에서 바꿀 수 있어요.`);
  return r;
}
function renderVtFound(list, note) {
  const box = $('vtFound');
  const have = engineOk ? engine.virtualSources() : [];
  if (list && list.length > 1) {
    box.innerHTML = list.map((f, i) => `<button class="vf run" data-i="${i}"><i></i>${esc(f.app.name)} 연결</button>`).join('') + '<div class="vf-note">여러 개가 켜져 있어요. 띄울 프로그램을 골라 주세요.</div>';
    box.querySelectorAll('button.vf').forEach((b) => b.addEventListener('click', guard(() => { connectVirtual(list[Number(b.dataset.i)]); renderVtFound(); })));
    return;
  }
  const run = new Set((list || vtLastSeen).map((f) => exeOf(f.value)));
  box.innerHTML = have.map((v) => { const app = appOfExe(v.exe); const on = run.has(v.exe);
    return `<span class="vf ${on ? 'on' : ''}" title="${on ? '연결됨' : '프로그램이 꺼져 있어요'}"><i></i>${esc(app ? app.name : v.name)} · ${on ? '연결됨' : '꺼짐'}</span>`; }).join('')
    + (note ? `<div class="vf-note">${note}</div>` : '');
}
let vtLastSeen = [];
$('vtGo').addEventListener('click', guard(() => {
  if (DEMO) { renderVtFound([], '데모 화면이에요.'); return; }
  const list = virtualApps(); vtLastSeen = list;
  if (!list.length) return renderVtFound([], `켜져 있는 버추얼 프로그램을 찾지 못했어요. 먼저 프로그램을 켜 주세요.<br>지원: ${VIRTUAL_APPS.map((a) => a.name).join(' · ')}<br>목록에 없는 프로그램은 ＋ 추가 → 🧸 버추얼에서 창을 직접 고르면 돼요.`);
  if (list.length > 1) return renderVtFound(list);
  connectVirtual(list[0]); renderVtFound(list);
}));
$('vtAuto').checked = cfg.virtualAuto !== false;
$('vtAuto').addEventListener('change', () => { cfg.virtualAuto = $('vtAuto').checked; save(); });
// 4초마다: 새로 켜진 버추얼 프로그램 → (처음 한 번) 자동으로 띄우기, 껐다 켰으면 다시 잡기
let vtPrev = new Set();
setInterval(() => {
  if (!engineOk || DEMO || !cfg.virtualAuto) return;
  const list = virtualApps(); vtLastSeen = list;
  const now = new Set(list.map((f) => exeOf(f.value)));
  for (const f of list) {
    const exe = exeOf(f.value);
    if (vtPrev.has(exe)) continue;                          // 계속 켜져 있던 건 그대로
    const have = virtualSourceFor(exe);
    if (have) { try { engine.rehookVirtual(have.name, f.value); } catch {} continue; }
    if ((cfg.virtualAutoDone || []).includes(exe)) continue; // 한 번 자동으로 띄웠다가 사용자가 지운 건 다시 안 띄움
    try { connectVirtual(f, { auto: true }); cfg.virtualAutoDone = [...new Set([...(cfg.virtualAutoDone || []), exe])]; save(); } catch (e) { rlog('warn', 'auto virtual', e); }
  }
  vtPrev = now;
  if (document.querySelector('#tab-sources.on')) renderVtFound();
}, 4000);

// 소스 탭에서 버추얼 항목을 골랐을 때 나오는 세부 설정
function virtualPickOptions(cur) {
  let wins = []; try { wins = engineOk ? engine.listProp(engine.resolveType('window') || 'window_capture', 'window') : []; } catch {}
  const known = wins.filter((w) => appOfExe(exeOf(w.value))), rest = wins.filter((w) => !appOfExe(exeOf(w.value)));
  if (cur && !wins.some((w) => w.value === cur)) known.unshift({ name: `${appOfExe(exeOf(cur))?.name || exeOf(cur)} (꺼져 있음)`, value: cur });
  const o = (w) => `<option value="${esc(w.value)}"${w.value === cur ? ' selected' : ''}>${esc(w.name)}</option>`;
  return (known.length ? `<optgroup label="버추얼 프로그램">${known.map(o).join('')}</optgroup>` : '') + (rest.length ? `<optgroup label="다른 창">${rest.map(o).join('')}</optgroup>` : '');
}
function renderVirtualProps(name, v, curWindow, method) {
  const body = $('propsBody');
  const app = appOfExe(exeOf(curWindow));
  const seg = (id, items, val) => `<div class="seg" id="${id}">${items.map(([k, l]) => `<button data-v="${k}" class="${k === val ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const c = v.crop || {};
  body.innerHTML = `<div class="vprops"><h4>🧸 ${esc(name)} <small>버추얼 설정 · 바꾸면 바로 적용돼요</small></h4>
    ${method === 'spout' ? '<div class="vsec"><b>연결</b><p class="hint" style="margin:4px 0 0">Spout2로 받는 중이에요. 버추얼 프로그램에서 Spout2 출력을 켜 주세요.</p></div>'
      : `<div class="vsec"><b>연결할 창</b><div class="row" style="margin:6px 0 0"><select id="vPick">${virtualPickOptions(curWindow)}</select><button class="ghost" id="vRefresh" title="다시 찾기">↻</button></div></div>`}
    <div class="vsec"><b>위치</b>${seg('vSpot', Object.entries(VIRTUAL_SPOTS).map(([k, x]) => [k, x.label]), v.spot)}
      <label class="field" style="margin-top:8px">크기 <b id="vSizeV">${v.size}%</b> <small>(화면 높이 기준)</small><input type="range" id="vSize" min="20" max="120" step="5" value="${v.size}"></label>
      <label class="check" style="margin-top:6px"><input type="checkbox" id="vFlip" ${v.flip ? 'checked' : ''}> 좌우 반전 (거울처럼)</label></div>
    <div class="vsec"><b>배경 처리</b>${seg('vBg', [['transparent', '투명 (추천)'], ['green', '초록 크로마키'], ['blue', '파랑 크로마키'], ['custom', '색 직접 고르기']], v.bg)}
      <div class="vcolor" id="vColorRow" ${v.bg === 'custom' ? '' : 'hidden'}><input type="color" id="vColor" value="${esc(v.color || '#00FF00')}"><small class="hint" style="margin:0">지울 배경색</small></div>
      <p class="hint" style="margin:6px 0 0">${VT_TIP}</p></div>
    <div class="vsec"><b>가장자리 자르기</b> <small class="hint">아바타 옆 빈 공간을 잘라내면 끌기·배치가 편해져요 (픽셀)</small>
      <div class="crop">${[['left', '왼쪽'], ['right', '오른쪽'], ['top', '위'], ['bottom', '아래']].map(([k, l]) => `<label>${l}<input type="number" min="0" max="4000" step="10" data-crop="${k}" value="${c[k] | 0}"></label>`).join('')}</div></div>
    <div class="row"><button id="vAll">모든 장면에 넣기</button><button id="vRehook">다시 잡기</button><button id="vSaveDef" title="다음에 버추얼을 띄울 때 이 위치·크기·배경으로">기본값으로 저장</button></div>
    ${app ? `<p class="hint">${esc(app.name)} 연결됨 · 프로그램을 껐다 켜도 자동으로 다시 잡아요.</p>` : ''}</div>`;
  const set = guard((patch, opts) => { if (DEMO) return; engine.setVirtual(name, patch, opts); saveScenes(); });
  const segBind = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); });
  segBind('vSpot', (k) => set({ spot: k }, { layout: true }));
  segBind('vBg', (k) => { $('vColorRow').hidden = k !== 'custom'; set({ bg: k }, { layout: false }); });
  let szT = 0;
  $('vSize').addEventListener('input', () => { $('vSizeV').textContent = $('vSize').value + '%'; clearTimeout(szT); szT = setTimeout(() => {
    const patch = { size: Number($('vSize').value) };
    if (!DEMO && engine.getVirtual(name)?.spot === 'full') { patch.spot = 'bottom-right'; $('vSpot').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'bottom-right')); }
    set(patch, { layout: true });
  }, 60); });
  $('vFlip').addEventListener('change', () => set({ flip: $('vFlip').checked }, { layout: false }));
  $('vColor')?.addEventListener('change', () => set({ color: $('vColor').value }, { layout: false }));
  body.querySelectorAll('[data-crop]').forEach((inp) => inp.addEventListener('change', () => set({ crop: { [inp.dataset.crop]: Math.max(0, Number(inp.value) || 0) } }, { layout: false })));
  $('vPick')?.addEventListener('change', guard(() => { if (DEMO) return; engine.updateSource(name, 'virtual', { value: $('vPick').value, virt: engine.getVirtual(name) }); saveScenes(); }));
  $('vRefresh')?.addEventListener('click', () => { $('vPick').innerHTML = virtualPickOptions($('vPick').value); });
  $('vAll').addEventListener('click', guard(() => { if (DEMO) return; const n = engine.virtualToAllScenes(name); saveScenes(); toast(n ? `${n}개 장면에 더 넣었어요.` : '이미 모든 장면에 있어요.'); }));
  $('vRehook').addEventListener('click', guard(() => { if (DEMO) return; engine.rehookVirtual(name); toast('창을 다시 잡았어요.'); }));
  $('vSaveDef').addEventListener('click', () => { const cur = DEMO ? v : engine.getVirtual(name); cfg.virtualLast = { spot: cur.spot, size: cur.size, flip: cur.flip, bg: cur.bg, color: cur.color }; save(); toast('다음 버추얼부터 이 설정으로 띄울게요.'); });
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
