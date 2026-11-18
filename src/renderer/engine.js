// Streamy Kit 방송 엔진 래퍼 (v0.3)
// OBS 엔진(libobs)을 obs-studio-node 모듈로 불러와서 Streamy Kit에 필요한 기능만 감쌉니다.
// - 장면/소스는 사용자가 직접 만들고, 미리보기에서 끌어서 옮기고 크기를 바꿉니다.
// - 오디오(데스크톱/마이크/앱별)는 장면과 상관없이 항상 들리는 "오디오 버스"에 둡니다.
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
  monitor: { label: '모니터 화면', icon: '🖥', type: 'monitor_capture', prop: 'monitor_id', fit: true },
  window: { label: '프로그램 창', icon: '🪟', type: 'window_capture', prop: 'window', fit: true },
  game: { label: '게임', icon: '🎮', type: 'game_capture', prop: 'window', fit: true },
  webcam: { label: '웹캠', icon: '📷', type: 'dshow_input', prop: 'video_device_id', fit: false },
  image: { label: '이미지', icon: '🖼', type: 'image_source', file: true, fit: false },
  text: { label: '텍스트', icon: '🅃', type: 'text_gdiplus', text: true, fit: false },
  web: { label: '웹페이지 (알림창 등)', icon: '🌐', type: 'browser_source', url: true, fit: false },
  timer: { label: '타이머', icon: '⏱', type: 'browser_source', timer: true, fit: false },
  virtual: { label: '버추얼 (Spout2)', icon: '🧸', type: 'spout_capture', fit: false },
  color: { label: '단색 배경', icon: '■', type: 'color_source', fit: true },
};

// 앱별 소리 분리 대상. priority 2 = 실행 파일 이름으로 매칭 (창 제목이 바뀌어도 잡힘)
const AUDIO_APPS = {
  discord: { name: '디스코드', window: 'Discord:Chrome_WidgetWin_1:Discord.exe' },
  chrome: { name: '크롬 (유튜브 등)', window: 'Chrome:Chrome_WidgetWin_1:chrome.exe' },
  edge: { name: '엣지', window: 'Edge:Chrome_WidgetWin_1:msedge.exe' },
  whale: { name: '웨일', window: 'Whale:Chrome_WidgetWin_1:whale.exe' },
  spotify: { name: '스포티파이', window: 'Spotify:Chrome_WidgetWin_1:Spotify.exe' },
  melon: { name: '멜론', window: 'Melon:Chrome_WidgetWin_1:Melon.exe' },
};

// 플랫폼별 송출 프리셋 (OBS 엔진에 들어 있는 rtmp-services 값 기준)
const PLATFORMS = {
  chzzk: { name: '치지직', server: 'rtmp://global-rtmp.lip2.navercorp.com:8080/relay', bitrate: 8000, keyint: 1, bframes: 0, keyHelp: 'https://studio.chzzk.naver.com/setting' },
  youtube: { name: '유튜브', server: 'rtmps://a.rtmps.youtube.com:443/live2', bitrate: 9000, keyint: 2, bframes: 2, keyHelp: 'https://studio.youtube.com/' },
  soop: { name: 'SOOP', server: 'rtmp://stream.sooplive.co.kr/app/', bitrate: 8000, keyint: 2, bframes: 0, keyHelp: 'https://dashboard.sooplive.co.kr' },
};

const ENCODER_PRIORITY = ['obs_nvenc_h264_tex', 'jim_nvenc', 'ffmpeg_nvenc', 'h264_texture_amf', 'amd_amf_h264', 'obs_qsv11_v2', 'obs_qsv11', 'obs_x264'];
const ENCODER_LABEL = { obs_nvenc_h264_tex: 'NVIDIA NVENC', jim_nvenc: 'NVIDIA NVENC', ffmpeg_nvenc: 'NVIDIA NVENC', h264_texture_amf: 'AMD', amd_amf_h264: 'AMD', obs_qsv11_v2: 'Intel QSV', obs_qsv11: 'Intel QSV', obs_x264: 'CPU (x264)' };

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
    this.sources = {};           // name -> { input, kind }
    this.audio = {};             // name -> { input, fader, volmeter, label, kind }
    this.audioBus = null;
    this.levels = {};            // name -> { level(0..1), peak(0..1) }
    this.selected = null;        // { sceneId, itemId }
    this.stream = null; this.streamParts = []; this.recording = null;
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
    const init = N.OBS_API_initAPI({ language: 'ko-KR', appDataPath: dataDir, version: '0.3.0', crashServerUrl: '' });
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

    // 장면 전환 + 오디오 버스(항상 켜져 있는 소리 전용 장면, 영상 없음)
    this.transition = osn.TransitionFactory.create('fade_transition', 'streamy-fade', {});
    osn.Global.setOutputSource(0, this.transition);
    this.audioBus = osn.SceneFactory.createPrivate('streamy-audio-bus');
    osn.Global.setOutputSource(9, this.audioBus);

    // 소리 레벨: 볼륨미터 콜백 (소스 콜백 작업자가 볼륨미터도 함께 읽어 옴)
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
    try { N.RemoveVolmeterCallback?.(); N.RemoveSourceCallback?.(); } catch {}
    for (const a of Object.values(this.audio)) { try { a.volmeter.detach(); a.volmeter.destroy(); a.fader.detach(); a.fader.destroy(); a.input.release(); } catch {} }
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
  createDisplay(windowHandle) {
    const N = this.osn.NodeObs;
    this.display = 'streamy-preview';
    N.OBS_content_createDisplay(windowHandle, this.display, E.Render.Main, false, this.video);
    N.OBS_content_setPaddingColor(this.display, 5, 5, 6);
    N.OBS_content_setPaddingSize(this.display, 0);
    N.OBS_content_setShouldDrawUI(this.display, true);   // 선택한 소스의 테두리/손잡이 표시
    try { N.OBS_content_setOutlineColor?.(this.display, 225, 29, 46); } catch {}
  }
  moveDisplay(x, y, w, h) {
    if (!this.display) return;
    const N = this.osn.NodeObs;
    N.OBS_content_moveDisplay(this.display, Math.round(x), Math.round(y));
    N.OBS_content_resizeDisplay(this.display, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }
  destroyDisplay() { if (this.display) { this.osn.NodeObs.OBS_content_destroyDisplay(this.display); this.display = null; } }
  // 미리보기 안에서 실제 영상이 그려지는 영역 (디스플레이 기준 픽셀)
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

  // ================================================================ 장면
  sceneById(id) { return this.scenes.find((s) => s.id === id) || null; }
  get currentScene() { return this.sceneById(this.currentId); }
  uniqueName(base, taken) { let n = base, i = 2; while (taken(n)) n = `${base} ${i++}`; return n; }

  addScene(name) {
    name = this.uniqueName(name || '장면 ' + (this.scenes.length + 1), (n) => this.scenes.some((s) => s.name === n) || !!this.sources[n]);
    const scene = this.osn.SceneFactory.create(name);
    const s = { id: 's' + this.seq++, name, scene };
    this.scenes.push(s);
    if (!this.currentId) this.switchScene(s.id, true);
    this.emit('scenes');
    return s;
  }
  renameScene(id, name) {
    const s = this.sceneById(id); if (!s || !name) return;
    if (this.scenes.some((x) => x.name === name && x.id !== id)) throw new Error('같은 이름의 장면이 있어요.');
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
    const cands = all.filter((t) => t === base || t.startsWith(base + '_v')).sort();
    return cands.pop() || null;
  }
  available(kind) { try { return !!this.resolveType(kind); } catch { return false; } }

  // 장치/창/모니터 목록 (OBS 속성에서 읽음)
  choices(kind) {
    const def = SOURCE_TYPES[kind]; if (!def.prop) return [];
    const type = this.resolveType(kind); if (!type) return [];
    try {
      const tmp = this.osn.InputFactory.createPrivate(type, '__probe_' + Date.now(), {});
      const p = tmp.properties.get(def.prop);
      const items = p && p.details ? p.details.items.filter((x) => x.value !== '').map((x) => ({ name: x.name, value: x.value })) : [];
      tmp.release();
      return items;
    } catch (e) { console.error(e); return []; }
  }

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
      case 'virtual': return {};
      case 'color': return { color: abgr(opt.color || '#0E0E10'), width: this.width, height: this.height };
    }
    return {};
  }

  addSource(kind, opt = {}) {
    const scene = this.currentScene; if (!scene) throw new Error('장면을 먼저 만들어 주세요.');
    const def = SOURCE_TYPES[kind];
    const type = this.resolveType(kind);
    if (!type) throw new Error(`이 PC에서는 '${def.label}'을(를) 쓸 수 없어요.` + (kind === 'virtual' ? ' (Spout2 플러그인 필요)' : ''));
    const name = this.uniqueName(opt.name || def.label, (n) => !!this.sources[n] || !!this.audio[n] || this.scenes.some((s) => s.name === n));
    const input = this.osn.InputFactory.create(type, name, this.settingsFor(kind, opt));
    this.sources[name] = { input, kind };
    const item = scene.scene.add(input);
    // 화면류는 캔버스에 꽉 차게, 나머지는 원래 크기로 가운데
    item.alignment = E.Align.TopLeft;
    if (def.fit) {
      item.position = { x: 0, y: 0 };
      item.boundsType = E.Bounds.ScaleInner; item.boundsAlignment = E.Align.Center;
      item.bounds = { x: this.width, y: this.height };
      if (kind !== 'color') item.moveTop(); else item.moveBottom();
    } else if (kind === 'webcam' || kind === 'virtual') {
      const w = kind === 'webcam' ? this.width * 0.3 : this.width * 0.4, h = kind === 'webcam' ? this.height * 0.3 : this.height * 0.8;
      item.position = { x: kind === 'webcam' ? 30 : this.width - w - 30, y: this.height - h - 30 };
      item.boundsType = E.Bounds.ScaleInner; item.boundsAlignment = E.Align.Center; item.bounds = { x: w, y: h };
    } else if (kind === 'timer') {
      item.position = { x: this.width - 630, y: 30 };
    } else {
      item.position = { x: this.width / 4, y: this.height / 3 };
    }
    // 소리가 있는 소스(게임/웹)는 믹서에 표시되도록 볼륨미터만 붙임 (재생은 장면에서)
    this.select(scene.id, item.id);
    this.emit('items');
    return { name, item };
  }

  // 장면에서 쓰이지 않는 소스 정리
  gcSources() {
    const used = new Set();
    for (const s of this.scenes) for (const it of s.scene.getItems()) used.add(it.source.name);
    for (const [n, s] of Object.entries(this.sources)) if (!used.has(n)) { try { s.input.release(); } catch {} delete this.sources[n]; }
  }

  items(sceneId = this.currentId) {
    const s = this.sceneById(sceneId); if (!s) return [];
    // getItems()는 아래(0)부터 위로. 목록은 위에 있는 것부터 보여줌
    return s.scene.getItems().map((it) => {
      const src = this.sources[it.source.name];
      return { id: it.id, name: it.source.name, kind: src ? src.kind : '', visible: it.visible, selected: this.selected && this.selected.itemId === it.id && this.selected.sceneId === sceneId };
    }).reverse();
  }
  itemObj(itemId, sceneId = this.currentId) { const s = this.sceneById(sceneId); return s ? s.scene.findItem(itemId) : null; }
  setVisible(itemId, v) { const it = this.itemObj(itemId); if (it) { it.visible = v; this.emit('items'); } }
  moveItem(itemId, dir) { const it = this.itemObj(itemId); if (!it) return; dir > 0 ? it.moveUp() : it.moveDown(); this.emit('items'); }
  removeItem(itemId) {
    const it = this.itemObj(itemId); if (!it) return;
    if (this.selected && this.selected.itemId === itemId) this.clearSelection();
    it.remove(); this.gcSources(); this.emit('items');
  }
  renameSource(oldName, name) {
    const s = this.sources[oldName]; if (!s || !name || name === oldName) return;
    if (this.sources[name] || this.audio[name]) throw new Error('같은 이름이 있어요.');
    s.input.name = name; this.sources[name] = s; delete this.sources[oldName]; this.emit('items');
  }
  sourceSettings(name) { const s = this.sources[name]; return s ? { kind: s.kind, settings: s.input.settings } : null; }
  updateSource(name, kind, opt) { const s = this.sources[name]; if (s) s.input.update(this.settingsFor(kind, opt)); }

  // ================================================================ 선택 / 끌기 / 크기 조절 (캔버스 좌표)
  select(sceneId, itemId) {
    this.clearSelection();
    const it = this.itemObj(itemId, sceneId); if (!it) return;
    it.selected = true; this.selected = { sceneId, itemId };
    this.emit('items');
  }
  clearSelection() {
    if (this.selected) { const it = this.itemObj(this.selected.itemId, this.selected.sceneId); if (it) { try { it.selected = false; } catch {} } }
    this.selected = null;
  }
  // 항목이 실제로 차지하는 사각형
  itemRect(it) {
    const src = it.source;
    const sw = src.width || 0, sh = src.height || 0;
    const pos = it.position, al = it.alignment;
    let w, h, x, y;
    if (it.boundsType !== E.Bounds.None) {
      const b = it.bounds;
      const bx = pos.x - (al & E.Align.Right ? b.x : al & E.Align.Left ? 0 : b.x / 2);
      const by = pos.y - (al & E.Align.Bottom ? b.y : al & E.Align.Top ? 0 : b.y / 2);
      if (sw > 0 && sh > 0) { const k = Math.min(b.x / sw, b.y / sh); w = sw * k; h = sh * k; } else { w = b.x; h = b.y; }
      x = bx + (b.x - w) / 2; y = by + (b.y - h) / 2;
    } else {
      const sc = it.scale; w = sw * sc.x; h = sh * sc.y;
      x = pos.x - (al & E.Align.Right ? w : al & E.Align.Left ? 0 : w / 2);
      y = pos.y - (al & E.Align.Bottom ? h : al & E.Align.Top ? 0 : h / 2);
    }
    return { x, y, w, h, sw, sh };
  }
  // 위에 있는 것부터 검사해서 클릭한 항목 찾기
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
  // 끌기 시작 전에 단순한 형태(왼쪽 위 기준, 크기=배율)로 바꿔 둠
  normalize(itemId) {
    const it = this.itemObj(itemId); if (!it) return null;
    const r = this.itemRect(it);
    if (r.sw > 0 && r.sh > 0) {
      it.boundsType = E.Bounds.None;
      it.alignment = E.Align.TopLeft;
      it.scale = { x: r.w / r.sw, y: r.h / r.sh };
      it.position = { x: r.x, y: r.y };
    }
    return this.itemRect(it);
  }
  setItemRect(itemId, x, y, w) {
    const it = this.itemObj(itemId); if (!it) return;
    const sw = it.source.width || 0;
    if (sw > 0 && w) { const k = Math.max(0.02, w / sw); it.scale = { x: k, y: k }; }
    it.position = { x, y };
  }
  fitItem(itemId, mode) {
    const it = this.itemObj(itemId); if (!it) return;
    const r = this.normalize(itemId); if (!r || !r.sw) return;
    if (mode === 'fit') { const k = Math.min(this.width / r.sw, this.height / r.sh); it.scale = { x: k, y: k }; it.position = { x: (this.width - r.sw * k) / 2, y: (this.height - r.sh * k) / 2 }; }
    if (mode === 'center') it.position = { x: (this.width - r.w) / 2, y: (this.height - r.h) / 2 };
    if (mode === 'reset') { it.scale = { x: 1, y: 1 }; it.position = { x: (this.width - r.sw) / 2, y: (this.height - r.sh) / 2 }; }
  }

  // ================================================================ 오디오 (항상 켜짐: 데스크톱 / 마이크 / 앱별)
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
    for (const a of cfg.appAudio || []) { try { this.addAppAudio(a.window, a.label); } catch (e) { console.warn(e); } }
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
  // 지금 켜져 있는 프로그램 목록 (소리 분리 대상 후보)
  appChoices() {
    const type = this.processType();
    try {
      const tmp = this.osn.InputFactory.createPrivate(type, '__probe_apps_' + Date.now(), {});
      const p = tmp.properties.get('window');
      const items = p && p.details ? p.details.items.filter((x) => x.value).map((x) => ({ name: x.name, value: String(x.value) })) : [];
      tmp.release();
      return items;
    } catch (e) { console.error(e); return []; }
  }
  // window 값 "제목:클래스:실행파일.exe" — 실행 파일 이름으로 매칭(priority 2)
  addAppAudio(windowValue, label) {
    const type = this.processType();
    const exe = String(windowValue).split(':').pop() || windowValue;
    const name = '앱 · ' + (label || exe.replace(/\.exe$/i, ''));
    if (Object.values(this.audio).some((a) => a.window && a.window.split(':').pop().toLowerCase() === exe.toLowerCase())) throw new Error('이미 따로 잡고 있는 프로그램이에요.');
    const a = this.addAudio(name, type, { window: windowValue, priority: 2 }, label || exe.replace(/\.exe$/i, ''), 'app');
    a.window = windowValue;
    return name;
  }
  appAudioList() { return Object.entries(this.audio).filter(([, a]) => a.kind === 'app').map(([name, a]) => ({ name, label: a.label, window: a.window })); }
  audioList() {
    return Object.entries(this.audio).map(([name, a]) => ({ name, label: a.label, kind: a.kind, muted: a.input.muted, vol: a.fader.deflection }));
  }
  setVolume(name, v) { const a = this.audio[name]; if (a) a.fader.deflection = Math.max(0, Math.min(1, v)); }
  setMuted(name, m) { const a = this.audio[name]; if (a) { a.input.muted = m; this.emit('audio'); } }
  audioDevices(kind) {
    const type = kind === 'mic' ? 'wasapi_input_capture' : 'wasapi_output_capture';
    try {
      const tmp = this.osn.InputFactory.createPrivate(type, '__probe_audio_' + Date.now(), {});
      const p = tmp.properties.get('device_id');
      const items = p && p.details ? p.details.items.map((x) => ({ name: x.name, value: x.value })) : [];
      tmp.release(); return items;
    } catch { return []; }
  }
  setAudioDevice(name, deviceId) { const a = this.audio[name]; if (a) a.input.update({ device_id: deviceId }); }

  // 볼륨미터 → 0..1 레벨 (−60dB ~ 0dB)
  onVolmeter(arr) {
    for (const d of arr || []) {
      const mags = d.magnitude || [], peaks = d.peak || [];
      const db = mags.length ? Math.max(...mags) : -Infinity;
      const pk = peaks.length ? Math.max(...peaks) : -Infinity;
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
      version: 3,
      current: this.currentScene ? this.currentScene.name : null,
      sources: Object.entries(this.sources).map(([name, s]) => ({ name, kind: s.kind, type: s.input.id, settings: s.input.settings, muted: s.input.muted })),
      scenes: this.scenes.map((s) => ({ name: s.name, items: items(s) })),
    };
  }
  load(data) {
    const osn = this.osn;
    for (const src of data.sources || []) {
      try {
        const input = osn.InputFactory.create(src.type, src.name, src.settings || {});
        if (src.muted) input.muted = true;
        this.sources[src.name] = { input, kind: src.kind };
      } catch (e) { console.warn('source load failed', src.name, e); }
    }
    for (const sc of data.scenes || []) {
      const scene = osn.SceneFactory.create(sc.name);
      const s = { id: 's' + this.seq++, name: sc.name, scene };
      this.scenes.push(s);
      for (const it of sc.items || []) {
        const src = this.sources[it.source]; if (!src) continue;
        const item = scene.add(src.input);
        try {
          item.alignment = it.align; item.boundsType = it.boundsType; item.boundsAlignment = it.boundsAlign;
          item.bounds = it.bounds; item.scale = it.scale; item.position = it.pos; item.visible = it.visible;
          if (it.crop) item.crop = it.crop;
        } catch (e) { console.warn(e); }
      }
    }
    const cur = this.scenes.find((s) => s.name === data.current) || this.scenes[0];
    if (cur) this.switchScene(cur.id, true);
    this.emit('scenes'); this.emit('items');
  }

  // ================================================================ 송출
  encoderTypes() { try { return this.osn.VideoEncoderFactory.types(); } catch { return ['obs_x264']; } }
  pickEncoder() { const all = this.encoderTypes(); const id = ENCODER_PRIORITY.find((e) => all.includes(e)) || 'obs_x264'; return { id, label: ENCODER_LABEL[id] || id }; }
  encoderSettings(id, p) {
    if (id === 'obs_x264') return { rate_control: 'CBR', bitrate: p.bitrate, keyint_sec: p.keyint, preset: 'veryfast', profile: 'high', tune: p.bframes === 0 ? 'zerolatency' : '', x264opts: p.bframes === 0 ? 'bframes=0 scenecut=0' : '' };
    return { rate_control: 'CBR', bitrate: p.bitrate, keyint_sec: p.keyint, preset2: 'p5', preset: 'quality', profile: 'high', bf: p.bframes, multipass: 'qres' };
  }
  startStream({ platform, key }) {
    if (this.stream) throw new Error('이미 방송 중이에요.');
    const p = PLATFORMS[platform]; if (!p) throw new Error('플랫폼을 골라 주세요.');
    if (!key) throw new Error(p.name + ' 스트림 키를 입력해 주세요.');
    const osn = this.osn, enc = this.pickEncoder();
    const service = osn.ServiceFactory.create('rtmp_custom', 'streamy-service-' + platform, { server: p.server, key, use_auth: false, bwtest: false });
    const venc = osn.VideoEncoderFactory.create(enc.id, 'streamy-video-' + Date.now(), this.encoderSettings(enc.id, p));
    const aenc = osn.AudioEncoderFactory.create('ffmpeg_aac', 'streamy-audio-' + Date.now()); aenc.bitrate = 160;
    const s = osn.SimpleStreamingFactory.create();
    s.video = this.video; s.videoEncoder = venc; s.audioEncoder = aenc; s.service = service; s.enforceServiceBitrate = false;
    s.delay = osn.DelayFactory.create(); s.delay.enabled = false;
    s.reconnect = osn.ReconnectFactory.create(); s.reconnect.enabled = true; s.reconnect.retryDelay = 10; s.reconnect.maxRetries = 20;
    s.network = osn.NetworkFactory.create();
    s.signalHandler = (sig) => this.onStreamSignal(sig);
    this.stream = s; this.streamParts = [venc, aenc, service];
    this.streamInfo = { platform: p.name, encoder: enc.label, startedAt: 0 };
    this.emit('stream', { state: 'starting', ...this.streamInfo });
    s.start();
  }
  onStreamSignal(sig) {
    const n = sig.signal;
    if (n === 'start' || n === 'activate') { if (!this.streamInfo.startedAt) this.streamInfo.startedAt = Date.now(); this.emit('stream', { state: 'live', ...this.streamInfo }); }
    else if (n === 'reconnect') this.emit('stream', { state: 'reconnecting', ...this.streamInfo });
    else if (n === 'reconnect_success') this.emit('stream', { state: 'live', ...this.streamInfo });
    else if (n === 'stop' || n === 'deactivate') { const err = sig.code && sig.code !== 0 ? streamError(sig) : ''; this.cleanupStream(); this.emit('stream', { state: 'off', error: err }); }
  }
  stopStream(force = false) { if (!this.stream) return; this.emit('stream', { state: 'stopping', ...this.streamInfo }); this.stream.stop(force); if (force) this.cleanupStream(); }
  cleanupStream() {
    if (!this.stream) return;
    const s = this.stream; this.stream = null;
    setTimeout(() => {
      try { s.signalHandler = () => {}; this.osn.SimpleStreamingFactory.destroy(s); } catch {}
      for (const x of this.streamParts) { try { x.release ? x.release() : this.osn.ServiceFactory.destroy(x); } catch {} }
      this.streamParts = [];
    }, 500);
  }
  stats() {
    const g = this.osn.Global;
    const out = { cpu: g.cpuPercentage, fps: g.currentFrameRate };
    if (this.stream) { out.kbps = this.stream.kbitsPerSec; out.dropped = this.stream.droppedFrames; out.sent = this.stream.totalFrames; }
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
  const msg = { '-1': '스트림 키나 서버 주소가 잘못됐어요.', '-2': '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.', '-3': '인코더를 시작하지 못했어요.', '-4': '연결이 끊겼어요.', '-5': '방송을 시작할 수 없어요.', '-6': '서버가 연결을 거부했어요. 스트림 키를 확인해 주세요.' }[String(sig.code)];
  return (msg || '방송 오류') + (sig.error ? ' (' + sig.error + ')' : '');
}

module.exports = { Engine, SOURCE_TYPES, AUDIO_APPS, PLATFORMS };
