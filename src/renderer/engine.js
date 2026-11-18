// Streamy Kit 방송 엔진 래퍼 (v0.8)
// OBS 엔진(libobs)을 obs-studio-node 모듈로 불러와서 Streamy Kit에 필요한 기능만 감쌉니다.
// - 장면/소스는 사용자가 직접 만들고, 미리보기에서 끌어서 옮기고 크기를 바꿉니다.
// - 오디오(데스크톱/마이크/프로그램별)는 장면과 상관없이 항상 들리는 "오디오 버스"에 둡니다.
// - 장치/창 목록은 한 번 만든 "조회용 소스"를 계속 재사용합니다 (매번 만들고 지우면 엔진이 불안정해짐).
'use strict';
const path = require('path');
const fs = require('fs');

const E = {
  VideoFormat: { NV12: 2 }, ColorSpace: { CS709: 2 }, Range: { Partial: 1 }, Scale: { Lanczos: 4 },
  FPSType: { Fractional: 2 }, Fader: { Cubic: 0, IEC: 1 },
  Align: { Center: 0, Left: 1, Right: 2, Top: 4, Bottom: 8, TopLeft: 5, TopRight: 6, BottomLeft: 9, BottomRight: 10 },
  Bounds: { None: 0, ScaleInner: 2 }, Render: { Main: 0 }, IPCOk: 0,
};

// 추가할 수 있는 소스 종류
const SOURCE_TYPES = {
  monitor: { label: '모니터 화면', icon: '🖥️', type: 'monitor_capture', prop: 'monitor_id', fit: true },
  window: { label: '프로그램 창', icon: '🪟', type: 'window_capture', prop: 'window', fit: true },
  game: { label: '게임', icon: '🎮', type: 'game_capture', prop: 'window', fit: true },
  webcam: { label: '웹캠', icon: '📷', type: 'dshow_input', prop: 'video_device_id', fit: false },
  image: { label: '이미지', icon: '🖼️', type: 'image_source', file: true, fit: false },
  text: { label: '텍스트', icon: '🔤', type: 'text_gdiplus', text: true, fit: false },
  web: { label: '웹페이지 (알림창)', icon: '🌐', type: 'browser_source', url: true, fit: false },
  timer: { label: '타이머', icon: '⏱️', type: 'browser_source', timer: true, fit: false },
  virtual: { label: '버추얼', icon: '🧸', type: 'game_capture', prop: 'window', fit: false },
  color: { label: '단색 배경', icon: '🟥', type: 'color_source', fit: true },
};

// 버추얼 프로그램 (실행 파일 이름으로 알아봄). 기본 연결 = 게임 캡처 + 투명 배경
const VIRTUAL_APPS = [
  { id: 'vts', name: 'VTube Studio', exe: ['vtube studio.exe'], spout: true },
  { id: 'vseeface', name: 'VSeeFace', exe: ['vseeface.exe'], spout: true },
  { id: 'warudo', name: 'Warudo', exe: ['warudo.exe'], spout: true },
  { id: 'vnyan', name: 'VNyan', exe: ['vnyan.exe'], spout: true },
  { id: 'vmm', name: 'VMagicMirror', exe: ['vmagicmirror.exe'] },
  { id: 'nizima', name: 'nizima LIVE', exe: ['nizima live.exe', 'nizimalive.exe'] },
  { id: 'prpr', name: 'PrprLive', exe: ['prprlive.exe'] },
  { id: 'animaze', name: 'Animaze', exe: ['animaze.exe', 'animaze-win64-shipping.exe'] },
  { id: '3tene', name: '3tene', exe: ['3tene.exe'] },
  { id: 'luppet', name: 'Luppet', exe: ['luppet.exe'] },
  { id: 'vup', name: 'VUP', exe: ['vup.exe'] },
  { id: 'wmc', name: 'Webcam Motion Capture', exe: ['webcam motion capture.exe', 'webcammotioncapture.exe'] },
];
// 위치 프리셋 (캔버스 비율) — 박스 안에 비율 유지로 맞춤
const VIRTUAL_SPOTS = {
  'bottom-left': { label: '왼쪽 아래', ax: 0, ay: 1 }, 'bottom-center': { label: '가운데 아래', ax: 0.5, ay: 1 },
  'bottom-right': { label: '오른쪽 아래', ax: 1, ay: 1 }, center: { label: '가운데', ax: 0.5, ay: 0.5 }, full: { label: '꽉 차게', ax: 0.5, ay: 0.5 },
};
const VIRTUAL_DEFAULT = { spot: 'bottom-right', size: 75, flip: false, bg: 'transparent', color: '#00FF00', method: 'game', crop: { left: 0, top: 0, right: 0, bottom: 0 } };
const exeOf = (v) => String(v || '').split(':').pop().toLowerCase();
const appOfExe = (exe) => VIRTUAL_APPS.find((a) => a.exe.includes(String(exe).toLowerCase())) || null;

// 플랫폼별 송출 프리셋 (OBS 엔진에 들어 있는 rtmp-services 값 기준)
const PLATFORMS = {
  chzzk: { name: '치지직', server: 'rtmp://global-rtmp.lip2.navercorp.com:8080/relay', bitrate: 8000, keyint: 1, bframes: 0, keyHelp: 'https://studio.chzzk.naver.com/setting' },
  youtube: { name: '유튜브', server: 'rtmps://a.rtmps.youtube.com:443/live2', bitrate: 9000, keyint: 2, bframes: 2, keyHelp: 'https://studio.youtube.com/' },
  soop: { name: 'SOOP', server: 'rtmp://stream.soop.live/app/', bitrate: 8000, keyint: 2, bframes: 0, keyHelp: 'https://dashboard.sooplive.co.kr' },
};

// H.264 인코더 (RTMP 송출용). 자동 선택 우선순위 순서
const ENCODERS = [
  { id: 'obs_nvenc_h264_tex', label: 'NVIDIA NVENC', hw: true },
  { id: 'jim_nvenc', label: 'NVIDIA NVENC (구버전)', hw: true },
  { id: 'ffmpeg_nvenc', label: 'NVIDIA NVENC (FFmpeg)', hw: true },
  { id: 'h264_texture_amf', label: 'AMD AMF', hw: true },
  { id: 'amd_amf_h264', label: 'AMD AMF (구버전)', hw: true },
  { id: 'obs_qsv11_v2', label: 'Intel QSV', hw: true },
  { id: 'obs_qsv11', label: 'Intel QSV (구버전)', hw: true },
  { id: 'obs_x264', label: 'CPU (x264)', hw: false },
];

const abgr = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};

class Engine {
  constructor() {
    this.osn = null; this.video = null; this.ready = false;
    this.width = 1920; this.height = 1080; this.fps = 60;
    this.scenes = [];            // [{ id, name, scene: IScene }]
    this.currentId = null;
    this.transition = null;
    this.sources = {};           // name -> { input, kind, icon }
    this.audio = {};             // name -> { input, fader, volmeter, label, kind, window }
    this.audioBus = null;
    this.levels = {};            // name -> { level(0..1), peak(0..1), t }
    this.sel = new Set();        // 선택된 장면 항목 id들 (현재 장면 기준)
    this.primary = null;         // 마지막으로 고른 항목 (끌기/크기 조절 대상)
    this.anchor = null;          // Shift 범위 선택 기준
    this.probes = {};            // type -> 조회용 private 소스 (재사용)
    this.streams = {};           // platform -> { out, parts, state, error }
    this.recording = null;
    this.encoderPref = 'auto';
    this.listeners = {};
    this.seq = 1;
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { (this.listeners[ev] || []).forEach((f) => { try { f(data); } catch (e) { console.error(e); } }); }

  // ================================================================ 시작 / 종료
  start({ osnDir, dataDir, width = 1920, height = 1080, fps = 60 }) {
    if (process.platform !== 'win32') throw new Error('Streamy Kit 방송 엔진은 윈도우에서만 실행돼요.');
    if (!fs.existsSync(path.join(osnDir, 'obs_studio_client.node'))) throw new Error('방송 엔진 파일을 찾지 못했어요: ' + osnDir);
    this.osn = require(path.join(osnDir, 'index.js'));
    const osn = this.osn, N = osn.NodeObs;
    fs.mkdirSync(dataDir, { recursive: true });

    const code = N.IPC.host('streamy-kit-' + process.pid + '-' + Date.now());
    if (code !== E.IPCOk) {
      const why = { 259: '이전에 실행한 엔진이 아직 종료되지 않았어요. 잠시 후 다시 시작해 주세요.', 252: '엔진 파일 버전이 맞지 않아요. Streamy Kit을 다시 설치해 주세요.', 254: '필요한 구성 요소가 없어요. Visual C++ 런타임(x64)을 설치해 주세요.', 253: '엔진 실행 파일을 시작하지 못했어요. 백신 프로그램이 obs64.exe를 막았는지 확인해 주세요.' }[code];
      throw new Error((why || '방송 엔진을 시작하지 못했어요.') + ' (코드 ' + code + ')');
    }
    N.SetWorkingDirectory(osnDir);
    const init = N.OBS_API_initAPI({ language: 'ko-KR', appDataPath: dataDir, version: '0.5.0', crashServerUrl: '' });
    if (init !== 0) {
      try { N.IPC.disconnect(); } catch {}
      const why = { '-1': '지원하지 않는 그래픽 카드예요. 그래픽 드라이버를 최신으로 업데이트해 주세요.', '-2': '이 PC의 그래픽 설정으로는 엔진을 시작할 수 없어요. 그래픽 드라이버를 업데이트해 주세요.' }[String(init)];
      throw new Error((why || '방송 엔진 초기화에 실패했어요. 그래픽 드라이버를 최신으로 업데이트해 보세요.') + ' (코드 ' + init + ')');
    }

    this.width = width; this.height = height; this.fps = fps;
    this.video = osn.VideoFactory.create();
    this.video.video = {
      fpsNum: fps, fpsDen: 1, baseWidth: width, baseHeight: height, outputWidth: width, outputHeight: height,
      outputFormat: E.VideoFormat.NV12, colorspace: E.ColorSpace.CS709, range: E.Range.Partial,
      scaleType: E.Scale.Lanczos, fpsType: E.FPSType.Fractional,
    };
    try { N.OBS_service_connectOutputSignals?.(); } catch {}

    this.transition = osn.TransitionFactory.create('fade_transition', 'streamy-fade', {});
    osn.Global.setOutputSource(0, this.transition);
    this.audioBus = osn.SceneFactory.createPrivate('streamy-audio-bus');
    osn.Global.setOutputSource(9, this.audioBus);

    try {
      N.RegisterSourceCallback(() => {});
      N.RegisterVolmeterCallback((arr) => this.onVolmeter(arr));
    } catch (e) { console.warn('volmeter callback', e); }
    this.ready = true;
  }

  shutdown() {
    if (!this.osn) return;
    const N = this.osn.NodeObs;
    try { this.stopStream(true); } catch {}
    try { this.stopRecording(true); } catch {}
    try { this.destroyDisplay(); } catch {}
    try { this.destroyPhoneDisplay(); } catch {}
    try { N.RemoveVolmeterCallback?.(); N.RemoveSourceCallback?.(); } catch {}
    for (const a of Object.values(this.audio)) { try { a.volmeter.detach(); a.volmeter.destroy(); a.fader.detach(); a.fader.destroy(); a.input.release(); } catch {} }
    for (const p of Object.values(this.probes)) { try { p.release(); } catch {} }
    try { this.transition.clear(); this.transition.release(); } catch {}
    for (const s of Object.values(this.sources)) { try { s.input.release(); } catch {} }
    for (const s of this.scenes) { try { s.scene.release(); } catch {} }
    try { this.audioBus.release(); } catch {}
    try { this.video.destroy(); } catch {}
    try { N.OBS_service_removeCallback?.(); } catch {}
    try { N.IPC.disconnect(); } catch {}
    this.ready = false;
  }

  // ================================================================ 미리보기
  createDisplay(windowHandle, bg = [11, 11, 13]) {
    const N = this.osn.NodeObs;
    this.display = 'streamy-preview';
    N.OBS_content_createDisplay(windowHandle, this.display, E.Render.Main, false, this.video);
    N.OBS_content_setPaddingColor(this.display, bg[0], bg[1], bg[2]);   // 남는 공간을 앱 배경색으로 → 검은 띠 안 보임
    N.OBS_content_setPaddingSize(this.display, 0);
    N.OBS_content_setShouldDrawUI(this.display, true);
    try { N.OBS_content_setOutlineColor?.(this.display, 225, 29, 46); } catch {}
    try { N.OBS_content_setDrawGuideLines?.(this.display, true); } catch {}
  }
  moveDisplay(x, y, w, h) {
    if (!this.display) return;
    const N = this.osn.NodeObs;
    N.OBS_content_moveDisplay(this.display, Math.round(x), Math.round(y));
    N.OBS_content_resizeDisplay(this.display, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }
  // 폰 화면 미리보기용 두 번째 화면 (방송 결과 그대로, 편집 표시 없음)
  createPhoneDisplay(windowHandle, bg = [0, 0, 0]) {
    if (this.phoneDisplay) return;
    const N = this.osn.NodeObs;
    this.phoneDisplay = 'streamy-phone';
    N.OBS_content_createDisplay(windowHandle, this.phoneDisplay, E.Render.Main, false, this.video);
    N.OBS_content_setPaddingColor(this.phoneDisplay, bg[0], bg[1], bg[2]);
    N.OBS_content_setPaddingSize(this.phoneDisplay, 0);
    N.OBS_content_setShouldDrawUI(this.phoneDisplay, false);
  }
  movePhoneDisplay(x, y, w, h) {
    if (!this.phoneDisplay) return;
    const N = this.osn.NodeObs;
    N.OBS_content_moveDisplay(this.phoneDisplay, Math.round(x), Math.round(y));
    N.OBS_content_resizeDisplay(this.phoneDisplay, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }
  destroyPhoneDisplay() { if (this.phoneDisplay) { const d = this.phoneDisplay; this.phoneDisplay = null; this.osn.NodeObs.OBS_content_destroyDisplay(d); } }
  destroyDisplay() { if (this.display) { this.osn.NodeObs.OBS_content_destroyDisplay(this.display); this.display = null; } }
  previewRect(dispW, dispH) {
    try {
      const N = this.osn.NodeObs;
      const o = N.OBS_content_getDisplayPreviewOffset(this.display);
      const s = N.OBS_content_getDisplayPreviewSize(this.display);
      if (s && s.width > 0) return { x: o.x, y: o.y, w: s.width, h: s.height };
    } catch {}
    const sc = Math.min(dispW / this.width, dispH / this.height);
    return { x: (dispW - this.width * sc) / 2, y: (dispH - this.height * sc) / 2, w: this.width * sc, h: this.height * sc };
  }

  // ================================================================ 조회용 소스 (재사용)
  probe(type) {
    if (this.probes[type]) return this.probes[type];
    const p = this.osn.InputFactory.createPrivate(type, 'streamy-probe-' + type, {});
    this.probes[type] = p;
    return p;
  }
  listProp(type, prop) {
    try {
      const p = this.probe(type).properties.get(prop);
      return p && p.details ? p.details.items.filter((x) => x.value !== '' && x.value != null).map((x) => ({ name: String(x.name), value: String(x.value) })) : [];
    } catch (e) { console.error('listProp', type, prop, e); return []; }
  }

  // ================================================================ 장면
  sceneById(id) { return this.scenes.find((s) => s.id === id) || null; }
  get currentScene() { return this.sceneById(this.currentId); }
  uniqueName(base, taken) { let n = base, i = 2; while (taken(n)) n = `${base} ${i++}`; return n; }
  nameTaken(n) { return !!this.sources[n] || !!this.audio[n] || this.scenes.some((s) => s.name === n); }

  addScene(name) {
    name = this.uniqueName(name || '장면 ' + (this.scenes.length + 1), (n) => this.nameTaken(n));
    const scene = this.osn.SceneFactory.create(name);
    const s = { id: 's' + this.seq++, name, scene };
    this.scenes.push(s);
    if (!this.currentId) this.switchScene(s.id, true);
    this.emit('scenes');
    return s;
  }
  renameScene(id, name) {
    const s = this.sceneById(id); if (!s || !name || name === s.name) return;
    if (this.nameTaken(name)) throw new Error('같은 이름이 이미 있어요.');
    s.scene.name = name; s.name = name; this.emit('scenes');
  }
  removeScene(id) {
    if (this.scenes.length <= 1) throw new Error('장면은 최소 1개 있어야 해요.');
    const i = this.scenes.findIndex((s) => s.id === id); if (i < 0) return;
    const [s] = this.scenes.splice(i, 1);
    if (this.currentId === id) this.switchScene(this.scenes[Math.max(0, i - 1)].id, true);
    for (const it of s.scene.getItems()) it.remove();
    s.scene.release();
    this.gcSources();
    this.emit('scenes');
  }
  moveScene(id, dir) {
    const i = this.scenes.findIndex((s) => s.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= this.scenes.length) return;
    [this.scenes[i], this.scenes[j]] = [this.scenes[j], this.scenes[i]]; this.emit('scenes');
  }
  switchScene(id, instant = false) {
    const s = this.sceneById(id); if (!s) return;
    this.clearSelection();
    if (instant || !this.currentId) this.transition.set(s.scene); else this.transition.start(300, s.scene);
    this.currentId = id;
    this.emit('scenes'); this.emit('items');
  }

  // ================================================================ 소스
  types() { return this.osn.InputFactory.types(); }
  resolveType(kind) {
    const all = this.types(), base = SOURCE_TYPES[kind].type;
    return all.filter((t) => t === base || t.startsWith(base + '_v')).sort().pop() || null;
  }
  available(kind) { try { return !!this.resolveType(kind); } catch { return false; } }
  choices(kind) { const def = SOURCE_TYPES[kind]; const t = def.prop && this.resolveType(kind); return t ? this.listProp(t, def.prop) : []; }

  settingsFor(kind, opt) {
    switch (kind) {
      case 'monitor': return { monitor_id: opt.value, capture_cursor: true };
      case 'window': return { window: opt.value, capture_cursor: true, priority: 2 };
      case 'game': return opt.value ? { capture_mode: 'window', window: opt.value, priority: 2, capture_cursor: false, allow_transparency: false }
        : { capture_mode: 'any_fullscreen', capture_cursor: false };
      case 'webcam': return { video_device_id: opt.value, res_type: 0 };
      case 'image': return { file: opt.file };
      case 'text': return { text: opt.text || '텍스트', font: { face: opt.font || 'Malgun Gothic', size: Number(opt.size) || 96, style: 'Bold', flags: 1 }, color: abgr(opt.color || '#FFFFFF') & 0xffffff, outline: !!opt.outline, outline_size: 6, outline_color: 0x000000 };
      case 'web': return { url: opt.url, width: Number(opt.width) || 800, height: Number(opt.height) || 600, css: 'body{background-color:rgba(0,0,0,0);margin:0;overflow:hidden}', reroute_audio: false };
      case 'timer': return { url: opt.timerUrl, width: 600, height: 200, css: '', reroute_audio: false };
      case 'virtual': {
        const v = { ...VIRTUAL_DEFAULT, ...(opt.virt || {}) };
        if (v.method === 'spout') return {};
        return { capture_mode: 'window', window: opt.value, priority: 2, capture_cursor: false, allow_transparency: v.bg === 'transparent', anti_cheat_hook: true, hook_rate: 1 };
      }
      case 'color': return { color: abgr(opt.color || '#0E0E10'), width: this.width, height: this.height };
    }
    return {};
  }

  addSource(kind, opt = {}) {
    const scene = this.currentScene; if (!scene) throw new Error('장면을 먼저 만들어 주세요.');
    const def = SOURCE_TYPES[kind];
    const type = kind === 'virtual' && opt.virt?.method === 'spout' ? (this.types().find((t) => t.startsWith('spout_capture')) || null) : this.resolveType(kind);
    if (!type) throw new Error(`이 PC에서는 '${def.label}'을(를) 쓸 수 없어요.` + (kind === 'virtual' ? ' (Spout2를 쓸 수 없어요 — 게임 캡처로 바꿔 주세요)' : ''));
    const name = this.uniqueName(opt.name || def.label, (n) => this.nameTaken(n));
    const input = this.osn.InputFactory.create(type, name, this.settingsFor(kind, opt));
    this.sources[name] = { input, kind, icon: def.icon };
    if (kind === 'virtual') this.sources[name].virt = { ...VIRTUAL_DEFAULT, ...(opt.virt || {}), crop: { ...VIRTUAL_DEFAULT.crop, ...(opt.virt?.crop || {}) } };
    const item = scene.scene.add(input);
    item.alignment = E.Align.TopLeft;
    if (kind === 'virtual') {
      this.applyVirtual(name);
      this.select(item.id, 'single'); this.emit('items');
      return { name, item };
    }
    if (def.fit) {
      item.position = { x: 0, y: 0 };
      item.boundsType = E.Bounds.ScaleInner; item.boundsAlignment = E.Align.Center;
      item.bounds = { x: this.width, y: this.height };
      if (kind === 'color') item.moveBottom();
    } else if (kind === 'webcam') {
      const w = this.width * 0.3, h = this.height * 0.3;
      item.position = { x: 30, y: this.height - h - 30 };
      item.boundsType = E.Bounds.ScaleInner; item.boundsAlignment = E.Align.Center; item.bounds = { x: w, y: h };
    } else if (kind === 'timer') {
      item.position = { x: this.width - 630, y: 30 };
    } else {
      item.position = { x: this.width / 4, y: this.height / 3 };
    }
    this.select(item.id, 'single');
    this.emit('items');
    return { name, item };
  }

  gcSources() {
    const used = new Set();
    for (const s of this.scenes) for (const it of s.scene.getItems()) used.add(it.source.name);
    for (const [n, s] of Object.entries(this.sources)) if (!used.has(n)) { try { s.input.release(); } catch {} delete this.sources[n]; }
  }

  // 목록은 위(앞)에 있는 것부터
  items(sceneId = this.currentId) {
    const s = this.sceneById(sceneId); if (!s) return [];
    return s.scene.getItems().map((it) => {
      const src = this.sources[it.source.name];
      return { id: it.id, name: it.source.name, kind: src ? src.kind : '', icon: (src && src.icon) || '•', visible: it.visible, selected: this.sel.has(it.id) };
    }).reverse();
  }
  itemObj(itemId, sceneId = this.currentId) { const s = this.sceneById(sceneId); return s ? s.scene.findItem(itemId) : null; }
  setVisible(itemId, v) { const it = this.itemObj(itemId); if (it) { it.visible = v; this.emit('items'); } }
  moveItem(itemId, dir) { const it = this.itemObj(itemId); if (!it) return; dir > 0 ? it.moveUp() : it.moveDown(); this.emit('items'); }
  removeItems(ids) {
    for (const id of ids) { const it = this.itemObj(id); if (it) { try { it.selected = false; } catch {} it.remove(); } }
    this.sel.clear(); this.primary = null; this.anchor = null;
    this.gcSources(); this.emit('items');
  }
  renameSource(oldName, name, icon) {
    const s = this.sources[oldName]; if (!s) return;
    if (icon !== undefined) s.icon = icon || SOURCE_TYPES[s.kind]?.icon || '•';
    if (name && name !== oldName) {
      if (this.nameTaken(name)) throw new Error('같은 이름이 이미 있어요.');
      s.input.name = name; this.sources[name] = s; delete this.sources[oldName];
    }
    this.emit('items');
  }
  sourceSettings(name) { const s = this.sources[name]; return s ? { kind: s.kind, settings: s.input.settings } : null; }
  updateSource(name, kind, opt) { const s = this.sources[name]; if (s) s.input.update(this.settingsFor(kind, opt)); }

  // ================================================================ 선택 (단일 / Ctrl 토글 / Shift 범위)
  select(itemId, mode = 'single') {
    const order = this.items().map((x) => x.id);   // 목록 순서 (위→아래)
    if (mode === 'single') { this.sel = new Set([itemId]); this.anchor = itemId; }
    else if (mode === 'toggle') { this.sel.has(itemId) ? this.sel.delete(itemId) : this.sel.add(itemId); this.anchor = itemId; }
    else if (mode === 'range') {
      const a = order.indexOf(this.anchor ?? itemId), b = order.indexOf(itemId);
      if (a < 0 || b < 0) this.sel = new Set([itemId]);
      else { const [lo, hi] = a < b ? [a, b] : [b, a]; this.sel = new Set(order.slice(lo, hi + 1)); }
    }
    this.primary = this.sel.has(itemId) ? itemId : [...this.sel].pop() ?? null;
    this.syncSelected();
    this.emit('items');
  }
  syncSelected() {
    const s = this.currentScene; if (!s) return;
    for (const it of s.scene.getItems()) { const on = this.sel.has(it.id); try { if (it.selected !== on) it.selected = on; } catch {} }
  }
  clearSelection() {
    const s = this.currentScene;
    if (s) for (const id of this.sel) { const it = s.scene.findItem(id); if (it) { try { it.selected = false; } catch {} } }
    this.sel.clear(); this.primary = null; this.anchor = null;
  }

  // ================================================================ 끌기 / 크기 조절 (캔버스 좌표)
  itemRect(it) {
    const src = it.source;
    let c = null; try { c = it.crop; } catch {}
    const sw = Math.max(0, (src.width || 0) - (c ? c.left + c.right : 0)), sh = Math.max(0, (src.height || 0) - (c ? c.top + c.bottom : 0));
    const pos = it.position, al = it.alignment;
    let w, h, x, y;
    if (it.boundsType !== E.Bounds.None) {
      const b = it.bounds;
      const bx = pos.x - (al & E.Align.Right ? b.x : al & E.Align.Left ? 0 : b.x / 2);
      const by = pos.y - (al & E.Align.Bottom ? b.y : al & E.Align.Top ? 0 : b.y / 2);
      if (sw > 0 && sh > 0) { const k = Math.min(b.x / sw, b.y / sh); w = sw * k; h = sh * k; } else { w = b.x; h = b.y; }
      x = bx + (b.x - w) / 2; y = by + (b.y - h) / 2;
    } else {
      const sc = it.scale; w = sw * Math.abs(sc.x); h = sh * Math.abs(sc.y);
      x = pos.x - (al & E.Align.Right ? w : al & E.Align.Left ? 0 : w / 2) - (sc.x < 0 ? w : 0);   // 좌우 반전이면 왼쪽으로 그려짐
      y = pos.y - (al & E.Align.Bottom ? h : al & E.Align.Top ? 0 : h / 2) - (sc.y < 0 ? h : 0);
    }
    return { x, y, w, h, sw, sh };
  }
  hitTest(cx, cy) {
    const s = this.currentScene; if (!s) return null;
    const list = s.scene.getItems();
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (!it.visible) continue;
      const r = this.itemRect(it);
      if (r.w <= 0 || r.h <= 0) continue;
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return { id: it.id, rect: r };
    }
    return null;
  }
  normalize(itemId) {
    const it = this.itemObj(itemId); if (!it) return null;
    const r = this.itemRect(it);
    if (r.sw > 0 && r.sh > 0) {
      const flip = it.scale.x < 0;
      it.boundsType = E.Bounds.None; it.alignment = E.Align.TopLeft;
      this.place(it, r.x, r.y, r.w / r.sw, flip);
    }
    return this.itemRect(it);
  }
  // 왼쪽 위 (x,y) · 배율 k · 좌우 반전 여부로 배치 (TopLeft 정렬 기준)
  place(it, x, y, k, flip = it.scale.x < 0) {
    let c = null; try { c = it.crop; } catch {}
    const sw = Math.max(0, (it.source.width || 0) - (c ? c.left + c.right : 0));
    it.scale = { x: flip ? -k : k, y: k };
    it.position = { x: flip ? x + sw * k : x, y };
  }
  setItemRect(itemId, x, y, w) {
    const it = this.itemObj(itemId); if (!it) return;
    const r = this.itemRect(it);
    const k = r.sw > 0 && w ? Math.max(0.02, w / r.sw) : Math.abs(it.scale.x);
    this.place(it, x, y, k);
  }
  fitItem(itemId, mode) {
    const it = this.itemObj(itemId); if (!it) return;
    const r = this.normalize(itemId); if (!r || !r.sw) return;
    if (mode === 'fit') { const k = Math.min(this.width / r.sw, this.height / r.sh); this.place(it, (this.width - r.sw * k) / 2, (this.height - r.sh * k) / 2, k); }
    if (mode === 'center') this.place(it, (this.width - r.w) / 2, (this.height - r.h) / 2, r.w / r.sw);
    if (mode === 'reset') this.place(it, (this.width - r.sw) / 2, (this.height - r.sh) / 2, 1);
  }

  // ================================================================ 버추얼
  // 지금 켜져 있는 버추얼 프로그램 창 찾기 → [{ app, value, title }]
  findVirtualApps() {
    const out = [], seen = new Set();
    for (const w of this.listProp(this.resolveType('window') || 'window_capture', 'window')) {   // 창 캡처 목록으로 조회 (게임 캡처 조회 소스는 후킹을 시도할 수 있어서 피함)
      const app = appOfExe(exeOf(w.value));
      if (!app || seen.has(app.id)) continue;
      seen.add(app.id);
      out.push({ app, value: w.value, title: w.name });
    }
    return out;
  }
  virtualSources() {
    return Object.entries(this.sources).filter(([, s]) => s.kind === 'virtual').map(([name, s]) => ({ name, virt: s.virt || { ...VIRTUAL_DEFAULT }, exe: exeOf(s.input.settings?.window) }));
  }
  getVirtual(name) { const s = this.sources[name]; return s && s.kind === 'virtual' ? (s.virt ||= { ...VIRTUAL_DEFAULT, crop: { ...VIRTUAL_DEFAULT.crop } }) : null; }
  // 버추얼 설정을 엔진에 반영: 배경(투명/크로마키) · 자르기 · 위치/크기 · 반전 (모든 장면의 해당 항목)
  applyVirtual(name, { layout = true } = {}) {
    const s = this.sources[name]; if (!s) return;
    const v = this.getVirtual(name);
    // 배경
    if (v.method !== 'spout') { try { s.input.update({ allow_transparency: v.bg === 'transparent' }); } catch {} }
    let f = null; try { f = s.input.findFilter('Streamy 크로마키'); } catch {}
    if (v.bg !== 'transparent') {
      const ftype = (this.osn.FilterFactory.types?.() || []).filter((t) => t.startsWith('chroma_key_filter')).sort().pop() || 'chroma_key_filter_v2';
      const col = v.bg === 'green' ? 'green' : v.bg === 'blue' ? 'blue' : 'custom';
      const set = { key_color_type: col, key_color: abgr(v.color || '#00FF00') & 0xffffff, similarity: 420, smoothness: 80, spill: 100 };
      try { if (f) f.update(set); else s.input.addFilter(this.osn.FilterFactory.create(ftype, 'Streamy 크로마키', set)); } catch (e) { console.warn('chroma', e); }
    } else if (f) { try { s.input.removeFilter(f); f.release?.(); } catch {} }
    // 장면 항목들
    for (const sc of this.scenes) for (const it of sc.scene.getItems()) {
      if (it.source.name !== name) continue;
      const c = v.crop || {};
      const keep = it.boundsType === E.Bounds.None && it.scale.x < 0 ? this.itemRect(it) : null;   // 반전 상태에서 자르면 왼쪽 끝이 그대로이게
      try { it.crop = { left: c.left | 0, top: c.top | 0, right: c.right | 0, bottom: c.bottom | 0 }; } catch {}
      if (keep && !layout) this.place(it, keep.x, keep.y, Math.abs(it.scale.x), true);
      if (layout) this.layoutVirtualItem(it, v);
      else if ((it.scale.x < 0) !== !!v.flip) {
        if (it.boundsType !== E.Bounds.None) { const sc = it.scale; it.scale = { x: (v.flip ? -1 : 1) * Math.abs(sc.x || 1), y: Math.abs(sc.y || 1) }; }
        else { const r = this.itemRect(it); this.place(it, r.x, r.y, Math.abs(it.scale.x), !!v.flip); }
      }
    }
    this.emit('items');
  }
  // 위치 프리셋 + 크기(캔버스 높이 %) → 박스. 소스 크기를 몰라도(아직 연결 전) 박스 기준으로 맞춰짐
  layoutVirtualItem(it, v) {
    const spot = VIRTUAL_SPOTS[v.spot] || VIRTUAL_SPOTS['bottom-right'];
    const full = v.spot === 'full';
    const bh = full ? this.height : this.height * Math.max(10, Math.min(120, v.size)) / 100;
    const bw = full ? this.width : Math.min(this.width, bh * 16 / 9);
    const m = full ? 0 : 20;
    const x = (this.width - bw) * spot.ax + (spot.ax === 0 ? m : spot.ax === 1 ? -m : 0);
    const y = (this.height - bh) * spot.ay + (spot.ay === 1 ? 0 : 0);
    it.alignment = E.Align.TopLeft;
    it.boundsType = E.Bounds.ScaleInner;
    it.boundsAlignment = spot.ay === 1 ? (spot.ax === 0 ? E.Align.BottomLeft : spot.ax === 1 ? E.Align.BottomRight : E.Align.Bottom) : E.Align.Center;
    it.bounds = { x: bw, y: bh };
    it.position = { x, y };
    it.scale = { x: v.flip ? -1 : 1, y: 1 };     // 박스 모드에서는 부호만 반전에 쓰임
  }
  setVirtual(name, patch, opts) {
    const v = this.getVirtual(name); if (!v) return;
    Object.assign(v, patch, patch.crop ? { crop: { ...v.crop, ...patch.crop } } : {});
    this.applyVirtual(name, opts);
  }
  // 버추얼 창 다시 잡기 (프로그램을 껐다 켰을 때)
  rehookVirtual(name, value) {
    const s = this.sources[name]; if (!s) return;
    const v = this.getVirtual(name);
    if (v.method === 'spout') return;
    const w = value || s.input.settings?.window;
    try { s.input.update({ window: '', capture_mode: 'window' }); s.input.update(this.settingsFor('virtual', { value: w, virt: v })); } catch (e) { console.warn('rehook', e); }
  }
  // 모든 장면에 같은 버추얼 넣기 (위치는 같은 설정으로)
  virtualToAllScenes(name) {
    const s = this.sources[name]; if (!s) return 0;
    let n = 0;
    for (const sc of this.scenes) {
      if (sc.scene.getItems().some((it) => it.source.name === name)) continue;
      try { sc.scene.add(s.input); n++; } catch {}
    }
    this.applyVirtual(name); return n;
  }
  setDrawUI(on) { try { if (this.display) this.osn.NodeObs.OBS_content_setShouldDrawUI(this.display, !!on); } catch {} }

  // ================================================================ 오디오 (항상 켜짐: 데스크톱 / 마이크 / 프로그램별)
  addAudio(name, type, settings, label, kind) {
    if (this.audio[name]) return this.audio[name];
    const osn = this.osn;
    const input = osn.InputFactory.create(type, name, settings);
    this.audioBus.add(input);
    const fader = osn.FaderFactory.create(E.Fader.Cubic); fader.attach(input);
    const volmeter = osn.VolmeterFactory.create(E.Fader.IEC); volmeter.attach(input);
    this.audio[name] = { input, fader, volmeter, label, kind };
    this.emit('audio');
    return this.audio[name];
  }
  removeAudio(name) {
    const a = this.audio[name]; if (!a) return;
    for (const it of this.audioBus.getItems()) if (it.source.name === name) it.remove();
    try { a.volmeter.detach(); a.volmeter.destroy(); a.fader.detach(); a.fader.destroy(); a.input.release(); } catch {}
    delete this.audio[name]; delete this.levels[name];
    this.emit('audio');
  }
  setupAudio(cfg) {
    this.addAudio('데스크톱 소리', 'wasapi_output_capture', { device_id: 'default' }, '데스크톱 소리', 'desktop');
    this.addAudio('마이크', 'wasapi_input_capture', { device_id: 'default' }, '마이크', 'mic');
    for (const a of cfg.appAudio || []) { try { this.addAppAudio(a.exe || String(a.window || '').split(':').pop(), a.label); } catch (e) { console.warn(e); } }
    for (const [n, v] of Object.entries(cfg.audioState || {})) {
      const a = this.audio[n]; if (!a) continue;
      if (typeof v.vol === 'number') a.fader.deflection = v.vol;
      if (typeof v.muted === 'boolean') a.input.muted = v.muted;
    }
    this.emit('audio');
  }
  processType() {
    const t = this.types().find((x) => x.startsWith('wasapi_process_output_capture'));
    if (!t) throw new Error('이 PC에서는 프로그램별 소리 분리를 쓸 수 없어요. (윈도우 10 2004 이상 필요)');
    return t;
  }
  // 실행 파일 이름(예: Discord.exe)으로 소리 잡기 — 창 제목이 바뀌어도 계속 잡힘
  addAppAudio(exe, label) {
    exe = String(exe || '').trim(); if (!exe) throw new Error('프로그램을 알 수 없어요.');
    if (!/\.exe$/i.test(exe)) exe += '.exe';
    const lower = exe.toLowerCase();
    if (Object.values(this.audio).some((a) => a.exe && a.exe.toLowerCase() === lower)) throw new Error('이미 따로 잡고 있는 프로그램이에요.');
    const nice = label || exe.replace(/\.exe$/i, '');
    const name = this.uniqueName('앱 · ' + nice, (n) => this.nameTaken(n));
    const win = `${nice.replace(/:/g, ' ')}::${exe}`;          // 제목:클래스:실행파일 (priority 2 = 실행파일로 매칭)
    const a = this.addAudio(name, this.processType(), { window: win, priority: 2 }, nice, 'app');
    a.exe = exe;
    this.emit('audio');
    return name;
  }
  appAudioList() { return Object.entries(this.audio).filter(([, a]) => a.kind === 'app').map(([name, a]) => ({ name, label: a.label, exe: a.exe })); }
  audioList() { return Object.entries(this.audio).map(([name, a]) => ({ name, label: a.label, kind: a.kind, exe: a.exe, muted: a.input.muted, vol: a.fader.deflection })); }
  setVolume(name, v) { const a = this.audio[name]; if (a) a.fader.deflection = Math.max(0, Math.min(1, v)); }
  setMuted(name, m) { const a = this.audio[name]; if (a) { a.input.muted = m; this.emit('audio'); } }
  // 장치 목록은 이미 있는 데스크톱/마이크 소스에서 읽음 (새 소스를 만들지 않음)
  audioDevices(kind) {
    const a = this.audio[kind === 'mic' ? '마이크' : '데스크톱 소리'];
    try {
      const p = a ? a.input.properties.get('device_id') : null;
      return p && p.details ? p.details.items.map((x) => ({ name: String(x.name), value: String(x.value) })) : [];
    } catch (e) { console.error('audioDevices', e); return []; }
  }
  setAudioDevice(name, deviceId) { const a = this.audio[name]; if (a) a.input.update({ device_id: deviceId }); }
  onVolmeter(arr) {
    for (const d of arr || []) {
      const mags = d.magnitude || [], peaks = d.peak || [];
      const db = mags.length ? Math.max(...mags) : -Infinity, pk = peaks.length ? Math.max(...peaks) : -Infinity;
      const toLvl = (x) => (!isFinite(x) ? 0 : Math.max(0, Math.min(1, (x + 60) / 60)));
      this.levels[d.sourceName] = { level: toLvl(db), peak: toLvl(pk), t: Date.now() };
    }
  }

  // ================================================================ 저장 / 불러오기
  serialize() {
    const items = (s) => s.scene.getItems().map((it) => ({
      source: it.source.name, visible: it.visible, pos: it.position, scale: it.scale, align: it.alignment,
      boundsType: it.boundsType, bounds: it.bounds, boundsAlign: it.boundsAlignment, crop: it.crop,
    }));
    return {
      version: 5,
      current: this.currentScene ? this.currentScene.name : null,
      sources: Object.entries(this.sources).map(([name, s]) => ({ name, kind: s.kind, icon: s.icon, type: s.input.id, settings: s.input.settings, muted: s.input.muted, virt: s.virt })),
      scenes: this.scenes.map((s) => ({ name: s.name, items: items(s) })),
    };
  }
  load(data) {
    const osn = this.osn;
    for (const src of data.sources || []) {
      try {
        const input = osn.InputFactory.create(src.type, src.name, src.settings || {});
        if (src.muted) input.muted = true;
        this.sources[src.name] = { input, kind: src.kind, icon: src.icon || SOURCE_TYPES[src.kind]?.icon || '•' };
        if (src.kind === 'virtual') this.sources[src.name].virt = { ...VIRTUAL_DEFAULT, ...(src.virt || {}), crop: { ...VIRTUAL_DEFAULT.crop, ...(src.virt?.crop || {}) } };
      } catch (e) { console.warn('source load failed', src.name, e); }
    }
    for (const sc of data.scenes || []) {
      try {
        const scene = osn.SceneFactory.create(sc.name);
        const s = { id: 's' + this.seq++, name: sc.name, scene };
        this.scenes.push(s);
        for (const it of sc.items || []) {
          const src = this.sources[it.source]; if (!src) continue;
          try {
            const item = scene.add(src.input);
            item.alignment = it.align; item.boundsType = it.boundsType; item.boundsAlignment = it.boundsAlign;
            item.bounds = it.bounds; item.scale = it.scale; item.position = it.pos; item.visible = it.visible;
            if (it.crop) item.crop = it.crop;
          } catch (e) { console.warn('item load failed', it.source, e); }
        }
      } catch (e) { console.warn('scene load failed', sc.name, e); }
    }
    for (const [n, src] of Object.entries(this.sources)) if (src.kind === 'virtual') { try { this.applyVirtual(n, { layout: false }); } catch (e) { console.warn('virtual load', e); } }
    const cur = this.scenes.find((s) => s.name === data.current) || this.scenes[0];
    if (cur) this.switchScene(cur.id, true);
    this.emit('scenes'); this.emit('items');
  }

  // ================================================================ 인코더
  encoderTypes() { try { return this.osn.VideoEncoderFactory.types(); } catch { return ['obs_x264']; } }
  availableEncoders() { const all = this.encoderTypes(); return ENCODERS.filter((e) => all.includes(e.id)); }
  pickEncoder() {
    const avail = this.availableEncoders();
    const chosen = this.encoderPref !== 'auto' && avail.find((e) => e.id === this.encoderPref);
    return chosen || avail[0] || ENCODERS[ENCODERS.length - 1];
  }
  encoderSettings(id, p) {
    if (id === 'obs_x264') return { rate_control: 'CBR', bitrate: p.bitrate, keyint_sec: p.keyint, preset: 'veryfast', profile: 'high', tune: p.bframes === 0 ? 'zerolatency' : '', x264opts: p.bframes === 0 ? 'bframes=0 scenecut=0' : '' };
    return { rate_control: 'CBR', bitrate: p.bitrate, keyint_sec: p.keyint, preset2: 'p5', preset: 'quality', profile: 'high', bf: p.bframes, multipass: 'qres' };
  }

  // ================================================================ 송출 (여러 플랫폼 동시)
  get streaming() { return Object.values(this.streams).some((s) => s.state !== 'off'); }
  streamStates() { const o = {}; for (const [k, s] of Object.entries(this.streams)) o[k] = { state: s.state, error: s.error, startedAt: s.startedAt }; return o; }
  startStream(targets) {   // targets: [{ platform, key }]
    if (this.streaming) throw new Error('이미 방송 중이에요.');
    const list = targets.filter((t) => PLATFORMS[t.platform] && t.key);
    if (!list.length) throw new Error('스트림 키를 하나 이상 입력해 주세요.');
    const enc = this.pickEncoder();
    this.streamInfo = { encoder: enc.label };
    for (const t of list) {
      try { this.startOne(t.platform, t.key, enc); }
      catch (e) { this.streams[t.platform] = { state: 'off', error: e.message || String(e), parts: [] }; }
    }
    this.emit('stream', this.streamStates());
  }
  startOne(platform, key, enc) {
    const osn = this.osn, p = PLATFORMS[platform], tag = platform + '-' + Date.now();
    const service = osn.ServiceFactory.create('rtmp_custom', 'streamy-service-' + tag, { server: p.server, key, use_auth: false, bwtest: false });
    const venc = osn.VideoEncoderFactory.create(enc.id, 'streamy-video-' + tag, this.encoderSettings(enc.id, p));
    const aenc = osn.AudioEncoderFactory.create('ffmpeg_aac', 'streamy-audio-' + tag); aenc.bitrate = 160;
    const s = osn.SimpleStreamingFactory.create();
    s.video = this.video; s.videoEncoder = venc; s.audioEncoder = aenc; s.service = service; s.enforceServiceBitrate = false;
    s.delay = osn.DelayFactory.create(); s.delay.enabled = false;
    s.reconnect = osn.ReconnectFactory.create(); s.reconnect.enabled = true; s.reconnect.retryDelay = 10; s.reconnect.maxRetries = 20;
    s.network = osn.NetworkFactory.create();
    const rec = { out: s, parts: [venc, aenc, service], state: 'starting', error: '', startedAt: 0 };
    this.streams[platform] = rec;
    s.signalHandler = (sig) => this.onStreamSignal(platform, sig);
    s.start();
  }
  onStreamSignal(platform, sig) {
    const rec = this.streams[platform]; if (!rec) return;
    const n = sig.signal;
    if (n === 'start' || n === 'activate') { rec.state = 'live'; if (!rec.startedAt) rec.startedAt = Date.now(); rec.error = ''; }
    else if (n === 'reconnect') rec.state = 'reconnecting';
    else if (n === 'reconnect_success') rec.state = 'live';
    else if (n === 'stop' || n === 'deactivate') {
      if (rec.state === 'off') return;
      rec.error = sig.code && sig.code !== 0 ? streamError(sig) : '';
      rec.state = 'off';
      this.releaseStream(rec);
    }
    this.emit('stream', this.streamStates());
  }
  stopStream(force = false) {
    for (const rec of Object.values(this.streams)) {
      if (rec.state === 'off') continue;
      rec.state = 'stopping';
      try { rec.out.stop(force); } catch {}
      if (force) { rec.state = 'off'; this.releaseStream(rec); }
    }
    this.emit('stream', this.streamStates());
  }
  releaseStream(rec) {
    const s = rec.out; if (!s) return; rec.out = null;
    const parts = rec.parts; rec.parts = [];
    setTimeout(() => {
      try { s.signalHandler = () => {}; this.osn.SimpleStreamingFactory.destroy(s); } catch {}
      for (const x of parts) { try { x.release ? x.release() : this.osn.ServiceFactory.destroy(x); } catch {} }
    }, 500);
  }
  stats() {
    const g = this.osn.Global;
    const out = { cpu: g.cpuPercentage, fps: g.currentFrameRate };
    let kbps = 0, dropped = 0, sent = 0, any = false;
    for (const rec of Object.values(this.streams)) {
      if (!rec.out || rec.state === 'off') continue;
      try { kbps += rec.out.kbitsPerSec; dropped += rec.out.droppedFrames; sent += rec.out.totalFrames; any = true; } catch {}
    }
    if (any) Object.assign(out, { kbps, dropped, sent });
    return out;
  }

  // ================================================================ 녹화
  startRecording(dir) {
    if (this.recording) return;
    const osn = this.osn; fs.mkdirSync(dir, { recursive: true });
    const enc = this.pickEncoder();
    const r = osn.SimpleRecordingFactory.create();
    r.path = dir; r.format = 'mkv'; r.quality = 1; r.video = this.video;
    r.videoEncoder = osn.VideoEncoderFactory.create(enc.id, 'streamy-rec-' + Date.now(), enc.id === 'obs_x264' ? { rate_control: 'CRF', crf: 20, preset: 'veryfast' } : { rate_control: 'CQP', cqp: 20 });
    r.audioEncoder = osn.AudioEncoderFactory.create('ffmpeg_aac', 'streamy-rec-audio-' + Date.now());
    r.lowCPU = false; r.overwrite = false; r.noSpace = false;
    r.signalHandler = (sig) => {
      if (sig.signal === 'start') this.emit('record', { state: 'on' });
      if (sig.signal === 'stop') { this.emit('record', { state: 'off', error: sig.code ? (sig.error || '녹화 오류') : '' }); this.cleanupRecording(); }
    };
    this.recording = r; r.start();
  }
  stopRecording(force = false) { if (this.recording) { this.recording.stop(force); if (force) this.cleanupRecording(); } }
  cleanupRecording() {
    const r = this.recording; this.recording = null; if (!r) return;
    setTimeout(() => { try { const v = r.videoEncoder, a = r.audioEncoder; this.osn.SimpleRecordingFactory.destroy(r); v && v.release(); a && a.release(); } catch {} }, 500);
  }
}

function streamError(sig) {
  const msg = { '-1': '스트림 키나 서버 주소가 잘못됐어요.', '-2': '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.', '-3': '인코더를 시작하지 못했어요. 다른 인코더를 골라 보세요.', '-4': '연결이 끊겼어요.', '-5': '방송을 시작할 수 없어요.', '-6': '서버가 연결을 거부했어요. 스트림 키를 확인해 주세요.' }[String(sig.code)];
  return (msg || '방송 오류') + (sig.error ? ' (' + sig.error + ')' : '');
}

module.exports = { Engine, SOURCE_TYPES, PLATFORMS, ENCODERS, VIRTUAL_APPS, VIRTUAL_SPOTS, VIRTUAL_DEFAULT, appOfExe, exeOf };
