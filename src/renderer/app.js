// Streamy Kit — 화면 로직
'use strict';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { Engine, SCENES, AUDIO_APPS, VIRTUAL_APPS, PLATFORMS } = require('./engine.js');

const $ = (id) => document.getElementById(id);
const info = ipcRenderer.sendSync('app:info');
const engine = new Engine();
let engineOk = false;

// ------------------------------------------------------------------ 설정 저장
const DEFAULTS = {
  platform: 'chzzk', keys: { chzzk: '', youtube: '', soop: '' },
  audioApps: ['discord', 'chrome'], muteDesktop: false,
  waitingText: '곧 방송이 시작됩니다', awayText: '잠시 자리 비웠어요, 금방 올게요!', endingText: '오늘도 함께해 주셔서 감사합니다', bgColor: '#0E0E10',
  timer: { mode: 'stopwatch', minutes: 10, label: '', theme: 'red', visible: true },
  virtualApp: 'vtubestudio', camCorner: 'bottomLeft', camSize: 30, quality: '1080p60',
};
function loadSettings() {
  try { const s = JSON.parse(fs.readFileSync(info.settingsFile, 'utf8')); return { ...DEFAULTS, ...s, keys: { ...DEFAULTS.keys, ...(s.keys || {}) }, timer: { ...DEFAULTS.timer, ...(s.timer || {}) } }; }
  catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
let cfg = loadSettings();
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { fs.mkdirSync(path.dirname(info.settingsFile), { recursive: true }); fs.writeFileSync(info.settingsFile, JSON.stringify(cfg, null, 2)); } catch (e) { console.error(e); } }, 300);
}

// ------------------------------------------------------------------ 알림
let toastT = null;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, err ? 7000 : 3500);
}
function guard(fn) {
  return (...a) => {
    if (!engineOk) return toast('방송 엔진이 아직 준비되지 않았어요.', true);
    try { const r = fn(...a); if (r && r.catch) r.catch((e) => toast(e.message || String(e), true)); }
    catch (e) { console.error(e); toast(e.message || String(e), true); }
  };
}

// ------------------------------------------------------------------ 탭
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
}));

// ------------------------------------------------------------------ 장면 버튼 (F1~F4)
function renderScenes() {
  const box = $('scenes'); box.innerHTML = '';
  SCENES.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'scene-btn' + (engine.current === s.key ? ' on' : '');
    b.innerHTML = `<b></b><small></small><kbd>F${i + 1}</kbd>`;
    b.querySelector('b').textContent = s.label;
    b.querySelector('small').textContent = { waiting: '대기 화면', main: '게임 · 캠', away: '잠깐 쉬는 중', ending: '마무리 인사' }[s.key];
    b.addEventListener('click', guard(() => engine.switchScene(s.key)));
    box.appendChild(b);
  });
}
engine.on('scene', renderScenes);
window.addEventListener('keydown', (e) => {
  const n = ['F1', 'F2', 'F3', 'F4'].indexOf(e.key);
  if (n >= 0 && engineOk) { e.preventDefault(); engine.switchScene(SCENES[n].key); }
});

// ------------------------------------------------------------------ 믹서
function renderMixer() {
  const box = $('mixer');
  if (!engineOk) { box.innerHTML = '<div class="mixer-empty">엔진이 준비되면 오디오가 여기 표시돼요.</div>'; return; }
  const list = engine.audioList();
  box.innerHTML = '';
  for (const a of list) {
    const row = document.createElement('div');
    row.className = 'ch' + (a.muted ? ' muted' : '');
    row.innerHTML = '<button class="mute" title="음소거"></button><div><div class="nm"></div><input type="range" min="0" max="100"></div><span class="pct"></span>';
    row.querySelector('.mute').textContent = a.muted ? '✕' : '♪';
    row.querySelector('.nm').textContent = a.label;
    const r = row.querySelector('input'); r.value = Math.round(a.deflection * 100);
    const pct = row.querySelector('.pct'); pct.textContent = r.value + '%';
    r.addEventListener('input', () => { engine.setVolume(a.name, r.value / 100); pct.textContent = r.value + '%'; });
    row.querySelector('.mute').addEventListener('click', () => engine.setMuted(a.name, !a.muted));
    box.appendChild(row);
  }
}
engine.on('audio-changed', renderMixer);

// ------------------------------------------------------------------ 방송: 플랫폼 / 키
function renderPlatforms() {
  const box = $('platforms'); box.innerHTML = '';
  for (const [k, p] of Object.entries(PLATFORMS)) {
    const b = document.createElement('button');
    b.className = 'plat' + (cfg.platform === k ? ' on' : '');
    b.innerHTML = `<span></span><small>${p.bitrate}kbps</small>`;
    b.querySelector('span').textContent = p.name;
    b.addEventListener('click', () => { if (engine.stream) return toast('방송 중에는 플랫폼을 바꿀 수 없어요.', true); cfg.platform = k; save(); renderPlatforms(); });
    box.appendChild(b);
  }
  $('streamKey').value = cfg.keys[cfg.platform] || '';
}
$('streamKey').addEventListener('input', () => { cfg.keys[cfg.platform] = $('streamKey').value.trim(); save(); });
$('keyShow').addEventListener('click', () => { const k = $('streamKey'); const show = k.type === 'password'; k.type = show ? 'text' : 'password'; $('keyShow').textContent = show ? '숨기기' : '보기'; });
$('keyHelp').addEventListener('click', () => ipcRenderer.invoke('app:open-url', PLATFORMS[cfg.platform].keyHelp));
$('srcLink').addEventListener('click', () => ipcRenderer.invoke('app:open-url', 'https://github.com/Onin0782/streamy-kit-studio'));

// ------------------------------------------------------------------ 방송 시작/종료
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
  if (s.state === 'off' && s.error) toast(s.error, true);
  else if (s.state === 'off') toast('방송을 종료했어요.');
});
$('btnLive').addEventListener('click', guard(async () => {
  if (engine.stream) {
    const r = await ipcRenderer.invoke('app:confirm', { title: '방송 종료', message: '방송을 종료할까요?', buttons: ['종료', '취소'] });
    if (r === 0) engine.stopStream();
    return;
  }
  engine.startStream({ platform: cfg.platform, key: cfg.keys[cfg.platform] });
}));

engine.on('record', (r) => {
  $('btnRec').classList.toggle('on', r.state === 'on');
  if (r.state === 'on') toast('녹화를 시작했어요. 저장 위치: ' + info.recordDir);
  if (r.state === 'off') r.error ? toast(r.error, true) : toast('녹화를 저장했어요.');
});
$('btnRec').addEventListener('click', guard(() => {
  if (engine.recording) engine.stopRecording(); else engine.startRecording(info.recordDir);
}));

// ------------------------------------------------------------------ 상태 표시
setInterval(() => {
  if (liveSince) {
    const s = Math.floor((Date.now() - liveSince) / 1000);
    $('liveTime').textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  if (!engineOk) return;
  try {
    const st = engine.stats();
    $('sCpu').textContent = st.cpu != null ? st.cpu.toFixed(0) + '%' : '-';
    $('sFps').textContent = st.fps != null ? st.fps.toFixed(0) : '-';
    $('sKbps').textContent = st.kbps != null ? Math.round(st.kbps) + 'kbps' : '-';
    $('sDrop').textContent = st.dropped != null && st.sent ? ((st.dropped / Math.max(1, st.sent)) * 100).toFixed(1) + '%' : '-';
  } catch { /* 엔진 재시작 중 */ }
}, 1000);

// ------------------------------------------------------------------ 화면·캠·버추얼
function fillSelect(sel, items, empty) {
  sel.innerHTML = '';
  if (!items.length) { const o = document.createElement('option'); o.textContent = empty; o.value = ''; sel.appendChild(o); return; }
  for (const it of items) { const o = document.createElement('option'); o.value = it.value; o.textContent = it.name; sel.appendChild(o); }
}
$('btnScreen').addEventListener('click', guard(() => { engine.addScreen($('monitorSel').value); toast('모니터 화면을 메인 장면에 넣었어요.'); }));
$('btnCam').addEventListener('click', guard(() => {
  const id = $('camSel').value;
  if (!id) return toast('연결된 웹캠이 없어요.', true);
  engine.addWebcam(id);
  engine.webcamLayout(cfg.camCorner, cfg.camSize / 100);
  $('camLayout').classList.add('show');
  toast('웹캠을 넣었어요. 위치와 크기를 골라 주세요.');
}));
document.querySelectorAll('[data-corner]').forEach((b) => b.addEventListener('click', guard(() => {
  cfg.camCorner = b.dataset.corner; save();
  document.querySelectorAll('[data-corner]').forEach((x) => x.classList.toggle('on', x === b));
  engine.webcamLayout(cfg.camCorner, cfg.camSize / 100);
})));
$('camSize').addEventListener('input', guard(() => { cfg.camSize = Number($('camSize').value); save(); engine.webcamLayout(cfg.camCorner, cfg.camSize / 100); }));
$('btnCamRemove').addEventListener('click', guard(() => { engine.removeInput('[Streamy] 웹캠'); $('camLayout').classList.remove('show'); toast('웹캠을 뺐어요.'); }));

function renderChips(boxId, items, selected, multi, onChange) {
  const box = $(boxId); box.innerHTML = '';
  for (const [k, v] of Object.entries(items)) {
    const b = document.createElement('button');
    b.className = 'chip' + (selected.includes(k) ? ' on' : '');
    b.textContent = v.name;
    b.addEventListener('click', () => {
      let next = multi ? (selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]) : [k];
      onChange(next); renderChips(boxId, items, next, multi, onChange);
    });
    box.appendChild(b);
  }
}
let audioSel = [...cfg.audioApps];
renderChips('audioApps', AUDIO_APPS, audioSel, true, (n) => { audioSel = n; });
$('muteDesktop').checked = cfg.muteDesktop;
$('btnAudio').addEventListener('click', guard(() => {
  engine.setAppAudio(audioSel, $('muteDesktop').checked);
  cfg.audioApps = audioSel; cfg.muteDesktop = $('muteDesktop').checked; save();
  toast(audioSel.length ? `${audioSel.map((k) => AUDIO_APPS[k].name).join(', ')} 소리를 따로 잡았어요. 프로그램이 꺼져 있어도 켜지면 자동으로 들어와요.` : '앱별 소리 분리를 껐어요.');
}));
let virtualSel = [cfg.virtualApp];
renderChips('virtualApps', VIRTUAL_APPS, virtualSel, false, (n) => { virtualSel = n; cfg.virtualApp = n[0]; save(); });
$('btnVirtual').addEventListener('click', guard(() => { const how = engine.addVirtual(cfg.virtualApp); toast(`${VIRTUAL_APPS[cfg.virtualApp].name}을(를) 넣었어요 (${how}).`); }));

// ------------------------------------------------------------------ 타이머
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
$('tApply').addEventListener('click', () => {
  cfg.timer = { ...cfg.timer, mode: $('tMode').value, minutes: Number($('tMin').value), label: $('tLabel').value, theme: $('tTheme').value }; save();
  timer({ type: 'config', ...cfg.timer }); toast('타이머 설정을 적용했어요.');
});
$('tVisible').addEventListener('change', guard(() => { cfg.timer.visible = $('tVisible').checked; save(); engine.setTimerVisible(cfg.timer.visible); }));

// ------------------------------------------------------------------ 문구·디자인
for (const k of ['waitingText', 'awayText', 'endingText', 'bgColor']) $(k).value = cfg[k];
$('btnTexts').addEventListener('click', guard(() => {
  for (const k of ['waitingText', 'awayText', 'endingText', 'bgColor']) cfg[k] = $(k).value;
  save(); engine.updateTexts(cfg); toast('문구와 배경을 바꿨어요.');
}));
$('quality').value = cfg.quality;
$('quality').addEventListener('change', () => { cfg.quality = $('quality').value; save(); toast('화질 설정을 저장했어요. Streamy Kit을 다시 시작하면 적용돼요.'); });

// ------------------------------------------------------------------ 미리보기 위치 맞추기
function layoutDisplay() {
  if (!engineOk) return;
  const r = $('preview').getBoundingClientRect();
  const z = window.devicePixelRatio || 1;
  engine.moveDisplay(r.left * z, r.top * z, r.width * z, r.height * z);
}
new ResizeObserver(layoutDisplay).observe($('preview'));
window.addEventListener('resize', layoutDisplay);

// ------------------------------------------------------------------ 시작
function boot() {
  $('ver').textContent = 'v' + info.version;
  renderPlatforms(); renderScenes(); renderMixer(); setLive('off'); timerListen();
  $('tMode').value = cfg.timer.mode; $('tMin').value = cfg.timer.minutes; $('tLabel').value = cfg.timer.label; $('tTheme').value = cfg.timer.theme; $('tVisible').checked = cfg.timer.visible;
  timer({ type: 'config', ...cfg.timer });
  $('camSize').value = cfg.camSize;
  document.querySelectorAll('[data-corner]').forEach((x) => x.classList.toggle('on', x.dataset.corner === cfg.camCorner));

  const q = { '1080p60': [1920, 1080, 60], '1080p30': [1920, 1080, 30], '720p60': [1280, 720, 60] }[cfg.quality] || [1920, 1080, 60];
  try {
    engine.start({ osnDir: info.osnDir, dataDir: info.dataDir, width: q[0], height: q[1], fps: q[2] });
    engineOk = true;
    engine.setupScenes(cfg);
    engine.createDisplay(ipcRenderer.sendSync('app:window-handle'));
    $('preview').classList.add('has-engine');
    layoutDisplay();
    if (cfg.audioApps.length || cfg.muteDesktop) { try { engine.setAppAudio(cfg.audioApps, cfg.muteDesktop); } catch (e) { toast(e.message, true); } }
    engine.addTimer(info.timerUrl);
    engine.setTimerVisible(cfg.timer.visible);
    fillSelect($('monitorSel'), engine.monitors(), '모니터 없음');
    fillSelect($('camSel'), engine.webcams(), '웹캠 없음');
    const enc = engine.pickEncoder();
    $('encInfo').textContent = '인코더: ' + enc.label + (enc.id === 'obs_x264' ? ' (그래픽카드 인코더를 찾지 못해 CPU를 써요)' : ' (그래픽카드)');
    renderScenes(); renderMixer();
    toast('준비 완료! F1~F4로 장면을 바꿀 수 있어요.');
  } catch (e) {
    console.error(e);
    engineOk = false;
    const box = $('previewEmpty'); box.classList.add('err');
    $('engineMsg').textContent = e.message || String(e);
    $('encInfo').textContent = '인코더: 엔진 없음';
    fillSelect($('monitorSel'), [], '엔진 없음'); fillSelect($('camSel'), [], '엔진 없음');
    if (process.env.STREAMY_DEMO) demoMode();
  }
}

// 개발용 화면 미리보기 (윈도우가 아닌 환경에서 STREAMY_DEMO=1)
function demoMode() {
  const img = document.createElement('img'); img.src = 'demo-preview.png'; img.className = 'demo-shot';
  $('preview').appendChild(img); $('preview').classList.add('has-engine');
  engine.current = 'waiting'; renderScenes();
  $('encInfo').textContent = '인코더: NVIDIA NVENC (그래픽카드)';
  $('sCpu').textContent = '6%'; $('sFps').textContent = '60';
  const box = $('mixer'); box.innerHTML = '';
  for (const [n, v, m] of [['데스크톱 소리', 80, 0], ['마이크', 72, 0], ['디스코드', 55, 0], ['크롬 (유튜브 등)', 40, 0], ['스포티파이', 30, 1]]) {
    const row = document.createElement('div'); row.className = 'ch' + (m ? ' muted' : '');
    row.innerHTML = `<button class="mute">${m ? '✕' : '♪'}</button><div><div class="nm">${n}</div><input type="range" min="0" max="100" value="${v}"></div><span class="pct">${v}%</span>`;
    box.appendChild(row);
  }
}

// ------------------------------------------------------------------ 종료
ipcRenderer.on('app:request-quit', async () => {
  if (engine.stream) {
    const r = await ipcRenderer.invoke('app:confirm', { title: 'Streamy Kit 종료', message: '방송 중이에요. 방송을 끝내고 종료할까요?', buttons: ['종료', '취소'] });
    if (r !== 0) return;
  }
  try { engine.shutdown(); } catch (e) { console.error(e); }
  ipcRenderer.send('app:ready-to-quit');
});

boot();
