// Streamy Kit 방송 엔진 래퍼
// OBS 엔진(libobs)을 obs-studio-node 모듈로 불러와서, Streamy Kit에 필요한 기능만 쉬운 함수로 감쌉니다.
// 카메라(웹캠)는 사용자가 직접 추가했을 때만 만들고, 위치·크기도 사용자가 정합니다.
'use strict';
const path = require('path');
const fs = require('fs');

// enum 값 (obs-studio-node의 const enum은 런타임에 없으므로 숫자로 둡니다)
const E = {
  VideoFormat: { NV12: 2 }, ColorSpace: { CS709: 2 }, Range: { Partial: 1 }, Scale: { Bilinear: 3, Lanczos: 4 },
  FPSType: { Fractional: 2 }, Fader: { Cubic: 0 }, Monitoring: { None: 0, MonitoringAndOutput: 2 },
  Align: { Center: 0, TopLeft: 5, TopRight: 6, BottomLeft: 9, BottomRight: 10 },
  Bounds: { None: 0, ScaleInner: 2, MaxOnly: 6 }, Render: { Main: 0 }, IPCOk: 0,
};

const P = '[Streamy] ';
const SCENES = [
  { key: 'waiting', name: P + '방송 시작 전', label: '시작 전' },
  { key: 'main', name: P + '메인', label: '메인' },
  { key: 'away', name: P + '잠시 자리 비움', label: '자리 비움' },
  { key: 'ending', name: P + '방송 종료', label: '종료' },
];

// 앱별 소리 분리 대상. priority 2 = 실행 파일 이름으로 매칭 (창 제목이 바뀌어도 잡힘)
const AUDIO_APPS = {
  discord: { name: '디스코드', window: 'Discord:Chrome_WidgetWin_1:Discord.exe' },
  chrome: { name: '크롬 (유튜브 등)', window: 'Chrome:Chrome_WidgetWin_1:chrome.exe' },
  edge: { name: '엣지', window: 'Edge:Chrome_WidgetWin_1:msedge.exe' },
  whale: { name: '웨일', window: 'Whale:Chrome_WidgetWin_1:whale.exe' },
  spotify: { name: '스포티파이', window: 'Spotify:Chrome_WidgetWin_1:Spotify.exe' },
  melon: { name: '멜론', window: 'Melon:Chrome_WidgetWin_1:Melon.exe' },
};

const VIRTUAL_APPS = {
  vtubestudio: { name: 'VTube Studio', window: 'VTube Studio:UnityWndClass:VTube Studio.exe', spout: true },
  vseeface: { name: 'VSeeFace', window: 'VSeeFace:UnityWndClass:VSeeFace.exe', spout: true },
  warudo: { name: 'Warudo', window: 'Warudo:UnityWndClass:Warudo.exe', spout: false },
};

// 플랫폼별 송출 프리셋 (OBS 엔진에 들어 있는 rtmp-services 값 기준)
const PLATFORMS = {
  chzzk: { name: '치지직', service: 'CHZZK', server: 'rtmp://global-rtmp.lip2.navercorp.com:8080/relay', bitrate: 8000, keyint: 1, bframes: 0, keyHelp: 'https://studio.chzzk.naver.com/setting' },
  youtube: { name: '유튜브', service: 'YouTube - RTMPS', server: 'rtmps://a.rtmps.youtube.com:443/live2', bitrate: 9000, keyint: 2, bframes: 2, keyHelp: 'https://studio.youtube.com/channel/UC/livestreaming' },
  soop: { name: 'SOOP', service: 'SOOP', server: 'rtmp://stream.sooplive.co.kr/app/', bitrate: 8000, keyint: 2, bframes: 0, keyHelp: 'https://dashboard.sooplive.co.kr' },
};

// 하드웨어 인코더 우선순위 (있는 것 중 첫 번째 사용)
const ENCODER_PRIORITY = ['obs_nvenc_h264_tex', 'jim_nvenc', 'ffmpeg_nvenc', 'h264_texture_amf', 'amd_amf_h264', 'obs_qsv11_v2', 'obs_qsv11', 'obs_x264'];
const ENCODER_LABEL = { obs_nvenc_h264_tex: 'NVIDIA NVENC', jim_nvenc: 'NVIDIA NVENC', ffmpeg_nvenc: 'NVIDIA NVENC', h264_texture_amf: 'AMD', amd_amf_h264: 'AMD', obs_qsv11_v2: 'Intel QSV', obs_qsv11: 'Intel QSV', obs_x264: 'CPU (x264)' };

const abgr = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};

class Engine {
  constructor() {
    this.osn = null;
    this.video = null;
    this.ready = false;
    this.scenes = {};          // key -> IScene
    this.transition = null;
    this.current = null;
    this.inputs = {};          // name -> IInput (우리가 만든 것만)
    this.faders = {};          // name -> IFader
    this.stream = null;
    this.streamParts = [];
    this.recording = null;
    this.listeners = {};
    this.width = 1920; this.height = 1080; this.fps = 60;
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { (this.listeners[ev] || []).forEach((f) => { try { f(data); } catch (e) { console.error(e); } }); }

  // ---------------------------------------------------------------- 시작/종료
  start({ osnDir, dataDir, width = 1920, height = 1080, fps = 60 }) {
    if (process.platform !== 'win32') throw new Error('Streamy Kit 방송 엔진은 윈도우에서만 실행돼요.');
    if (!fs.existsSync(path.join(osnDir, 'obs_studio_client.node'))) throw new Error('방송 엔진 파일을 찾지 못했어요: ' + osnDir);
    this.osn = require(path.join(osnDir, 'index.js'));
    const osn = this.osn;
    fs.mkdirSync(dataDir, { recursive: true });

    const pipe = 'streamy-kit-' + process.pid + '-' + Date.now();
    const code = osn.NodeObs.IPC.host(pipe);
    if (code !== E.IPCOk) throw new Error('방송 엔진 프로세스를 시작하지 못했어요 (코드 ' + code + '). Visual C++ 런타임이 설치돼 있는지 확인해 주세요.');
    osn.NodeObs.SetWorkingDirectory(osnDir);
    const init = osn.NodeObs.OBS_API_initAPI({ language: 'ko-KR', appDataPath: dataDir, version: '0.2.0', crashServerUrl: '' });
    if (init !== 0) throw new Error('방송 엔진 초기화 실패 (코드 ' + init + '). 그래픽 드라이버를 최신으로 업데이트해 보세요.');

    this.width = width; this.height = height; this.fps = fps;
    this.video = osn.VideoFactory.create();
    this.video.video = {
      fpsNum: fps, fpsDen: 1, baseWidth: width, baseHeight: height, outputWidth: width, outputHeight: height,
      outputFormat: E.VideoFormat.NV12, colorspace: E.ColorSpace.CS709, range: E.Range.Partial,
      scaleType: E.Scale.Lanczos, fpsType: E.FPSType.Fractional,
    };
    try { osn.NodeObs.OBS_service_connectOutputSignals?.(); } catch { /* 일부 버전엔 없음 */ }
    this.ready = true;
    return { inputTypes: osn.InputFactory.types(), encoders: this.encoderTypes() };
  }

  shutdown() {
    if (!this.osn) return;
    try { this.stopStream(true); } catch {}
    try { this.stopRecording(true); } catch {}
    try { this.destroyDisplay(); } catch {}
    for (const f of Object.values(this.faders)) { try { f.detach(); f.destroy(); } catch {} }
    try { if (this.transition) { this.transition.clear(); this.transition.release(); } } catch {}
    for (const i of Object.values(this.inputs)) { try { i.release(); } catch {} }
    for (const s of Object.values(this.scenes)) { try { s.release(); } catch {} }
    try { this.video && this.video.destroy(); } catch {}
    try { this.osn.NodeObs.OBS_service_removeCallback?.(); } catch {}
    try { this.osn.NodeObs.IPC.disconnect(); } catch {}
    this.ready = false;
  }

  // ---------------------------------------------------------------- 미리보기 화면
  createDisplay(windowHandle) {
    const N = this.osn.NodeObs;
    N.OBS_content_createDisplay(windowHandle, 'streamy-preview', E.Render.Main, false, this.video);
    N.OBS_content_setPaddingColor('streamy-preview', 8, 8, 10);
    N.OBS_content_setShouldDrawUI('streamy-preview', false);
    this.display = 'streamy-preview';
  }
  moveDisplay(x, y, w, h) {
    if (!this.display) return;
    const N = this.osn.NodeObs;
    N.OBS_content_moveDisplay(this.display, Math.round(x), Math.round(y));
    N.OBS_content_resizeDisplay(this.display, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }
  destroyDisplay() {
    if (!this.display) return;
    this.osn.NodeObs.OBS_content_destroyDisplay(this.display);
    this.display = null;
  }

  // ---------------------------------------------------------------- 소스 헬퍼
  hasType(t) { return this.osn.InputFactory.types().includes(t); }
  pickType(...list) { const all = this.osn.InputFactory.types(); return list.find((t) => all.includes(t)); }

  input(name) { return this.inputs[name] || null; }
  makeInput(type, name, settings = {}) {
    if (this.inputs[name]) return this.inputs[name];
    const i = this.osn.InputFactory.create(type, name, settings);
    this.inputs[name] = i;
    return i;
  }
  removeInput(name) {
    const i = this.inputs[name];
    if (!i) return;
    for (const s of Object.values(this.scenes)) {
      for (const it of s.getItems()) if (it.source.name === name) it.remove();
    }
    const f = this.faders[name];
    if (f) { try { f.detach(); f.destroy(); } catch {} delete this.faders[name]; }
    i.release();
    delete this.inputs[name];
    this.emit('audio-changed');
  }
  findItem(scene, name) { return scene.getItems().find((it) => it.source.name === name) || null; }
  place(sceneKey, input, opts = {}) {
    const scene = this.scenes[sceneKey];
    let item = this.findItem(scene, input.name);
    if (!item) item = scene.add(input);
    if (opts.fit) {
      item.position = { x: 0, y: 0 };
      item.alignment = E.Align.TopLeft;
      item.boundsType = E.Bounds.ScaleInner;
      item.boundsAlignment = E.Align.Center;
      item.bounds = { x: this.width, y: this.height };
    }
    if (opts.textBox) {
      item.position = { x: 0, y: opts.textBox.y };
      item.alignment = E.Align.TopLeft;
      item.boundsType = E.Bounds.MaxOnly;
      item.boundsAlignment = E.Align.Center;
      item.bounds = { x: this.width, y: opts.textBox.h };
    }
    if (opts.pos) { item.alignment = opts.align ?? E.Align.TopLeft; item.position = opts.pos; }
    if (opts.scale) item.scale = { x: opts.scale, y: opts.scale };
    if (opts.bottom) item.moveBottom();
    if (opts.top) item.moveTop();
    return item;
  }

  // ---------------------------------------------------------------- 기본 장면 4개
  setupScenes(cfg) {
    const osn = this.osn;
    for (const s of SCENES) if (!this.scenes[s.key]) this.scenes[s.key] = osn.SceneFactory.create(s.name);

    const colorType = this.pickType('color_source_v3', 'color_source_v2', 'color_source');
    const textType = this.pickType('text_gdiplus_v3', 'text_gdiplus_v2', 'text_gdiplus');
    const bg = this.makeInput(colorType, P + '배경', { color: abgr(cfg.bgColor || '#0E0E10'), width: this.width, height: this.height });
    const red = this.makeInput(colorType, P + '레드 라인', { color: abgr('#E11D2E'), width: 160, height: 6 });
    const font = (size) => ({ face: 'Malgun Gothic', size, style: 'Bold', flags: 1 });
    const text = (name, t, size, color = '#FFFFFF') => this.makeInput(textType, name, { text: t, font: font(size), color: abgr(color) & 0xffffff, align: 'center', valign: 'center' });

    const tWait = text(P + '문구-시작 전', cfg.waitingText || '곧 방송이 시작됩니다', 120);
    const tSub = text(P + '문구-서브', 'STREAMY KIT  ·  LIVE SOON', 44, '#E11D2E');
    const tAway = text(P + '문구-자리 비움', cfg.awayText || '잠시 자리 비웠어요, 금방 올게요!', 110);
    const tEnd = text(P + '문구-종료', cfg.endingText || '오늘도 함께해 주셔서 감사합니다', 96);

    for (const k of ['waiting', 'away', 'ending']) this.place(k, bg, { fit: true, bottom: true });
    this.place('waiting', tWait, { textBox: { y: 400, h: 180 } });
    this.place('waiting', red, { pos: { x: (this.width - 160) / 2, y: 600 } });
    this.place('waiting', tSub, { textBox: { y: 630, h: 90 } });
    this.place('away', tAway, { textBox: { y: 450, h: 180 } });
    this.place('ending', tEnd, { textBox: { y: 450, h: 180 } });

    // 메인: 게임 캡처 (전체 화면 게임 자동 감지)
    const gameType = this.pickType('game_capture');
    if (gameType) {
      const g = this.makeInput(gameType, P + '게임 화면', { capture_mode: 'any_fullscreen', capture_audio: false, allow_transparency: false });
      this.place('main', g, { fit: true, bottom: true });
    }

    // 기본 오디오: 데스크톱 소리 + 마이크 (모든 장면에서 들리도록 각 장면에 추가)
    const desk = this.makeInput('wasapi_output_capture', P + '데스크톱 소리', { device_id: 'default' });
    const mic = this.makeInput('wasapi_input_capture', P + '마이크', { device_id: 'default' });
    for (const s of SCENES) { this.place(s.key, desk); this.place(s.key, mic); }
    this.ensureFader(desk); this.ensureFader(mic);

    // 장면 전환 효과
    if (!this.transition) {
      this.transition = osn.TransitionFactory.create('fade_transition', P + '페이드', {});
      osn.Global.setOutputSource(0, this.transition);
    }
    this.switchScene('waiting', true);
    this.emit('audio-changed');
  }

  updateTexts(cfg) {
    const set = (n, t) => { const i = this.input(n); if (i && t) i.update({ text: t }); };
    set(P + '문구-시작 전', cfg.waitingText);
    set(P + '문구-자리 비움', cfg.awayText);
    set(P + '문구-종료', cfg.endingText);
    const bg = this.input(P + '배경'); if (bg && cfg.bgColor) bg.update({ color: abgr(cfg.bgColor) });
  }

  switchScene(key, instant = false) {
    const s = this.scenes[key];
    if (!s) return;
    if (instant || !this.current) this.transition.set(s);
    else this.transition.start(300, s);
    this.current = key;
    this.emit('scene', key);
  }

  // ---------------------------------------------------------------- 사운드 분리 / 믹서
  ensureFader(input) {
    if (this.faders[input.name]) return this.faders[input.name];
    const f = this.osn.FaderFactory.create(E.Fader.Cubic);
    f.attach(input);
    this.faders[input.name] = f;
    return f;
  }
  setAppAudio(appKeys, muteDesktop) {
    const type = this.pickType('wasapi_process_output_capture');
    if (!type) throw new Error('이 PC에서는 앱별 소리 분리를 쓸 수 없어요. (윈도우 10 2004 이상 필요)');
    const wanted = new Set(appKeys);
    for (const [key, app] of Object.entries(AUDIO_APPS)) {
      const name = P + '소리-' + app.name;
      if (wanted.has(key)) {
        const i = this.makeInput(type, name, { window: app.window, priority: 2 });
        for (const s of SCENES) this.place(s.key, i);
        this.ensureFader(i);
      } else if (this.inputs[name]) {
        this.removeInput(name);
      }
    }
    const desk = this.input(P + '데스크톱 소리');
    if (desk) desk.muted = !!muteDesktop;
    this.emit('audio-changed');
  }
  audioList() {
    return Object.values(this.inputs)
      .filter((i) => this.faders[i.name])
      .map((i) => ({ name: i.name, label: i.name.replace(P, '').replace('소리-', ''), muted: i.muted, deflection: this.faders[i.name].deflection }));
  }
  setVolume(name, deflection) { const f = this.faders[name]; if (f) f.deflection = Math.max(0, Math.min(1, deflection)); }
  setMuted(name, muted) { const i = this.inputs[name]; if (i) i.muted = muted; this.emit('audio-changed'); }

  // ---------------------------------------------------------------- 화면 / 웹캠 / 버추얼
  devicesOf(type, prop) {
    try {
      const tmp = this.osn.InputFactory.create(type, '__streamy_probe_' + Date.now(), {});
      const p = tmp.properties.get(prop);
      const items = p && p.details ? p.details.items.map((x) => ({ name: x.name, value: x.value })) : [];
      tmp.release();
      return items;
    } catch (e) { console.error(e); return []; }
  }
  webcams() { return this.devicesOf('dshow_input', 'video_device_id'); }
  monitors() { return this.devicesOf('monitor_capture', 'monitor_id'); }

  addScreen(monitorId) {
    const name = P + '모니터 화면';
    if (this.inputs[name]) this.removeInput(name);
    const i = this.makeInput('monitor_capture', name, monitorId ? { monitor_id: monitorId, capture_cursor: true } : { capture_cursor: true });
    this.place('main', i, { fit: true });
    const game = this.input(P + '게임 화면'); if (game) this.findItem(this.scenes.main, game.name)?.moveTop();
  }
  // 웹캠: 사용자가 버튼을 눌렀을 때만. 위치/크기는 사용자가 고름
  addWebcam(deviceId) {
    const name = P + '웹캠';
    if (this.inputs[name]) this.removeInput(name);
    const i = this.makeInput('dshow_input', name, { video_device_id: deviceId, res_type: 0 });
    this.place('main', i, { top: true });
    this.webcamLayout('bottomLeft', 0.3);
  }
  webcamLayout(corner, size) {
    const it = this.findItem(this.scenes.main, P + '웹캠');
    if (!it) return false;
    const m = 30, W = this.width, H = this.height;
    const map = { topLeft: [E.Align.TopLeft, m, m], topRight: [E.Align.TopRight, W - m, m], bottomLeft: [E.Align.BottomLeft, m, H - m], bottomRight: [E.Align.BottomRight, W - m, H - m] };
    const [al, x, y] = map[corner] || map.bottomLeft;
    it.boundsType = E.Bounds.ScaleInner;
    it.boundsAlignment = E.Align.Center;
    it.bounds = { x: W * size, y: H * size };
    it.alignment = al;
    it.position = { x, y };
    return true;
  }
  addVirtual(appKey) {
    const app = VIRTUAL_APPS[appKey];
    if (!app) throw new Error('지원하지 않는 버추얼 프로그램이에요.');
    const name = P + '버추얼';
    if (this.inputs[name]) this.removeInput(name);
    let i, how;
    if (app.spout && this.hasType('spout_capture')) {
      i = this.makeInput('spout_capture', name, {});
      how = 'Spout2';
    } else {
      i = this.makeInput('game_capture', name, { capture_mode: 'window', window: app.window, priority: 2, allow_transparency: true });
      how = '게임 캡처 (투명 배경)';
    }
    const it = this.place('main', i, { top: true });
    it.boundsType = E.Bounds.ScaleInner; it.boundsAlignment = E.Align.Center;
    it.bounds = { x: this.width * 0.45, y: this.height * 0.85 };
    it.alignment = E.Align.BottomRight; it.position = { x: this.width, y: this.height };
    return how;
  }

  // ---------------------------------------------------------------- 타이머 오버레이 (브라우저 소스)
  addTimer(url, scenes = ['waiting', 'main']) {
    if (!this.hasType('browser_source')) return false;
    const i = this.makeInput('browser_source', P + '타이머', { url, width: 600, height: 200, css: '', shutdown: false, reroute_audio: false });
    for (const k of scenes) this.place(k, i, { pos: { x: this.width - 30, y: 30 }, align: E.Align.TopRight, top: true });
    return true;
  }
  setTimerVisible(visible) {
    for (const s of Object.values(this.scenes)) { const it = this.findItem(s, P + '타이머'); if (it) it.visible = visible; }
  }

  // ---------------------------------------------------------------- 인코더 / 송출
  encoderTypes() { try { return this.osn.VideoEncoderFactory.types(); } catch { return ['obs_x264']; } }
  pickEncoder() {
    const all = this.encoderTypes();
    const id = ENCODER_PRIORITY.find((e) => all.includes(e)) || 'obs_x264';
    return { id, label: ENCODER_LABEL[id] || id };
  }
  encoderSettings(id, p) {
    if (id === 'obs_x264') {
      return { rate_control: 'CBR', bitrate: p.bitrate, keyint_sec: p.keyint, preset: 'veryfast', profile: 'high', tune: p.bframes === 0 ? 'zerolatency' : '', x264opts: p.bframes === 0 ? 'bframes=0 scenecut=0' : '' };
    }
    return { rate_control: 'CBR', bitrate: p.bitrate, keyint_sec: p.keyint, preset2: 'p5', preset: 'quality', profile: 'high', bf: p.bframes, multipass: 'qres' };
  }

  startStream({ platform, key }) {
    if (this.stream) throw new Error('이미 방송 중이에요.');
    const p = PLATFORMS[platform];
    if (!p) throw new Error('플랫폼을 골라 주세요.');
    if (!key) throw new Error(p.name + ' 스트림 키를 입력해 주세요.');
    const osn = this.osn;
    const enc = this.pickEncoder();
    const service = osn.ServiceFactory.create('rtmp_custom', 'streamy-service-' + platform, { server: p.server, key, use_auth: false, bwtest: false });
    const venc = osn.VideoEncoderFactory.create(enc.id, 'streamy-video-' + Date.now(), this.encoderSettings(enc.id, p));
    const aenc = osn.AudioEncoderFactory.create('ffmpeg_aac', 'streamy-audio-' + Date.now());
    aenc.bitrate = 160;
    const s = osn.SimpleStreamingFactory.create();
    s.video = this.video;
    s.videoEncoder = venc;
    s.audioEncoder = aenc;
    s.service = service;
    s.enforceServiceBitrate = false;
    s.delay = osn.DelayFactory.create(); s.delay.enabled = false;
    s.reconnect = osn.ReconnectFactory.create(); s.reconnect.enabled = true; s.reconnect.retryDelay = 10; s.reconnect.maxRetries = 20;
    s.network = osn.NetworkFactory.create();
    s.signalHandler = (sig) => this.onStreamSignal(sig);
    this.stream = s;
    this.streamParts = [venc, aenc, service];
    this.streamInfo = { platform: p.name, encoder: enc.label, startedAt: 0 };
    this.emit('stream', { state: 'starting', ...this.streamInfo });
    s.start();
  }
  onStreamSignal(sig) {
    const name = sig.signal;
    if (name === 'start' || name === 'activate') {
      if (!this.streamInfo.startedAt) this.streamInfo.startedAt = Date.now();
      this.emit('stream', { state: 'live', ...this.streamInfo });
    } else if (name === 'reconnect') {
      this.emit('stream', { state: 'reconnecting', ...this.streamInfo });
    } else if (name === 'reconnect_success') {
      this.emit('stream', { state: 'live', ...this.streamInfo });
    } else if (name === 'stop' || name === 'deactivate') {
      const err = sig.code && sig.code !== 0 ? streamError(sig) : '';
      this.cleanupStream();
      this.emit('stream', { state: 'off', error: err });
    }
  }
  stopStream(force = false) {
    if (!this.stream) return;
    this.emit('stream', { state: 'stopping', ...this.streamInfo });
    this.stream.stop(force);
    if (force) this.cleanupStream();
  }
  cleanupStream() {
    if (!this.stream) return;
    const s = this.stream;
    this.stream = null;
    setTimeout(() => {
      try { s.signalHandler = () => {}; this.osn.SimpleStreamingFactory.destroy(s); } catch {}
      for (const x of this.streamParts) { try { x.release ? x.release() : this.osn.ServiceFactory.destroy(x); } catch {} }
      this.streamParts = [];
    }, 500);
  }
  stats() {
    const g = this.osn.Global;
    const out = { cpu: g.cpuPercentage, fps: g.currentFrameRate, lagged: g.laggedFrames, total: g.totalFrames };
    if (this.stream) { out.kbps = this.stream.kbitsPerSec; out.dropped = this.stream.droppedFrames; out.sent = this.stream.totalFrames; }
    return out;
  }

  // ---------------------------------------------------------------- 녹화
  startRecording(dir) {
    if (this.recording) return;
    const osn = this.osn;
    fs.mkdirSync(dir, { recursive: true });
    const enc = this.pickEncoder();
    const r = osn.SimpleRecordingFactory.create();
    r.path = dir;
    r.format = 'mkv';
    r.quality = 1; // HighQuality
    r.video = this.video;
    r.videoEncoder = osn.VideoEncoderFactory.create(enc.id, 'streamy-rec-' + Date.now(), enc.id === 'obs_x264' ? { rate_control: 'CRF', crf: 20, preset: 'veryfast' } : { rate_control: 'CQP', cqp: 20 });
    r.audioEncoder = osn.AudioEncoderFactory.create('ffmpeg_aac', 'streamy-rec-audio-' + Date.now());
    r.lowCPU = false;
    r.overwrite = false;
    r.noSpace = false;
    r.signalHandler = (sig) => {
      if (sig.signal === 'start') this.emit('record', { state: 'on' });
      if (sig.signal === 'stop') { this.emit('record', { state: 'off', error: sig.code ? (sig.error || '녹화 오류') : '' }); this.cleanupRecording(); }
    };
    this.recording = r;
    r.start();
  }
  stopRecording(force = false) { if (this.recording) { this.recording.stop(force); if (force) this.cleanupRecording(); } }
  cleanupRecording() {
    const r = this.recording; this.recording = null;
    if (!r) return;
    setTimeout(() => { try { const v = r.videoEncoder, a = r.audioEncoder; this.osn.SimpleRecordingFactory.destroy(r); v && v.release(); a && a.release(); } catch {} }, 500);
  }
}

function streamError(sig) {
  const msg = {
    '-1': '스트림 키나 서버 주소가 잘못됐어요.', '-2': '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.',
    '-3': '인코더를 시작하지 못했어요.', '-4': '연결이 끊겼어요.', '-5': '방송을 시작할 수 없어요.',
    '-6': '서버가 연결을 거부했어요. 스트림 키를 확인해 주세요.',
  }[String(sig.code)];
  return (msg || '방송 오류') + (sig.error ? ' (' + sig.error + ')' : '');
}

module.exports = { Engine, SCENES, AUDIO_APPS, VIRTUAL_APPS, PLATFORMS };
