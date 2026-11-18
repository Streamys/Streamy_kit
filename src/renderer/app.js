// Streamy Kit — 화면 로직 (v0.3)
'use strict';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { Engine, SOURCE_TYPES, AUDIO_APPS, PLATFORMS } = require('./engine.js');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const info = ipcRenderer.sendSync('app:info');
const rlog = (level, ...a) => { try { ipcRenderer.send('log', level, ...a.map((x) => (x instanceof Error ? x.stack || x.message : x))); } catch {} };
window.addEventListener('error', (e) => rlog('error', 'window.onerror', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => rlog('error', 'unhandledrejection', e.reason));
const engine = new Engine();
let engineOk = false;
const DEMO = !!process.env.STREAMY_DEMO;

// ================================================================== 설정 저장
const DEFAULTS = {
  platform: 'chzzk', keys: { chzzk: '', youtube: '', soop: '' },
  appAudio: [], audioState: {}, devices: {}, showViewers: false, channels: { chzzk: '' },
  timer: { mode: 'stopwatch', minutes: 10, label: '', theme: 'red' }, quality: '1080p60',
};
const scenesFile = path.join(path.dirname(info.settingsFile), 'scenes.json');
function loadSettings() {
  try { const s = JSON.parse(fs.readFileSync(info.settingsFile, 'utf8')); return { ...DEFAULTS, ...s, keys: { ...DEFAULTS.keys, ...(s.keys || {}) }, timer: { ...DEFAULTS.timer, ...(s.timer || {}) } }; }
  catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
let cfg = loadSettings();
// 예전 설정(audioApps 키 목록) → appAudio 로 옮기기
if (Array.isArray(cfg.audioApps)) { for (const k of cfg.audioApps) { const p = AUDIO_APPS[k]; if (p && !cfg.appAudio.some((a) => a.window === p.window)) cfg.appAudio.push({ window: p.window, label: p.name }); } delete cfg.audioApps; }
cfg.channels = { chzzk: '', ...(cfg.channels || {}) };
const writeJson = (f, d) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(d, null, 2)); fs.renameSync(f + '.tmp', f); } catch (e) { console.error(e); } };
let saveT = null, sceneT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(() => writeJson(info.settingsFile, cfg), 300); }
function saveScenes() { if (!engineOk) return; clearTimeout(sceneT); sceneT = setTimeout(() => { try { writeJson(scenesFile, engine.serialize()); } catch (e) { console.error(e); } }, 600); }
function saveAudioState() {
  if (!engineOk) return;
  cfg.audioState = {}; for (const a of engine.audioList()) cfg.audioState[a.name] = { vol: a.vol, muted: a.muted }; save();
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
    try { const r = fn(...a); if (r && r.catch) r.catch((e) => toast(e.message || String(e), true)); }
    catch (e) { console.error(e); toast(e.message || String(e), true); }
  };
}
function openTab(name) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name));
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));

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
      const cnt = DEMO ? (s.n || 0) : s.scene.getItems().length;
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

// ================================================================== 소스 목록
function selectedItem() { return engine.selected && engine.selected.sceneId === engine.currentId ? engine.selected.itemId : null; }
function renderSources() {
  const ul = $('sourceList'); ul.innerHTML = '';
  $('srcSceneName').textContent = DEMO ? '게임 방송' : engineOk && engine.currentScene ? engine.currentScene.name : '장면';
  const items = DEMO ? demo.items : engineOk ? engine.items() : [];
  if (!items.length) ul.innerHTML = '<li class="empty">아직 소스가 없어요.<br><b>＋ 추가</b>에서 모니터 화면이나 게임을 넣어 보세요.</li>';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = (it.selected ? 'on' : '') + (it.visible ? '' : ' hidden');
    const ic = (SOURCE_TYPES[it.kind] || {}).icon || '•';
    li.innerHTML = `<span class="ic">${ic}</span><span class="nm">${esc(it.name)}</span><button class="eye" title="보이기/숨기기">${it.visible ? '👁' : '◌'}</button>`;
    li.addEventListener('click', guard(() => { if (DEMO) return; engine.select(engine.currentId, it.id); }));
    li.addEventListener('dblclick', guard(() => { if (DEMO) return; engine.select(engine.currentId, it.id); showProps(); }));
    li.querySelector('.eye').addEventListener('click', guard((e) => { e.stopPropagation(); if (DEMO) return; engine.setVisible(it.id, !it.visible); saveScenes(); }));
    ul.appendChild(li);
  }
  renderEditBar();
}
function renderEditBar() {
  const bar = $('editBar'), name = $('selName');
  const hint = ' · 끌어서 이동 · 모서리를 끌어 크기 조절 · Alt 누르면 자석 끄기';
  if (DEMO) { bar.classList.add('has-sel'); name.innerHTML = '선택: <b>웹캠</b>' + hint; return; }
  const id = engineOk ? selectedItem() : null;
  const it = id != null ? engine.items().find((x) => x.id === id) : null;
  bar.classList.toggle('has-sel', !!it);
  name.innerHTML = it ? `선택: <b>${esc(it.name)}</b>` + hint : '미리보기에서 소스를 클릭하면 선택돼요' + hint;
}
engine.on('items', () => { renderSources(); if (engineOk) { const id = selectedItem(); if (id == null) $('propsBody').innerHTML = ''; else if (propsFor !== id) showProps(true); } renderScenesCountsSoon(); });
let countT = 0; function renderScenesCountsSoon() { clearTimeout(countT); countT = setTimeout(renderScenes, 150); }
$('srcAdd').addEventListener('click', () => openTab('add'));
$('srcUp').addEventListener('click', guard(() => { const id = selectedItem(); if (id != null) { engine.moveItem(id, 1); saveScenes(); } }));
$('srcDown').addEventListener('click', guard(() => { const id = selectedItem(); if (id != null) { engine.moveItem(id, -1); saveScenes(); } }));
$('srcDel').addEventListener('click', guard(() => removeSelected()));
document.querySelectorAll('[data-fit]').forEach((b) => b.addEventListener('click', guard(() => { const id = selectedItem(); if (id != null) { engine.fitItem(id, b.dataset.fit); saveScenes(); } })));
async function removeSelected() {
  const id = selectedItem(); if (id == null) return toast('삭제할 소스를 먼저 골라 주세요.');
  const it = engine.items().find((x) => x.id === id);
  const r = await ipcRenderer.invoke('app:confirm', { title: '소스 삭제', message: `'${it.name}'을(를) 이 장면에서 뺄까요?`, buttons: ['삭제', '취소'] });
  if (r === 0) { engine.removeItem(id); saveScenes(); }
}

// ================================================================== 소스 추가 / 속성 폼
let addKind = null;
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
  return first + optionList(engineOk ? engine.choices(kind) : [], kind === 'game' ? '' : '찾지 못했어요');
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
  if (kind === 'virtual') h += '<p class="hint">VTube Studio·VSeeFace 설정에서 <b>Spout2 출력</b>을 켜 주세요. 배경 없이 캐릭터만 들어와요. 다른 프로그램은 <b>게임</b>에서 창을 골라 잡으세요.</p>';
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
  box.innerHTML = `<h4>${t.icon} ${esc(t.label)} 추가</h4>` + sourceForm(addKind, 'a') + '<button class="primary-sm" id="aAdd">현재 장면에 추가</button>';
  bindForm(addKind, 'a');
  $('aAdd').addEventListener('click', guard(() => {
    const opt = readForm('a');
    if (t.prop && addKind !== 'game' && !opt.value) return toast('목록에서 골라 주세요.', true);
    if (t.file && !opt.file) return toast('이미지 파일을 골라 주세요.', true);
    if (t.url && !/^https?:\/\//.test(opt.url || '')) return toast('http(s)로 시작하는 주소를 넣어 주세요.', true);
    if (['webcam', 'monitor', 'window'].includes(addKind) && opt.label) opt.name = opt.label.slice(0, 40);
    const r = engine.addSource(addKind, opt);
    saveScenes();
    toast(`'${r.name}'을(를) 넣었어요. 미리보기에서 끌어서 위치를 맞추세요.`);
  }));
}
let propsFor = null;
function showProps(quiet) {
  if (!quiet) openTab('sources');
  const id = selectedItem(), body = $('propsBody');
  propsFor = id;
  if (id == null) { body.innerHTML = ''; return; }
  const it = engine.items().find((x) => x.id === id), s = engine.sourceSettings(it.name);
  if (!s) { body.innerHTML = '<p class="hint">이 소스는 바꿀 수 있는 설정이 없어요.</p>'; return; }
  const t = SOURCE_TYPES[s.kind] || {};
  body.innerHTML = `<h4>선택한 소스 설정</h4><label class="field">이름<input id="pName" value="${esc(it.name)}"></label>` + sourceForm(s.kind, 'p', s.settings) +
    '<div class="row"><button class="primary-sm" id="pSave">적용</button><button class="ghost" id="pDel">이 장면에서 빼기</button></div>';
  bindForm(s.kind, 'p');
  if (t.prop) { const cur = s.settings[t.prop]; if (cur != null) $('pPick').value = cur; }
  $('pSave').addEventListener('click', guard(() => {
    const opt = readForm('p');
    if (!(t.prop && !opt.value && s.kind !== 'game')) engine.updateSource(it.name, s.kind, opt);
    const nn = $('pName').value.trim(); if (nn && nn !== it.name) engine.renameSource(it.name, nn);
    saveScenes(); toast('적용했어요.'); renderSources();
  }));
  $('pDel').addEventListener('click', guard(() => removeSelected()));
}

// ================================================================== 미리보기에서 끌기 / 크기 조절
const prev = $('preview');
let drag = null, raf = 0, pending = null;
function toCanvas(e) {
  const r = prev.getBoundingClientRect(), z = window.devicePixelRatio || 1;
  const pr = engine.previewRect(r.width * z, r.height * z);
  const k = engine.width / pr.w;                        // 디스플레이 픽셀 → 캔버스 픽셀
  return { x: ((e.clientX - r.left) * z - pr.x) * k, y: ((e.clientY - r.top) * z - pr.y) * k, px: k * z };
}
function cornerAt(rect, p) {
  const tol = 10 * p.px;
  const cs = { tl: [rect.x, rect.y], tr: [rect.x + rect.w, rect.y], bl: [rect.x, rect.y + rect.h], br: [rect.x + rect.w, rect.y + rect.h] };
  for (const [k, [x, y]] of Object.entries(cs)) if (Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol) return k;
  return null;
}
function snap(v, size, total, tol) {
  for (const t of [0, total / 2 - size / 2, total - size]) if (Math.abs(v - t) < tol) return t;
  return v;
}
prev.addEventListener('mousedown', (e) => {
  if (!engineOk || e.button !== 0) return;
  try {
    const p = toCanvas(e), selId = selectedItem();
    if (selId != null) {
      const it = engine.itemObj(selId);
      if (it) {
        const c = cornerAt(engine.itemRect(it), p);
        if (c) { const r = engine.normalize(selId); if (!r || r.w <= 0) return; drag = { mode: 'resize', id: selId, corner: c, start: r, p0: p }; e.preventDefault(); return; }
      }
    }
    const hit = engine.hitTest(p.x, p.y);
    if (!hit) { engine.clearSelection(); renderSources(); return; }
    if (hit.id !== selId) engine.select(engine.currentId, hit.id);
    drag = { mode: 'move', id: hit.id, start: engine.normalize(hit.id), p0: p };
    e.preventDefault();
  } catch (err) { console.error(err); }
});
let hoverT = 0;
window.addEventListener('mousemove', (e) => {
  if (!engineOk) return;
  if (!drag) {
    // 마우스 모양 (IPC 호출을 줄이려고 60ms마다만 확인)
    const now = Date.now(); if (now - hoverT < 60) return; hoverT = now;
    let cls = '';
    const selId = selectedItem();
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
    // 반대쪽 모서리를 고정하고 비율 유지
    const left = drag.corner.includes('l'), top = drag.corner.includes('t');
    const ax = left ? s.x + s.w : s.x, ay = top ? s.y + s.h : s.y;
    const sx = left ? -1 : 1, sy = top ? -1 : 1, ratio = s.w / s.h;
    let w = Math.max(16, s.w + sx * dx), h = Math.max(16, s.h + sy * dy);
    if (w / h > ratio) h = w / ratio; else w = h * ratio;
    if (!e.altKey) { const ex = ax + sx * w; for (const t of [0, engine.width]) if (Math.abs(ex - t) < tol) { w = Math.abs(t - ax); h = w / ratio; } }
    pending = { id: drag.id, x: left ? ax - w : ax, y: top ? ay - h : ay, w };
  }
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) { try { engine.setItemRect(pending.id, pending.x, pending.y, pending.w); } catch {} pending = null; } });
});
window.addEventListener('mouseup', () => { if (drag) { drag = null; saveScenes(); } });

window.addEventListener('keydown', (e) => {
  if (!engineOk || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const n = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'].indexOf(e.key);
  if (n >= 0 && engine.scenes[n]) { e.preventDefault(); engine.switchScene(engine.scenes[n].id); saveScenes(); return; }
  const id = selectedItem(); if (id == null) return;
  const step = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (mv) { e.preventDefault(); const r = engine.normalize(id); engine.setItemRect(id, r.x + mv[0], r.y + mv[1], null); saveScenes(); }
  if (e.key === 'Delete') removeSelected();
  if (e.key === 'Escape') { engine.clearSelection(); renderSources(); }
});

// ================================================================== 오디오 믹서 (막대 뒤에서 소리 레벨이 움직임)
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
engine.on('audio', renderMixer);
// 올라갈 땐 바로, 내려갈 땐 천천히 (눈으로 보기 편하게)
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
  requestAnimationFrame(meterLoop);
}
requestAnimationFrame(meterLoop);

// ================================================================== 사운드 분리 (⚙)
$('soundGear').addEventListener('click', () => { openTab('sound'); renderSoundSettings(true); });
function saveAppAudio() { cfg.appAudio = engine.appAudioList().map((a) => ({ window: a.window, label: a.label })); save(); saveAudioState(); }
function renderSoundSettings(refresh) {
  // 지금 켜져 있는 프로그램
  if (refresh && engineOk) {
    try {
      const items = engine.appChoices();
      $('appPick').innerHTML = items.length ? items.map((x) => `<option value="${esc(x.value)}">${esc(x.name)}</option>`).join('') : '<option value="">켜져 있는 프로그램을 찾지 못했어요</option>';
    } catch (e) { $('appPick').innerHTML = `<option value="">${esc(e.message)}</option>`; }
  }
  // 자주 쓰는 프로그램
  const pre = $('appPresets'); pre.innerHTML = '';
  const using = engineOk ? engine.appAudioList() : DEMO ? [{ window: AUDIO_APPS.discord.window }, { window: AUDIO_APPS.chrome.window }] : [];
  const exeOf = (w) => String(w).split(':').pop().toLowerCase();
  for (const p of Object.values(AUDIO_APPS)) {
    const on = using.some((u) => exeOf(u.window) === exeOf(p.window));
    const b = document.createElement('button'); b.className = 'chip' + (on ? ' on' : ''); b.textContent = (on ? '✓ ' : '+ ') + p.name;
    b.addEventListener('click', guard(() => {
      if (DEMO) return;
      const ex = engine.appAudioList().find((u) => exeOf(u.window) === exeOf(p.window));
      if (ex) engine.removeAudio(ex.name); else engine.addAppAudio(p.window, p.name);
      saveAppAudio(); renderSoundSettings();
    }));
    pre.appendChild(b);
  }
  // 지금 따로 잡는 소리
  const ul = $('sepList'); ul.innerHTML = '';
  const list = engineOk ? engine.appAudioList() : DEMO ? [{ name: 'dc', label: '디스코드', window: 'Discord.exe' }, { name: 'ch', label: '크롬 (유튜브 등)', window: 'chrome.exe' }] : [];
  if (!list.length) ul.innerHTML = '<li class="empty">아직 없어요. 위에서 프로그램을 골라 추가하세요.</li>';
  for (const a of list) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="ic">🔊</span><span class="nm">${esc(a.label)} <small style="color:var(--sub)">${esc(String(a.window).split(':').pop())}</small></span><button class="x" title="빼기">✕</button>`;
    li.querySelector('.x').addEventListener('click', guard(() => { if (DEMO) return; engine.removeAudio(a.name); saveAppAudio(); renderSoundSettings(); }));
    ul.appendChild(li);
  }
  renderDevices();
}
$('appRefresh').addEventListener('click', guard(() => renderSoundSettings(true)));
$('appAdd').addEventListener('click', guard(() => {
  if (DEMO) return;
  const sel = $('appPick'), v = sel.value; if (!v) return toast('목록에서 프로그램을 골라 주세요.', true);
  const label = (sel.selectedOptions[0].textContent.replace(/^\[[^\]]*\]:?\s*/, '') || v.split(':').pop()).slice(0, 30);
  engine.addAppAudio(v, label); saveAppAudio(); renderSoundSettings();
  toast(`'${label}' 소리를 따로 잡았어요. 아래 사운드에서 볼륨을 조절하세요.`);
}));
engine.on('audio', () => { if ($('tab-sound').classList.contains('on')) renderSoundSettings(); });

// ================================================================== 통합 시청자 (👁)
const viewers = { chzzk: null };
function renderViewers() {
  const eye = $('viewerEye'), num = $('viewerTotal'), det = $('viewerDetail');
  eye.classList.toggle('on', cfg.showViewers);
  eye.textContent = cfg.showViewers ? '👁' : '🙈';
  if (!cfg.showViewers) { num.textContent = '•••'; num.classList.add('masked'); det.textContent = ''; return; }
  num.classList.remove('masked');
  const parts = [];
  if (viewers.chzzk != null) parts.push(['치지직', viewers.chzzk]);
  if (DEMO) { num.textContent = '1,284'; det.textContent = '치지직 912 · 유튜브 372'; return; }
  if (!cfg.channels.chzzk) { num.textContent = '-'; det.textContent = '설정에서 채널 연결'; return; }
  const total = parts.reduce((a, [, n]) => a + n, 0);
  num.textContent = parts.length ? total.toLocaleString('ko-KR') : '-';
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

// ================================================================== 방송 / 녹화
function renderPlatforms() {
  const box = $('platforms'); box.innerHTML = '';
  for (const [k, p] of Object.entries(PLATFORMS)) {
    const b = document.createElement('button'); b.className = 'plat' + (cfg.platform === k ? ' on' : '');
    b.innerHTML = `${esc(p.name)}<small>${p.bitrate}kbps</small>`;
    b.addEventListener('click', () => { if (engine.stream) return toast('방송 중에는 플랫폼을 바꿀 수 없어요.', true); cfg.platform = k; save(); renderPlatforms(); });
    box.appendChild(b);
  }
  $('streamKey').value = cfg.keys[cfg.platform] || '';
}
$('streamKey').addEventListener('input', () => { cfg.keys[cfg.platform] = $('streamKey').value.trim(); save(); });
$('keyShow').addEventListener('click', () => { const k = $('streamKey'), show = k.type === 'password'; k.type = show ? 'text' : 'password'; $('keyShow').textContent = show ? '숨기기' : '보기'; });
$('keyHelp').addEventListener('click', () => ipcRenderer.invoke('app:open-url', PLATFORMS[cfg.platform].keyHelp));
$('srcLink').addEventListener('click', () => ipcRenderer.invoke('app:open-url', 'https://github.com/Streamys/Streamy_kit'));

let liveSince = 0;
function setLive(state, extra = {}) {
  const pill = $('livePill'), btn = $('btnLive');
  pill.className = 'live-pill' + (state === 'live' ? ' live' : state === 'off' ? '' : ' wait');
  $('liveText').textContent = { live: 'LIVE · ' + (extra.platform || ''), starting: '연결 중…', reconnecting: '재연결 중…', stopping: '종료 중…', off: '오프라인' }[state] || state;
  btn.classList.toggle('live', state !== 'off');
  btn.querySelector('span').textContent = state === 'off' ? '방송 시작' : state === 'live' ? '방송 종료' : $('liveText').textContent;
  btn.disabled = state === 'starting' || state === 'stopping';
  liveSince = state === 'live' ? (extra.startedAt || Date.now()) : state === 'off' ? 0 : liveSince;
  if (state === 'off') $('liveTime').textContent = '';
}
engine.on('stream', (s) => {
  setLive(s.state, s);
  if (s.state === 'live') toast(`${s.platform} 방송이 시작됐어요! (인코더: ${s.encoder})`);
  if (s.state === 'off') s.error ? toast(s.error, true) : toast('방송을 종료했어요.');
});
$('btnLive').addEventListener('click', guard(async () => {
  if (DEMO) return;
  if (engine.stream) { const r = await ipcRenderer.invoke('app:confirm', { title: '방송 종료', message: '방송을 종료할까요?', buttons: ['종료', '취소'] }); if (r === 0) engine.stopStream(); return; }
  engine.startStream({ platform: cfg.platform, key: cfg.keys[cfg.platform] });
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
function renderDevices() {
  if (!engineOk) return;
  for (const [sel, name, kind] of [['devDesktop', '데스크톱 소리', 'desktop'], ['devMic', '마이크', 'mic']]) {
    const el = $(sel); el.innerHTML = optionList(engine.audioDevices(kind), '장치 없음');
    el.value = cfg.devices[kind] || 'default';
    el.onchange = guard(() => { engine.setAudioDevice(name, el.value); cfg.devices[kind] = el.value; save(); });
  }
}

// ================================================================== 미리보기 위치 맞추기
function layoutDisplay() {
  if (!engineOk) return;
  const r = prev.getBoundingClientRect(), z = window.devicePixelRatio || 1;
  engine.moveDisplay(r.left * z, r.top * z, r.width * z, r.height * z);
}
new ResizeObserver(layoutDisplay).observe(prev);
window.addEventListener('resize', layoutDisplay);

// ================================================================== 시작 (화면 먼저 → 엔진은 그 다음)
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
function engineError(e) {
  console.error(e); rlog('error', 'engine start failed', e);
  engineOk = false;
  $('previewEmpty').classList.add('err');
  $('engineMsg').textContent = e.message || String(e);
  $('engineSub').textContent = '다시 시작해도 안 되면 로그 폴더의 streamy-kit.log 파일을 보내 주세요.';
  $('encInfo').textContent = '인코더: 엔진 없음';
}
async function boot() {
  $('ver').textContent = 'v' + info.version;
  $('gpuOff').checked = !!info.gpuOff;
  renderPlatforms(); renderTypes(); setLive('off'); timerListen(); renderViewers(); pollViewers();
  $('tMode').value = cfg.timer.mode; $('tMin').value = cfg.timer.minutes; $('tLabel').value = cfg.timer.label; $('tTheme').value = cfg.timer.theme;
  timer({ type: 'config', ...cfg.timer });
  renderScenes(); renderSources(); renderMixer();
  if (DEMO) { engineError(new Error('미리보기 모드')); demoMode(); return; }

  // 1) 화면을 먼저 그림 → 2) 지난번에 남은 엔진 정리 → 3) 엔진 시작 (이 동안 화면은 로딩 표시)
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

  // 장면/오디오 복원은 하나씩 실패해도 전체가 멈추지 않게
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
  const enc = engine.pickEncoder();
  $('encInfo').textContent = '인코더: ' + enc.label + (enc.id === 'obs_x264' ? ' (그래픽카드 인코더를 찾지 못해 CPU를 써요)' : ' (그래픽카드)');
  renderScenes(); renderSources(); renderMixer(); renderTypes();
  try { renderSoundSettings(true); } catch (e) { rlog('warn', 'sound settings', e); }
  rlog('info', `ready in ${Math.round(performance.now() - t0)}ms`);
  if (!engine.items().length) { openTab('add'); toast('＋ 추가에서 모니터 화면이나 게임부터 넣어 보세요.'); }
}
$('btnRetry').addEventListener('click', () => ipcRenderer.send('app:relaunch'));
$('btnRestart').addEventListener('click', () => ipcRenderer.send('app:relaunch'));
$('btnLogs').addEventListener('click', () => ipcRenderer.invoke('app:open-path', info.logDir));
$('btnLogs2').addEventListener('click', () => ipcRenderer.invoke('app:open-path', info.logDir));
$('gpuOff').addEventListener('change', async () => { const v = await ipcRenderer.invoke('app:set-gpu', $('gpuOff').checked); $('gpuOff').checked = v; toast('저장했어요. 다시 시작하면 적용돼요.'); });

// 개발용 화면 미리보기 (윈도우가 아닌 환경에서 STREAMY_DEMO=1)
const demo = {
  scenes: [{ id: 'a', name: '게임 방송', n: 3 }, { id: 'b', name: '저챗', n: 2 }, { id: 'c', name: '쉬는 시간', n: 1 }, { id: 'd', name: '합방', n: 4 }], current: 'a',
  items: [{ id: 3, name: '웹캠', kind: 'webcam', visible: true, selected: true }, { id: 2, name: '타이머', kind: 'timer', visible: true }, { id: 1, name: '모니터 1', kind: 'monitor', visible: true }],
  audio: [{ name: 'd', label: '데스크톱 소리', vol: 0.8, muted: false }, { name: 'm', label: '마이크', vol: 0.72, muted: false }, { name: 'dc', label: '디스코드', vol: 0.55, muted: false }, { name: 'ch', label: '크롬 (유튜브 등)', vol: 0.4, muted: false }, { name: 'sp', label: '스포티파이', vol: 0.3, muted: true }],
  level(name, now) { const base = { d: 0.62, m: 0.5, dc: 0.32, ch: 0, sp: 0.5 }[name] || 0; const v = base ? base + Math.sin(now / 170 + name.length) * 0.12 + Math.sin(now / 53) * 0.05 : 0; return { level: Math.max(0, v), peak: Math.max(0, base + 0.15), t: now }; },
};
function demoMode() {
  $('previewEmpty').classList.remove('err');
  const img = document.createElement('img'); img.src = 'demo-preview.png'; img.className = 'demo-shot'; prev.appendChild(img);
  const sel = document.createElement('div'); sel.className = 'demo-sel'; sel.innerHTML = '<i></i><i></i><i></i><i></i>';
  Object.assign(sel.style, { left: '2.5%', top: '62%', width: '27%', height: '34%' }); prev.appendChild(sel);
  prev.classList.add('has-engine');
  $('encInfo').textContent = '인코더: NVIDIA NVENC (그래픽카드)'; $('sCpu').textContent = '6%'; $('sFps').textContent = '60';
  renderScenes(); renderSources(); renderMixer(); renderSoundSettings(); renderViewers();
}

// ================================================================== 종료
ipcRenderer.on('app:request-quit', async () => {
  if (engine.stream) {
    const r = await ipcRenderer.invoke('app:confirm', { title: 'Streamy Kit 종료', message: '방송 중이에요. 방송을 끝내고 종료할까요?', buttons: ['종료', '취소'] });
    if (r !== 0) { ipcRenderer.send('app:quit-cancelled'); return; }
  }
  ipcRenderer.send('app:quitting');          // 창은 바로 숨겨짐
  rlog('info', 'shutting down');
  try { if (engineOk) { writeJson(scenesFile, engine.serialize()); saveAudioState(); writeJson(info.settingsFile, cfg); } } catch (e) { rlog('error', 'save on quit', e); }
  try { engine.shutdown(); } catch (e) { rlog('error', 'shutdown', e); }
  ipcRenderer.send('app:ready-to-quit');
});

boot();
