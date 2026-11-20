// Streamy Kit — 화면 로직 (v0.8)
'use strict';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { Engine, SOURCE_TYPES, PLATFORMS, ENCODERS, VIRTUAL_APPS, VIRTUAL_SPOTS, VIRTUAL_DEFAULT, VTS_SENDER, appOfExe, exeOf } = require('./engine.js');
const { FLAT_ICONS, UI_ICON } = require('./icons.js');
const ic = (n) => UI_ICON(n);
// 확인 창 (윈도우 기본 창 대신 앱 디자인으로). 고른 버튼 번호를 돌려줌, 닫으면 마지막(취소)
// 안내 창 (확인 창과 같은 디자인): 아이콘 · 제목 · 한 줄 · 순서 · 칩 · 버튼
function uiNotice({ icon = 'warn', title = '', message = '', steps = [], chips = [], foot = '', buttons = ['확인'] } = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'cf-ov';
    ov.innerHTML = `<div class="cf-box nt ${icon === 'warn' ? 'warnish' : ''}" role="dialog" aria-modal="true">
      <div class="cf-ic">${icon === 'warn' ? '<b class="bang">!</b>' : (FLAT_ICONS[icon] || ic(icon))}</div>
      <b class="cf-title">${esc(title)}</b>${message ? `<p class="cf-msg">${esc(message)}</p>` : ''}
      ${steps.length ? `<ol class="nt-steps">${steps.map((x) => `<li><span>${x}</span></li>`).join('')}</ol>` : ''}
      ${chips.length ? `<div class="nt-chips">${chips.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
      ${foot ? `<p class="cf-detail">${esc(foot)}</p>` : ''}
      <div class="cf-btns${buttons.length === 1 ? ' one' : buttons.length > 2 ? ' many' : ''}">${buttons.map((b, i) => `<button data-i="${i}" class="${i === 0 ? 'cf-main' : i === buttons.length - 1 ? 'cf-cancel' : 'cf-mid'}">${esc(b)}</button>`).join('')}</div></div>`;
    const done = (i) => { window.removeEventListener('keydown', key, true); ov.classList.add('out'); setTimeout(() => ov.remove(), 120); try { hidePreview('notice', false); } catch {} resolve(i); };
    const key = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(e.key === 'Enter' ? 0 : -1); } };
    ov.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) done(+b.dataset.i); else if (e.target === ov) done(-1); });
    window.addEventListener('keydown', key, true);
    try { hidePreview('notice', true); } catch {}
    document.body.appendChild(ov);
    setTimeout(() => ov.querySelector('.cf-main')?.focus(), 0);
  });
}
function uiConfirm({ title = '확인', message = '', detail = '', buttons = ['확인', '취소'] } = {}) {
  return new Promise((resolve) => {
    const danger = /삭제|종료|지우기|빼기/.test(buttons[0] || '');
    const ov = document.createElement('div'); ov.className = 'cf-ov';
    ov.innerHTML = `<div class="cf-box${danger ? ' danger' : ''}" role="dialog" aria-modal="true">
      <div class="cf-ic">${ic(danger ? 'warn' : 'ok')}</div>
      <b class="cf-title">${esc(title)}</b>
      <p class="cf-msg">${esc(message).replace(/\n/g, '<br>')}</p>${detail ? `<p class="cf-detail">${esc(detail).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="cf-btns${buttons.length > 2 ? ' many' : ''}">${buttons.map((b, i) => `<button data-i="${i}" class="${i === 0 ? 'cf-main' : i === buttons.length - 1 ? 'cf-cancel' : 'cf-mid'}">${esc(b)}</button>`).join('')}</div></div>`;
    const cancel = buttons.length - 1;
    const done = (i) => { window.removeEventListener('keydown', key, true); ov.classList.add('out'); setTimeout(() => ov.remove(), 120); try { hidePreview('confirm', false); } catch {} resolve(i); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(cancel); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(0); } };
    ov.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) done(+b.dataset.i); else if (e.target === ov) done(cancel); });
    window.addEventListener('keydown', key, true);
    try { hidePreview('confirm', true); } catch {}
    document.body.appendChild(ov);
    setTimeout(() => ov.querySelector(danger ? '.cf-cancel' : '.cf-main')?.focus(), 0);
  });
}
// 소스 아이콘: 기본 이모지 그대로면 플랫 아이콘, 사용자가 바꾼 이모지면 그 이모지
function srcIcon(kind) { return FLAT_ICONS[kind] || UI_ICON('dot'); }

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
    // 스트림 키는 암호화해서 저장 (keysEnc). 예전 평문(keys)은 읽어서 다음 저장 때 암호화로 바뀜
    if (s.keysEnc) { try { const plain = ipcRenderer.sendSync('secret:dec', s.keysEnc); if (plain) s.keys = { ...(s.keys || {}), ...JSON.parse(plain) }; } catch {} }
    delete s.keysEnc;
    return { ...DEFAULTS, ...s, keys: { ...DEFAULTS.keys, ...(s.keys || {}) }, timer: { ...DEFAULTS.timer, ...(s.timer || {}) }, channels: { ...DEFAULTS.channels, ...(s.channels || {}) }, mini: { ...DEFAULTS.mini, ...(s.mini || {}) } };
  } catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
let cfg = loadSettings();
// 예전 형식(window 문자열) → 실행 파일 이름
cfg.appAudio = (cfg.appAudio || []).map((a) => ({ exe: a.exe || String(a.window || '').split(':').pop(), label: a.label })).filter((a) => a.exe);
delete cfg.audioApps; delete cfg.platform;
// 설정 저장: 스트림 키만 암호화해서 keysEnc로 (암호화를 못 쓰는 PC면 예전처럼)
function cfgForDisk(c) {
  const out = { ...c };
  try { const e = ipcRenderer.sendSync('secret:enc', JSON.stringify(c.keys || {})); if (e) { out.keysEnc = e; delete out.keys; } } catch {}
  return out;
}
const writeJson = (f, d) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(d, null, 2)); fs.renameSync(f + '.tmp', f); } catch (e) { rlog('error', 'writeJson', e); } };
let saveT = null, sceneT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => writeJson(info.settingsFile, cfgForDisk(cfg)), 300); }
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
  if (name === 'stream') { try { renderStreamSubs(); } catch {} }
  if (name === 'sources') { try { renderSrcTab(); } catch (e) { rlog('warn', 'src tab', e); } }
}
// 방송 탭에 옮겨 온 녹화 · 따로 보이기 칸 그리기
function renderStreamSubs() { renderIso(); renderTracks(); renderVis(); renderRecFile(); }
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
      b.draggable = !DEMO; b.dataset.id = s.id;
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-streamy-scene', String(s.id)); e.dataTransfer.effectAllowed = 'move'; b.classList.add('dragging'); document.body.classList.add('scene-dragging'); });
      b.addEventListener('dragend', () => { b.classList.remove('dragging'); document.body.classList.remove('scene-dragging'); box.querySelectorAll('.drop-a,.drop-b').forEach((x) => x.classList.remove('drop-a', 'drop-b')); });
      b.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('application/x-streamy-scene')) return;
        e.preventDefault(); const r = b.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        box.querySelectorAll('.drop-a,.drop-b').forEach((x) => x.classList.remove('drop-a', 'drop-b')); b.classList.add(after ? 'drop-a' : 'drop-b');
      });
      b.addEventListener('drop', guard((e) => {
        const from = e.dataTransfer.getData('application/x-streamy-scene'); if (!from) return; e.preventDefault();
        const order = list.map((x) => String(x.id)), fi = order.indexOf(from); if (fi < 0) return;
        const r = b.getBoundingClientRect(); let ti = order.indexOf(String(s.id)) + (e.clientY > r.top + r.height / 2 ? 1 : 0); if (ti > fi) ti -= 1;
        const mid = list[fi].id;
        for (let k = fi; k < ti; k++) engine.moveScene(mid, 1);
        for (let k = fi; k > ti; k--) engine.moveScene(mid, -1);
        if (ti !== fi) { saveScenes(); renderScenes(); }
      }));
      b.addEventListener('contextmenu', guard(async (e) => {
        e.preventDefault(); if (DEMO) return;
        const r = await uiConfirm({ title: '장면', message: `'${s.name}' 장면을 어떻게 할까요?`, buttons: ['삭제', '왼쪽으로', '오른쪽으로', '취소'] });
        if (r === 0) engine.removeScene(s.id); if (r === 1) engine.moveScene(s.id, -1); if (r === 2) engine.moveScene(s.id, 1);
        saveScenes();
      }));
    }
    box.appendChild(b);
  });
}
function addSceneNow() { if (DEMO) return; const sc = engine.addScene(); engine.switchScene(sc.id, true); renamingScene = sc.id; renderScenes(); saveScenes(); }
async function deleteScene(id) {
  if (DEMO || !engineOk) return;
  const sc = engine.scenes.find((x) => x.id === id); if (!sc) return;
  if (engine.scenes.length <= 1) return toast('장면은 하나 이상 있어야 해요.', true);
  const r = await uiConfirm({ title: '장면 삭제', message: `'${sc.name}' 장면을 삭제할까요?\n안에 있는 소스 배치도 같이 사라져요.`, buttons: ['삭제', '취소'] });
  if (r === 0) { engine.removeScene(id); saveScenes(); renderScenes(); renderSources(); }
}
$('sceneAdd').addEventListener('click', guard(addSceneNow));
$('sceneDel').addEventListener('click', guard(() => deleteScene(DEMO ? null : engine.currentId)));
// [삭제] 버튼으로 끌어와서 빼기 (장면 · 소스 둘 다)
for (const [btn, type] of [['sceneDel', 'application/x-streamy-scene'], ['srcDel', 'application/x-streamy-src']]) {
  const el = $(btn);
  el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes(type)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop-del'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-del'));
  el.addEventListener('drop', guard((e) => {
    el.classList.remove('drop-del'); const id = e.dataTransfer.getData(type); if (!id) return; e.preventDefault(); e.stopPropagation();
    if (type.endsWith('scene')) { const sc = engine.scenes.find((x) => String(x.id) === id); if (sc) deleteScene(sc.id); }
    else { engine.select(Number(id), 'single'); removeSelected(); }
  }));
}
engine.on('scenes', renderScenes);

// ================================================================== 소스 목록 (다중 선택 / 이름·이모지 편집)
let editingItem = null;
function renderSources() {
  const ul = $('sourceList'); ul.innerHTML = '';
  // (소스 칸 제목은 '소스' 고정)
  const items = DEMO ? demo.items : engineOk ? engine.items() : [];
  if (!items.length) ul.innerHTML = '<li class="empty">아직 소스가 없어요. <b>＋ 추가</b>를 눌러 모니터 화면이나 게임을 넣어 보세요.</li>';
  for (const it of items) {
    const li = document.createElement('li');
    if (editingItem === it.id) {
      li.className = 'editing';
      li.innerHTML = `<span class="ic">${srcIcon(it.kind)}</span><input class="nmi">`;
      const nmi = li.querySelector('.nmi');
      nmi.value = it.name;
      let finished = false;
      const done = (ok) => {
        if (finished) return; finished = true; editingItem = null;
        if (ok) guard(() => { engine.renameSource(it.name, nmi.value.trim() || it.name, it.icon); saveScenes(); })();
        renderSources();
      };
      for (const inp of [nmi]) {
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
        inp.addEventListener('click', (e) => e.stopPropagation());
      }
      li.addEventListener('focusout', () => setTimeout(() => { if (!li.contains(document.activeElement)) done(true); }, 0));
      setTimeout(() => { nmi.focus(); nmi.select(); });
    } else {
      li.className = (it.selected ? 'on' : '') + (it.visible ? '' : ' hidden');
      li.innerHTML = `<span class="ic">${srcIcon(it.kind)}</span><span class="nm">${esc(it.name)}</span>${it.where && it.where !== 'both' ? `<span class="vis-off" title="${it.where === 'stream' ? '녹화' : '방송'}에서 뺐어요">${ic('eyeOff')}${it.where === 'stream' ? '녹화' : '방송'}</span>` : ''}<button class="eye" title="보이기/숨기기">${it.visible ? ic('eye') : ic('eyeOff')}</button>`;
      li.addEventListener('click', guard((e) => {
        if (DEMO) return;
        engine.select(it.id, e.shiftKey ? 'range' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'single');
      }));
      li.addEventListener('dblclick', guard(() => { if (DEMO) return; editingItem = it.id; renderSources(); }));
      li.querySelector('.eye').addEventListener('click', guard((e) => { e.stopPropagation(); if (DEMO) return; engine.setVisible(it.id, !it.visible); saveScenes(); }));
      // 끌어서 순서 바꾸기 (위 = 화면 앞)
      li.draggable = !DEMO; li.dataset.id = it.id;
      li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-streamy-src', String(it.id)); e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); document.body.classList.add('src-dragging-list'); });
      li.addEventListener('dragend', () => { li.classList.remove('dragging'); document.body.classList.remove('src-dragging-list'); ul.querySelectorAll('.drop-a,.drop-b').forEach((x) => x.classList.remove('drop-a', 'drop-b')); });
      li.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('application/x-streamy-src')) return;
        e.preventDefault(); e.stopPropagation();
        const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        ul.querySelectorAll('.drop-a,.drop-b').forEach((x) => x.classList.remove('drop-a', 'drop-b'));
        li.classList.add(after ? 'drop-a' : 'drop-b');
      });
      li.addEventListener('drop', guard((e) => {
        const from = e.dataTransfer.getData('application/x-streamy-src'); if (!from) return;
        e.preventDefault(); e.stopPropagation();
        const order = items.map((x) => String(x.id)); const fi = order.indexOf(from); if (fi < 0) return;
        const r = li.getBoundingClientRect(); let ti = order.indexOf(String(it.id)) + (e.clientY > r.top + r.height / 2 ? 1 : 0);
        if (ti > fi) ti -= 1;
        const id = items[fi].id;
        for (let k = fi; k < ti; k++) engine.moveItem(id, -1);
        for (let k = fi; k > ti; k--) engine.moveItem(id, 1);
        if (ti !== fi) saveScenes();
      }));
    }
    ul.appendChild(li);
  }
  syncSourceCards(items);
  renderEditBar();
}
function selIds() { return engineOk ? [...engine.sel] : []; }
function renderEditBar() {
  const bar = $('editBar'), name = $('selName'), size = $('selSize');
  const hint = '';
  if (DEMO) { bar.classList.add('has-sel'); name.innerHTML = '<b>웹캠</b>'; size.textContent = '576 × 324 · 30%'; return; }
  const ids = selIds();
  bar.classList.toggle('has-sel', ids.length === 1);
  if (!ids.length) { name.innerHTML = ''; size.textContent = ''; return; }
  if (ids.length > 1) { name.innerHTML = `<b>${ids.length}개</b> 선택됨 · [삭제] 또는 Delete로 한 번에 삭제`; size.textContent = ''; return; }
  const it = engine.items().find((x) => x.id === ids[0]);
  name.innerHTML = it ? `<b>${esc(it.name)}</b>` : '';
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
  if ($('tab-stream')?.classList.contains('on')) { try { renderIso(); renderVis(); } catch {} }
  if (soundOpen) { try { renderVis(); } catch {} }
  if ($('tab-sources')?.classList.contains('on')) { try { renderSrcTab(); } catch {} }
  if (engineOk) {
    const ids = selIds();
    if (ids.length !== 1) propsFor = null;
    else if (propsFor !== ids[0]) {
      propsFor = ids[0];
      if (mode !== 'air' && $('addBox').hidden) {      // 누르면 소스 탭에서 그 장면 · 그 소스로 바로
        srcScene = engine.currentId; openTab('sources'); renderSrcTab(true); srcFocus(ids[0]);
      }
    }
  }
  clearTimeout(countT); countT = setTimeout(renderScenes, 150);
});
let countT = 0;
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
  const r = await uiConfirm({ title: '소스 삭제', message: msg, buttons: ['삭제', '취소'] });
  if (r === 0) { engine.removeItems(ids); saveScenes(); }
}

// ================================================================== 소스 추가 (소스 탭 안에서)
let addKind = null;
// ＋ 추가 → 왼쪽에 소스 종류 목록이 쭉 펼쳐짐 → 고르면 오른쪽에서 세부 설정
const ADD_DESC = {
  monitor: '모니터 전체를 그대로', window: '켜져 있는 프로그램 하나만', game: '게임 화면 (전체 화면 게임도)',
  webcam: '카메라 · 캡처보드', image: '사진 · 로고 · 배경 그림', text: '화면에 글자 넣기',
  web: '투네이션 · 트윕 같은 알림창 주소', timer: '방송 시간 · 카운트다운', virtual: 'VTube Studio 같은 버추얼 프로그램', color: '한 가지 색으로 채운 배경',
};
function renderAddMenu() {
  const m = $('addMenu');
  $('addBox').appendChild($('addForm'));          // 다시 그리기 전에 설정 칸을 잠깐 빼 둠
  m.innerHTML = Object.entries(SOURCE_TYPES).map(([k, t]) => {
    const off = engineOk && !engine.available(k);
    return `<button class="am-item${addKind === k ? ' on' : ''}" data-k="${k}"${off ? ' disabled title="이 PC에서는 쓸 수 없어요"' : ' draggable="true" title="누르면 설정 · 끌어서 화면에 놓으면 추가"'}><span class="am-tx"><b>${esc(t.label)}</b><small>${esc(ADD_DESC[k] || '')}</small></span><span class="am-grip" aria-hidden="true">⠿</span></button>`;
  }).join('');
  if (addKind) { const it = m.querySelector(`.am-item[data-k="${addKind}"]`); if (it) { it.after($('addForm')); renderAddForm(); } }
}
// ＋ 추가 → 오버레이: 왼쪽에서 종류 고르고 오른쪽에서 바로 설정 → 넣기
let aoKind = null;
function renderAddOv() {
  const sc = DEMO ? '게임 방송' : (engineOk && engine.currentScene ? engine.currentScene.name : '장면');
  $('aoScene').textContent = `'${sc}' 장면에 넣어요`;
  $('aoList').innerHTML = Object.entries(SOURCE_TYPES).map(([k, t]) => `<button class="ao-item${aoKind === k ? ' on' : ''}" data-k="${k}"><span class="ic">${srcIcon(k)}</span><span class="ao-tx"><b>${esc(t.label)}</b><small>${esc(ADD_DESC[k] || '')}</small></span></button>`).join('');
  $('aoEmpty').hidden = !!aoKind; $('aoPane').hidden = !aoKind;
  if (!aoKind) return;
  const t = SOURCE_TYPES[aoKind];
  $('aoIc').innerHTML = srcIcon(aoKind); $('aoName').textContent = t.label; $('aoDesc').textContent = ADD_DESC[aoKind] || '';
  $('aoForm').innerHTML = sourceForm(aoKind, 'o') || '<p class="hint">따로 정할 건 없어요. 바로 넣으면 돼요.</p>';
  bindForm(aoKind, 'o');
}
function setAddMenu(open) {
  $('addOv').hidden = !open; $('srcAdd').classList.toggle('open', open);
  hidePreview('addov', open);
  if (open) { aoKind = null; renderAddOv(); }
}
$('srcAdd').addEventListener('click', () => setAddMenu($('addOv').hidden));
$('aoClose').addEventListener('click', () => setAddMenu(false));
$('addOv').addEventListener('click', (e) => { if (e.target.id === 'addOv') setAddMenu(false); });
$('aoList').addEventListener('click', (e) => { const b = e.target.closest('.ao-item'); if (!b) return; aoKind = b.dataset.k; renderAddOv(); });
$('aoGo').addEventListener('click', guard(() => { if (aoKind) addSourceFrom(aoKind, 'o', () => { if ($('aoMore').checked) renderAddOv(); else setAddMenu(false); }); }));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('addOv').hidden) { e.stopPropagation(); setAddMenu(false); } }, true);
$('addMenu').addEventListener('click', (e) => {
  const b = e.target.closest('.am-item'); if (!b || b.disabled) return;
  addKind = addKind === b.dataset.k ? null : b.dataset.k;   // 같은 걸 다시 누르면 접기
  renderAddMenu();
  if (addKind) setTimeout(() => $('addForm').scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
});
function closeAdd() { addKind = null; $('addBox').appendChild($('addForm')); $('addForm').innerHTML = ''; $('addBox').hidden = true; setAddMenu(false); }

// 끌어다 놓기: 사진 파일 → 이미지 소스, 웹 주소(알림창) → 웹페이지 소스
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
let dropDepth = 0;
const isFileOrUrl = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/uri-list');
window.addEventListener('dragenter', (e) => { if (!isFileOrUrl(e) || DEMO || srcDrag) return; dropDepth++; document.body.classList.add('dropping'); });
window.addEventListener('dragleave', () => { if (--dropDepth <= 0) { dropDepth = 0; document.body.classList.remove('dropping'); } });
window.addEventListener('dragover', (e) => { if (isFileOrUrl(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('drop', guard((e) => {
  if (!isFileOrUrl(e)) return;
  e.preventDefault(); dropDepth = 0; document.body.classList.remove('dropping');
  if (DEMO || !engineOk) return toast('엔진이 아직 준비되지 않았어요.', true);
  const added = [];
  const { webUtils } = require('electron');
  for (const f of e.dataTransfer.files || []) {
    let fp = ''; try { fp = webUtils ? webUtils.getPathForFile(f) : f.path; } catch { fp = f.path || ''; }
    if (fp && IMG_EXT.test(fp)) added.push(engine.addSource('image', { file: fp, name: require('path').basename(fp).replace(IMG_EXT, '').slice(0, 40) }).name);
  }
  if (!added.length) {
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n').map((x) => x.trim()).find((x) => /^https?:\/\//.test(x));
    if (url) added.push(engine.addSource('web', { url, width: 800, height: 600, name: '알림창' }).name);
  }
  if (!added.length) return toast('사진 파일(png · jpg · gif)이나 http 주소만 넣을 수 있어요.', true);
  saveScenes(); openTab('sources');
  toast(`${added.map((n) => `'${n}'`).join(', ')}을(를) 넣었어요. 미리보기에서 끌어서 위치를 맞추세요.`);
}));
function renderTypes() {
  const g = $('typeGrid'); g.innerHTML = '';
  for (const [k, t] of Object.entries(SOURCE_TYPES)) {
    const b = document.createElement('button');
    b.className = 'type' + (addKind === k ? ' on' : '');
    b.innerHTML = `<span>${srcIcon(k)}</span>${esc(t.label)}`;
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
let camList = [];
async function refreshCams(rerender) {
  try {
    let ds = await navigator.mediaDevices.enumerateDevices();
    if (ds.some((d) => d.kind === 'videoinput' && !d.label)) { try { const st = await navigator.mediaDevices.getUserMedia({ video: true }); st.getTracks().forEach((t) => t.stop()); ds = await navigator.mediaDevices.enumerateDevices(); } catch {} }
    camList = ds.filter((d) => d.kind === 'videoinput' && d.label).map((d) => ({ label: d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') }));
  } catch { camList = []; }
  if (rerender) for (const pre of ['o', 'p']) { const sel = $(pre + 'Pick'); if (sel && (aoKind === 'webcam' || pre === 'p')) { const k = pre === 'o' ? aoKind : null; if (k === 'webcam') sel.innerHTML = pickOptions('webcam'); } }
}
function pickOptions(kind) {
  const first = kind === 'game' ? '<option value="">전체 화면 게임 자동 감지</option>' : '';
  if (kind === 'virtual') return virtualPickOptions('') || '<option value="">찾지 못했어요 — 프로그램을 켜고 다시 찾기</option>';
  if (kind === 'monitor') {
    let ds = []; try { ds = ipcRenderer.sendSync('app:displays') || []; } catch {}
    return optionList(ds.map((d) => ({ name: `모니터 ${d.i + 1}${d.primary ? ' (주 모니터)' : ''} · ${d.w}×${d.h}`, value: d.id || 'mon:' + d.i })), '찾지 못했어요');
  }
  // 엔진에 목록을 물어보면(임시 소스) 이 PC에서 엔진이 죽어서, 창은 윈도우 창 목록 · 카메라는 브라우저 장치 목록을 씀
  let items = [];
  if (kind === 'window' || kind === 'game') {
    try { openWins = ipcRenderer.sendSync('windows:get') || openWins; } catch {}
    items = openWins.filter((w) => !HIDE_EXE.test(w.exe)).map((w) => ({ name: `[${w.exe}] ${w.title}`.slice(0, 80), value: w.value }));
  } else if (kind === 'webcam') {
    items = camList.map((c) => ({ name: c.label, value: c.label + ':' }));
    if (!camList.length) refreshCams(true);
  }
  return first + optionList(items, kind === 'game' ? '' : '찾지 못했어요');
}
function sourceForm(kind, prefix, cur = {}) {
  const t = SOURCE_TYPES[kind];
  let h = '';
  if (t.prop) {
    h += `<label class="field">${PICK_LABEL[kind]}<div class="row" style="margin:6px 0 0"><select id="${prefix}Pick">${pickOptions(kind)}</select><button class="ghost" id="${prefix}Refresh" title="다시 찾기">${ic('refresh')}</button></div></label>`;
    if (kind === 'webcam') h += '<p class="hint">웹캠은 처음에 왼쪽 아래에 들어가요. 미리보기에서 <b>끌어서 옮기고 모서리로 크기</b>를 맞추세요.</p>';
    if (kind === 'game') h += '<p class="hint">특정 게임만 잡으려면 게임을 켠 상태에서 다시 찾기 버튼을 누르고 고르세요.</p>';
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
      <p class="hint">켜져 있는 프로그램만 목록에 나와요. 더 쉬운 방법: 위의 <b>버추얼 원클릭 연결</b>.</p>`;
  if (kind === 'timer') h += '<p class="hint">오른쪽 위에 들어가요. 넣고 나면 <b>소스</b> 탭에 <b>방송 타이머</b> 칸이 생겨요.</p>';
  return h;
}
function readForm(prefix) {
  const v = (id) => { const el = $(prefix + id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
  const pick = $(prefix + 'Pick');
  return { virt: $(prefix + 'Method') ? { ...VIRTUAL_DEFAULT, ...(cfg.virtualLast || {}), method: v('Method') } : undefined, value: v('Pick'), label: pick && pick.selectedOptions[0] ? pick.selectedOptions[0].textContent : '', file: v('File'), text: v('Text'), size: v('Size'), color: v('Color'), outline: v('Outline'), url: v('Url'), width: v('W'), height: v('H'), timerUrl: info.timerUrl };
}
function bindForm(kind, prefix) {
  const r = $(prefix + 'Refresh');
  if (r) r.addEventListener('click', guard(async () => { if (kind === 'webcam') await refreshCams(); $(prefix + 'Pick').innerHTML = pickOptions(kind); }));
  const b = $(prefix + 'Browse');
  if (b) b.addEventListener('click', async () => { const f = await ipcRenderer.invoke('app:pick-image'); if (f) $(prefix + 'File').value = f; });
}
// 소스 탭: 콤보박스로 고르고 바로 넣기 · 선택한 소스 빼기
function syncSourceCards(items) {
  $('timerCard').hidden = !items.some((x) => x.kind === 'timer');      // 타이머는 넣었을 때만
}
function renderAddForm() {
  const box = $('addForm');
  if (!addKind) { box.innerHTML = ''; return; }
  const t = SOURCE_TYPES[addKind];
  box.innerHTML = sourceForm(addKind, 'a') + '<button class="primary-sm add-go" id="aAdd">＋ 이 장면에 넣기</button><p class="add-drag-hint">또는 위의 <b>' + esc(t.label) + '</b>을(를) 끌어서 화면에 놓아도 돼요</p>';
  bindForm(addKind, 'a');
  $('aAdd').addEventListener('click', guard(() => addFromForm()));
}
function addFromForm() { if (addKind) addSourceFrom(addKind, 'a', closeAdd); }
function addSourceFrom(kind, prefix, after) {
  const addKind = kind;
  const t = SOURCE_TYPES[addKind];
  {
    if (!engineOk) return toast('방송 엔진이 아직 준비되지 않았어요.', true);
    const opt = readForm(prefix);
    if (t.prop && addKind !== 'game' && !opt.value && !(addKind === 'virtual' && opt.virt?.method === 'spout')) return toast('목록에서 골라 주세요.', true);
    if (addKind === 'virtual') opt.name = appOfExe(exeOf(opt.value))?.name || '버추얼';
    if (t.file && !opt.file) return toast('이미지 파일을 골라 주세요.', true);
    if (t.url && !/^https?:\/\//.test(opt.url || '')) return toast('http(s)로 시작하는 주소를 넣어 주세요.', true);
    if (['webcam', 'monitor', 'window'].includes(addKind) && opt.label) opt.name = opt.label.replace(/^\[[^\]]*\]:?\s*/, '').slice(0, 40);
    const r = engine.addSource(addKind, opt);
    saveScenes(); if (after) after();
    toast(`'${r.name}'을(를) 넣었어요. 미리보기에서 끌어서 위치를 맞추세요.`);
  }
}
// 소스 종류를 끌어서 화면(또는 소스 목록)에 놓으면 추가. 끄는 동안엔 엔진 미리보기·가이드 창을 잠깐 숨겨야 놓기가 먹힘
let srcDrag = false;
// 엔진 미리보기(네이티브 창)는 HTML 위에 떠 있어서, 위에 뭘 띄우거나 끌어 놓을 땐 잠깐 숨김
const prevHide = new Set();
function hidePreview(why, on) {
  const before = prevHide.size; on ? prevHide.add(why) : prevHide.delete(why);
  if (!engineOk || (before > 0) === (prevHide.size > 0)) return;
  if (prevHide.size) { try { engine.moveDisplay(-20000, -20000, 1, 1); } catch {} ipcRenderer.send('ov:show', false); }
  else { layoutDisplay(); guideShow(); }
}
function setSrcDrag(on) {
  srcDrag = on; document.body.classList.toggle('src-dragging', on);
  hidePreview('drag', on);
}
$('addMenu').addEventListener('dragstart', (e) => {
  const b = e.target.closest && e.target.closest('.am-item'); if (!b || b.disabled) { if (!b) e.preventDefault(); return; }
  e.dataTransfer.setData('application/x-streamy-add', b.dataset.k); e.dataTransfer.effectAllowed = 'copy';
  setTimeout(() => setSrcDrag(true), 0);
});
$('addMenu').addEventListener('dragend', () => setSrcDrag(false));
for (const zone of [$('previewWrap'), $('sourceList')]) {
  zone.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-streamy-add')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; zone.classList.add('add-over'); } });
  zone.addEventListener('dragleave', () => zone.classList.remove('add-over'));
  zone.addEventListener('drop', guard((e) => {
    const k = e.dataTransfer.getData('application/x-streamy-add'); zone.classList.remove('add-over'); if (!k) return;
    e.preventDefault(); e.stopPropagation(); setSrcDrag(false);
    if (addKind !== k) { addKind = k; renderAddMenu(); }      // 안 펼친 걸 끌어오면 기본값으로
    addFromForm();
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
  body.innerHTML = `<h4 class="props-h"><span class="ic">${srcIcon(it.kind)}</span>${esc(it.name)} 설정</h4>` + sourceForm(s.kind, 'p', s.settings) + '<button class="primary-sm" id="pSave">적용</button>';
  bindForm(s.kind, 'p');
  if (t.prop) { const cur = s.settings[t.prop]; if (cur != null) $('pPick').value = cur; }
  $('pSave').addEventListener('click', guard(() => {
    const opt = readForm('p');
    if (t.prop && !opt.value && s.kind !== 'game') return toast('목록에서 골라 주세요.', true);
    engine.updateSource(it.name, s.kind, opt); saveScenes(); toast('적용했어요.');
  }));
}

// ================================================================== 소스 탭: 위에서 장면 고르면 그 장면 소스 설정이 쭉
let srcScene = null, srcKey = '';
function srcScenesList() {
  if (DEMO) return demo.scenes.map((s) => ({ id: s.id, name: s.name, n: s.n }));
  if (!engineOk) return [];
  return engine.scenes.map((s) => ({ id: s.id, name: s.name, n: engine.items(s.id).length }));
}
function renderSrcTab(force) {
  const box = $('srcScenes'), list = $('srcList'); if (!box || !list) return;
  const scenes = srcScenesList(), cur = DEMO ? demo.current : engineOk ? engine.currentId : null;
  if (!srcScene || !scenes.some((x) => x.id === srcScene)) srcScene = cur;
  box.innerHTML = scenes.map((x) => `<button class="sp-sc${x.id === srcScene ? ' on' : ''}" data-id="${esc(x.id)}"><span>${esc(x.name)}</span>${x.id === cur ? '<i class="sp-now" title="지금 방송 중인 장면"></i>' : ''}<em>${x.n}</em></button>`).join('');
  const items = DEMO ? (srcScene === demo.current ? demo.items : []) : engineOk ? engine.items(srcScene) : [];
  const sc = scenes.find((x) => x.id === srcScene);
  $('srcHead').innerHTML = sc ? `<b>${esc(sc.name)}</b><small>소스 ${items.length}개 · 위에서부터 앞에 보이는 순서</small>` : '';
  const key = srcScene + '|' + (srcScene === cur) + '|' + items.map((i) => `${i.id}:${i.name}:${i.kind}:${i.visible}`).join(',');
  if (!force && key === srcKey && list.childElementCount) return;
  srcKey = key;
  const hold = $('srcHold'); hold.appendChild($('propsCard')); hold.appendChild($('timerCard'));
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<div class="sp-empty">이 장면엔 아직 소스가 없어요. 왼쪽 <b>＋ 추가</b>로 넣어 보세요.</div>'; return; }
  let virtDone = false;
  items.forEach((it, i) => {
    const card = document.createElement('div'); card.className = 'sp-card'; card.dataset.id = it.id;
    const eye = srcScene === cur ? `<button class="sp-eye${it.visible ? '' : ' off'}" title="보이기 / 숨기기">${ic(it.visible ? 'eye' : 'eyeOff')}</button>` : '';
    card.innerHTML = `<div class="sp-card-h"><span class="ic">${srcIcon(it.kind)}</span><b>${esc(it.name)}</b>${eye}</div><div class="sp-card-b"></div>`;
    list.appendChild(card);
    const b = card.querySelector('.sp-card-b');
    if (eye) card.querySelector('.sp-eye').addEventListener('click', guard(() => { if (DEMO) return; engine.setVisible(it.id, !it.visible); saveScenes(); }));
    const st = DEMO ? { kind: it.kind, settings: {} } : engine.sourceSettings(it.name);
    const kind = st ? st.kind : it.kind;
    if (kind === 'timer') { const tc = $('timerCard'); tc.hidden = false; b.appendChild(tc); return; }
    if (kind === 'virtual') {
      if (virtDone) { b.innerHTML = '<p class="sp-note">버추얼 설정은 첫 번째 버추얼 소스에서 바꿀 수 있어요.</p>'; return; }
      virtDone = true; b.appendChild($('propsCard'));
      if (DEMO) renderVirtualProps(it.name, { ...VIRTUAL_DEFAULT }, '', 'game');
      else { const v = engine.getVirtual(it.name); renderVirtualProps(it.name, v, st.settings.window, v.method); }
      return;
    }
    const t = SOURCE_TYPES[kind] || {};
    if (!(t.prop || t.file || t.text || t.url || kind === 'color')) { b.innerHTML = '<p class="sp-note">따로 정할 건 없어요.</p>'; return; }
    const px = 'q' + i;
    b.innerHTML = sourceForm(kind, px, st.settings || {}) + `<button class="primary-sm" id="${px}Save">적용</button>`;
    bindForm(kind, px);
    if (t.prop && st.settings) { const cv = st.settings[t.prop]; if (cv != null && $(px + 'Pick')) $(px + 'Pick').value = cv; }
    $(px + 'Save').addEventListener('click', guard(() => {
      if (DEMO) return;
      const opt = readForm(px);
      if (t.prop && !opt.value && kind !== 'game') return toast('목록에서 골라 주세요.', true);
      engine.updateSource(it.name, kind, opt); saveScenes(); toast(`'${it.name}' 적용했어요.`);
    }));
  });
}
function srcFocus(id) {
  const c = document.querySelector(`#srcList .sp-card[data-id="${id}"]`); if (!c) return;
  c.scrollIntoView({ block: 'start', behavior: 'smooth' });
  c.classList.remove('hl'); void c.offsetWidth; c.classList.add('hl');
}
$('srcScenes').addEventListener('click', (e) => { const b = e.target.closest('.sp-sc'); if (!b) return; srcScene = b.dataset.id; renderSrcTab(true); document.querySelector('.tab-body').scrollTop = 0; });
engine.on('scenes', () => { if ($('tab-sources')?.classList.contains('on')) { try { renderSrcTab(); } catch {} } });

// ================================================================== 녹화 파일 (형식 · 저장 위치)
function renderRecFile() {
  const f = ['mkv', 'mp4', 'mov'].includes(cfg.recFormat) ? cfg.recFormat : 'mkv';
  $('recFmt').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
  $('recDirV').textContent = info.recordDir || '';
  $('recDirV').title = info.recordDir || '';
}
$('recFmt').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (!DEMO && engineOk && engine.recording) return toast('녹화가 끝난 뒤에 바꿀 수 있어요.', true);
  cfg.recFormat = b.dataset.f; save(); renderRecFile();
  if (b.dataset.f !== 'mkv') toast('mp4 · mov는 녹화 중에 프로그램이 꺼지면 파일이 깨질 수 있어요.');
});

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
      out.push({ id: x.id, name: x.name, icon: x.icon, x: r.x, y: r.y, w: r.w, h: r.h, where: x.where || 'both' });
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
    items.push({ x: m.ox + r.x * m.s, y: m.oy + r.y * m.s, w: r.w * m.s, h: r.h * m.s, name: r.name, state, off: r.where === 'stream' ? 'record' : r.where === 'record' ? 'stream' : '' });
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
  guideRaf = requestAnimationFrame(() => { guideRaf = 0; try { ipcRenderer.send('ov:draw', { ...guideData(), color: guideColors() }); } catch (e) { rlog('warn', 'guide', e); } });
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
  if (e.key === 'Escape' && !$('addMenu').hidden) { closeAdd(); return; }
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
    row.innerHTML = `<button class="mute" title="음소거">${a.muted ? ic('mute') : ic('volume')}</button><div class="nm">${esc(a.label)}<span class="dot"></span></div><span class="pct"></span>
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
engine.on('audio', () => { renderMixer(); renderApps(true); renderTracks(); });

// ================================================================== 녹화 트랙 분리 (OBS 오디오 트랙 1~6)
// 트랙 1 = 전체 소리(방송과 같음). 소리마다 2~6 중 하나를 고르면 그 트랙에 그 소리만 따로 담김
const SCENE_TRK = '__scene__';
function recTracks() {
  const rt = cfg.recTracks && typeof cfg.recTracks === 'object' ? cfg.recTracks : (cfg.recTracks = { on: false, map: {}, scene: 0 });
  rt.map = rt.map || {}; rt.scene = Number(rt.scene) || 0; return rt;
}
// 처음 켤 때 기본값: 마이크 2, 데스크톱 3, 프로그램 4~6
function trkDefaults(list) {
  const rt = recTracks(); if (Object.keys(rt.map).length) return;
  let next = 4;
  for (const a of list) {
    if (a.label === '마이크' || a.kind === 'mic') rt.map[a.name] = 2;
    else if (a.label === '데스크톱 소리' || a.kind === 'desktop') rt.map[a.name] = 3;
    else if (next <= 6) rt.map[a.name] = next++;
  }
}
function trkApply() { save(); if (!DEMO && engineOk) { try { engine.setRecTracks(recTracks()); } catch (e) { rlog('warn', 'rec tracks', e); } } }
function renderTracks() {
  const box = $('trkList'), chk = $('trkOn'); if (!box || !chk) return;
  const rt = recTracks(); chk.checked = !!rt.on;
  box.hidden = !rt.on; $('trkHint').hidden = !rt.on;
  if (!rt.on) { box.innerHTML = ''; return; }
  const list = DEMO ? demo.audio : engineOk ? engine.audioList() : [];
  const rows = list.map((a) => ({ key: a.name, label: a.label, t: Number(rt.map[a.name]) || 0 }));
  rows.push({ key: SCENE_TRK, label: '장면 소리', sub: '웹캠 · 알림창', t: rt.scene });
  box.innerHTML = '<div class="trk-row trk-all"><div class="trk-nm">전체 소리</div><div class="trk-seg"><span class="trk-one">트랙 1</span></div></div>';
  for (const r of rows) {
    const row = document.createElement('div'); row.className = 'trk-row';
    row.innerHTML = `<div class="trk-nm">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div><div class="trk-seg">` +
      [0, 2, 3, 4, 5, 6].map((t) => `<button data-t="${t}" class="${r.t === t ? 'on' : ''}" title="${t ? '트랙 ' + t : '따로 안 나눔'}">${t || '–'}</button>`).join('') + '</div>';
    row.querySelector('.trk-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const t = Number(b.dataset.t);
      if (r.key === SCENE_TRK) rt.scene = t; else rt.map[r.key] = t;
      trkApply(); renderTracks();
    });
    box.appendChild(row);
  }
}
$('trkOn').addEventListener('change', () => {
  const rt = recTracks(); rt.on = $('trkOn').checked;
  if (rt.on) trkDefaults(DEMO ? demo.audio : engineOk ? engine.audioList() : []);
  trkApply(); renderTracks();
  if (rt.on && !DEMO && engine.recording) toast('다음 녹화부터 트랙이 나뉘어요.');
});
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
$('soundGear').addEventListener('click', () => openTab('sound'));
$('soundBack').addEventListener('click', () => openTab(tabBeforeSound));

// ================================================================== 사운드 탭: 지금 나오는 소리 → 끌어다 분리
let liveApps = [];          // [{ exe, desc, title, peak }]
const liveLevels = {};      // exe(lower) -> { v, t }
let liveSeen = {};          // exe(lower) -> 마지막으로 보인 시각 (잠깐 조용해도 목록에서 바로 안 사라지게)
let soundOpen = false, liveRenderT = 0;
function soundTabOpened() {
  if (soundOpen) return; soundOpen = true;
  renderDevices(); renderLiveApps(); renderSepApps(); renderTracks(); renderVis();
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
    c.innerHTML = `<div class="lv"></div><span class="ava">${esc(label.slice(0, 1).toUpperCase())}</span><div class="nm">${esc(label)}<small>${on ? `<b class="tag">${ic('check')}사운드에 있음</b>` : esc(a.exe)}</small></div>`;
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
// 블루투스 이어폰(버즈 · 에어팟 등) 마이크를 열면 윈도우가 '통화 모드'로 바꿔서 이어폰 음질이 확 떨어짐 → 알려 주고 고르게
const BT_MIC = /hands-?free|핸즈프리|buds|airpods|bluetooth|블루투스|\bAG Audio\b|wf-1000|wh-1000|galaxy/i;
async function checkBtMic() {
  if (DEMO || !engineOk || cfg.btMicOk || cfg.devices.mic === '__off__') return;
  let name = '';
  try {
    const cur = cfg.devices.mic || 'default';
    if (cur !== 'default') name = (engine.audioDevices('mic').find((d) => d.value === cur) || {}).name || '';
    else { const ds = await navigator.mediaDevices.enumerateDevices(); name = (ds.find((d) => d.kind === 'audioinput' && d.deviceId === 'default') || {}).label || ''; }
  } catch {}
  if (!BT_MIC.test(name)) return;
  rlog('info', 'bt mic', name);
  const i = await uiNotice({ icon: 'warn', title: '블루투스 이어폰 마이크를 쓰고 있어요', message: name.replace(/^기본값\s*-\s*/, ''),
    steps: ['이어폰 마이크를 켜면 윈도우가 <b>통화 모드</b>로 바꿔요', '그래서 <b>이어폰 소리 음질이 확 떨어져요</b>'],
    buttons: ['다른 마이크 고르기', '마이크 끄기', '그대로 쓰기'] });
  if (i === 0) { openTab('sound'); setTimeout(() => $('devMic')?.focus(), 200); }
  else if (i === 1) { cfg.devices.mic = '__off__'; save(); try { engine.setAudioDevice('마이크', '__off__'); } catch {} renderDevices(); toast('마이크를 껐어요. 이어폰 음질이 돌아와요.'); }
  else if (i === 2) { cfg.btMicOk = true; save(); }
}
function renderDevices() {
  if (!engineOk) { for (const id of ['devDesktop', 'devMic']) $(id).innerHTML = '<option>엔진 준비 중</option>'; return; }
  for (const [sel, name, kind] of [['devDesktop', '데스크톱 소리', 'desktop'], ['devMic', '마이크', 'mic']]) {
    const el = $(sel); el.innerHTML = optionList(engine.audioDevices(kind), '장치 없음') + (kind === 'mic' ? '<option value="__off__">사용 안 함</option>' : '');
    const opts = [...el.options].map((o) => o.value);
    el.value = (opts.includes(cfg.devices[kind]) || cfg.devices[kind] === '__off__') ? cfg.devices[kind] : opts.includes('default') ? 'default' : (opts[0] || '');
    el.onchange = guard(() => { engine.setAudioDevice(name, el.value); cfg.devices[kind] = el.value; save(); toast('장치를 바꿨어요.'); if (kind === 'mic') { cfg.btMicOk = false; setTimeout(checkBtMic, 300); } });
  }
}

// ================================================================== 통합 시청자 (👁)
const viewers = { chzzk: null };
function renderViewers() {
  const eye = $('viewerEye'), num = $('viewerTotal'), det = $('viewerDetail');
  eye.classList.toggle('on', cfg.showViewers);
  eye.innerHTML = cfg.showViewers ? ic('eye') : ic('eyeOff');
  if (!cfg.showViewers) { num.textContent = '•••'; num.classList.add('masked'); det.textContent = ''; return; }
  num.classList.remove('masked');
  if (DEMO) { num.textContent = '1,284'; det.textContent = '치지직 912 · 유튜브 372'; return; }
  if (!cfg.channels.chzzk) { num.textContent = '-'; det.textContent = '치지직 로그인 필요'; return; }
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
// 치지직 채널은 [방송 정보]에서 치지직 로그인하면 자동으로 들어감 (따로 넣을 필요 없음)
function syncChzzkChannel(st) {
  let changed = false;
  for (const p of ['chzzk', 'youtube']) {
    const id = st && st[p] && st[p].connected && st[p].channel ? st[p].channel.id : '';
    if (id && id !== cfg.channels[p]) { cfg.channels[p] = id; changed = true; }
  }
  if (!changed) return;
  save(); try { chatConfigure(); } catch {} pollViewers();
}
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
    $('chatFeed').innerHTML = `<div class="chat-empty"><b>로그인하면 채팅이 여기 모여요</b><br><button id="chatGoSettings">로그인하러 가기</button></div>`;
    $('chatGoSettings').onclick = () => openTab('stream');
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
// 채팅 한 줄: 프로필(첫 글자 + 플랫폼 점) · 이름 · 배지 · 시간 / 내용. 같은 사람이 연달아 치면 이름 줄 생략
// 플랫폼 표시: platform/<이름>.png 공식 로고가 있으면 로고, 없으면 색 + 글자 배지
const PLAT_LETTER = { chzzk: '치', youtube: '유', soop: '숲' };
const PLAT_IMG = {};
for (const k of Object.keys(PLAT_LETTER)) { try { if (require('fs').existsSync(require('path').join(__dirname, 'platform', `${k}.png`))) PLAT_IMG[k] = `platform/${k}.png`; } catch {} }
function platMark(p, cls = '') { return `<i class="pm ${p} ${cls}" title="${CHAT_P[p] || p}">${PLAT_IMG[p] ? `<img src="${PLAT_IMG[p]}" alt="">` : (PLAT_LETTER[p] || '?')}</i>`; }
// 고정 화면(채팅 전환 탭 · 오버레이 플랫폼 고르기)의 색 점도 플랫폼 표시로
document.querySelectorAll('i.pd.chzzk, i.pd.youtube, i.pd.soop').forEach((el) => { const p = ['chzzk', 'youtube', 'soop'].find((k) => el.classList.contains(k)); el.outerHTML = platMark(p, 'sm'); });
// 채팅 등급 배지: 스트리머 · 매니저 · 열혈 · 멤버 · 팬 (아이콘 + 글자)
const BADGE = {
  '스트리머': ['st', '<path d="M3 8l4 3 5-6 5 6 4-3-2 10H5z"/>'],
  '매니저': ['mg', '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'],
  '열혈': ['hot', '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.5 2 3 0-3 0-6 1-8.5z"/>'],
  '멤버': ['mb', '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'],
  '팬': ['fan', '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'],
};
function badgeHtml(b) {
  if (!b) return '';
  const [cls, path] = BADGE[b] || ['etc', '<circle cx="12" cy="12" r="4"/>'];
  return `<span class="bd b-${cls}"><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>${esc(b)}</span>`;
}
const AV_COLORS = ['#F7C6D3', '#C9E8F7', '#D6CCF7', '#C8EED9', '#FBE2B8', '#F9CFC2', '#CDE0FA', '#E2D4F0'];
function avColor(nick) { let h = 0; for (const c of String(nick)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function chatHtml(m) {
  const body = (m.parts || []).map((x) => (x.t === 'img' ? `<img src="${esc(x.src)}" alt="${esc(x.alt)}" title="${esc(x.alt)}" loading="lazy" referrerpolicy="no-referrer">` : esc(x.v))).join('');
  const t = new Date(m.ts || Date.now()); const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  const first = [...String(m.nick || '?').trim()][0] || '?';
  const badge = badgeHtml(m.badge);
  if (m.kind === 'system') return `<span class="tx">${body}</span>`;
  return `<span class="av" style="background:${avColor(m.nick)}">${esc(first)}${platMark(m.p)}</span>`
    + `<div class="cb"><div class="ch"><span class="nk">${esc(m.nick)}</span>${badge}${m.amount ? `<span class="amt">${esc(m.amount)}</span>` : ''}<span class="tm">${hm}</span></div>`
    + `<div class="tx">${body}</div></div>`;
}
let lastChat = null;   // 연달아 친 채팅 묶기
function addChat(list) {
  try { phoneChat(list); } catch {}
  const feed = $('chatFeed');
  feed.querySelector('.chat-empty')?.remove();
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  const frag = document.createDocumentFragment();
  for (const m of list) {
    const d = document.createElement('div');
    const cont = (m.kind || 'chat') === 'chat' && lastChat && lastChat.p === m.p && lastChat.nick === m.nick && (m.ts || Date.now()) - lastChat.ts < 60000;
    lastChat = { p: m.p, nick: m.nick, ts: m.ts || Date.now() };
    d.className = `cm p-${m.p} ${m.kind || 'chat'}${m.recent ? ' recent' : ''}${cont ? ' cont' : ''}`;
    d.dataset.p = m.p; d.hidden = chat.hidden.has(m.p);
    d.innerHTML = chatHtml(m);
    frag.appendChild(d);
  }
  feed.appendChild(frag);
  while (feed.children.length > CHAT_MAX) feed.firstElementChild.remove();
  if (atBottom || chat.stick) { feed.scrollTop = feed.scrollHeight; chat.stick = true; }
  else { chat.unseen += list.filter((m) => !m.recent).length; $('chatMore').hidden = !chat.unseen; $('chatMore').textContent = `새 채팅 ${chat.unseen}개 ↓`; }
  if (!$('tab-chat').classList.contains('on') && list.some((m) => !m.recent)) $('chatDot').className = 'tab-dot new';
  if (chat.view !== 'all' && list.some((m) => m.p === chat.view)) renderChatView();
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
// 플랫폼별 보기: 브라우저로 공식 채팅창을 띄우지 않고, 우리 채팅 목록을 그 플랫폼만 걸러서 + 위에 채널 상태
function renderChatView() {
  const p = chat.view, all = $('chatAll'), head = $('chatPlat');
  all.hidden = false; $('chatWeb').hidden = true;
  all.dataset.only = p === 'all' ? '' : p;
  if (p === 'all') { head.hidden = true; return; }
  const st = chat.status[p] || {};
  const name = DEMO ? { chzzk: '스트리미', youtube: 'Streamy', soop: 'streamy' }[p] : (bcSt && bcSt[p] && bcSt[p].channel && bcSt[p].channel.name) || '';
  const linked = DEMO || !!cfg.channels[p];
  const live = DEMO ? p !== 'soop' : st.state === 'live';
  const v = DEMO ? { chzzk: 812, youtube: 391 }[p] : p === 'chzzk' ? viewers.chzzk : null;
  const right = live ? `<span class="cp-live"><i></i>LIVE</span>${v != null ? `<b class="cp-v">${Number(v).toLocaleString('ko-KR')}<small>명</small></b>` : ''}`
    : `<span class="cp-st">${esc(linked ? STATE_KO[st.state] || '대기 중' : p === 'soop' ? '준비 중' : '로그인 필요')}</span>`;
  const n = $('chatFeed').querySelectorAll(`.cm.p-${p}`).length;
  const empty = !linked ? (p === 'soop' ? 'SOOP 로그인은 앱 심사가 끝나면 열려요' : `방송 탭에서 ${CHAT_P[p]} 로그인을 해 주세요`) : n ? '' : `아직 ${CHAT_P[p]} 채팅이 없어요`;
  head.hidden = false;
  head.innerHTML = `<div class="cp-row">${platMark(p, 'lg')}<div class="cp-tx"><b>${esc(name || CHAT_P[p])}</b><small>${linked ? '채널 연결됨' : '연결 안 됨'}</small></div>${right}</div>` + (empty ? `<div class="cp-empty">${empty}${!linked && p !== 'soop' ? ' <button class="link inline" id="chatGoLogin">로그인하러 가기</button>' : ''}</div>` : '');
  const g = $('chatGoLogin'); if (g) g.onclick = () => openTab('stream');
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
    const msg = !cfg.channels[p] ? (p === 'soop' ? `<b>SOOP 연동 준비 중이에요</b>` : `<b>${CHAT_P[p]} 로그인이 필요해요</b><br><button id="chatGoSettings2">로그인하러 가기</button>`)
      : p === 'youtube' ? '<b>유튜브 방송이 켜지면 채팅창이 떠요</b><br>방송 시작 후 몇 초 안에 자동으로 나타나요.' : '<b>채널 ID를 확인해 주세요</b>';
    box.insertAdjacentHTML('beforeend', `<div class="chat-empty">${msg}</div>`);
    const b = $('chatGoSettings2'); if (b) b.onclick = () => openTab('stream');
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
  renderChatView();
  { const f = $('chatFeed'); if (chat.stick) f.scrollTop = f.scrollHeight; }
});
ipcRenderer.on('chat:messages', (_e, list) => addChat(list));
ipcRenderer.on('chat:status', (_e, st) => {
  const prev = chat.status[st.p] || {};
  chat.status[st.p] = st; renderChatState();
  if (chat.view === st.p) renderChatView();
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
    ? `<b>${esc(PLATFORMS[g.platform].name)}</b> 키 같아요`
    : '어느 플랫폼 키인가요? 눌러서 저장하세요.';
  const btns = $('kgBtns'); btns.innerHTML = '';
  for (const [k, p] of Object.entries(PLATFORMS)) {
    const b = document.createElement('button');
    b.className = g.platform === k ? 'guess' : '';
    b.innerHTML = esc(p.name);
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
    item.innerHTML = `<b>${esc(PLATFORMS[k].name)}</b><span class="pstate ${cls}"><i></i><span>${esc(STATE_TEXT[st] || st)}</span></span><code>${esc(maskKey(cfg.keys[k]))}</code><button class="x" title="키 지우기">${ic('x')}</button>`;
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
    const r = await uiConfirm({ title: '방송 종료', message: '방송을 종료할까요?', buttons: ['종료', '취소'] });
    if (r === 0) engine.stopStream(); return;
  }
  const targets = Object.entries(cfg.keys).filter(([, key]) => key).map(([platform, key]) => ({ platform, key }));
  if (!targets.length) { openTab('stream'); return toast('방송 탭에서 스트림 키를 하나 이상 넣어 주세요.', true); }
  streamStates = {}; engine.startStream(targets);
  setTimeout(() => ipcRenderer.invoke('chat:kick').catch(() => {}), 8000);   // 방송이 플랫폼에 잡히면 채팅 바로 연결
}));
let lastRecFolder = '';
engine.on('record', (r) => {
  if (r.state === 'warn') { toast(r.error, true); return; }
  $('btnRec').classList.toggle('on', r.state === 'on');
  if (r.state === 'on') {
    const bits = [];
    if (r.tracks > 1) bits.push(`소리 트랙 ${r.tracks}개`);
    if (r.iso > 0) bits.push(`소스 ${r.iso}개 따로`);
    toast('녹화를 시작했어요' + (bits.length ? ` (${bits.join(' · ')})` : '') + '.');
  }
  if (r.state === 'off') {
    lastRecFolder = r.folder || '';
    if (r.error) { toast(r.error, true); return; }
    if (r.warn) toast(r.warn, true);
    if (r.folder) {
      uiConfirm({ title: '녹화를 저장했어요', message: '전체 화면 · 소스별 파일' + (r.project ? ' · 편집 프로젝트' : '') + '를 폴더 하나에 담았어요.',
        detail: r.project ? '프리미어 · 다빈치에서 [가져오기]로 .xml 파일을 열면 트랙별로 깔려요.' : '', buttons: ['폴더 열기', '닫기'] })
        .then((i) => { if (i === 0) ipcRenderer.invoke('rec:open', r.folder); });
    } else toast('녹화를 저장했어요.');
  }
});
$('btnRec').addEventListener('click', guard(() => {
  if (DEMO) return;
  if (engine.recording) return engine.stopRecording();
  const iso = cfg.iso && cfg.iso.on ? isoPicked() : [];
  engine.startRecording(info.recordDir, { iso, format: ['mkv', 'mp4', 'mov'].includes(cfg.recFormat) ? cfg.recFormat : 'mkv' });
}));
$('recOpen').addEventListener('click', () => ipcRenderer.invoke('rec:open', lastRecFolder || ''));

// ================================================================== 소스별 따로 녹화 (고른 소스마다 파일 하나)
const ISO_KINDS = new Set(['monitor', 'window', 'game', 'webcam', 'virtual', 'browser', 'media', 'image']);
function isoCfg() { if (!cfg.iso || typeof cfg.iso !== 'object') cfg.iso = { on: false, names: [] }; cfg.iso.names = cfg.iso.names || []; return cfg.iso; }
function isoCandidates() {
  if (DEMO) return demo.items.filter((x) => ISO_KINDS.has(x.kind)).map((x) => ({ name: x.name, kind: x.kind }));
  if (!engineOk) return [];
  const seen = new Set(), out = [];
  for (const sc of engine.scenes) for (const it of engine.items(sc.id)) {
    if (seen.has(it.name) || (it.kind && !ISO_KINDS.has(it.kind))) continue;
    seen.add(it.name); out.push({ name: it.name, kind: it.kind });
  }
  return out;
}
function isoPicked() { const have = new Set(isoCandidates().map((x) => x.name)); return isoCfg().names.filter((n) => have.has(n)).slice(0, 3); }
function renderIso() {
  const box = $('isoList'), chk = $('isoOn'); if (!box || !chk) return;
  const c = isoCfg(); chk.checked = !!c.on;
  box.hidden = !c.on; $('isoHint').hidden = !c.on;
  if (!c.on) { box.innerHTML = ''; return; }
  const list = isoCandidates(), picked = new Set(isoPicked());
  box.innerHTML = list.length ? '' : '<div class="iso-empty">장면에 화면 · 카메라 소스를 넣으면 여기서 고를 수 있어요.</div>';
  for (const x of list) {
    const on = picked.has(x.name), full = !on && picked.size >= 3;
    const b = document.createElement('button');
    b.className = 'iso-chip' + (on ? ' on' : '') + (full ? ' full' : '');
    b.innerHTML = `<span class="ic">${srcIcon(x.kind)}</span><span class="nm">${esc(x.name)}</span><i>${on ? ic('check') : ''}</i>`;
    b.addEventListener('click', () => {
      if (engineOk && engine.recording) return toast('녹화가 끝난 뒤에 바꿀 수 있어요.', true);
      const cur = isoPicked();
      if (on) c.names = cur.filter((n) => n !== x.name);
      else { if (cur.length >= 3) return toast('따로 녹화는 3개까지 고를 수 있어요.', true); c.names = [...cur, x.name]; }
      save(); renderIso();
    });
    box.appendChild(b);
  }
}
$('isoOn').addEventListener('change', () => { const c = isoCfg(); c.on = $('isoOn').checked; save(); renderIso(); });

// ================================================================== 방송 · 녹화 따로 보이기 (사운드 탭, 녹화 트랙 아래)
// 소스마다 [방송] [녹화] 켜고 끄기 — 모든 장면의 같은 소스에 한 번에 적용
const whereOf = (w) => ({ stream: w !== 'record' && w !== 'none', record: w !== 'stream' && w !== 'none' });
function visSources() {
  if (DEMO) return demo.items.map((x) => ({ name: x.name, kind: x.kind, where: x.where || 'both' }));
  if (!engineOk) return [];
  const seen = new Set(), out = [];
  for (const sc of engine.scenes) for (const it of engine.items(sc.id)) {
    if (seen.has(it.name)) continue; seen.add(it.name);
    out.push({ name: it.name, kind: it.kind, where: engine.sourceWhere(it.name) });
  }
  return out;
}
function renderVis() {
  const box = $('visList'); if (!box) return;
  const list = visSources();
  box.innerHTML = list.length ? '' : '<div class="iso-empty">장면에 소스를 넣으면 여기서 고를 수 있어요.</div>';
  for (const x of list) {
    const w = whereOf(x.where);
    const row = document.createElement('div'); row.className = 'vis-row' + (x.where === 'none' ? ' hid' : x.where !== 'both' ? ' part' : '');
    row.innerHTML = `<span class="ic">${srcIcon(x.kind)}</span><span class="nm">${esc(x.name)}</span><span class="vis-tg">` +
      [['stream', '방송'], ['record', '녹화']].map(([k, l]) => `<button class="vis${w[k] ? '' : ' off'}" data-o="${k}">${ic(w[k] ? 'eye' : 'eyeOff')}<span>${l}</span></button>`).join('') + '</span>';
    row.querySelector('.vis-tg').addEventListener('click', guard((e) => {
      const b = e.target.closest('button'); if (!b || DEMO) return;
      const key = b.dataset.o; w[key] = !w[key];
      // 둘 다 끄면 = 눈 버튼으로 숨긴 것과 같음 (모든 장면에서 숨김)
      if (!w.stream && !w.record) { engine.setWhereSource(x.name, 'both'); engine.setVisibleSource(x.name, false); saveScenes(); renderVis(); return; }
      if (x.where === 'none') engine.setVisibleSource(x.name, true);
      const next = w.stream && w.record ? 'both' : w.stream ? 'stream' : 'record';
      const now = engine.setWhereSource(x.name, next); saveScenes();
      if (!now) toast('지금 방송 · 녹화가 끝나면 적용돼요.');
      renderVis();
    }));
    box.appendChild(row);
  }
}

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
  const show = !!v && ['available', 'downloading', 'ready'].includes(upd.status);
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
    const r = await uiConfirm({ title: '업데이트', message: `Streamy Kit v${v}로 업데이트할까요?` + (quick ? ' (빠른 업데이트)' : ''), detail: quick ? '몇 초 동안 껐다 켜져요. 장면과 설정은 그대로예요.' : '설치하는 동안 잠깐 꺼졌다가 자동으로 다시 켜져요. 장면과 설정은 그대로 유지돼요.', buttons: ['업데이트', '나중에'] });
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
  try { if (engineOk) { writeJson(scenesFile, engine.serialize()); saveAudioState(); writeJson(info.settingsFile, cfgForDisk(cfg)); } } catch (e) { rlog('error', 'save on update', e); }
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
$('introOn').checked = !cfg.introOff;
$('introOn').addEventListener('change', () => { cfg.introOff = !$('introOn').checked; save(); toast(cfg.introOff ? '다음부터 바로 켜져요.' : '다음에 켤 때 보여 드릴게요.'); });
$('gpuOff').addEventListener('change', async () => { const v = await ipcRenderer.invoke('app:set-gpu', $('gpuOff').checked); $('gpuOff').checked = v; toast('저장했어요. 다시 시작하면 적용돼요.'); });

// ================================================================== 미리보기 위치 맞추기 (창 크기 바뀔 때 바로 따라감)
let layoutRaf = 0;
function layoutDisplay() {
  if (!engineOk || layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    if (prevHide.size) return;
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
  if (DEMO) { demoMode(); ipcRenderer.send('intro:open'); return; }

  await nextFrame();
  try { await ipcRenderer.invoke('engine:prepare'); } catch (e) { rlog('warn', 'prepare', e); }
  // 엔진 켜는 동안 화면이 잠깐 멈춰서, 그 전에 안내를 띄우고 메인에 알림 (응답 없음 창 안 띄우게)
  const boot = document.createElement('div'); boot.className = 'boot-ov';
  // 엔진이 켜지는 동안 화면이 멈춰서 진행률을 직접 알 수 없음 → 지난번 걸린 시간 기준으로 막대를 채움 (멈춰도 움직이는 애니메이션)
  const expect = Math.min(300000, Math.max(8000, (cfg.bootMs || 30000) * 1.2));
  boot.innerHTML = `<div class="boot-box"><b>방송 엔진 준비 중</b><div class="boot-bar"><i style="animation-duration:${expect}ms"></i></div>
    <small>일반 데스크톱 기준 최대 30초</small><small>그래픽카드가 없는 노트북은 5분까지 걸릴 수 있어요!</small></div>`;
  if (cfg.introOff) document.body.appendChild(boot);   // 시작 애니메이션이 켜져 있으면 그쪽 로딩 막대가 대신함
  ipcRenderer.send('engine:booting', true); ipcRenderer.send('intro:status', '방송 엔진 준비 중');
  await nextFrame(); await nextFrame();
  const q = { '1080p60': [1920, 1080, 60], '1080p30': [1920, 1080, 30], '720p60': [1280, 720, 60] }[cfg.quality] || [1920, 1080, 60];
  const t0 = performance.now();
  try {
    engine.start({ osnDir: info.osnDir, dataDir: info.dataDir, width: q[0], height: q[1], fps: q[2] });
    rlog('info', `engine started in ${Math.round(performance.now() - t0)}ms`, 'encoders:', engine.encoderTypes().join(','));
    ipcRenderer.send('engine:booting', false);
    cfg.bootMs = Math.round(performance.now() - t0); save();
    boot.classList.add('done'); setTimeout(() => boot.remove(), 450);
    engineOk = true;
    setTimeout(checkBtMic, 3000);
    // 0.19.2~0.21.0에서 넣은 모니터(번호로 지정)는 화면이 안 잡혀서, 진짜 모니터 ID로 바꿔 줌
    setTimeout(function fixMon(n = 0) {
      try {
        const ds = ipcRenderer.sendSync('app:displays') || [];
        if (!ds.some((d) => d.id)) { if (n < 10) setTimeout(() => fixMon(n + 1), 1500); return; }
        let fixed = 0;
        for (const sc of engine.scenes) for (const it of engine.items(sc.id)) {
          const st = engine.sourceSettings(it.name);
          if (!st || st.kind !== 'monitor' || (st.settings.monitor_id && st.settings.monitor_id !== 'DUMMY')) continue;
          const d = ds[Number(st.settings.monitor) || 0] || ds.find((x) => x.primary) || ds[0];
          engine.updateSource(it.name, 'monitor', { value: d.id }); fixed++;
        }
        if (fixed) { saveScenes(); rlog('info', 'monitor fix', fixed); toast('모니터 화면을 다시 잡았어요.'); }
      } catch (e) { rlog('warn', 'monitor fix', e); }
    }, 1500);
    setTimeout(() => { try { for (const it of engine.items()) { const o = engine.itemObj(it.id), st = engine.sourceSettings(it.name); rlog('info', 'source', it.kind, it.name, `${o?.source?.width || 0}x${o?.source?.height || 0}`, it.visible ? 'shown' : 'hidden', JSON.stringify(st?.settings || {}).slice(0, 220)); } } catch (e) { rlog('warn', 'source diag', e); } }, 4000);
  } catch (e) { ipcRenderer.send('engine:booting', false); ipcRenderer.send('intro:open'); boot.remove(); engineError(e); return; }
  try { engine.setRecTracks(cfg.recTracks); } catch (e) { rlog('warn', 'rec tracks', e); }
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
  introWhenFrames();
}
// 시작 애니메이션은 미리보기에 화면이 들어온 뒤에 열기 (웹캠·모니터가 첫 화면을 보내기까지 잠깐 걸림). 최대 3초
function introWhenFrames() {
  ipcRenderer.send('intro:status', '화면 불러오는 중');
  const t0 = performance.now();
  (function poll() {
    let wait = 0;
    try {
      for (const it of engine.items()) {
        if (!it.visible || !['webcam', 'monitor', 'window', 'game', 'virtual', 'image', 'browser'].includes(it.kind)) continue;
        if (!(engine.itemObj(it.id)?.source?.width > 0)) wait++;
      }
    } catch { wait = 0; }
    if (!wait || performance.now() - t0 > 3000) { ipcRenderer.send('intro:open'); if (wait) rlog('info', 'intro: opened before', wait, 'source(s) had frames'); return; }
    setTimeout(poll, 100);
  })();
}

// 개발용 화면 미리보기 (윈도우가 아닌 환경에서 STREAMY_DEMO=1)
const demo = {
  scenes: [{ id: 'a', name: '게임 방송', n: 3 }, { id: 'b', name: '저챗', n: 2 }, { id: 'c', name: '쉬는 시간', n: 1 }, { id: 'd', name: '합방', n: 4 }], current: 'a',
  items: [{ id: 3, name: '웹캠', kind: 'webcam', icon: '', visible: true, selected: true }, { id: 2, name: '타이머', kind: 'timer', icon: '', visible: true, selected: true, where: 'record' }, { id: 1, name: '모니터 1', kind: 'monitor', icon: '', visible: true }],
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
    { p: 'chzzk', nick: '스트리미', parts: [{ t: 'text', v: '다들 어서 와요~ 오늘 랭크 갑니다' }], badge: '스트리머' },
    { p: 'chzzk', nick: '치즈냥', parts: [{ t: 'text', v: '오늘 방송 화질 미쳤다 ㄷㄷ' }], badge: '' },
    { p: 'youtube', nick: 'MinJun Kim', parts: [{ t: 'text', v: '유튜브에서 보고 있어요!' }] },
    { p: 'chzzk', nick: '매니저봇', parts: [{ t: 'text', v: '공지: 오늘은 10시까지 방송합니다' }], badge: '매니저' },
    { p: 'chzzk', kind: 'donation', nick: '후원왕', amount: '10,000치즈', parts: [{ t: 'text', v: '방송 잘 보고 있어요 화이팅!!' }] },
    { p: 'youtube', nick: 'streamy_fan', parts: [{ t: 'text', v: '사운드 분리 어떻게 한 거예요?' }], badge: '멤버' },
    { p: 'soop', nick: '숲속주민', parts: [{ t: 'text', v: 'SOOP에서도 같이 봐요 ㅎㅎ' }], badge: '팬' },
    { p: 'soop', nick: '불꽃시청자', parts: [{ t: 'text', v: '열혈 1년차 출석!' }], badge: '열혈' },
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
// 오른쪽 탭 안 구역 나누기: 제목(h4)마다 카드 하나로 묶기 (방송 · 설정 · 사운드 설정)
for (const id of ['tab-stream', 'tab-settings', 'tab-sound']) {
  const tab = $(id); if (!tab) continue;
  let card = null;
  for (const el of [...tab.children]) {
    if (el.tagName === 'H4') { card = document.createElement('div'); card.className = 'sec-card'; tab.insertBefore(card, el); }
    if (card && !el.classList.contains('tab-back')) card.appendChild(el);
  }
}
// 탭 안 작은 탭: 카드 제목(h4)으로 어느 칸에 들어갈지 정함
const SUBTABS = {
  'tab-stream': [['live', '실시간', ['스트림 키', '방송 정보', '인코더', '화질', '방송 · 녹화 따로 보이기']], ['rec', '녹화', ['녹화 파일', '소스별 따로 녹화', '녹화 사운드 트랙 분리', '채팅 기록']]],
  'tab-sound': [['dev', '장치 설정', ['기본 사운드 장치']], ['fil', '필터 설정', ['마이크 필터']], ['set', '사운드 설정', ['사운드 분리']]],
  'tab-settings': [['theme', '테마', ['최소화 오버레이', '화면 테마']], ['upd', '업데이트 · 공지', ['업데이트']], ['app', '프로그램 설정', ['문제 해결']]],
};
function subOf(tabId) { const subs = SUBTABS[tabId]; const v = cfg.subTab && cfg.subTab[tabId]; return subs.some(([k]) => k === v) ? v : subs[0][0]; }
function applySub(tabId) {
  const tab = $(tabId), cur = subOf(tabId);
  tab.querySelectorAll(':scope > .subtabs button').forEach((b) => b.classList.toggle('on', b.dataset.sub === cur));
  tab.querySelectorAll(':scope > .sec-card').forEach((c) => c.classList.toggle('sub-off', (c.dataset.sub || '') !== cur));
}
for (const [tabId, subs] of Object.entries(SUBTABS)) {
  const tab = $(tabId); if (!tab) continue;
  for (const card of tab.querySelectorAll(':scope > .sec-card')) {
    const h = card.querySelector(':scope > h4'); const t = h ? (h.childNodes[0].textContent || '').trim() : '';
    const hit = subs.find(([, , heads]) => heads.includes(t));
    card.dataset.sub = hit ? hit[0] : subs[subs.length - 1][0];
  }
  const nav = document.createElement('nav'); nav.className = 'subtabs';
  nav.innerHTML = subs.map(([k, l]) => `<button data-sub="${k}">${l}</button>`).join('');
  const back = tab.querySelector(':scope > .tab-back');
  tab.insertBefore(nav, back ? back.nextSibling : tab.firstChild);
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    cfg.subTab = { ...(cfg.subTab || {}), [tabId]: b.dataset.sub }; save(); applySub(tabId);
    document.querySelector('.tab-body').scrollTop = 0;
    if (tabId === 'tab-stream') renderStreamSubs();
  });
  applySub(tabId);
}
try { const vg = document.querySelector('#vtGo > span'); if (vg) vg.innerHTML = FLAT_ICONS.virtual; } catch {}
document.querySelectorAll('[data-ic]').forEach((el) => { el.innerHTML = UI_ICON(el.dataset.ic); });
// 화면 테마: 기본 = 밝은 카드, 설정에서 예전 검정·빨강
// 포인트 색: 사용자가 고름 (기본 핑크). 밝게/다크에 맞춰 글자용 · 옅은 배경색을 계산
const ACCENTS = [['#E5577E', '핑크'], ['#0F9F74', '민트'], ['#6B5CE7', '보라'], ['#3D7BEA', '블루'], ['#F08A24', '오렌지']];
const hexRgb = (h) => { const n = parseInt(String(h).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (h, to, t) => { const a = hexRgb(h), b = to === 'w' ? [255, 255, 255] : [0, 0, 0]; return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
function accentNow() { const a = String(cfg.accent || ACCENTS[0][0]); return /^#[0-9a-f]{6}$/i.test(a) ? a : ACCENTS[0][0]; }
function guideColors() { const a = accentNow(); return [cfg.themeDark ? mixHex(a, 'w', 0.12) : a, mixHex(a, 'w', 0.35), rgba(a, 0.11)]; }
function applyAccent(light) {
  const a = accentNow(), dark = !!cfg.themeDark, st = document.body.style;
  st.setProperty('--red', a);
  st.setProperty('--red2', mixHex(a, 'w', 0.12));
  st.setProperty('--red-dark', mixHex(a, 'k', 0.28));
  st.setProperty('--soft', rgba(a, dark ? 0.18 : 0.12));
  st.setProperty('--soft2', rgba(a, dark ? 0.08 : 0.06));
  st.setProperty('--link', dark ? mixHex(a, 'w', 0.42) : mixHex(a, 'k', 0.28));
  // 바탕도 순흰색·순검정 대신 포인트 색이 아주 살짝 섞인 부드러운 톤으로
  const tint = (base, t) => { const x = hexRgb(base), y = hexRgb(a); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const N = dark
    ? { '--bg': ['#16171C', .04], '--bg2': ['#1F2128', .03], '--card': ['#1F2128', .03], '--card2': ['#282A33', .035], '--sec': ['#24262E', .035], '--line': ['#31343E', .04], '--line2': ['#3F4250', .04], '--hover': ['#2E3039', .05] }
    : { '--bg': ['#E9EBF0', .05], '--bg2': ['#F7F7F9', .02], '--card': ['#F7F7F9', .02], '--card2': ['#EFF0F3', .035], '--sec': ['#EAECF0', .045], '--line': ['#DDE0E6', .05], '--line2': ['#CBCFD8', .05], '--hover': ['#E3E5EB', .06] };
  for (const [k, [b, t]] of Object.entries(N)) st.setProperty(k, tint(b, t));
  if (light) return;          // 색 고르는 중: 화면 색만 바로 (아이콘 · 오버레이 · 목록은 놓을 때)
  applyAppIcon(a);
  if (typeof miniConfigSend === 'function') setTimeout(miniConfigSend, 0);
  const row = $('accentRow');
  if (row) {
    row.innerHTML = ACCENTS.map(([h, n]) => `<button class="accent-sw${h.toLowerCase() === a.toLowerCase() ? ' on' : ''}" data-c="${h}" title="${n}" aria-label="${n}" style="--c:${h}"><i></i><span>${n}</span></button>`).join('')
      + `<button class="accent-sw custom${ACCENTS.some(([h]) => h.toLowerCase() === a.toLowerCase()) ? '' : ' on'}" id="accentCustom" title="직접 고르기" style="--c:${a}"><i></i><span>직접</span></button>`;
  }
}
// 앱 아이콘도 포인트 색 따라가기 (제목줄 로고 · 작업 표시줄 · 트레이)
function logoSvg(c) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="8" y="8" width="496" height="496" rx="104" fill="#0E0E10"/><rect x="34" y="34" width="444" height="444" rx="82" fill="none" stroke="${c}" stroke-width="18"/><text x="250" y="338" text-anchor="middle" font-family="Segoe UI Black,Segoe UI,Arial Black,Arial,sans-serif" font-weight="900" font-size="300" fill="#fff">S</text><circle cx="404" cy="108" r="40" fill="${c}"/></svg>`;
}
let iconFor = '', iconT = 0;
function applyAppIcon(c) {
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSvg(c));
  const img = document.querySelector('.brand img'); if (img) img.src = url;
  if (iconFor === c) return; iconFor = c;
  clearTimeout(iconT); iconT = setTimeout(() => {      // 색 고르는 중엔 너무 자주 안 바꾸게
    const im = new Image();
    im.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = cv.height = 256;
        cv.getContext('2d').drawImage(im, 0, 0, 256, 256);
        ipcRenderer.send('app:icon', cv.toDataURL('image/png'));
      } catch (e) { rlog('warn', 'icon', e); }
    };
    im.src = url;
  }, 250);
}
// ================================================================== 화면 꾸미기 (글자 크기 · 글꼴 · 끌어서 배치)
const { webFrame } = require('electron');
const BLOCKS = {
  scenes: { label: '장면', el: () => document.querySelector('.scene-row') },
  sources: { label: '소스 목록', el: () => document.querySelector('.src-rail') },
  preview: { label: '미리보기', el: () => document.querySelector('.stage-top'), fixed: true },
  edit: { label: '정렬 버튼', el: () => $('editBar') },
  sound: { label: '사운드', el: () => document.querySelector('.sound') },
  panel: { label: '방송 · 채팅 · 소스 · 설정', el: () => $('panel') },
};
const LAY_DEF = { cols: { l: ['scenes', 'sources'], c: ['preview', 'edit', 'sound'], r: ['panel'] }, wl: 248, wr: 380, zoom: 100, font: '', h: {} };
function lay() {
  const L = { ...LAY_DEF, ...(cfg.layout2 || {}) };
  const cols = { l: [...(L.cols?.l || [])], c: [...(L.cols?.c || [])], r: [...(L.cols?.r || [])] };
  const seen = new Set(Object.values(cols).flat());
  for (const k of Object.keys(BLOCKS)) if (!seen.has(k)) cols[k === 'panel' ? 'r' : k === 'preview' ? 'c' : 'l'].push(k);   // 빠진 칸은 기본 자리로
  if (!cols.c.includes('preview')) { for (const k of ['l', 'r']) cols[k] = cols[k].filter((x) => x !== 'preview'); cols.c.unshift('preview'); }
  return { ...L, cols };
}
let railR = null;
function applyLayout() {
  const L = lay();
  if (!railR) { railR = document.createElement('aside'); railR.className = 'rail rail-r'; railR.id = 'railR'; document.querySelector('.layout').appendChild(railR); }
  const host = { l: $('rail'), c: document.querySelector('.stage'), r: railR };
  for (const [k, list] of Object.entries(L.cols)) for (const id of list) { const el = BLOCKS[id].el(); if (el) host[k].appendChild(el); }
  host.l.style.width = L.wl + 'px'; host.r.style.width = L.wr + 'px';
  for (const [k, list] of Object.entries(L.cols)) {
    const fill = colFiller(list);
    for (const id of list) {
      const el = BLOCKS[id].el(); if (!el) continue;
      const h = (L.h || {})[id];
      if (id === fill) { el.style.flex = '1 1 0'; el.style.height = ''; el.style.minHeight = '0'; }
      else if (h) { el.style.flex = `0 0 ${h}px`; el.style.height = h + 'px'; el.style.minHeight = '0'; el.classList.add('lay-sized'); }
      else { el.style.flex = ''; el.style.height = ''; el.style.minHeight = ''; el.classList.remove('lay-sized'); }
    }
  }
  host.l.hidden = !L.cols.l.length; host.r.hidden = !L.cols.r.length;
  const pc = $('phoneCol'); if (pc && pc.parentElement !== document.querySelector('.stage-top')) document.querySelector('.stage-top').appendChild(pc);
  try { webFrame.setZoomFactor((L.zoom || 100) / 100); } catch {}
  document.body.style.setProperty('--font', L.font ? `'${L.font}','Pretendard','Malgun Gothic',system-ui,sans-serif` : '');
  document.body.classList.toggle('custom-font', !!L.font);
  layoutDisplay(); setTimeout(layoutDisplay, 60);
  if (!$('layOv').hidden) renderLayMap();
}
// 기둥마다 남는 높이를 채우는 칸 하나 (나머지는 끌어서 높이 정함)
function colFiller(list) { return ['preview', 'panel', 'sources', 'scenes', 'sound', 'edit'].find((x) => list.includes(x)) || list[list.length - 1]; }
function setLay(patch) { cfg.layout2 = { ...lay(), ...patch }; save(); applyLayout(); }
// 글꼴: 이 PC에 깔린 것만 보여 줌
const FONT_CHOICES = [['', '기본 (Pretendard)'], ['Malgun Gothic', '맑은 고딕'], ['NanumGothic', '나눔고딕'], ['NanumSquareRound', '나눔스퀘어 라운드'], ['NanumSquare', '나눔스퀘어'], ['Noto Sans KR', 'Noto Sans KR'], ['Spoqa Han Sans Neo', '스포카 한 산스'], ['SUIT', 'SUIT'], ['Gmarket Sans', 'G마켓 산스'], ['IBM Plex Sans KR', 'IBM Plex Sans KR'], ['Gulim', '굴림'], ['Dotum', '돋움']];
function fontInstalled(f) {
  if (!f) return true;
  const c = document.createElement('canvas').getContext('2d'), t = '가나다라ABCabc123';
  return ['monospace', 'serif'].some((base) => { c.font = `20px ${base}`; const w0 = c.measureText(t).width; c.font = `20px '${f}',${base}`; return c.measureText(t).width !== w0; });
}
// 사용자가 가져온 글꼴 (파일 → FontFace 등록, 이름만 넣은 건 PC에 깔린 글꼴)
const userFonts = () => Array.isArray(cfg.customFonts) ? cfg.customFonts : [];
function loadUserFonts() {
  for (const f of userFonts()) {
    if (!f.file || document.fonts.check(`12px '${f.family}'`) && f._ok) continue;
    try { const ff = new FontFace(f.family, `url("${require('url').pathToFileURL(f.file).href}")`); ff.load().then((x) => { document.fonts.add(x); f._ok = true; if (!$('layOv').hidden) renderLayFonts(); }).catch(() => {}); } catch {}
  }
}
function renderLayFonts() {
  const cur = lay().font;
  const base = FONT_CHOICES.filter(([f]) => fontInstalled(f) || f === cur).map(([f, n]) => ({ f, n }));
  const mine = userFonts().map((u) => ({ f: u.family, n: u.family, mine: true }));
  $('layFonts').innerHTML = [...base, ...mine.filter((m) => !base.some((b) => b.f === m.f))]
    .map(({ f, n, mine: my }) => `<button class="${f === cur ? 'on' : ''}${my ? ' mine' : ''}" data-f="${esc(f)}" style="font-family:${f ? `'${esc(f)}',` : ''}'Pretendard',sans-serif">${esc(n)}<small>가나다 ABC 123</small>${my ? `<i class="fx" data-rm="${esc(f)}" title="목록에서 빼기">${ic('x')}</i>` : ''}</button>`).join('');
}
$('layFonts').addEventListener('click', (e) => {
  const rm = e.target.closest('.fx');
  if (rm) {
    e.stopPropagation(); const fam = rm.dataset.rm, it = userFonts().find((u) => u.family === fam);
    cfg.customFonts = userFonts().filter((u) => u.family !== fam); save();
    if (it && it.file) ipcRenderer.invoke('app:remove-font', it.file);
    if (lay().font === fam) setLay({ font: '' }); renderLayFonts(); return;
  }
  const x = e.target.closest('button'); if (!x) return; setLay({ font: x.dataset.f }); renderLayFonts();
});
$('layFontFile').addEventListener('click', guard(async () => {
  const got = await ipcRenderer.invoke('app:pick-font'); if (!got || !got.length) return;
  const list = userFonts().filter((u) => !got.some((g) => g.family === u.family));
  cfg.customFonts = [...list, ...got.map((g) => ({ family: g.family, file: g.file }))]; save();
  loadUserFonts(); setLay({ font: got[got.length - 1].family }); renderLayFonts();
  toast(`글꼴 '${got[got.length - 1].family}'을(를) 가져와서 적용했어요.`);
}));
$('layFontNameAdd').addEventListener('click', () => {
  const name = $('layFontName').value.trim(); if (!name) return;
  if (!fontInstalled(name)) return toast(`'${name}' 글꼴을 이 PC에서 못 찾았어요. 이름을 정확히 넣거나 파일로 가져와 주세요.`, true);
  if (!userFonts().some((u) => u.family === name)) { cfg.customFonts = [...userFonts(), { family: name, file: null }]; save(); }
  $('layFontName').value = ''; setLay({ font: name }); renderLayFonts();
});
$('layFontName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('layFontNameAdd').click(); e.stopPropagation(); });
loadUserFonts();
$('layZoom').addEventListener('input', (e) => { $('layZoomV').textContent = e.target.value + '%'; });
$('layZoom').addEventListener('change', (e) => setLay({ zoom: +e.target.value }));
// 배치 지도: 칸 끌어 옮기기 + 기둥 너비 끌기
function renderLayMap() {
  const L = lay(), m = $('layMap');
  const col = (k) => `<div class="lm-col lm-${k}${L.cols[k].length ? '' : ' empty'}" data-col="${k}" ${k !== 'c' ? `style="flex:0 0 ${Math.round((k === 'l' ? L.wl : L.wr) / 2.6)}px"` : ''}>
      ${L.cols[k].map((id, i, arr) => {
        const fill = colFiller(arr), rel = BLOCKS[id].el(), h = (L.h || {})[id] || (rel && rel.offsetHeight) || 0, st = id === fill ? 'flex:1 1 0' : h ? `flex:0 0 ${Math.max(26, Math.round(h * lmScale()))}px` : '';
        return (i ? `<div class="lm-hs" data-a="${arr[i - 1]}" data-b="${id}" title="끌어서 위아래 높이 바꾸기"></div>` : '')
          + `<div class="lm-blk lm-${id}${BLOCKS[id].fixed ? ' fixed' : ''}${id === fill ? ' fill' : ''}" data-id="${id}" ${BLOCKS[id].fixed ? '' : 'draggable="true"'} style="${st}">${BLOCKS[id].fixed ? '' : '<i>⠿</i>'}<span>${BLOCKS[id].label}</span></div>`;
      }).join('')}
      <div class="lm-drop-end">여기에 놓기</div></div>`;
  m.innerHTML = col('l') + '<div class="lm-split" data-s="l"></div>' + col('c') + '<div class="lm-split" data-s="r"></div>' + col('r');
}
function lmScale() { const lay0 = document.querySelector('.layout'); const real = lay0 ? lay0.clientHeight : 800; return 396 / Math.max(300, real); }
let lmDrag = null;
$('layMap').addEventListener('dragstart', (e) => { const b = e.target.closest('.lm-blk'); if (!b || b.classList.contains('fixed')) return e.preventDefault(); lmDrag = b.dataset.id; e.dataTransfer.setData('text/x-lay', lmDrag); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => b.classList.add('dragging'), 0); });
$('layMap').addEventListener('dragend', () => { lmDrag = null; renderLayMap(); });
function lmTarget(e) {
  const colEl = e.target.closest('.lm-col'); if (!colEl) return null;
  const blks = [...colEl.querySelectorAll('.lm-blk:not(.dragging)')];
  let idx = blks.length;
  for (let i = 0; i < blks.length; i++) { const r = blks[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { idx = i; break; } }
  return { col: colEl.dataset.col, idx, colEl, blks };
}
$('layMap').addEventListener('dragover', (e) => {
  if (!lmDrag) return; const t = lmTarget(e); if (!t) return;
  if (lmDrag === 'panel' && t.col === 'c') return;          // 큰 설정 칸은 양옆 기둥에만
  e.preventDefault();
  $('layMap').querySelectorAll('.lm-mark').forEach((x) => x.remove());
  const mk = document.createElement('div'); mk.className = 'lm-mark';
  t.idx < t.blks.length ? t.blks[t.idx].before(mk) : t.colEl.querySelector('.lm-drop-end').before(mk);
});
$('layMap').addEventListener('drop', (e) => {
  if (!lmDrag) return; const t = lmTarget(e); if (!t) return; e.preventDefault();
  const L = lay(); const cols = { l: L.cols.l.filter((x) => x !== lmDrag), c: L.cols.c.filter((x) => x !== lmDrag), r: L.cols.r.filter((x) => x !== lmDrag) };
  const ids = t.blks.map((b) => b.dataset.id).filter((x) => x !== lmDrag);
  const before = ids[t.idx]; const arr = cols[t.col];
  arr.splice(before ? arr.indexOf(before) : arr.length, 0, lmDrag);
  lmDrag = null; setLay({ cols });
});
$('layMap').addEventListener('pointerdown', (e) => {
  const hs = e.target.closest('.lm-hs');
  if (hs) {
    const L = lay(), colEl = hs.closest('.lm-col'), list = L.cols[colEl.dataset.col], fill = colFiller(list);
    const a = hs.dataset.a, b = hs.dataset.b, target = a !== fill ? a : b, sign = target === a ? 1 : -1;
    const tEl = colEl.querySelector(`.lm-blk[data-id="${target}"]`), real = BLOCKS[target].el();
    const sc = lmScale(), y0 = e.clientY, h0 = (L.h || {})[target] || Math.round(real ? real.getBoundingClientRect().height : tEl.offsetHeight / sc);
    const maxH = Math.round((document.querySelector('.layout')?.clientHeight || 800) - 160);
    let h = h0;
    hs.setPointerCapture(e.pointerId); hs.classList.add('on'); tEl.style.flex = `0 0 ${Math.round(h0 * sc)}px`;
    const mv = (ev) => { h = Math.max(48, Math.min(maxH, Math.round(h0 + (ev.clientY - y0) * sign / sc))); tEl.style.flex = `0 0 ${Math.round(h * sc)}px`; };
    const up = () => { hs.removeEventListener('pointermove', mv); hs.classList.remove('on'); setLay({ h: { ...(L.h || {}), [target]: h } }); };
    hs.addEventListener('pointermove', mv); hs.addEventListener('pointerup', up, { once: true });
    return;
  }
  const sp = e.target.closest('.lm-split'); if (!sp) return;
  const side = sp.dataset.s, L = lay(), x0 = e.clientX, w0 = side === 'l' ? L.wl : L.wr;
  sp.setPointerCapture(e.pointerId); sp.classList.add('on');
  const colEl = $('layMap').querySelector(`.lm-${side}`);
  let w = w0;
  const mv = (ev) => { const d = (ev.clientX - x0) * 2.6 * (side === 'l' ? 1 : -1); w = Math.max(200, Math.min(620, Math.round(w0 + d))); colEl.style.flex = `0 0 ${Math.round(w / 2.6)}px`; colEl.dataset.w = w; };
  const up = () => { sp.removeEventListener('pointermove', mv); sp.classList.remove('on'); setLay(side === 'l' ? { wl: w } : { wr: w }); };
  sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up, { once: true });
});
function layOpen(on) {
  $('layOv').hidden = !on; $('layBtn').classList.toggle('on', on);
  hidePreview('layout', on);
  if (on) { const L = lay(); $('layZoom').value = L.zoom; $('layZoomV').textContent = L.zoom + '%'; renderLayFonts(); renderLayMap(); }
}
$('layBtn').addEventListener('click', () => layOpen($('layOv').hidden));
$('layClose').addEventListener('click', () => layOpen(false));
$('layOv').addEventListener('click', (e) => { if (e.target.id === 'layOv') layOpen(false); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('layOv').hidden) { e.stopPropagation(); layOpen(false); } }, true);
$('layReset').addEventListener('click', () => { cfg.layout2 = JSON.parse(JSON.stringify(LAY_DEF)); save(); applyLayout(); layOpen(true); });
applyLayout();
// 화면 모드: 밝게 · 어둡게 · 윈도우 따라가기
const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function themeMode() { return ['light', 'dark', 'auto'].includes(cfg.themeMode) ? cfg.themeMode : (cfg.themeDark ? 'dark' : 'light'); }
function applyTheme() {
  const m = themeMode();
  cfg.themeDark = m === 'auto' ? !!(darkMQ && darkMQ.matches) : m === 'dark';
  document.body.classList.toggle('theme-dark', cfg.themeDark);
  document.querySelectorAll('#modeRow .mode-tile').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  applyAccent();
  if (typeof guideDraw === 'function') guideDraw();
}
$('modeRow').addEventListener('click', (e) => { const b = e.target.closest('.mode-tile'); if (!b) return; cfg.themeMode = b.dataset.m; save(); applyTheme(); });
if (darkMQ) darkMQ.addEventListener('change', () => { if (themeMode() === 'auto') applyTheme(); });
$('accentRow').addEventListener('click', (e) => {
  const b = e.target.closest('button.accent-sw'); if (!b) return;
  if (b.id === 'accentCustom') return colorOpen();
  cfg.accent = b.dataset.c; save(); applyTheme();
});

// ================================================================== 포인트 색 직접 고르기 (전용 창): 끄는 동안 앱 색이 바로 바뀜
const hsv2hex = (h, s2, v) => {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s2 * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
};
const hex2hsv = (hex) => {
  const [r, g, b] = hexRgb(hex).map((x) => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
};
let colorSt = null;
function colorOpen() {
  let ov = $('colorOv');
  if (!ov) {
    ov = document.createElement('div'); ov.className = 'col-ov'; ov.id = 'colorOv';
    ov.innerHTML = `<div class="col-box" role="dialog" aria-label="포인트 색 직접 고르기">
      <div class="col-head"><b>포인트 색</b><small>끌면서 바로 바뀌는 걸 확인하세요</small><button class="lay-x" id="colX" title="취소 (Esc)">${ic('x')}</button></div>
      <div class="col-sv" id="colSv"><i class="col-dot" id="colSvDot"></i></div>
      <div class="col-hue" id="colHue"><i class="col-knob" id="colHueKnob"></i></div>
      <div class="col-row"><span class="col-prev" id="colPrev"></span>
        <label class="col-hex"><span>HEX</span><input id="colHex" maxlength="7" spellcheck="false"></label>
        <span class="col-pv"><button class="col-pv-btn">버튼</button><span class="col-pv-chip">글자</span></span></div>
      <div class="col-cap">추천 · 최근</div>
      <div class="col-sws" id="colSws"></div>
      <p class="col-warn" id="colWarn"></p>
      <div class="col-btns"><button id="colCancel">취소</button><button class="primary-sm" id="colOk">이 색으로</button></div>
    </div>`;
    document.body.appendChild(ov);
    const drag = (el, fn) => el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const mv = (ev) => { const r = el.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))); };
      mv(e); const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); colorLive(true); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
    drag($('colSv'), (x, y) => { colorSt.s = x; colorSt.v = 1 - y; colorSet(); });
    drag($('colHue'), (x) => { colorSt.h = x * 359.9; colorSet(); });
    $('colHex').addEventListener('input', () => {
      let v = $('colHex').value.trim(); if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) { [colorSt.h, colorSt.s, colorSt.v] = hex2hsv(v); colorSet(true); colorLive(true); }
    });
    $('colSws').addEventListener('click', (e) => { const b = e.target.closest('button[data-c]'); if (!b) return; [colorSt.h, colorSt.s, colorSt.v] = hex2hsv(b.dataset.c); colorSet(); colorLive(true); });
    $('colOk').addEventListener('click', () => colorClose(true));
    $('colCancel').addEventListener('click', () => colorClose(false));
    $('colX').addEventListener('click', () => colorClose(false));
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) colorClose(true); });
    window.addEventListener('keydown', (e) => { if ($('colorOv') && !$('colorOv').hidden && e.key === 'Escape') { e.stopPropagation(); colorClose(false); } if ($('colorOv') && !$('colorOv').hidden && e.key === 'Enter' && document.activeElement !== $('colHex')) colorClose(true); }, true);
  }
  const start = accentNow();
  colorSt = { orig: start, h: 0, s: 0, v: 0 };
  [colorSt.h, colorSt.s, colorSt.v] = hex2hsv(start);
  const recent = Array.isArray(cfg.accentRecent) ? cfg.accentRecent : [];
  $('colSws').innerHTML = [...ACCENTS.map(([h, n]) => [h, n]), ...recent.filter((h) => !ACCENTS.some(([a]) => a.toLowerCase() === h.toLowerCase())).slice(0, 6).map((h) => [h, '최근'])]
    .map(([h, n]) => `<button data-c="${h}" title="${n} · ${h}" style="--c:${h}"></button>`).join('');
  ov.hidden = false; hidePreview('color', true);
  colorSet();
}
function colorSet(fromHex) {
  const c = colorSt, hex = hsv2hex(c.h, c.s, c.v);
  c.hex = hex;
  $('colSv').style.setProperty('--hue', hsv2hex(c.h, 1, 1));
  $('colSvDot').style.left = c.s * 100 + '%'; $('colSvDot').style.top = (1 - c.v) * 100 + '%';
  $('colHueKnob').style.left = c.h / 360 * 100 + '%'; $('colHueKnob').style.setProperty('--c', hsv2hex(c.h, 1, 1));
  $('colPrev').style.background = hex;
  if (!fromHex && document.activeElement !== $('colHex')) $('colHex').value = hex.toUpperCase();
  // 너무 밝거나 어두우면 알려 줌 (흰 글씨가 올라가는 버튼 기준)
  const [r, g, b] = hexRgb(hex).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  $('colWarn').textContent = L > 0.55 ? '너무 밝으면 버튼 글씨가 잘 안 보일 수 있어요' : c.v < 0.25 ? '너무 어두우면 어두운 테마에서 잘 안 보여요' : '';
  colorLive(false);
}
let colorRaf = 0;
function colorLive(full) {
  cfg.accent = colorSt.hex;
  if (full) { applyAccent(); if (typeof guideDraw === 'function') guideDraw(); return; }
  if (colorRaf) return;
  colorRaf = requestAnimationFrame(() => { colorRaf = 0; applyAccent(true); });
}
function colorClose(ok) {
  const ov = $('colorOv'); if (!ov || ov.hidden) return;
  ov.hidden = true; hidePreview('color', false);
  if (ok) {
    cfg.accentRecent = [colorSt.hex, ...(cfg.accentRecent || []).filter((h) => h.toLowerCase() !== colorSt.hex.toLowerCase())].slice(0, 6);
  } else cfg.accent = colorSt.orig;
  save(); applyTheme();
}
applyTheme();

// ================================================================== 채팅 기록 (파일 저장)
async function setChatLog(on, quiet) {
  cfg.chatLog = !!on; save();
  try { await ipcRenderer.invoke('chat:log', { on: cfg.chatLog }); } catch (e) { rlog('error', 'chat log', e); }
  $('chatLog').classList.toggle('on', cfg.chatLog); $('chatLog').textContent = cfg.chatLog ? '기록 중' : '기록';
  $('chatLogOn').checked = cfg.chatLog;
  if (!quiet) toast(cfg.chatLog ? '채팅 기록을 시작했어요. 문서 › Streamy Kit › 채팅 로그에 날짜별로 저장돼요.' : '채팅 기록을 껐어요.');
}
$('chatLog').addEventListener('click', () => setChatLog(!cfg.chatLog));
// 채팅 보기 방식: 말풍선(기본) / 한 줄
function applyChatCompact() { $('chatFeed').classList.toggle('compact', !!cfg.chatCompact); $('chatCompact').classList.toggle('on', !!cfg.chatCompact); $('chatCompact').textContent = cfg.chatCompact ? '크게' : '한 줄'; }
$('chatCompact').addEventListener('click', () => { cfg.chatCompact = !cfg.chatCompact; save(); applyChatCompact(); const f = $('chatFeed'); if (chat.stick) f.scrollTop = f.scrollHeight; });
applyChatCompact();
$('chatLogOn').addEventListener('change', () => setChatLog($('chatLogOn').checked));
$('chatLogDir').addEventListener('click', () => ipcRenderer.invoke('chat:log-open'));
$('chatLogDir2').addEventListener('click', () => ipcRenderer.invoke('chat:log-open'));

// ================================================================== 최소화 오버레이
function miniConfigSend() { try { ipcRenderer.send('mini:config', { ...cfg.mini, dark: !!cfg.themeDark, accent: accentNow(), font: (typeof lay === 'function' && lay().font) || '' }); } catch {} }
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
  if (!list.length) {
    renderVtFound([]);
    uiNotice({ icon: 'virtual', title: '켜져 있는 버추얼 프로그램이 없어요', message: '먼저 프로그램을 켜 주세요', chips: VIRTUAL_APPS.map((a) => a.name), buttons: ['확인', '창에서 직접 고르기'] })
      .then((i) => { if (i === 1) { setAddMenu(true); aoKind = 'virtual'; renderAddOv(); } });
    return;
  }
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
  body.innerHTML = `<div class="vprops"><h4>${FLAT_ICONS.virtual} ${esc(name)} <small>버추얼 설정 · 바꾸면 바로 적용돼요</small></h4>
    ${method === 'spout' ? `<div class="vsec"><b>연결 · Spout2</b>
        <div class="row" style="margin:6px 0 0"><select id="vSender">${[[v.sender || 'usefirstavailablesender'], [VTS_SENDER], ['usefirstavailablesender']].filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i).map(([k]) => `<option value="${esc(k)}"${k === (v.sender || 'usefirstavailablesender') ? ' selected' : ''}>${k === 'usefirstavailablesender' ? '처음 보이는 Spout2 화면' : k === VTS_SENDER ? 'VTube Studio (VTubeStudioSpout)' : esc(k)}</option>`).join('')}</select>
        <select id="vComposite" title="가장자리가 검게/하얗게 보이면 바꿔 보세요"><option value="3"${(v.composite || 3) == 3 ? ' selected' : ''}>투명도: 기본</option><option value="4"${v.composite == 4 ? ' selected' : ''}>투명도: 미리 곱한 알파</option><option value="1"${v.composite == 1 ? ' selected' : ''}>투명도: 끔</option></select></div>
        <p class="hint" style="margin:6px 0 0">VTube Studio 설정(톱니바퀴) → 카메라 설정에서 <b>Spout2 출력</b>을 켜고, 배경을 <b>투명</b>으로 두세요. 가장자리가 검게 나오면 투명도 방식을 바꿔 보세요.</p></div>`
      : `<div class="vsec"><b>연결할 창</b><div class="row" style="margin:6px 0 0"><select id="vPick">${virtualPickOptions(curWindow)}</select><button class="ghost" id="vRefresh" title="다시 찾기">${ic('refresh')}</button></div></div>`}
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
const BC_NAME = { chzzk: '치지직', youtube: '유튜브', soop: 'SOOP' };
const BC_PS = ['chzzk', 'youtube', 'soop'];
let bcTab = 'all';
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
  const list = bcTab === 'all' ? BC_PS : [bcTab];
  $('bcAcc').innerHTML = list.map((p) => {
    const a = st[p] || {};
    if (p === 'soop') return `<div class="bc-row" data-p="soop"><i class="pd soop"></i><b>SOOP</b><span>심사 중</span><span class="sp"></span><button disabled>로그인</button></div>`;
    const state = a.connected ? `<span class="ok">${a.channel ? esc(a.channel.name) : '연결됨'}</span>` : a.hasApp ? '' : '<span>준비 중</span>';
    return `<div class="bc-row" data-p="${p}"><i class="pd ${p}"></i><b>${BC_NAME[p]}</b>${state}
      <span class="sp"></span>
      ${a.connected ? `<button class="ghost" data-act="logout">로그아웃</button>` : `<button class="${a.hasApp ? 'primary-sm' : ''}" data-act="login" ${a.hasApp ? '' : 'disabled'}>로그인</button>`}
      ${a.builtin && !a.custom ? '' : '<button class="ghost" data-act="app" title="내 앱 정보 직접 넣기 (고급)">' + ic('gear') + '</button>'}</div>
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
ipcRenderer.on('bc:status', (_e, st) => { bcSt = st; bcRenderAcc(); syncChzzkChannel(st); });
// 방송 정보: [통합] 탭 = 모든 플랫폼 공통, 플랫폼 탭 = "따로 설정"을 켜면 그 플랫폼만 다른 제목·태그
cfg.bc = { title: '', tags: '', desc: '', czCat: null, ytCat: '', toCz: true, toYt: true, toSoop: true, auto: false, own: {}, ...(cfg.bc || {}) };
for (const p of BC_PS) cfg.bc.own[p] = { on: false, title: '', tags: '', desc: '', ...(cfg.bc.own[p] || {}) };
const splitTags = (t) => String(t || '').split(/[,，#\n]/).map((x) => x.trim()).filter(Boolean);
const bcTags = () => splitTags($('bcTags').value);
const bcEditing = () => (bcTab !== 'all' && cfg.bc.own[bcTab].on ? cfg.bc.own[bcTab] : cfg.bc);   // 지금 칸이 고치는 대상
const BC_TO = { chzzk: 'toCz', youtube: 'toYt', soop: 'toSoop' };
function bcTagPreview() {
  const czOk = (t) => t.replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣぁ-ゟ゠-ヿ一-龯]/g, '').slice(0, 15);
  const tags = bcTags(), cz = bcTab === 'all' || bcTab === 'chzzk';
  $('bcTagPrev').innerHTML = tags.map((t, i) => { const c = czOk(t); const off = cz && (i >= 5 || !c); return `<span class="chip ${off ? 'dim' : ''}" title="${off ? '치지직에는 안 들어가요' : ''}">#${esc(t)}</span>`; }).join('');
}
function bcRenderCzCur() {
  const c = cfg.bc.czCat;
  $('bcCzCur').innerHTML = c ? `<span class="chip on">${esc(c.name)}</span><button class="link inline" id="bcCzClear">지우기</button>` : '';
  $('bcCzClear')?.addEventListener('click', () => { cfg.bc.czCat = null; save(); bcRenderCzCur(); });
}
function bcFill() {
  const t = bcTab, own = t !== 'all' && cfg.bc.own[t].on, src = bcEditing();
  document.querySelectorAll('#bcTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  document.querySelectorAll('#bcTabs button').forEach((b) => b.classList.toggle('own', b.dataset.t !== 'all' && cfg.bc.own[b.dataset.t].on));
  $('bcMode').hidden = t === 'all';
  document.querySelectorAll('#bcMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === (own ? 'own' : 'common')));
  $('bcFields').hidden = t !== 'all' && !own;
  $('bcSame').hidden = !(t !== 'all' && !own);
  if (!$('bcSame').hidden) $('bcSame').innerHTML = `<b>${esc(cfg.bc.title || '제목 없음')}</b>${splitTags(cfg.bc.tags).length ? `<span>${splitTags(cfg.bc.tags).map((x) => '#' + esc(x)).join(' ')}</span>` : ''}`;
  $('bcTitle').value = src.title || ''; $('bcTags').value = src.tags || ''; $('bcDesc').value = src.desc || '';
  $('bcDescF').hidden = !(t === 'all' || t === 'youtube');
  $('bcCatCz').hidden = !(t === 'all' || t === 'chzzk'); $('bcCatYt').hidden = !(t === 'all' || t === 'youtube');
  $('bcYtCat').value = cfg.bc.ytCat || ''; $('bcAuto').checked = cfg.bc.auto;
  $('bcTo').hidden = t !== 'all';
  $('bcTo').innerHTML = BC_PS.map((p) => `<button class="bc-to-chip${cfg.bc[BC_TO[p]] ? ' on' : ''}${p === 'soop' ? ' wait' : ''}" data-p="${p}"><i class="pm ${p}">${PLAT_LETTER[p]}</i>${BC_NAME[p]}${cfg.bc.own[p].on ? '<em>따로</em>' : ''}</button>`).join('');
  $('bcApply').textContent = t === 'all' ? '모두 적용' : `${BC_NAME[t]}에 적용`;
  $('bcApply').disabled = t === 'soop';
  $('bcAutoL').hidden = t !== 'all';
  $('bcTitleN').textContent = `${$('bcTitle').value.length}/100`; bcTagPreview(); bcRenderCzCur(); bcRenderAcc();
}
const bcSave = () => { const src = bcEditing(); Object.assign(src, { title: $('bcTitle').value, tags: $('bcTags').value, desc: $('bcDesc').value }); cfg.bc.ytCat = $('bcYtCat').value; cfg.bc.auto = $('bcAuto').checked; save(); };
for (const id of ['bcTitle', 'bcTags', 'bcDesc', 'bcYtCat', 'bcAuto']) $(id).addEventListener(/^bc(Auto|YtCat)/.test(id) ? 'change' : 'input', () => { bcSave(); if (id === 'bcTitle') $('bcTitleN').textContent = `${$('bcTitle').value.length}/100`; if (id === 'bcTags') bcTagPreview(); });
$('bcTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; bcTab = b.dataset.t; bcMsg(''); bcFill(); });
$('bcMode').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || bcTab === 'all') return;
  const o = cfg.bc.own[bcTab], on = b.dataset.m === 'own';
  if (on && !o.title && !o.tags) Object.assign(o, { title: cfg.bc.title, tags: cfg.bc.tags, desc: cfg.bc.desc });   // 처음엔 통합 내용을 복사해서 시작
  o.on = on; save(); bcFill();
});
$('bcTo').addEventListener('click', (e) => { const b = e.target.closest('.bc-to-chip'); if (!b) return; const k = BC_TO[b.dataset.p]; cfg.bc[k] = !cfg.bc[k]; save(); bcFill(); });
async function bcCzSearch() {
  const q = $('bcCzQ').value.trim(); if (!q) return;
  $('bcCzRes').innerHTML = '<small class="muted">찾는 중…</small>';
  const r = await bcInvoke('bc:chzzk-categories', q);
  if (!r.ok) { $('bcCzRes').innerHTML = `<small class="muted err">${esc(r.error)}</small>`; return; }
  const TY = { GAME: '게임', SPORTS: '스포츠', ETC: '기타' };
  $('bcCzRes').innerHTML = r.data.length ? r.data.map((c, i) => `<button class="chip" data-i="${i}">${esc(c.name)} <small>${TY[c.type] || ''}</small></button>`).join('') : '<small class="muted">결과 없음</small>';
  $('bcCzRes').querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { const c = r.data[Number(b.dataset.i)]; cfg.bc.czCat = { type: c.type, id: c.id, name: c.name }; save(); $('bcCzRes').innerHTML = ''; bcRenderCzCur(); }));
}
$('bcCzSearch').addEventListener('click', bcCzSearch);
$('bcCzQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bcCzSearch(); } });
// 플랫폼마다 보낼 내용 (따로 설정이 켜져 있으면 그 내용, 아니면 통합 내용)
function bcInfoFor(p) {
  const src = cfg.bc.own[p] && cfg.bc.own[p].on ? cfg.bc.own[p] : cfg.bc;
  return { title: String(src.title || '').trim(), tags: splitTags(src.tags), description: src.desc || '', chzzkCategory: cfg.bc.czCat || undefined, youtubeCategory: cfg.bc.ytCat || undefined };
}
function bcTargets(only) {
  const st = bcSt || {};
  return ['chzzk', 'youtube'].filter((p) => (only ? only.includes(p) : cfg.bc[BC_TO[p]]) && st[p] && st[p].connected);
}
async function bcApply({ only, quiet } = {}) {
  const targets = bcTargets(only);
  if (!targets.length) { if (!quiet) bcMsg('로그인된 플랫폼이 없어요.', true); return null; }
  const empty = targets.filter((p) => !bcInfoFor(p).title);
  if (empty.length && !quiet) { bcMsg(`${empty.map((p) => BC_NAME[p]).join(' · ')} 제목이 비어 있어요.`, true); return null; }
  bcMsg('적용하는 중…');
  const out = {};
  for (const p of targets) {     // 플랫폼마다 내용이 다를 수 있어서 하나씩
    const r = await bcInvoke('bc:apply', bcInfoFor(p), [p]);
    out[p] = r.ok ? (r.data[p] || { ok: true }) : { ok: false, error: r.error };
  }
  const lines = Object.entries(out).map(([p, x]) => x.ok ? `${ic('ok')} ${BC_NAME[p]}${x.warn && x.warn.length ? ` <small>(${esc(x.warn.join(' / '))})</small>` : ''}` : `${ic('warn')} ${BC_NAME[p]}: ${esc(x.error)}`);
  const bad = Object.values(out).some((x) => !x.ok);
  bcMsg(lines.join('<br>'), bad);
  if (!bad) toast('방송 정보를 바꿨어요.');
  return out;
}
$('bcApply').addEventListener('click', () => bcApply(bcTab === 'all' ? {} : { only: [bcTab] }));
$('bcLoad').addEventListener('click', async () => {
  const st = bcSt || {}; const got = [];
  const into = (p, d) => { const dst = bcTab === 'all' ? cfg.bc : cfg.bc.own[p]; if (bcTab !== 'all') dst.on = true; if (d.title) dst.title = d.title; if (d.tags && d.tags.length) dst.tags = d.tags.join(', '); if (d.description != null) dst.desc = d.description; };
  if (st.chzzk && st.chzzk.connected && (bcTab === 'all' || bcTab === 'chzzk')) {
    const r = await bcInvoke('bc:chzzk-get');
    if (r.ok) { into('chzzk', r.data); cfg.bc.czCat = r.data.category; got.push('치지직'); } else bcMsg(esc(r.error), true);
  }
  if (st.youtube && st.youtube.connected && (bcTab === 'youtube' || (bcTab === 'all' && !got.length))) {
    const r = await bcInvoke('bc:youtube-get');
    if (r.ok && r.data) { into('youtube', r.data); if (r.data.categoryId) cfg.bc.ytCat = r.data.categoryId; got.push('유튜브'); }
  }
  save(); bcFill();
  if (got.length) bcMsg(`${got.join(' · ')}에서 불러왔어요.`); else if (!$('bcMsg').classList.contains('err')) bcMsg('불러올 곳이 없어요.', true);
});
// 방송 시작 → 자동 적용 (치지직은 바로, 유튜브는 방송이 잡힐 때까지 몇 번 다시 시도)
async function bcAutoOnLive(platform) {
  if (!cfg.bc.auto || !bcInfoFor(platform).title) return;
  if (!bcTargets([platform]).length || !cfg.bc[BC_TO[platform]]) return;
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
  if (DEMO) { bcSt = { chzzk: { hasApp: true, connected: true, channel: { name: '스트리미' } }, youtube: { hasApp: true, connected: true, channel: { name: 'Streamy' } }, redirect: {} };
    cfg.bc.title = '오늘은 롤 랭크 올립니다!'; cfg.bc.tags = '롤, 랭크, 저챗, 버튜버'; cfg.bc.czCat = { type: 'GAME', id: 'League_of_Legends', name: '리그 오브 레전드' }; bcFill(); bcRenderAcc(); return; }
  bcSt = await ipcRenderer.invoke('bc:status').catch(() => null); bcRenderAcc(); syncChzzkChannel(bcSt);
})();


// ================================================================== VTube Studio: 자동 실행 · Spout2 · 모델/표정/위치 조종
const VTS_EXE = 'vtube studio.exe';
const vtsInvoke = async (ch, ...a) => { if (DEMO) return { ok: false, error: '데모 화면이에요.' }; try { return await ipcRenderer.invoke(ch, ...a); } catch (e) { return { ok: false, error: e.message }; } };
let vtsState = { status: 'off' };
function vtsMsg(t) { $('vtsMsg').innerHTML = t || ''; }
let vtsUserTry = false;
function vtsHowTo() {
  return uiNotice({ icon: 'warn', title: 'VTube Studio에 연결할 수 없어요', message: 'VTube Studio가 꺼져 있거나 API가 꺼져 있어요',
    steps: ['VTube Studio 켜기', '<b>설정</b> (톱니바퀴) 열기', '<b>플러그인 API</b> 켜기 <small>포트 8001</small>'],
    foot: '켜지면 자동으로 다시 연결돼요' });
}
function vtsRender(st) {
  vtsState = st || vtsState;
  const s = vtsState.status;
  const label = { off: '꺼짐', connecting: '연결 중…', 'waiting-allow': '허용 기다리는 중', connected: '연결됨', error: '오류' }[s] || s;
  $('vtsSt').className = 'vts-st ' + (s === 'connected' ? 'on' : s === 'connecting' || s === 'waiting-allow' ? 'wait' : s === 'error' ? 'err' : '');
  $('vtsSt').querySelector('em').textContent = label + (s === 'connected' && vtsState.model ? ` · ${vtsState.model.name}` : '');
  $('vtsConnect').innerHTML = s === 'connected' ? '연결 끊기' : ic('link') + ' 연결';
  $('vtsBody').hidden = s !== 'connected';
  if (s === 'waiting-allow') vtsMsg('VTube Studio 화면에 <b>Streamy Kit 허용</b> 창이 떴어요. <b>허용</b>을 눌러 주세요. (한 번만 하면 돼요)');
  else if (s === 'off' && vtsState.detail && cfg.vtsUse) {
    vtsMsg(`<button class="vts-warn" id="vtsHow"><b class="bang">!</b>VTube Studio에 연결할 수 없어요</button>`);
    $('vtsHow').onclick = vtsHowTo;
    if (vtsUserTry) { vtsUserTry = false; vtsHowTo(); }
  }
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
  vtsUserTry = vtsState.status !== 'connected';
  if (vtsState.status === 'connected' || vtsState.status === 'connecting' || vtsState.status === 'waiting-allow') { cfg.vtsUse = false; save(); await vtsInvoke('vts:disconnect'); vtsMsg(''); return; }
  cfg.vtsUse = true; save();
  vtsMsg('VTube Studio에 연결하는 중…');
  await vtsInvoke('vts:connect');
});
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
  // VTube Studio를 알아서 켜지 않음 (켜기 · 연결 버튼을 눌렀을 때만)
  if (cfg.vtsUse) vtsInvoke('vts:connect');
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
    const r = await uiConfirm({ title: 'Streamy Kit 종료', message: '방송 중이에요. 방송을 끝내고 종료할까요?', buttons: ['종료', '취소'] });
    if (r !== 0) { ipcRenderer.send('app:quit-cancelled'); return; }
  }
  ipcRenderer.send('app:quitting');
  rlog('info', 'shutting down');
  try { if (engineOk) { writeJson(scenesFile, engine.serialize()); saveAudioState(); writeJson(info.settingsFile, cfgForDisk(cfg)); } } catch (e) { rlog('error', 'save on quit', e); }
  try { engine.shutdown(); } catch (e) { rlog('error', 'shutdown', e); }
  ipcRenderer.send('app:ready-to-quit');
});

boot();
