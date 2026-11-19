// Streamy Kit — 화면 로직 (v0.8)
'use strict';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { Engine, SOURCE_TYPES, PLATFORMS, ENCODERS, VIRTUAL_APPS, VIRTUAL_SPOTS, VIRTUAL_DEFAULT, VTS_SENDER, appOfExe, exeOf } = require('./engine.js');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const info = ipcRenderer.sendSync('app:info');
const crumb = (a) => { try { ipcRenderer.send('crumb', a); } catch {} };     // 죽기 직전 동작 기록용
const rlog = (level, ...a) => { try { ipcRenderer.send('log', level, ...a.map((x) => (x instanceof Error ? x.stack || x.message : x))); } catch {} };
window.addEventListener('error', (e) => rlog('error', 'window.onerror', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => rlog('error', 'unhandledrejection', e.reason));
const engine = new Engine();
// 엔진 주요 동작은 자동으로 기록 (화면이 죽으면 로그에 마지막 동작이 남음)
for (const fn of ['switchScene', 'addScene', 'removeScene', 'addSource', 'removeItems', 'updateSource', 'addAppAudio', 'removeAudio', 'setAudioDevice', 'setVirtual', 'rehookVirtual', 'startStream', 'stopStream', 'startRecording', 'stopRecording', 'setDrawUI', 'clearSelection', 'select', 'fitItem']) {
  const orig = engine[fn]; if (typeof orig !== 'function') continue;
  engine[fn] = function (...a) { crumb(fn + (typeof a[0] === 'string' || typeof a[0] === 'number' ? ' ' + String(a[0]).slice(0, 30) : '')); return orig.apply(this, a); };
}
// 위치/크기가 바뀌는 동작 뒤에는 편집 가이드를 바로 다시 그림 (끄는 중은 따로 처리)
let geomRaf = 0;
function geomChanged() { if (geomRaf) return; geomRaf = requestAnimationFrame(() => { geomRaf = 0; if (typeof refreshRects === 'function') { refreshRects(); guideDraw(); } }); }
for (const fn of ['fitItem', 'setItemRect', 'setVirtual', 'rehookVirtual', 'updateSource', 'moveItem', 'setVisible', 'renameSource']) {
  const orig = engine[fn]; if (typeof orig !== 'function') continue;
  engine[fn] = function (...a) { const r = orig.apply(this, a); if (!drag) geomChanged(); return r; };
}
let engineOk = false;
const DEMO = !!process.env.STREAMY_DEMO;

// ================================================================== 설정 저장
const DEFAULTS = {
  keys: { chzzk: '', youtube: '', soop: '' }, encoder: 'auto',
  appAudio: [], audioState: {}, devices: {}, showViewers: false, channels: { chzzk: '', youtube: '', soop: '' },
  timer: { mode: 'stopwatch', minutes: 10, label: '', theme: 'red' }, quality: '1080p60',
  mode: 'setup', airOnLive: true, chatLog: false, autoUpdate: true, guide: true, phone: true, phoneOrient: 'v', phoneSplit: { v: 0.28, h: 0.45 },
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
  crumb('tab ' + name);
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
  if (engineOk) {
    const ids = selIds();
    if (ids.length !== 1) { $('propsBody').innerHTML = ''; propsFor = null; }
    else if (propsFor !== ids[0]) {
      showProps();
      if (mode !== 'air' && $('addBox').hidden) { openTab('sources'); document.querySelector('.tab-body').scrollTop = 0; }   // 누르면 그 소스 설정만 바로
    }
  }
  clearTimeout(countT); countT = setTimeout(renderScenes, 150);
});
let countT = 0;
$('srcUp').addEventListener('click', guard(() => { for (const id of selIds()) engine.moveItem(id, 1); saveScenes(); }));
$('srcDown').addEventListener('click', guard(() => { for (const id of selIds().reverse()) engine.moveItem(id, -1); saveScenes(); }));
$('srcDel').addEventListener('click', guard(() => removeSelected()));
document.querySelectorAll('[data-fit]').forEach((b) => b.addEventListener('click', guard(() => {
  const id = engine.primary; if (id == null) return;
  if (b.dataset.fit === 'uncrop') { engine.resetCrop(id); geomChanged(); } else engine.fitItem(id, b.dataset.fit);
  updateSizeLabel(); saveScenes();
})));
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
  if (!box.hidden) { openTab('sources'); document.querySelector('.tab-body').scrollTop = 0; }
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
// 변 가운데 손잡이 (자르기): l · r · t · b
function edgeAt(rect, p) {
  const tol = 13 * p.px;
  const es = { l: [rect.x, rect.y + rect.h / 2], r: [rect.x + rect.w, rect.y + rect.h / 2], t: [rect.x + rect.w / 2, rect.y], b: [rect.x + rect.w / 2, rect.y + rect.h] };
  for (const [k, [x, y]] of Object.entries(es)) if (Math.abs(p.x - x) <= tol * (k === 't' || k === 'b' ? 1.6 : 1) && Math.abs(p.y - y) <= tol * (k === 'l' || k === 'r' ? 1.6 : 1)) return k;
  return null;
}
function snap(v, size, total, tol, out, axis) {
  const ts = [[0, 0], [total / 2 - size / 2, total / 2], [total - size, total]];
  for (const [t, line] of ts) if (Math.abs(v - t) < tol) { if (out) out.push({ axis, at: line }); return t; }
  return v;
}

// ================================================================== 편집 가이드 (미리보기 위 투명 창에 테두리 · 손잡이 · 크기 · 안내)
let ovOk = false, hoverId = null, snapLines = [], guideRaf = 0;
// 소스 위치 캐시: 마우스를 움직일 때마다 엔진에 묻지 않도록 (엔진 호출을 크게 줄임)
let rects = [], rectsT = 0;      // [{ id, name, icon, sel, x, y, w, h }] (캔버스 좌표, 위에 있는 것부터)
function refreshRects() {
  rectsT = Date.now();
  if (!engineOk) { rects = []; return; }
  const out = [];
  try {
    for (const x of engine.items()) {
      if (!x.visible) continue;
      const it = engine.itemObj(x.id); if (!it) continue;
      const r = engine.itemRect(it); if (!(r.w > 0 && r.h > 0)) continue;
      out.push({ id: x.id, name: x.name, icon: x.icon, x: r.x, y: r.y, w: r.w, h: r.h });
    }
  } catch (e) { rlog('warn', 'refreshRects', e); }
  rects = out;
}
function cachedHit(cx, cy) { return rects.find((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) || null; }
function updateRect(id) {        // 끄는 중에는 그 소스만 다시 읽음
  const c = rects.find((r) => r.id === id); if (!c) return;
  try { const it = engine.itemObj(id); if (it) { const r = engine.itemRect(it); Object.assign(c, { x: r.x, y: r.y, w: r.w, h: r.h }); } } catch {}
}
function viewMap() {
  const r = prev.getBoundingClientRect(), z = window.devicePixelRatio || 1;
  const pr = engine.previewRect(r.width * z, r.height * z);
  return { s: pr.w / (engine.width * z), ox: pr.x / z, oy: pr.y / z };
}
function guideData() {
  if (!engineOk || mode === 'air') return { items: [] };
  const m = viewMap(), items = [];
  const selId = engine.sel.size === 1 ? engine.primary : null;
  for (const r of rects.slice().reverse()) {                     // 아래(뒤)부터 그림
    const state = engine.sel.has(r.id) ? 'sel' : r.id === hoverId ? 'hover' : 'norm';
    items.push({ x: m.ox + r.x * m.s, y: m.oy + r.y * m.s, w: r.w * m.s, h: r.h * m.s, name: `${r.icon} ${r.name}`, state });
  }
  let size = '', hint = '';
  const sr = selId != null ? rects.find((r) => r.id === selId) : null;
  if (sr) size = `${Math.round(sr.w)} × ${Math.round(sr.h)} · ${Math.round((sr.w / engine.width) * 100)}%`;
  if (drag) hint = drag.mode === 'move' ? '놓으면 그 자리에 저장돼요 · Alt = 자석 끄기' : drag.mode === 'crop' ? '화면 자르는 중 · 되돌리려면 아래 "자르기 초기화"' : '비율을 유지하면서 크기 조절 중 · Alt = 자석 끄기';
  else if (selId != null) hint = '안쪽 = 이동 · 모서리 □ = 크기 · 변 가운데 ▬ = 자르기 · 방향키 1px (Shift 10px)';
  else if (items.length) hint = '소스를 클릭하면 옮기고 크기를 바꿀 수 있어요';
  const guides = snapLines.map((l) => (l.axis === 'x'
    ? { x1: m.ox + l.at * m.s, y1: m.oy, x2: m.ox + l.at * m.s, y2: m.oy + engine.height * m.s }
    : { x1: m.ox, y1: m.oy + l.at * m.s, x2: m.ox + engine.width * m.s, y2: m.oy + l.at * m.s }));
  return { items, guides, size, hint };
}
function guideDraw() {
  if (guideRaf) return;
  guideRaf = requestAnimationFrame(() => { guideRaf = 0; try { ipcRenderer.send('ov:draw', { ...guideData(), color: cfg.themeDark ? ['#8B7CF6', '#B3A9FA', 'rgba(139,124,246,.12)'] : ['#6B5CE7', '#9A8FF5', 'rgba(107,92,231,.10)'] }); } catch (e) { rlog('warn', 'guide', e); } });
}
function guideShow() {
  const on = engineOk && mode !== 'air' && cfg.guide !== false;
  ipcRenderer.send('ov:show', on);
  if (engineOk) engine.setDrawUI(mode !== 'air' && !(ovOk && on));      // 가이드를 못 쓰면 엔진 기본 선택 표시로
  guideDraw();
}
ipcRenderer.on('ov:ready', () => { ovOk = true; guideShow(); });
$('guideOn').checked = cfg.guide !== false;
$('guideOn').addEventListener('change', () => { cfg.guide = $('guideOn').checked; save(); guideShow(); });
ipcRenderer.on('ov:lost', () => { ovOk = false; guideShow(); });
engine.on('items', () => { refreshRects(); guideDraw(); });
// 게임 캡처처럼 크기가 나중에 바뀌는 소스가 있어서 2초마다 한 번 새로 읽음 (세팅 화면에서만)
setInterval(() => { if (engineOk && mode !== 'air' && !drag && Date.now() - rectsT > 1800) { refreshRects(); guideDraw(); } }, 2000);
prev.addEventListener('mousedown', (e) => {
  if (!engineOk || e.button !== 0 || mode === 'air') return;
  try {
    const p = toCanvas(e), selId = engine.sel.size === 1 ? engine.primary : null;
    if (selId != null) {
      const it = engine.itemObj(selId);
      if (it) {
        const ir = engine.itemRect(it);
        const c = cornerAt(ir, p);
        if (c) { const r = engine.normalize(selId); if (!r || r.w <= 0) return; crumb('drag resize start'); drag = { mode: 'resize', id: selId, corner: c, start: r, p0: p }; e.preventDefault(); return; }
        const ed = edgeAt(ir, p);
        if (ed) {
          const r = engine.normalize(selId); if (!r || r.w <= 0 || !r.sw) return;
          crumb('drag crop start ' + ed);
          drag = { mode: 'crop', id: selId, side: ed, start: r, p0: p, crop0: engine.getCrop(selId), full: engine.srcSize(selId), k: r.w / r.sw, flip: engine.itemObj(selId).scale.x < 0 };
          e.preventDefault(); return;
        }
      }
    }
    const hit = engine.hitTest(p.x, p.y);
    if (!hit) { engine.clearSelection(); engine.emit('items'); return; }
    if (e.ctrlKey) { engine.select(hit.id, 'toggle'); return; }
    if (!engine.sel.has(hit.id) || engine.sel.size > 1) engine.select(hit.id, 'single');
    crumb('drag move start'); drag = { mode: 'move', id: hit.id, start: engine.normalize(hit.id), p0: p };
    e.preventDefault();
  } catch (err) { rlog('error', 'mousedown', err); }
});
let hoverT = 0;
window.addEventListener('mousemove', (e) => {
  if (!engineOk) return;
  if (!drag) {
    const now = Date.now(); if (now - hoverT < 60) return; hoverT = now;
    let cls = '', hov = null;
    const selId = engine.sel.size === 1 ? engine.primary : null;
    if (e.target === prev && mode !== 'air') {
      try {
        const p = toCanvas(e);
        const sr = selId != null ? rects.find((r) => r.id === selId) : null;
        const c = sr ? cornerAt(sr, p) : null;
        const ed = sr && !c ? edgeAt(sr, p) : null;
        if (c) cls = c === 'tl' || c === 'br' ? 'c-nwse' : 'c-nesw';
        else if (ed) cls = ed === 'l' || ed === 'r' ? 'c-ew' : 'c-ns';
        else { const h = cachedHit(p.x, p.y); if (h) { cls = 'c-move'; hov = h.id; } }
      } catch {}
    }
    prev.className = 'preview has-engine ' + cls;
    if (hov !== hoverId) { hoverId = hov; guideDraw(); }
    return;
  }
  const p = toCanvas(e);
  const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y, s = drag.start, tol = 12 * p.px;
  if (!s) return;
  snapLines = [];
  if (drag.mode === 'crop') {
    // 안쪽으로 끈 만큼(원본 픽셀) 그 변을 자름. 좌우 반전이면 화면 왼쪽 = 원본 오른쪽
    const { side, crop0, full, k, flip } = drag;
    const d = side === 'l' ? dx : side === 'r' ? -dx : side === 't' ? dy : -dy;
    const field = side === 'l' ? (flip ? 'right' : 'left') : side === 'r' ? (flip ? 'left' : 'right') : side === 't' ? 'top' : 'bottom';
    const opp = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[field];
    const max = (field === 'left' || field === 'right' ? full.w : full.h) - crop0[opp] - 8;
    const v = Math.max(0, Math.min(max, crop0[field] + d / k));
    const moved = (v - crop0[field]) * k;                          // 화면에서 그 변이 움직인 거리
    const crop = { ...crop0, [field]: v };
    pending = { id: drag.id, crop, x: side === 'l' ? s.x + moved : s.x, y: side === 't' ? s.y + moved : s.y, k };
    const w = s.w - (side === 'l' || side === 'r' ? moved : 0), h = s.h - (side === 't' || side === 'b' ? moved : 0);
    $('selSize').textContent = `${Math.round(w)} × ${Math.round(h)} · 자르는 중`;
  } else if (drag.mode === 'move') {
    let x = s.x + dx, y = s.y + dy;
    if (!e.altKey) { x = snap(x, s.w, engine.width, tol, snapLines, 'x'); y = snap(y, s.h, engine.height, tol, snapLines, 'y'); }
    pending = { id: drag.id, x, y, w: null };
  } else {
    const left = drag.corner.includes('l'), top = drag.corner.includes('t');
    const ax = left ? s.x + s.w : s.x, ay = top ? s.y + s.h : s.y;
    const sx = left ? -1 : 1, sy = top ? -1 : 1, ratio = s.w / s.h;
    let w = Math.max(16, s.w + sx * dx), h = Math.max(16, s.h + sy * dy);
    if (w / h > ratio) h = w / ratio; else w = h * ratio;
    if (!e.altKey) { const ex = ax + sx * w; for (const t of [0, engine.width]) if (Math.abs(ex - t) < tol) { w = Math.abs(t - ax); h = w / ratio; snapLines.push({ axis: 'x', at: t }); } }
    pending = { id: drag.id, x: left ? ax - w : ax, y: top ? ay - h : ay, w };
    $('selSize').textContent = `${Math.round(w)} × ${Math.round(h)} · ${Math.round((w / engine.width) * 100)}%`;
  }
  if (!raf) raf = requestAnimationFrame(() => {
    raf = 0; if (!pending) return;
    const id = pending.id;
    try { if (pending.crop) engine.setCropPlace(id, pending.crop, pending.x, pending.y, pending.k); else engine.setItemRect(id, pending.x, pending.y, pending.w); } catch {}
    pending = null; updateRect(id); guideDraw();
  });
});
window.addEventListener('mouseup', () => { if (drag) { crumb(`drag end ${drag.mode}`); drag = null; snapLines = []; updateSizeLabel(); saveScenes(); refreshRects(); guideDraw(); } });
// 미리보기 · 소스 목록 · 소스 설정 말고 아무 데나 누르면 선택 풀기 (빨간 테두리 없어짐)
document.addEventListener('mousedown', (e) => {
  if (!engineOk || e.button !== 0 || !engine.sel.size || drag) return;
  if (e.target.closest('#preview, #sourceList, #propsBody, #editBar, .src-tools, #addBox, .vt-card, .vts-card, .rail, #tab-sources')) return;
  crumb('click outside → deselect'); engine.clearSelection(); engine.emit('items');
}, true);
prev.addEventListener('mouseleave', () => { if (!drag && hoverId != null) { hoverId = null; guideDraw(); } });
window.addEventListener('keydown', (e) => {
  if (!engineOk || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const n = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'].indexOf(e.key);
  if (n >= 0 && engine.scenes[n]) { e.preventDefault(); engine.switchScene(engine.scenes[n].id); saveScenes(); return; }
  if (mode === 'air') return;     // ON AIR 화면에서는 소스 이동/삭제 단축키 막기
  if (e.key === 'Delete' && engine.sel.size) { removeSelected(); return; }
  if (e.key === 'Escape') { engine.clearSelection(); engine.emit('items'); return; }
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
    bindChannelDrag(row, a);
    box.appendChild(row);
    meterEls[a.name] = { row, lvl: row.querySelector('.lvl'), pk: row.querySelector('.pkw'), shown: 0, peak: 0, peakT: 0, drawn: -1, drawnPk: -1 };
  }
}
engine.on('audio', () => { renderMixer(); renderApps(true); });
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
let tabBeforeSound = 'stream';
$('soundGear').addEventListener('click', () => { tabBeforeSound = document.querySelector('.tabs button.on')?.dataset.tab || 'stream'; openTab('sound'); });
$('soundBack').addEventListener('click', () => openTab(tabBeforeSound));

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
// 켜져 있는 프로그램 = 창 목록(도우미) + 소리 내는 프로그램(오디오 세션). 실행 파일 기준으로 하나씩
let openWins = [];          // [{ exe, title, cls, value }]
const HIDE_EXE = /^(streamy kit|obs64|audiodg|explorer|applicationframehost|textinputhost|shellexperiencehost|searchhost|startmenuexperiencehost|lockapp|systemsettings|ctfmon|dwm)\.exe$/i;
function runningApps() {
  if (DEMO) return demo.live.concat([{ exe: 'Discord.exe', desc: '디스코드' }, { exe: 'chrome.exe', desc: 'Google Chrome' }, { exe: 'VTube Studio.exe', desc: 'VTube Studio' }]);
  const m = new Map();
  for (const w of openWins) { const k = w.exe.toLowerCase(); if (HIDE_EXE.test(w.exe) || m.has(k)) continue; m.set(k, { exe: w.exe, title: w.title }); }
  for (const a of Object.values(liveSeen)) { const k = a.exe.toLowerCase(); if (HIDE_EXE.test(a.exe)) continue; m.set(k, { ...(m.get(k) || {}), exe: a.exe, desc: a.desc || (m.get(k) || {}).desc, title: (m.get(k) || {}).title || a.title }); }
  return [...m.values()];
}
// 이름: 오디오 세션 이름 → 알려진 프로그램 → 창 제목 끝부분(" - Chrome" 같은) → 실행 파일 이름
const NICE = { 'chrome.exe': 'Google Chrome', 'msedge.exe': 'Microsoft Edge', 'whale.exe': '네이버 웨일', 'firefox.exe': 'Firefox', 'discord.exe': '디스코드', 'kakaotalk.exe': '카카오톡', 'spotify.exe': 'Spotify', 'melon.exe': '멜론', 'steam.exe': 'Steam', 'vtube studio.exe': 'VTube Studio', 'code.exe': 'VS Code', 'leagueclientux.exe': '리그 오브 레전드', 'league of legends.exe': '리그 오브 레전드 (게임)' };
function niceName(a) { return (a.desc && !/\.exe$/i.test(a.desc) ? a.desc : NICE[a.exe.toLowerCase()] || (a.title && a.title.length < 40 ? a.title : a.exe.replace(/\.exe$/i, ''))).slice(0, 30); }
function renderApps(force) {
  const box = $('appGrid'); if (!box) return;
  const sep = new Set((engineOk ? engine.appAudioList() : DEMO ? demo.sep : []).map((x) => (x.exe || '').toLowerCase()));
  const items = runningApps().sort((a, b) => niceName(a).localeCompare(niceName(b), 'ko'));
  const sig = items.map((a) => a.exe + (sep.has(a.exe.toLowerCase()) ? '+' : '')).join('|');
  if (!force && box.dataset.sig === sig && box.children.length) return;    // 같으면 다시 안 그림 (끌기 중 깜빡임 방지)
  box.dataset.sig = sig; box.innerHTML = '';
  if (!items.length) { box.innerHTML = `<div class="empty">${engineOk || DEMO ? '켜져 있는 프로그램을 찾는 중…' : '엔진이 준비되면 보여요'}</div>`; return; }
  for (const a of items) {
    const on = sep.has(a.exe.toLowerCase()), label = niceName(a);
    const c = document.createElement('div');
    c.className = 'acard' + (on ? ' in' : ''); c.draggable = !on; c.dataset.exe = a.exe;
    c.title = on ? '이미 사운드에 있어요' : '끌어서 아래 사운드 칸에 놓기 (더블클릭해도 돼요)';
    c.innerHTML = `<div class="lv"></div><span class="ava">${esc(label.slice(0, 1).toUpperCase())}</span><div class="nm">${esc(label)}<small>${on ? '<b class="tag">✓ 사운드에 있음</b>' : esc(a.exe)}</small></div>`;
    if (!on) {
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-streamy-app', JSON.stringify({ exe: a.exe, label })); e.dataTransfer.effectAllowed = 'copy'; c.classList.add('dragging'); document.body.classList.add('drag-app'); });
      c.addEventListener('dragend', () => { c.classList.remove('dragging'); document.body.classList.remove('drag-app'); });
      c.addEventListener('dblclick', () => addSep(a.exe, label));
    }
    box.appendChild(c);
  }
}
function renderLiveApps() { renderApps(); }
function renderSepApps() { renderApps(true); }
const addSep = guard((exe, label) => {
  if (DEMO) return toast(`'${label}' 소리를 따로 잡았어요 (데모)`);
  engine.addAppAudio(exe, label); saveAudioState(); renderApps(true);
  toast(`'${label}' 소리를 따로 잡았어요. 사운드 칸에서 볼륨을 조절하세요.`);
});
ipcRenderer.on('windows', (_e, data) => {
  if (!Array.isArray(data)) { if (data && data.error) rlog('warn', 'windows', data.error); return; }
  openWins = data;
  if (soundOpen) renderApps();
  virtualTick();
});
// 사운드 칸: 프로그램을 놓으면 넣기 / 막대를 끌어서 밖에 놓으면 빼기
const soundBox = document.querySelector('.sound');
let chDrag = null;          // 끌고 있는 사운드 막대 { name, label }
soundBox.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('application/x-streamy-app')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; soundBox.classList.add('drop-on'); }
  else if (chDrag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
});
soundBox.addEventListener('dragleave', (e) => { if (!soundBox.contains(e.relatedTarget)) soundBox.classList.remove('drop-on'); });
soundBox.addEventListener('drop', (e) => {
  soundBox.classList.remove('drop-on');
  const raw = e.dataTransfer.getData('application/x-streamy-app');
  if (raw) { e.preventDefault(); let d = null; try { d = JSON.parse(raw); } catch {} if (d) addSep(d.exe, d.label); return; }
  if (chDrag) { e.preventDefault(); chDrag.keep = true; }       // 사운드 칸 안에 다시 놓음 → 그대로
});
// 막대를 끄는 중에는 어디든 놓을 수 있게 (놓은 곳이 사운드 칸 밖이면 빼기)
document.addEventListener('dragover', (e) => { if (chDrag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
document.addEventListener('drop', (e) => { if (chDrag && !soundBox.contains(e.target)) e.preventDefault(); });
function bindChannelDrag(row, a) {
  if (a.kind !== 'app') return;
  const h = row.querySelector('.nm');
  h.draggable = true; h.classList.add('grab'); h.title = '끌어서 사운드 칸 밖에 놓으면 빠져요';
  h.addEventListener('dragstart', (e) => {
    chDrag = { name: a.name, label: a.label, keep: false };
    e.dataTransfer.setData('application/x-streamy-ch', a.name); e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging'); document.body.classList.add('drag-ch');
  });
  h.addEventListener('dragend', () => {
    const d = chDrag; chDrag = null;
    row.classList.remove('dragging'); document.body.classList.remove('drag-ch');
    if (!d || d.keep) return;
    guard(() => { if (DEMO) return toast(`'${d.label}'을(를) 뺐어요 (데모)`); engine.removeAudio(d.name); saveAudioState(); renderApps(true); toast(`'${d.label}' 소리를 사운드에서 뺐어요.`); })();
  });
}
function renderDevices() {
  if (!engineOk) { for (const id of ['devDesktop', 'devMic']) $(id).innerHTML = '<option>엔진 준비 중</option>'; return; }
  for (const [sel, name, kind] of [['devDesktop', '데스크톱 소리', 'desktop'], ['devMic', '마이크', 'mic']]) {
    const el = $(sel); el.innerHTML = optionList(engine.audioDevices(kind), '장치 없음');
    const opts = [...el.options].map((o) => o.value);
    el.value = opts.includes(cfg.devices[kind]) ? cfg.devices[kind] : opts.includes('default') ? 'default' : (opts[0] || '');
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
  try { phoneChat(list); } catch {}
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
  $('updCur').textContent = 'Streamy Kit v' + info.version + (info.patch ? ` (설치 v${info.baseVersion} + 빠른 업데이트)` : '');
  $('updStatus').textContent = { idle: '확인 전', checking: '확인하는 중…', latest: '최신 버전이에요', available: `새 버전 v${v}이(가) 있어요`, downloading: `v${v} 받는 중… ${upd.progress || 0}%`, ready: `v${v} 설치 준비 완료`, error: upd.error || '확인 실패' }[upd.status] || '';
  if (upd.error && upd.status === 'available') $('updStatus').textContent = upd.error;
  if (upd.checkedAt && ['latest', 'idle'].includes(upd.status)) {
    const t = new Date(upd.checkedAt);
    $('updStatus').textContent += ` · GitHub 마지막 확인 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` + (upd.remoteLatest ? ` (최신 v${upd.remoteLatest})` : '');
  }
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
  if (st.status === 'available' && was !== 'available' && !st.error) {
    if (cfg.autoUpdate !== false && !DEMO && st.info && (st.info.local || st.info.remote)) doUpdate(true);     // 바탕화면 폴더 · GitHub 릴리즈 → 바로 적용
    else toast(`새 버전 v${st.info.version}이(가) 나왔어요. 위쪽 업데이트 버튼을 누르세요.`);
  }
  if (st.status === 'latest' && st.manual) toast('지금 최신 버전이에요.');
  if (st.status === 'error' && st.manual) toast(st.error, true);
});
let updBusy = false, updPending = false;
async function doUpdate(auto = false) {
  if (upd.status === 'downloading' || updBusy) return;
  if (engine.streaming || engine.recording) {
    if (auto) { if (!updPending) toast(`v${upd.info.version} 업데이트는 방송·녹화가 끝나면 바로 적용할게요.`); updPending = true; return; }
    return toast(engine.streaming ? '방송 중에는 업데이트할 수 없어요. 방송을 끝낸 뒤 눌러 주세요.' : '녹화 중에는 업데이트할 수 없어요.', true);
  }
  const v = upd.info && upd.info.version; if (!v) return;
  const quick = upd.info.kind === 'patch';
  if (!auto) {
    const r = await ipcRenderer.invoke('app:confirm', { title: '업데이트', message: `Streamy Kit v${v}로 업데이트할까요?` + (quick ? ' (빠른 업데이트)' : ''), detail: quick ? '몇 초 동안 껐다 켜져요. 장면과 설정은 그대로예요.' : '설치하는 동안 잠깐 꺼졌다가 자동으로 다시 켜져요. 장면과 설정은 그대로 유지돼요.', buttons: ['업데이트', '나중에'] });
    if (r !== 0) return;
  }
  updBusy = true; updPending = false;
  try {
    toast(quick ? `v${v} 적용 중… 몇 초 뒤 다시 켜져요.` : `v${v} 설치 파일을 준비하는 중…`);
    await ipcRenderer.invoke('update:download');
    if (!quick) toast('윈도우가 허용을 물어보면 "예"를 눌러 주세요. 끝나면 자동으로 다시 켜져요.');
    await ipcRenderer.invoke('update:install');
  } catch (e) { toast('업데이트 실패: ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  finally { updBusy = false; }
}
$('updAuto').checked = cfg.autoUpdate !== false;
$('updAuto').addEventListener('change', () => { cfg.autoUpdate = $('updAuto').checked; save(); if (cfg.autoUpdate && upd.status === 'available') doUpdate(true); });
// 방송·녹화가 끝나면 미뤄 둔 업데이트 적용
setInterval(() => { if (updPending && !DEMO && !engine.streaming && !engine.recording && ['available', 'ready'].includes(upd.status)) doUpdate(true); }, 3000);
$('updBtn').addEventListener('click', () => doUpdate(false));
// 상단 ↻ 업데이트 확인: 누르면 바로 확인 → 새 버전이면 (자동 적용 켜져 있으면) 바로 적용
$('updCheckTop').addEventListener('click', async () => {
  const b = $('updCheckTop'); if (b.classList.contains('busy')) return;
  if (['available', 'ready'].includes(upd.status)) return doUpdate(false);
  b.classList.add('busy'); b.querySelector('em').textContent = '확인 중…';
  try { await ipcRenderer.invoke('update:check'); } catch (e) { toast('업데이트 확인 실패: ' + (e.message || e), true); }
  b.classList.remove('busy');
  const latest = upd.status === 'latest';
  b.querySelector('em').textContent = latest ? '최신이에요' : '업데이트 확인';
  if (latest) { b.classList.add('ok'); setTimeout(() => { b.classList.remove('ok'); b.querySelector('em').textContent = '업데이트 확인'; }, 2500); }
});
$('updFolder').addEventListener('click', () => ipcRenderer.invoke('update:folder'));
$('updCheck').addEventListener('click', async () => {
  if (upd.status === 'available' || upd.status === 'ready') return doUpdate(false);
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
    ipcRenderer.send('ov:rect', { x: r.left, y: r.top, width: r.width, height: r.height });
    guideDraw(); phoneLayout();
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
    layoutDisplay(); guideShow(); phoneSync();
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
  audio: [{ name: 'd', label: '데스크톱 소리', vol: 0.8, muted: false }, { name: 'm', label: '마이크', vol: 0.72, muted: false }, { name: 'dc', label: '디스코드', vol: 0.55, muted: false, kind: 'app' }, { name: 'ch', label: 'Google Chrome', vol: 0.4, muted: false, kind: 'app' }],
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
    if (engineOk) { try { engine.clearSelection(); } catch {} renderSources(); }
  } else {
    openTab(tabBeforeAir === 'chat' ? 'stream' : tabBeforeAir);
  }
  guideShow();
  phoneSync();
  layoutDisplay();
  if (!quiet) { cfg.mode = m; save(); }
}
$('modeSw').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });
// 화면 테마: 기본 = 밝은 카드, 설정에서 예전 검정·빨강
function applyTheme() { document.body.classList.toggle('theme-dark', !!cfg.themeDark); $('themeDark').checked = !!cfg.themeDark; if (typeof guideDraw === 'function') guideDraw(); }
$('themeDark').addEventListener('change', () => { cfg.themeDark = $('themeDark').checked; save(); applyTheme(); });
applyTheme();
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
function virtualApps() {
  const out = [], seen = new Set();
  for (const w of openWins) { const app = appOfExe(w.exe); if (!app || seen.has(app.id)) continue; seen.add(app.id); out.push({ app, value: w.value, title: w.title }); }
  return out;
}
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
  // VTube Studio는 Spout2로 받기 (설정에서 끌 수 있음)
  const spout = found.app.id === 'vts' && cfg.vtsSpout !== false && engine.types().some((t) => t.startsWith('spout_capture'));
  const virt = { ...VIRTUAL_DEFAULT, ...(cfg.virtualLast || {}), crop: { ...VIRTUAL_DEFAULT.crop } };
  if (spout) Object.assign(virt, { method: 'spout', sender: VTS_SENDER, exe: exe, composite: cfg.vtsComposite || 3 });
  const r = engine.addSource('virtual', { value: found.value, name: found.app.name, virt });
  saveScenes();
  if (mode !== 'air') openTab('sources');
  toast(`${auto ? '자동으로 ' : ''}${found.app.name}을(를) 화면에 띄웠어요.` + (spout ? ' (Spout2) 화면이 비어 있으면 VTube Studio 설정에서 Spout2 출력을 켜 주세요.' : ' 위치·크기·배경은 소스 탭에서 바꿀 수 있어요.'));
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
  openWins = ipcRenderer.sendSync('windows:get') || openWins;
  const list = virtualApps(); vtLastSeen = list;
  if (!list.length) return renderVtFound([], `켜져 있는 버추얼 프로그램을 찾지 못했어요. 먼저 프로그램을 켜 주세요.<br>지원: ${VIRTUAL_APPS.map((a) => a.name).join(' · ')}<br>목록에 없는 프로그램은 ＋ 추가 → 🧸 버추얼에서 창을 직접 고르면 돼요.`);
  if (list.length > 1) return renderVtFound(list);
  connectVirtual(list[0]); renderVtFound(list);
}));
$('vtAuto').checked = cfg.virtualAuto !== false;
$('vtAuto').addEventListener('change', () => { cfg.virtualAuto = $('vtAuto').checked; save(); });
// 창 목록이 올 때마다(2초): 새로 켜진 버추얼 프로그램 → (처음 한 번) 자동으로 띄우기, 껐다 켰으면 다시 잡기
let vtPrev = null;
function virtualTick() {
  if (!engineOk || DEMO) return;
  const list = virtualApps(); vtLastSeen = list;
  const now = new Set(list.map((f) => exeOf(f.value)));
  if (vtPrev === null) vtPrev = new Set();
  if (cfg.virtualAuto) for (const f of list) {
    const exe = exeOf(f.value);
    if (vtPrev.has(exe)) continue;                          // 계속 켜져 있던 건 그대로
    const have = virtualSourceFor(exe);
    if (have) { try { engine.rehookVirtual(have.name, f.value); } catch {} continue; }
    if ((cfg.virtualAutoDone || []).includes(exe)) continue; // 한 번 자동으로 띄웠다가 사용자가 지운 건 다시 안 띄움
    try { connectVirtual(f, { auto: true }); cfg.virtualAutoDone = [...new Set([...(cfg.virtualAutoDone || []), exe])]; save(); } catch (e) { rlog('warn', 'auto virtual', e); }
  }
  vtPrev = now;
  if (document.querySelector('#tab-sources.on')) renderVtFound();
}

// 소스 탭에서 버추얼 항목을 골랐을 때 나오는 세부 설정
function virtualPickOptions(cur) {
  const wins = openWins.filter((w) => !HIDE_EXE.test(w.exe)).map((w) => ({ name: `[${w.exe}] ${w.title}`.slice(0, 70), value: w.value }));
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
    ${method === 'spout' ? `<div class="vsec"><b>연결 · Spout2</b>
        <div class="row" style="margin:6px 0 0"><select id="vSender">${[[v.sender || 'usefirstavailablesender'], [VTS_SENDER], ['usefirstavailablesender']].filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i).map(([k]) => `<option value="${esc(k)}"${k === (v.sender || 'usefirstavailablesender') ? ' selected' : ''}>${k === 'usefirstavailablesender' ? '처음 보이는 Spout2 화면' : k === VTS_SENDER ? 'VTube Studio (VTubeStudioSpout)' : esc(k)}</option>`).join('')}</select>
        <select id="vComposite" title="가장자리가 검게/하얗게 보이면 바꿔 보세요"><option value="3"${(v.composite || 3) == 3 ? ' selected' : ''}>투명도: 기본</option><option value="4"${v.composite == 4 ? ' selected' : ''}>투명도: 미리 곱한 알파</option><option value="1"${v.composite == 1 ? ' selected' : ''}>투명도: 끔</option></select></div>
        <p class="hint" style="margin:6px 0 0">VTube Studio 설정(⚙) → 카메라 설정에서 <b>Spout2 출력</b>을 켜고, 배경을 <b>투명</b>으로 두세요. 가장자리가 검게 나오면 투명도 방식을 바꿔 보세요.</p></div>`
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
  const spoutSet = guard(() => { if (DEMO) return; const vv = engine.getVirtual(name); vv.sender = $('vSender').value; vv.composite = Number($('vComposite').value); cfg.vtsComposite = vv.composite; save(); engine.updateSource(name, 'virtual', { virt: vv }); saveScenes(); });
  $('vSender')?.addEventListener('change', spoutSet); $('vComposite')?.addEventListener('change', spoutSet);
  $('vPick')?.addEventListener('change', guard(() => { if (DEMO) return; engine.updateSource(name, 'virtual', { value: $('vPick').value, virt: engine.getVirtual(name) }); saveScenes(); }));
  $('vRefresh')?.addEventListener('click', () => { openWins = ipcRenderer.sendSync('windows:get') || openWins; $('vPick').innerHTML = virtualPickOptions($('vPick').value); });
  $('vAll').addEventListener('click', guard(() => { if (DEMO) return; const n = engine.virtualToAllScenes(name); saveScenes(); toast(n ? `${n}개 장면에 더 넣었어요.` : '이미 모든 장면에 있어요.'); }));
  $('vRehook').addEventListener('click', guard(() => { if (DEMO) return; engine.rehookVirtual(name); toast('창을 다시 잡았어요.'); }));
  $('vSaveDef').addEventListener('click', () => { const cur = DEMO ? v : engine.getVirtual(name); cfg.virtualLast = { spot: cur.spot, size: cur.size, flip: cur.flip, bg: cur.bg, color: cur.color }; save(); toast('다음 버추얼부터 이 설정으로 띄울게요.'); });
}


// ================================================================== 방송 정보: 치지직 · 유튜브 제목/태그/설명/카테고리
const BC_NAME = { chzzk: '치지직', youtube: '유튜브' };
const BC_HELP = {
  chzzk: `<b>치지직 앱 만들기 (한 번만)</b><ol>
    <li><a href="#" data-url="https://developers.chzzk.naver.com/">치지직 개발자 센터</a>에 로그인 → <b>애플리케이션 등록</b></li>
    <li><b>로그인 리디렉션 URL</b>에 아래 주소를 그대로 넣기</li>
    <li>API 권한에서 <b>방송 설정 조회</b> · <b>방송 설정 변경</b> · <b>유저 정보 조회</b> 체크</li>
    <li>만들어진 <b>Client ID</b> · <b>Client Secret</b>을 아래 칸에 붙여 넣기</li></ol>`,
  youtube: `<b>유튜브(구글) 앱 만들기 (한 번만)</b><ol>
    <li><a href="#" data-url="https://console.cloud.google.com/projectcreate">구글 클라우드 콘솔</a>에서 새 프로젝트 만들기</li>
    <li><a href="#" data-url="https://console.cloud.google.com/apis/library/youtube.googleapis.com">YouTube Data API v3</a> → <b>사용</b></li>
    <li><a href="#" data-url="https://console.cloud.google.com/auth/overview">OAuth 동의 화면</a> 만들기 (외부, 테스트 사용자에 내 구글 계정 추가)</li>
    <li><a href="#" data-url="https://console.cloud.google.com/apis/credentials">사용자 인증 정보</a> → OAuth 클라이언트 ID → 유형 <b>데스크톱 앱</b></li>
    <li>만들어진 <b>클라이언트 ID</b> · <b>보안 비밀번호</b>를 아래 칸에 붙여 넣기</li></ol>`,
};
let bcSt = null, bcOpen = '';
const bcInvoke = async (ch, ...a) => { if (DEMO) return { ok: false, error: '데모 화면이에요.' }; try { return await ipcRenderer.invoke(ch, ...a); } catch (e) { return { ok: false, error: e.message }; } };
function bcMsg(t, err) { $('bcMsg').innerHTML = t || ''; $('bcMsg').classList.toggle('err', !!err); }
function bcRenderAcc() {
  const st = bcSt || { chzzk: {}, youtube: {}, redirect: {} };
  // 유튜브는 아직 준비 중 → 내 앱 정보를 직접 넣었거나 이미 연결된 경우만 보여 줌
  const yt = !!(st.youtube && (st.youtube.hasApp || st.youtube.connected));
  document.querySelectorAll('#bcCard .yt-only').forEach((el) => { el.hidden = !yt; });
  $('bcSub').textContent = yt ? '치지직 · 유튜브에 제목·태그를 한 번에' : '치지직 제목·태그·카테고리';
  $('bcAcc').innerHTML = (yt ? ['chzzk', 'youtube'] : ['chzzk']).map((p) => {
    const a = st[p] || {};
    const state = a.connected ? `<span class="ok">연결됨${a.channel ? ' · ' + esc(a.channel.name) : ''}</span>` : a.hasApp ? '<span>로그인하면 제목·태그를 바꿀 수 있어요</span>' : '<span>준비 중</span>';
    return `<div class="bc-row" data-p="${p}"><i class="pd ${p}"></i><b>${BC_NAME[p]}</b>${state}
      <span class="sp"></span>
      ${a.connected ? `<button class="ghost" data-act="logout">로그아웃</button>` : `<button class="${a.hasApp ? 'primary-sm' : ''}" data-act="login" ${a.hasApp ? '' : 'disabled'}>로그인</button>`}
      ${a.builtin && !a.custom ? '' : '<button class="ghost" data-act="app" title="내 앱 정보 직접 넣기 (고급)">⚙</button>'}</div>
      ${bcOpen === p ? `<div class="bc-app" data-p="${p}">${BC_HELP[p]}
        <label class="field">리디렉션 주소 <div class="row"><input readonly value="${esc((st.redirect || {})[p] || '')}"><button class="ghost" data-act="copy">복사</button></div></label>
        <label class="field">Client ID<input data-k="clientId" value="${esc(a.clientId || '')}" spellcheck="false"></label>
        <label class="field">Client Secret<input data-k="secret" type="password" placeholder="${a.hasApp ? '저장돼 있어요 (바꿀 때만 입력)' : ''}" spellcheck="false"></label>
        <div class="row"><button class="primary-sm" data-act="save">저장</button></div></div>` : ''}`;
  }).join('');
}
$('bcAcc').addEventListener('click', async (ev) => {
  const link = ev.target.closest('a[data-url]'); if (link) { ev.preventDefault(); ipcRenderer.invoke('app:open-url', link.dataset.url); return; }
  const b = ev.target.closest('button[data-act]'); if (!b) return;
  const p = b.closest('[data-p]').dataset.p, act = b.dataset.act;
  if (act === 'app') { bcOpen = bcOpen === p ? '' : p; return bcRenderAcc(); }
  if (act === 'copy') { const inp = b.parentElement.querySelector('input'); require('electron').clipboard.writeText(inp.value); return toast('복사했어요.'); }
  if (act === 'save') {
    const box = b.closest('.bc-app');
    const r = await bcInvoke('bc:set-app', p, { clientId: box.querySelector('[data-k="clientId"]').value, secret: box.querySelector('[data-k="secret"]').value });
    if (!r.ok) return toast(r.error, true);
    bcSt = r.data; bcOpen = ''; bcRenderAcc(); toast('앱 정보를 저장했어요. 이제 "로그인"을 누르세요.'); return;
  }
  if (act === 'logout') { const r = await bcInvoke('bc:logout', p); if (r.ok) { bcSt = r.data; bcRenderAcc(); toast(`${BC_NAME[p]}에서 로그아웃했어요.`); } return; }
  if (act === 'login') {
    b.disabled = true; bcMsg(`브라우저에서 ${BC_NAME[p]} 로그인 후 <b>허용</b>을 눌러 주세요…`);
    const r = await bcInvoke('bc:login', p);
    b.disabled = false;
    if (!r.ok) { bcMsg(esc(r.error), true); return; }
    bcSt = r.data; bcRenderAcc(); bcMsg(''); toast(`${BC_NAME[p]} 계정을 연결했어요!`); ipcRenderer.invoke('bc:focus');
  }
});
ipcRenderer.on('bc:status', (_e, st) => { bcSt = st; bcRenderAcc(); });
// 입력값 → cfg.bc 에 저장 (껐다 켜도 그대로)
cfg.bc = { title: '', tags: '', desc: '', czCat: null, ytCat: '', toCz: true, toYt: true, auto: false, ...(cfg.bc || {}) };
const bcTags = () => String($('bcTags').value).split(/[,，#\n]/).map((t) => t.trim()).filter(Boolean);
function bcTagPreview() {
  const czOk = (t) => t.replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣぁ-ゟ゠-ヿ一-龯]/g, '').slice(0, 15);
  const tags = bcTags();
  $('bcTagPrev').innerHTML = tags.map((t, i) => { const c = czOk(t); const off = i >= 5 || !c; return `<span class="chip ${off ? 'dim' : ''}" title="${off ? '치지직에는 안 들어가요' : c !== t ? '치지직: ' + esc(c) : ''}">#${esc(t)}</span>`; }).join('');
}
function bcRenderCzCur() {
  const c = cfg.bc.czCat;
  $('bcCzCur').innerHTML = c ? `<span class="chip on">${esc(c.name)}</span><button class="link inline" id="bcCzClear">지우기</button>` : '<small class="hint">카테고리: 그대로 두기</small>';
  $('bcCzClear')?.addEventListener('click', () => { cfg.bc.czCat = null; save(); bcRenderCzCur(); });
}
function bcFill() {
  $('bcTitle').value = cfg.bc.title; $('bcTags').value = cfg.bc.tags; $('bcDesc').value = cfg.bc.desc; $('bcYtCat').value = cfg.bc.ytCat || '';
  $('bcToCz').checked = cfg.bc.toCz; $('bcToYt').checked = cfg.bc.toYt; $('bcAuto').checked = cfg.bc.auto;
  $('bcTitleN').textContent = `${$('bcTitle').value.length}/100`; bcTagPreview(); bcRenderCzCur();
}
const bcSave = () => { Object.assign(cfg.bc, { title: $('bcTitle').value, tags: $('bcTags').value, desc: $('bcDesc').value, ytCat: $('bcYtCat').value, toCz: $('bcToCz').checked, toYt: $('bcToYt').checked, auto: $('bcAuto').checked }); save(); };
for (const id of ['bcTitle', 'bcTags', 'bcDesc', 'bcYtCat', 'bcToCz', 'bcToYt', 'bcAuto']) $(id).addEventListener(/^bc(To|Auto|YtCat)/.test(id) ? 'change' : 'input', () => { bcSave(); if (id === 'bcTitle') $('bcTitleN').textContent = `${$('bcTitle').value.length}/100`; if (id === 'bcTags') bcTagPreview(); });
async function bcCzSearch() {
  const q = $('bcCzQ').value.trim(); if (!q) return;
  $('bcCzRes').innerHTML = '<small class="hint">찾는 중…</small>';
  const r = await bcInvoke('bc:chzzk-categories', q);
  if (!r.ok) { $('bcCzRes').innerHTML = `<small class="hint err">${esc(r.error)}</small>`; return; }
  const TY = { GAME: '게임', SPORTS: '스포츠', ETC: '기타' };
  $('bcCzRes').innerHTML = r.data.length ? r.data.map((c, i) => `<button class="chip" data-i="${i}">${esc(c.name)} <small>${TY[c.type] || ''}</small></button>`).join('') : '<small class="hint">결과가 없어요</small>';
  $('bcCzRes').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { const c = r.data[Number(b.dataset.i)]; cfg.bc.czCat = { type: c.type, id: c.id, name: c.name }; save(); $('bcCzRes').innerHTML = ''; bcRenderCzCur(); }));
}
$('bcCzSearch').addEventListener('click', bcCzSearch);
$('bcCzQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bcCzSearch(); } });
function bcInfo() { return { title: cfg.bc.title.trim(), tags: bcTags(), description: cfg.bc.desc, chzzkCategory: cfg.bc.czCat || undefined, youtubeCategory: cfg.bc.ytCat || undefined }; }
function bcTargets(only) {
  const st = bcSt || {};
  return ['chzzk', 'youtube'].filter((p) => (p === 'chzzk' ? cfg.bc.toCz : cfg.bc.toYt) && st[p] && st[p].connected && (!only || only.includes(p)));
}
async function bcApply({ only, quiet } = {}) {
  const targets = bcTargets(only);
  if (!targets.length) { if (!quiet) bcMsg('연결된 플랫폼이 없어요. 위에서 치지직/유튜브에 먼저 로그인해 주세요.', true); return null; }
  if (!cfg.bc.title.trim() && !quiet) { bcMsg('제목을 넣어 주세요.', true); return null; }
  bcMsg('적용하는 중…');
  const r = await bcInvoke('bc:apply', bcInfo(), targets);
  if (!r.ok) { bcMsg(esc(r.error), true); return null; }
  const lines = Object.entries(r.data).map(([p, x]) => x.ok ? `✅ ${BC_NAME[p]} 적용됨${x.warn && x.warn.length ? ` <small>(${esc(x.warn.join(' / '))})</small>` : ''}` : `⚠️ ${BC_NAME[p]}: ${esc(x.error)}`);
  const bad = Object.values(r.data).some((x) => !x.ok);
  bcMsg(lines.join('<br>'), bad);
  if (!bad) toast('방송 정보를 바꿨어요.');
  return r.data;
}
$('bcApply').addEventListener('click', () => bcApply());
$('bcLoad').addEventListener('click', async () => {
  const st = bcSt || {}; const got = [];
  if (st.chzzk && st.chzzk.connected) {
    const r = await bcInvoke('bc:chzzk-get');
    if (r.ok) { cfg.bc.title = r.data.title || cfg.bc.title; if (r.data.tags.length) cfg.bc.tags = r.data.tags.join(', '); cfg.bc.czCat = r.data.category; got.push('치지직'); } else bcMsg(esc(r.error), true);
  }
  if (st.youtube && st.youtube.connected) {
    const r = await bcInvoke('bc:youtube-get');
    if (r.ok && r.data) { if (!got.length) { cfg.bc.title = r.data.title; if (r.data.tags.length) cfg.bc.tags = r.data.tags.join(', '); } cfg.bc.desc = r.data.description; if (r.data.categoryId) cfg.bc.ytCat = r.data.categoryId; got.push('유튜브'); }
  }
  save(); bcFill();
  if (got.length) bcMsg(`${got.join(' · ')}에서 불러왔어요.`); else if (!$('bcMsg').classList.contains('err')) bcMsg('불러올 곳이 없어요. 먼저 연결해 주세요.', true);
});
// 방송 시작 → 자동 적용 (치지직은 바로, 유튜브는 방송이 잡힐 때까지 몇 번 다시 시도)
async function bcAutoOnLive(platform) {
  if (!cfg.bc.auto || !cfg.bc.title.trim()) return;
  if (!bcTargets([platform]).length) return;
  for (let i = 0; i < (platform === 'youtube' ? 6 : 2); i++) {
    await new Promise((res) => setTimeout(res, platform === 'youtube' ? 15000 : 3000));
    if (!engine.streaming) return;
    const r = await bcApply({ only: [platform], quiet: true });
    if (r && r[platform] && r[platform].ok) return;
  }
}
let bcPrevLive = {};
engine.on('stream', (states) => { for (const [k, s] of Object.entries(states)) if (s.state === 'live' && (bcPrevLive[k] !== 'live') && (k === 'chzzk' || k === 'youtube')) bcAutoOnLive(k); bcPrevLive = Object.fromEntries(Object.entries(states).map(([k, s]) => [k, s.state])); });
(async () => {
  bcFill();
  if (DEMO) { bcSt = { chzzk: { hasApp: true, connected: true, channel: { name: '스트리미' } }, youtube: { hasApp: true, connected: false }, redirect: {} };
    cfg.bc.title = '오늘은 롤 랭크 올립니다 🔥'; cfg.bc.tags = '롤, 랭크, 저챗, 버튜버'; cfg.bc.czCat = { type: 'GAME', id: 'League_of_Legends', name: '리그 오브 레전드' }; bcFill(); bcRenderAcc(); return; }
  bcSt = await ipcRenderer.invoke('bc:status').catch(() => null); bcRenderAcc();
})();


// ================================================================== VTube Studio: 자동 실행 · Spout2 · 모델/표정/위치 조종
const VTS_EXE = 'vtube studio.exe';
const vtsInvoke = async (ch, ...a) => { if (DEMO) return { ok: false, error: '데모 화면이에요.' }; try { return await ipcRenderer.invoke(ch, ...a); } catch (e) { return { ok: false, error: e.message }; } };
let vtsState = { status: 'off' };
function vtsMsg(t) { $('vtsMsg').innerHTML = t || ''; }
function vtsRender(st) {
  vtsState = st || vtsState;
  const s = vtsState.status;
  const label = { off: '꺼짐', connecting: '연결 중…', 'waiting-allow': '허용 기다리는 중', connected: '연결됨', error: '오류' }[s] || s;
  $('vtsSt').className = 'vts-st ' + (s === 'connected' ? 'on' : s === 'connecting' || s === 'waiting-allow' ? 'wait' : s === 'error' ? 'err' : '');
  $('vtsSt').querySelector('em').textContent = label + (s === 'connected' && vtsState.model ? ` · ${vtsState.model.name}` : '');
  $('vtsConnect').textContent = s === 'connected' ? '연결 끊기' : '🔗 연결';
  $('vtsBody').hidden = s !== 'connected';
  if (s === 'waiting-allow') vtsMsg('VTube Studio 화면에 <b>Streamy Kit 허용</b> 창이 떴어요. <b>허용</b>을 눌러 주세요. (한 번만 하면 돼요)');
  else if (s === 'off' && vtsState.detail && cfg.vtsUse) vtsMsg(`${esc(vtsState.detail)} · 켜지면 자동으로 다시 붙어요.<br>처음이면 VTube Studio 설정(⚙) → <b>VTube Studio 플러그인 API 켜기</b>(포트 8001)를 켜 주세요.`);
  else if (s === 'error') vtsMsg(esc(vtsState.detail || ''));
  else if (s === 'connected') vtsMsg('');
  if (s === 'connected' && vtsState.model) vtsFillPos(vtsState.model.pos);
}
ipcRenderer.on('vts:status', (_e, st) => { const was = vtsState.status; vtsRender(st); if (st.status === 'connected' && was !== 'connected') vtsLoadLists(); });
async function vtsLoadLists() {
  const [m, e, k] = await Promise.all([vtsInvoke('vts:models'), vtsInvoke('vts:expressions'), vtsInvoke('vts:hotkeys')]);
  if (m.ok) {
    const cur = vtsState.model && vtsState.model.id;
    $('vtsModel').innerHTML = m.data.map((x) => `<option value="${esc(x.modelID)}"${x.modelID === cur || x.modelLoaded ? ' selected' : ''}>${esc(x.modelName)}${x.modelLoaded ? ' (지금)' : ''}</option>`).join('') || '<option value="">모델이 없어요</option>';
  }
  if (e.ok) {
    $('vtsExpr').innerHTML = e.data.map((x) => `<button class="chip ${x.active ? 'on' : ''}" data-f="${esc(x.file)}">${esc(String(x.name || x.file).replace(/\.exp3\.json$/i, ''))}</button>`).join('');
  }
  if (k.ok) {
    const TYPE = { ToggleExpression: '표정', TriggerAnimation: '동작', ChangeIdleAnimation: '대기 동작', ChangeBackground: '배경', MoveModel: '이동', RemoveAllExpressions: '표정 끄기', ToggleItemScene: '아이템' };
    $('vtsKeys').innerHTML = k.data.map((x) => `<button class="chip" data-id="${esc(x.hotkeyID)}" title="${esc(TYPE[x.type] || x.type || '')}">${esc(x.name || TYPE[x.type] || '단축키')}</button>`).join('');
  }
}
$('vtsExpr').addEventListener('click', async (ev) => {
  const b = ev.target.closest('.chip'); if (!b) return;
  const on = !b.classList.contains('on');
  const r = await vtsInvoke('vts:expression', b.dataset.f, on);
  if (r.ok) b.classList.toggle('on', on); else toast(r.error, true);
});
$('vtsKeys').addEventListener('click', async (ev) => {
  const b = ev.target.closest('.chip'); if (!b) return;
  const r = await vtsInvoke('vts:trigger', b.dataset.id);
  if (!r.ok) toast(r.error, true); else { b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 300); setTimeout(vtsLoadLists, 600); }
});
$('vtsModelLoad').addEventListener('click', async () => {
  const id = $('vtsModel').value; if (!id) return;
  $('vtsModelLoad').disabled = true; vtsMsg('모델을 바꾸는 중…');
  const r = await vtsInvoke('vts:load', id);
  $('vtsModelLoad').disabled = false;
  if (!r.ok) { vtsMsg(''); return toast(r.error.includes('cooldown') || r.error.includes('2 seconds') ? '모델은 2초에 한 번만 바꿀 수 있어요. 잠깐 뒤에 다시 눌러 주세요.' : r.error, true); }
  vtsMsg(''); toast('모델을 바꿨어요.'); vtsLoadLists();
});
$('vtsRefresh').addEventListener('click', () => { vtsInvoke('vts:model'); vtsLoadLists(); });
// 위치 슬라이더 → 0.08초에 한 번씩 보내기
const VTS_POS = [['vtsX', 'positionX', 2], ['vtsY', 'positionY', 2], ['vtsS', 'size', 0], ['vtsR', 'rotation', 0]];
function vtsFillPos(p) {
  if (!p) return;
  for (const [id, k, d] of VTS_POS) if (Number.isFinite(p[k]) && document.activeElement !== $(id)) { $(id).value = p[k]; $(id + 'V').textContent = Number(p[k]).toFixed(d); }
}
let vtsMoveT = 0, vtsMoveP = null;
function vtsMoveSend(p) {
  vtsMoveP = { ...(vtsMoveP || {}), ...p };
  if (vtsMoveT) return;
  vtsMoveT = setTimeout(async () => { const q = vtsMoveP; vtsMoveP = null; vtsMoveT = 0; const r = await vtsInvoke('vts:move', q); if (!r.ok) rlog('warn', 'vts move', r.error); }, 80);
}
for (const [id, k, d] of VTS_POS) $(id).addEventListener('input', () => { const v = Number($(id).value); $(id + 'V').textContent = v.toFixed(d); vtsMoveSend({ [k]: v }); });
$('vtsCenter').addEventListener('click', () => { vtsFillPos({ positionX: 0, positionY: 0, rotation: 0, size: Number($('vtsS').value) }); vtsMoveSend({ positionX: 0, positionY: 0, rotation: 0 }); });
$('vtsPosGet').addEventListener('click', async () => { const r = await vtsInvoke('vts:model'); if (r.ok && r.data.modelPosition) vtsFillPos(r.data.modelPosition); });
// 켜기 / 연결
async function vtsLaunch(quiet) {
  const r = await vtsInvoke('vts:launch');
  if (!r.ok) { if (!quiet) toast(r.error, true); return false; }
  const d = r.data || {};
  if (!d.ok) { if (!quiet) toast(d.error || 'VTube Studio를 켜지 못했어요.', true); vtsMsg(esc(d.error || '')); return false; }
  if (!quiet) toast(d.already ? 'VTube Studio가 이미 켜져 있어요.' : 'VTube Studio를 켜는 중이에요. 켜지면 자동으로 연결돼요.');
  return true;
}
$('vtsLaunch').addEventListener('click', async () => { await vtsLaunch(false); cfg.vtsUse = true; save(); vtsInvoke('vts:connect'); });
$('vtsConnect').addEventListener('click', async () => {
  if (vtsState.status === 'connected' || vtsState.status === 'connecting' || vtsState.status === 'waiting-allow') { cfg.vtsUse = false; save(); await vtsInvoke('vts:disconnect'); vtsMsg(''); return; }
  cfg.vtsUse = true; save();
  vtsMsg('VTube Studio에 연결하는 중…');
  await vtsInvoke('vts:connect');
});
$('vtsAuto').checked = !!cfg.vtsAuto;
$('vtsAuto').addEventListener('change', () => { cfg.vtsAuto = $('vtsAuto').checked; if (cfg.vtsAuto) cfg.vtsUse = true; save(); if (cfg.vtsAuto) { vtsLaunch(true); vtsInvoke('vts:connect'); } });
// Spout2로 화면 넣기: VTube Studio 전용 Spout2 소스를 지금 장면에 (창 캡처로 넣어 둔 게 있으면 숨김)
$('vtsSpout').addEventListener('click', guard(() => {
  if (DEMO) return toast('데모 화면이에요.');
  if (!engineOk) return toast('엔진이 아직 준비되지 않았어요.', true);
  if (!engine.types().some((t) => t.startsWith('spout_capture'))) return toast('이 PC에서는 Spout2를 쓸 수 없어요.', true);
  const all = engine.virtualSources().filter((v) => v.exe === VTS_EXE);
  const spoutSrc = all.find((v) => v.virt.method === 'spout');
  let hidden = 0;
  for (const it of engine.items()) {
    const v = all.find((x) => x.name === it.name);
    if (v && v.virt.method !== 'spout' && it.visible) { engine.setVisible(it.id, false); hidden++; }
  }
  if (spoutSrc) {
    let it = engine.items().find((x) => x.name === spoutSrc.name);
    if (!it) { engine.currentScene.scene.add(engine.sources[spoutSrc.name].input); engine.applyVirtual(spoutSrc.name); it = engine.items().find((x) => x.name === spoutSrc.name); }
    else if (!it.visible) engine.setVisible(it.id, true);
    if (it) engine.select(it.id, 'single');
  } else {
    engine.addSource('virtual', { name: 'VTube Studio', value: '', virt: { ...VIRTUAL_DEFAULT, ...(cfg.virtualLast || {}), crop: { ...VIRTUAL_DEFAULT.crop }, method: 'spout', sender: VTS_SENDER, exe: VTS_EXE, composite: cfg.vtsComposite || 3 } });
  }
  cfg.virtualAutoDone = [...new Set([...(cfg.virtualAutoDone || []), VTS_EXE])]; save();
  saveScenes(); renderVtFound();
  toast('VTube Studio를 Spout2로 넣었어요.' + (hidden ? ` 창 캡처로 넣어 둔 ${hidden}개는 숨겼어요.` : '') + ' 화면이 비어 있으면 VTube Studio 설정에서 Spout2 출력을 켜 주세요.');
}));
// 시작할 때
(async () => {
  if (DEMO) { vtsRender({ status: 'connected', model: { name: '데모 모델', pos: { positionX: 0.2, positionY: -0.4, size: -20, rotation: 0 } } });
    $('vtsModel').innerHTML = '<option>데모 모델 (지금)</option><option>두 번째 모델</option>';
    $('vtsExpr').innerHTML = '<button class="chip on">웃음</button><button class="chip">화남</button><button class="chip">눈물</button><button class="chip">하트 눈</button>';
    $('vtsKeys').innerHTML = '<button class="chip">손 흔들기</button><button class="chip">배경 바꾸기</button><button class="chip">모자 쓰기</button>'; return; }
  vtsRender(await ipcRenderer.invoke('vts:status').catch(() => ({ status: 'off' })));
  if (cfg.vtsAuto) await vtsLaunch(true);
  if (cfg.vtsAuto || cfg.vtsUse) vtsInvoke('vts:connect');
})();


// ================================================================== ON AIR: 스마트폰으로 볼 때
function phoneVisible() { return mode === 'air' && cfg.phone !== false; }
let phoneRaf = 0;
function phoneLayout() {
  if (phoneRaf) return;
  phoneRaf = requestAnimationFrame(() => {
    phoneRaf = 0;
    if (!engineOk || !engine.phoneDisplay) return;
    const r = $('phVideo').getBoundingClientRect(), z = window.devicePixelRatio || 1;
    try { engine.movePhoneDisplay(r.left * z, r.top * z, r.width * z, r.height * z); } catch (e) { rlog('warn', 'phone move', e); }
  });
}
const SPLIT_DEF = { v: 0.28, h: 0.45 };
function phoneApplySplit() {
  const o = cfg.phoneOrient === 'h' ? 'h' : 'v';
  const k = Math.max(0.15, Math.min(0.7, Number((cfg.phoneSplit || {})[o]) || SPLIT_DEF[o]));
  $('phoneCol').style.width = (k * 100).toFixed(1) + '%';
}
function phoneSync() {
  const on = phoneVisible();
  $('phoneCol').hidden = !on; $('phSplit').hidden = !on;
  phoneApplySplit();
  $('phToggle').classList.toggle('on', cfg.phone !== false);
  $('phone').className = 'phone ' + (cfg.phoneOrient === 'h' ? 'h' : 'v');
  $('phOrient').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.o === (cfg.phoneOrient === 'h' ? 'h' : 'v')));
  if (DEMO) { if (!$('phVideo').querySelector('img')) $('phVideo').innerHTML = '<img src="demo-preview.png" alt="">'; }
  else if (engineOk) {
    try {
      if (on) { engine.createPhoneDisplay(ipcRenderer.sendSync('app:window-handle'), [0, 0, 0]); crumb('phone display on'); }
      else if (engine.phoneDisplay) { engine.destroyPhoneDisplay(); crumb('phone display off'); }
    } catch (e) { rlog('error', 'phone display', e); }
  }
  layoutDisplay(); phoneLayout();
}
// 비율 조절 막대: 끌어서 폰 화면 폭 바꾸기 (세로/가로 따로 기억), 더블클릭 = 기본값
$('phSplit').addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; e.preventDefault();
  const box = document.querySelector('.stage-top').getBoundingClientRect(), o = cfg.phoneOrient === 'h' ? 'h' : 'v';
  document.body.classList.add('splitting'); $('phSplit').classList.add('on');
  const move = (ev) => {
    const k = Math.max(0.15, Math.min(0.7, (box.right - ev.clientX) / box.width));
    cfg.phoneSplit = { ...SPLIT_DEF, ...(cfg.phoneSplit || {}), [o]: Math.round(k * 1000) / 1000 };
    phoneApplySplit();
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('splitting'); $('phSplit').classList.remove('on'); save(); layoutDisplay(); phoneLayout(); };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
});
$('phSplit').addEventListener('dblclick', () => { const o = cfg.phoneOrient === 'h' ? 'h' : 'v'; cfg.phoneSplit = { ...SPLIT_DEF, ...(cfg.phoneSplit || {}), [o]: SPLIT_DEF[o] }; save(); phoneApplySplit(); });
$('phToggle').addEventListener('click', () => { cfg.phone = cfg.phone === false; save(); phoneSync(); });
$('phOrient').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; cfg.phoneOrient = b.dataset.o; save(); phoneSync(); });
new ResizeObserver(phoneLayout).observe($('phVideo'));
new ResizeObserver(phoneLayout).observe($('phoneCol'));
window.addEventListener('resize', phoneLayout);
// 폰 화면 정보줄 (1초마다)
setInterval(() => {
  if (!phoneVisible()) return;
  const st = miniState();
  $('phLive').style.display = st.state === 'live' ? '' : 'none';
  $('phTitle').textContent = st.scene ? `${st.scene}` : 'Streamy 방송';
  $('phMeta').textContent = [st.state === 'live' ? st.time : '방송 전', st.viewers != null ? `시청자 ${Number(st.viewers).toLocaleString('ko-KR')}명` : ''].filter(Boolean).join(' · ');
}, 1000);
// 폰 화면 채팅 (최근 12개, 모바일 크기 글씨)
const phMsgs = [];
function phoneChat(list) {
  for (const m of list) if (m.kind !== 'system') phMsgs.push(m);
  if (phMsgs.length > 12) phMsgs.splice(0, phMsgs.length - 12);
  $('phChat').innerHTML = phMsgs.map((m) => {
    const body = (m.parts || []).map((x) => (x.t === 'img' ? `<img src="${esc(x.src)}" alt="" referrerpolicy="no-referrer">` : esc(x.v))).join('');
    return `<div class="pc p-${m.p}">${m.amount ? `<span class="amt">${esc(m.amount)}</span>` : ''}<b>${esc(m.nick)}</b>${body}</div>`;
  }).join('');
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
