// Streamy 보이스 — 마이크 필터 (지금은 EQ). 소리 이름 EQ 화면 + 들어보기용 실제 소리 처리(WebAudio)
// 방송 소리에 넣는 건 다음 단계(엔진 쪽 처리 프로그램). 지금은 이어폰으로 들어보고 녹음해서 비교하는 용도.
'use strict';
(() => {
  const Q = (id) => document.getElementById(id);
  const ov = Q('voOv'); if (!ov) return;
  const NS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- 설정
  const PRESETS = {
    base: ['기본', [['hp', 90, 0, 0.71], ['bell', 330, -3.5, 1.1], ['bell', 3200, 3, 0.9], ['bell', 6800, -2.5, 2.5], ['hs', 11000, 1.5, 0.71]]],
    game: ['게임 방송', [['hp', 110, 0, 0.71], ['bell', 350, -4.5, 1], ['bell', 2600, 4, 0.8], ['hs', 9500, 2.5, 0.71]]],
    talk: ['저챗', [['hp', 75, 0, 0.71], ['ls', 160, 2, 0.71], ['bell', 380, -2.5, 1.2], ['bell', 4000, 2, 1]]],
    asmr: ['ASMR', [['hp', 40, 0, 0.71], ['ls', 120, 3, 0.71], ['bell', 6000, -2, 1.4], ['hs', 12000, 4, 0.71]]],
  };
  const mkBands = (list) => list.map(([type, f, g, q], i) => ({ id: i + 1, type, f, g, q, on: true }));
  function V() {
    if (!cfg.voice || typeof cfg.voice !== 'object') cfg.voice = {};
    const v = cfg.voice;
    if (!Array.isArray(v.bands) || !v.bands.length) { v.bands = mkBands(PRESETS.base[1]); v.preset = 'base'; }
    v.view = v.view === 'comp' ? 'comp' : 'eq';
    if (!v.comp || typeof v.comp !== 'object') v.comp = { on: true, thr: -22, ratio: 4, att: 5, rel: 100, knee: 6, makeup: 0, auto: true, easy: 50, preset: 'broadcast' };
    v.level = v.level || 'pro'; if (v.tone == null) v.tone = 30; if (v.mud == null) v.mud = 40; if (v.cutOn == null) v.cutOn = true;
    return v;
  }
  let sel = 2, drag = null, bypass = false, saveT = 0, solo = null;   // solo = 그 밴드 구간만 듣기
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => save(), 400); };

  // ---------------------------------------------------------------- 수학 (그림 = 실제 필터와 같은 RBJ 식)
  const ZONES = [['웅웅', 20, 90], ['따뜻함', 90, 250], ['먹먹함', 250, 600], ['목소리 몸통', 600, 2000], ['또렷함', 2000, 5000], ['치찰음', 5000, 9000], ['공기감', 9000, 20000]];
  const zoneRaw = (f) => (ZONES.find(([, a, b]) => f >= a && f < b) || ZONES[ZONES.length - 1])[0];
  const zoneOf = (f, b) => zoneRaw(b && b.type === 'hp' ? f * 0.85 : b && b.type === 'lp' ? f * 1.15 : f);
  const fmtF = (f) => f >= 1000 ? (f / 1000).toFixed(1) + 'kHz' : Math.round(f) + 'Hz';
  const hasGain = (b) => b.type === 'bell' || b.type === 'ls' || b.type === 'hs';
  const hasWidth = (b) => b.type === 'bell' || b.type === 'notch';
  const bwOf = (q) => 2 / Math.LN2 * Math.asinh(1 / (2 * q));
  const qOf = (bw) => 1 / (2 * Math.sinh(Math.LN2 / 2 * bw));
  let W = 1000, H = 420;
  const fx = (f) => W * Math.log10(f / 20) / 3;
  const xf = (x) => 20 * Math.pow(10, 3 * Math.max(0, Math.min(W, x)) / W);
  const top0 = () => 70, dbSpan = 15;
  const gy = (g) => { const mid = top0() + (H - top0()) * 0.42; return mid - g * (H - top0()) * 0.4 / dbSpan; };
  const yg = (y) => { const mid = top0() + (H - top0()) * 0.42; return (mid - y) * dbSpan / ((H - top0()) * 0.4); };
  function coefs(b) {
    const w0 = 2 * Math.PI * Math.min(b.f, 23000) / 48000, c = Math.cos(w0), s = Math.sin(w0);
    const A = Math.pow(10, b.g / 40), q = Math.max(0.1, b.q), al = s / (2 * q), sa = Math.sqrt(A);
    switch (b.type) {
      case 'bell': return [1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A];
      case 'ls': return [A * ((A + 1) - (A - 1) * c + 2 * sa * al), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - 2 * sa * al), (A + 1) + (A - 1) * c + 2 * sa * al, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - 2 * sa * al];
      case 'hs': return [A * ((A + 1) + (A - 1) * c + 2 * sa * al), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - 2 * sa * al), (A + 1) - (A - 1) * c + 2 * sa * al, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - 2 * sa * al];
      case 'hp': return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
      case 'lp': return [(1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al];
      case 'notch': return [1, -2 * c, 1, 1 + al, -2 * c, 1 - al];
    }
    return [1, 0, 0, 1, 0, 0];
  }
  function magDb(k, f) {
    const w = 2 * Math.PI * f / 48000, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = k[0] + k[1] * c1 + k[2] * c2, ni = -(k[1] * s1 + k[2] * s2), dr = k[3] + k[4] * c1 + k[5] * c2, di = -(k[4] * s1 + k[5] * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-12);
  }
  const bandDb = (b, f) => (b.type === 'hp' || b.type === 'lp' ? 2 : 1) * magDb(coefs(b), f);

  // ---------------------------------------------------------------- 실제 소리 (WebAudio: 같은 바이쿼드)
  const A = { soloNodes: [], comp: null, ready: null, ctx: null, stream: null, mic: null, play: null, recBuf: null, chainIn: null, filters: [], sig: '', an: null, mon: null, listening: false, playing: false, rec: null };
  // 구간만 듣기 방식: 자르기면 '잘려 나가는 쪽', 쉘프면 '바뀌는 쪽', 벨 · 노치면 '그 둘레'
  const soloKindOf = (b) => ({ hp: 'cut-low', lp: 'cut-high', ls: 'shelf-low', hs: 'shelf-high', bell: 'band', notch: 'band' })[b.type] || 'band';
  // 구간 경계: 벨 · 노치는 폭(최소 1/3옥타브), 쉘프 · 자르기는 그 주파수 아래/위 전부
  const soloEdges = (b) => {
    const k = soloKindOf(b);
    if (k.endsWith('low')) return [20, b.f];
    if (k.endsWith('high')) return [b.f, 20000];
    const bw = Math.max(1 / 3, bwOf(b.q)); return [b.f / Math.pow(2, bw / 2), b.f * Math.pow(2, bw / 2)];
  };
  const WA_TYPE = { hp: 'highpass', lp: 'lowpass', bell: 'peaking', ls: 'lowshelf', hs: 'highshelf', notch: 'notch' };
  function ensureCtx() {
    if (A.ctx) return A.ctx;
    A.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    A.chainIn = A.ctx.createGain();
    A.an = A.ctx.createAnalyser(); A.an.fftSize = 4096; A.an.smoothingTimeConstant = 0.82; A.an.minDecibels = -100; A.an.maxDecibels = -10;
    A.mon = A.ctx.createGain(); A.mon.gain.value = 0;
    A.an.connect(A.mon); A.mon.connect(A.ctx.destination);
    const ctx = A.ctx;
    A.ready = ctx.audioWorklet.addModule('voice-worklet.js').then(() => {
      if (A.ctx !== ctx) return;
      A.comp = new AudioWorkletNode(ctx, 'streamy-comp', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      A.comp.port.onmessage = (e) => compMeter(e.data);
      A.sig = ''; syncChain();
    }).catch((e) => { console.warn('comp worklet', e); });
    return A.ctx;
  }
  // 체인 구조가 바뀌면 다시 잇고, 값만 바뀌면 값만 바꿈
  function syncChain() {
    if (!A.ctx) return;
    const bs = V().bands.filter((b) => b.on);
    const sb = solo != null ? V().bands.find((b) => b.id === solo) : null;
    const soloKind = sb ? soloKindOf(sb) : '';
    const sig = (bypass ? 'bypass' : bs.map((b) => b.type).join(',') + (A.comp ? '|comp' : '')) + '|' + soloKind;
    if (sig !== A.sig) {
      try { A.chainIn.disconnect(); } catch {}
      for (const f of A.filters) { try { f.node.disconnect(); } catch {} }
      for (const n of A.soloNodes || []) { try { n.disconnect(); } catch {} }
      if (A.comp) { try { A.comp.disconnect(); } catch {} }
      A.filters = []; A.soloNodes = [];
      let last = A.chainIn;
      if (!bypass) for (const b of bs) {
        const n = (b.type === 'hp' || b.type === 'lp') ? 2 : 1;      // 로우컷 · 하이컷은 2단 (12dB → 24dB/옥타브), 그림과 같게
        for (let i = 0; i < n; i++) { const node = A.ctx.createBiquadFilter(); node.type = WA_TYPE[b.type]; last.connect(node); last = node; A.filters.push({ node, b }); }
      }
      if (!bypass && A.comp) { last.connect(A.comp); last = A.comp; }          // EQ 다음 컴프레서
      if (sb) {
        // 그 구간만: 벨 · 노치 = 그 주파수 둘레만, 쉘프 = 그 아래/위만, 자르기 = 잘려 나가는 소리(필터 전)
        let src = soloKind.startsWith('cut') ? A.chainIn : last;
        // 가파르게 (48dB/옥타브): 바깥 소리가 새어 들어오지 않게
        const roles = soloKind.endsWith('low') ? ['lp', 'lp', 'lp', 'lp'] : soloKind.endsWith('high') ? ['hp', 'hp', 'hp', 'hp'] : ['hp', 'hp', 'hp', 'hp', 'lp', 'lp', 'lp', 'lp'];
        for (const r of roles) { const n = A.ctx.createBiquadFilter(); n.type = r === 'lp' ? 'lowpass' : 'highpass'; n._role = r; src.connect(n); src = n; A.soloNodes.push(n); }
        src.connect(A.an);
      } else last.connect(A.an);
      A.sig = sig;
    }
    const t = A.ctx.currentTime;
    if (A.comp) {
      const c = compParams(), P = A.comp.parameters;
      for (const k of ['thr', 'ratio', 'att', 'rel', 'knee', 'makeup']) P.get(k).setValueAtTime(c[k], t);
      P.get('on').setValueAtTime(c.on ? 1 : 0, t);
    }
    if (sb) {
      const [lo, hi] = soloEdges(sb), k = soloKindOf(sb);
      for (const n of A.soloNodes) {
        const fq = k === 'band' ? (n._role === 'hp' ? lo : hi) : sb.f;
        n.frequency.setTargetAtTime(Math.max(20, Math.min(20000, fq)), t, 0.015); n.Q.setTargetAtTime(0.71, t, 0.015);
      }
    }
    let i = 0;
    for (const b of bypass ? [] : bs) {
      const n = (b.type === 'hp' || b.type === 'lp') ? 2 : 1;
      for (let k = 0; k < n; k++, i++) {
        const node = A.filters[i] && A.filters[i].node; if (!node) continue;
        node.frequency.setTargetAtTime(Math.max(20, Math.min(20000, b.f)), t, 0.015);
        node.Q.setTargetAtTime(Math.max(0.1, b.q), t, 0.015);
        node.gain.setTargetAtTime(hasGain(b) ? b.g : 0, t, 0.015);
      }
    }
  }
  async function micStart() {
    ensureCtx(); if (A.ctx.state === 'suspended') await A.ctx.resume();
    if (A.ready) { try { await A.ready; } catch {} }
    if (A.stream) return;
    const dev = Q('voMic') && Q('voMic').value;
    A.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: dev ? { exact: dev } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    A.mic = A.ctx.createMediaStreamSource(A.stream);
    if (!A.playing) A.mic.connect(A.chainIn);
    syncChain();
  }
  function micStop() {
    try { A.mic && A.mic.disconnect(); } catch {}
    if (A.stream) A.stream.getTracks().forEach((t) => t.stop());
    A.stream = null; A.mic = null;
  }
  async function listMics() {
    const sel = Q('voMic'); if (!sel) return;
    try {
      const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const cur = sel.value;
      sel.innerHTML = ds.map((d) => `<option value="${esc(d.deviceId)}">${esc(d.label || '마이크')}</option>`).join('');
      if (ds.some((d) => d.deviceId === cur)) sel.value = cur;
    } catch {}
  }
  function setListen(on) {
    A.listening = on; if (A.mon) A.mon.gain.setTargetAtTime(on || A.playing ? 1 : 0, A.ctx.currentTime, 0.02);
    renderTest();
  }
  // 5초 녹음 → 반복 재생 (필터 / 원래 소리를 위에서 바꿔 가며 비교)
  async function recordTest() {
    if (A.rec) return;
    try { await micStart(); } catch (e) { toast('마이크를 열 수 없어요: ' + (e.message || e), true); return; }
    stopPlay();
    const mr = new MediaRecorder(A.stream), parts = [];
    A.rec = { mr, t0: Date.now() };
    mr.ondataavailable = (e) => parts.push(e.data);
    mr.onstop = async () => {
      A.rec = null;
      try { const buf = await new Blob(parts).arrayBuffer(); A.recBuf = await A.ctx.decodeAudioData(buf); playTest(); }
      catch (e) { toast('녹음을 불러오지 못했어요.', true); }
      renderTest();
    };
    mr.start(); renderTest();
    const tick = setInterval(() => { if (!A.rec) return clearInterval(tick); renderTest(); }, 200);
    setTimeout(() => { try { mr.state !== 'inactive' && mr.stop(); } catch {} }, 5000);
  }
  function playTest() {
    if (!A.recBuf) return;
    stopPlay(true);
    try { A.mic && A.mic.disconnect(); } catch {}
    const s = A.ctx.createBufferSource(); s.buffer = A.recBuf; s.loop = true; s.connect(A.chainIn); s.start();
    A.play = s; A.playing = true; A.mon.gain.setTargetAtTime(1, A.ctx.currentTime, 0.02); renderTest();
  }
  function stopPlay(quiet) {
    if (A.play) { try { A.play.stop(); A.play.disconnect(); } catch {} A.play = null; }
    if (A.playing) { A.playing = false; if (A.mic) { try { A.mic.connect(A.chainIn); } catch {} } if (A.mon) A.mon.gain.setTargetAtTime(A.listening ? 1 : 0, A.ctx.currentTime, 0.02); }
    if (!quiet) renderTest();
  }

  // ---------------------------------------------------------------- 컴프레서 설정 · 계산 (worklet과 같은 식)
  const gcDb = (x, T, R, W) => { const d = x - T; if (2 * d < -W) return x; if (W > 0 && 2 * Math.abs(d) <= W) return x + (1 / R - 1) * Math.pow(d + W / 2, 2) / (2 * W); return T + d / R; };
  const CPRESETS = {
    natural: ['자연스럽게', { thr: -24, ratio: 2, att: 15, rel: 150, knee: 8 }],
    broadcast: ['방송처럼', { thr: -22, ratio: 4, att: 5, rel: 100, knee: 6 }],
    shout: ['소리 지르는 방송', { thr: -26, ratio: 6, att: 2, rel: 80, knee: 4 }],
    asmr: ['ASMR', { thr: -30, ratio: 2.5, att: 25, rel: 250, knee: 10 }],
  };
  const autoMakeup = (c) => Math.max(0, Math.min(18, -(gcDb(-18, c.thr, c.ratio, c.knee) + 18) * 0.85));   // 보통 목소리(-18dB)가 원래 크기쯤 되게
  function compParams() { const c = V().comp; return { ...c, makeup: c.auto ? autoMakeup(c) : c.makeup }; }
  function easyComp(k) { const c = V().comp; Object.assign(c, { easy: k, thr: -16 - k * 0.14, ratio: 1.5 + k * 0.045, att: 20 - k * 0.15, rel: 180 - k * 0.8, knee: 8, auto: true, preset: '' }); }
  const hist = [];       // [{ in, out, gr }] 최근 6초
  let meterNow = { in: -120, out: -120, gr: 0 }, liveIn = -120;
  function compMeter(d) {
    meterNow = d; hist.push(d); if (hist.length > 240) hist.shift();
    liveIn = d.in > liveIn ? d.in : liveIn * 0.85 + d.in * 0.15;
  }

  // ---------------------------------------------------------------- 그리기
  const svg = Q('voSvg'), wrap = Q('voGraph');
  const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  defs.innerHTML = '<linearGradient id="voCloudG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--red)" stop-opacity=".8"/><stop offset="1" stop-color="var(--red)" stop-opacity=".14"/></linearGradient><filter id="voGlow" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>';
  const gZones = el('g', {}, svg);
  const soloRect = el('rect', { class: 'vo-solo-r', y: 0 }, svg);
  const zero = el('line', { class: 'vo-zero' }, svg);
  const cloud = el('path', { fill: 'url(#voCloudG)' }, svg);
  const edge = el('path', { class: 'vo-edge', fill: 'none' }, svg);
  const glow = el('path', { class: 'vo-glow', fill: 'none', filter: 'url(#voGlow)' }, svg);
  const curve = el('path', { class: 'vo-curve', fill: 'none' }, svg);
  const gW = el('g', {}, svg), gN = el('g', {}, svg);
  const labels = Q('voZones'), bubble = Q('voBubble');

  function resize() { if (wrap.hidden) return; const r = wrap.getBoundingClientRect(); if (r.width < 50 || r.height < 50) return; W = Math.max(300, Math.round(r.width)); H = Math.max(200, Math.round(r.height)); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); }
  function zonesDraw() {
    gZones.innerHTML = ''; labels.innerHTML = '';
    const s = curSel(), v = V();
    ZONES.forEach(([l, a, b], i) => {
      const x = fx(a), x2 = fx(b), on = s && v.level !== 'easy' && zoneOf(s.f, s) === l;
      el('rect', { x, y: 0, width: x2 - x, height: H, class: 'vo-zone' + (i % 2 ? ' alt' : '') + (on ? ' on' : '') }, gZones);
      const d = document.createElement('div'); d.className = 'vo-zl' + (on ? ' on' : '');
      d.style.left = ((x + x2) / 2 / W * 100) + '%';
      d.innerHTML = `<b>${l}</b><small>${fmtF(a)}–${fmtF(b)}</small>`; labels.appendChild(d);
    });
    zero.setAttribute('x1', 0); zero.setAttribute('x2', W); zero.setAttribute('y1', gy(0)); zero.setAttribute('y2', gy(0));
  }
  const curSel = () => V().level === 'easy' ? null : (V().bands.find((b) => b.id === sel) || null);
  let xsCache = [];
  function curveDraw() {
    const v = V(), bs = v.bands.filter((b) => b.on && !bypass);
    const N = Math.max(120, Math.round(W / 4)); xsCache = [];
    let d = '';
    for (let i = 0; i <= N; i++) {
      const x = i * W / N, f = xf(x), g = bs.reduce((a, b) => a + bandDb(b, f), 0);
      xsCache.push([x, f, g]);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + Math.max(top0(), Math.min(H - 6, gy(g))).toFixed(1) + ' ';
    }
    curve.setAttribute('d', d); glow.setAttribute('d', d);
    ov.classList.toggle('vo-bypass', bypass);
    const sb = solo != null ? V().bands.find((b) => b.id === solo) : null;
    ov.classList.toggle('vo-soloing', !!sb);
    if (sb) {
      const [a, z] = soloEdges(sb);
      soloRect.setAttribute('x', fx(Math.max(20, a))); soloRect.setAttribute('width', Math.max(4, fx(Math.min(20000, z)) - fx(Math.max(20, a)))); soloRect.setAttribute('height', H);
    } else soloRect.setAttribute('width', 0);
  }
  function nodesDraw() {
    gN.innerHTML = ''; gW.innerHTML = '';
    const v = V(), s = curSel();
    if (v.level === 'easy') { bubble.hidden = true; return; }
    for (const b of v.bands) {
      const x = fx(b.f), y = hasGain(b) ? gy(b.g) : gy(0), on = s && s.id === b.id;
      if (on) el('circle', { cx: x, cy: y, r: 22, class: 'vo-halo' }, gN);
      const c = el('circle', { cx: x, cy: y, r: on ? 10 : 7.5, class: 'vo-node' + (on ? ' sel' : '') + (b.on ? '' : ' off') }, gN);
      c.addEventListener('pointerdown', (e) => grab(e, b.id, 'node'));
    }
    if (s && v.level === 'pro' && hasWidth(s)) {
      const bw = bwOf(s.q), x1 = fx(s.f / Math.pow(2, bw / 2)), x2 = fx(s.f * Math.pow(2, bw / 2)), y = hasGain(s) ? gy(s.g) : gy(0);
      el('line', { x1, x2, y1: y, y2: y, class: 'vo-wline' }, gW);
      for (const [x, k] of [[x1, 'wl'], [x2, 'wr']]) { const r = el('rect', { x: x - 5, y: y - 13, width: 10, height: 26, rx: 5, class: 'vo-wh' }, gW); r.addEventListener('pointerdown', (e) => grab(e, s.id, k)); }
    }
    bubbleDraw();
  }
  const TYPES = [['hp', '아래 자르기', 'M2 14 C7 14 8 4 13 4 L24 4'], ['ls', '아래 올리기/내리기', 'M2 11 L8 11 C11 11 12 5 15 5 L24 5'], ['bell', '한 구역', 'M2 11 L7 11 C10 11 11 3 13 3 C15 3 16 11 19 11 L24 11'], ['notch', '콕 파내기', 'M2 5 L10 5 L13 14 L16 5 L24 5'], ['hs', '위 올리기/내리기', 'M2 5 L11 5 C14 5 15 11 18 11 L24 11'], ['lp', '위 자르기', 'M2 4 L13 4 C18 4 19 14 24 14']];
  function bubbleDraw() {
    const s = curSel(), v = V();
    if (!s) { bubble.hidden = true; return; }
    const x = fx(s.f), y = hasGain(s) ? gy(s.g) : gy(0), above = y > H * 0.45;
    const g = hasGain(s) ? (s.g > 0 ? '+' : '') + s.g.toFixed(1) + 'dB' : ({ hp: '아래 자르기', lp: '위 자르기', notch: '콕 파내기' })[s.type];
    bubble.hidden = false;
    bubble.style.left = Math.max(12, Math.min(88, x / W * 100)) + '%';
    bubble.style.top = (y / H * 100) + '%';
    bubble.style.transform = `translate(-50%, ${above ? 'calc(-100% - 26px)' : '26px'})`;
    const so = solo === s.id;
    bubble.innerHTML = `<div class="vo-bt"><b>${zoneOf(s.f, s)}</b><em>${s.on ? g : '꺼짐'}</em><small>${fmtF(s.f)}</small><button data-a="solo" class="vo-solo${so ? ' on' : ''}" title="이 구간 소리만 들어보기"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1v-5zM20 14h-3v6h2a1 1 0 0 0 1-1v-5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>${so ? '구간만 듣는 중' : '이 구간만 듣기'}</button></div>` + (v.level === 'pro'
      ? `<div class="vo-bb">${TYPES.map(([k, l, d]) => `<button data-t="${k}" class="${s.type === k ? 'on' : ''}" title="${l}" aria-label="${l}"><svg width="22" height="14" viewBox="0 0 26 16"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join('')}<i></i><button data-a="onoff" class="txt">${s.on ? '끄기' : '켜기'}</button><button data-a="del" aria-label="지우기">${ic('x')}</button></div>` : '');
  }
  bubble.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const s = curSel(); if (!s) return;
    if (b.dataset.a === 'solo') { setSolo(solo === s.id ? null : s.id); return; }
    if (b.dataset.t) { s.type = b.dataset.t; s.q = s.type === 'notch' ? 4 : s.type === 'bell' ? 1 : 0.71; }
    else if (b.dataset.a === 'onoff') s.on = !s.on;
    else if (b.dataset.a === 'del') { V().bands = V().bands.filter((x) => x.id !== s.id); sel = null; if (solo === s.id) solo = null; }
    changed();
  });
  function chipsDraw() {
    const v = V(), box = Q('voChips'); box.innerHTML = '';
    for (const b of v.bands) {
      const g = hasGain(b) ? (b.g > 0 ? '+' : '') + b.g.toFixed(1) : ({ hp: '자름', lp: '자름', notch: '파냄' })[b.type];
      const btn = document.createElement('button'); btn.className = 'vo-chip' + (sel === b.id ? ' on' : '') + (b.on ? '' : ' off');
      btn.innerHTML = `<span>${zoneOf(b.f, b)}</span><b>${b.on ? g : '꺼짐'}</b>`;
      btn.addEventListener('click', () => { sel = b.id; if (solo != null) { solo = b.id; syncChain(); } drawAll(); });
      box.appendChild(btn);
    }
  }
  const CHAIN = [['로우컷', 'eq'], ['잡음 제거', ''], ['게이트', ''], ['EQ', 'eq'], ['디에서', ''], ['컴프레서', 'comp'], ['리미터', '']];
  function chainDraw() {
    const v = V();
    Q('voChain').innerHTML = CHAIN.map(([l, view], i) => {
      const on = view && view === v.view && (view !== 'eq' || l === 'EQ'), soon = !view;
      const off = view === 'comp' && !v.comp.on;
      return `${i ? '<span class="vo-cl"></span>' : ''}<button class="vo-step${on ? ' on' : ''}${soon ? ' soon' : ''}${off ? ' off' : ''}" data-view="${view}" ${soon ? 'disabled title="준비 중"' : ''}><i>${i + 1}</i>${l}</button>`;
    }).join('');
  }
  function headDraw() {
    const v = V();
    Q('voLevel').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.l === v.level));
    const comp = v.view === 'comp';
    Q('voPresets').innerHTML = comp
      ? Object.entries(CPRESETS).map(([k, [l]]) => `<button data-c="${k}" class="${v.comp.preset === k ? 'on' : ''}">${l}</button>`).join('')
      : Object.entries(PRESETS).map(([k, [l]]) => `<button data-p="${k}" class="${v.preset === k ? 'on' : ''}">${l}</button>`).join('');
    Q('voGraph').hidden = comp; Q('voComp').hidden = !comp;
    document.querySelector('.vo-foot').hidden = comp;
    chainDraw();
    if (comp) { compCtrlDraw(); tfDraw(); }
    Q('voAB').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.ab === 'off') === bypass));
    const easy = v.level === 'easy';
    Q('voEasy').hidden = !easy || comp; Q('voPro').hidden = easy || comp;
    Q('voHint').textContent = v.level === 'pro' ? '점 끌기 · 양옆 막대 = 폭 · 빈 곳 두 번 = 추가' : '점을 끌어서 맞추세요';
    Q('voTone').value = v.tone; Q('voMud').value = v.mud; Q('voMudV').textContent = v.mud ? '-' + (v.mud * 0.06).toFixed(1) + 'dB' : '끔';
    Q('voCut').classList.toggle('on', !!v.cutOn);
  }
  function drawAll() { zonesDraw(); curveDraw(); nodesDraw(); chipsDraw(); headDraw(); }
  Q('voChain').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]'); if (!b || !b.dataset.view) return;
    const v = V(); if (v.view === b.dataset.view) return;
    v.view = b.dataset.view; if (v.view === 'comp') solo = null;
    syncChain(); headDraw();                                  // 먼저 화면을 보이게 바꾼 뒤
    requestAnimationFrame(() => { resize(); drawAll(); }); saveSoon();   // 보이는 크기로 다시 잼
  });
  function changed(quick) {
    if (!quick) V().preset = V().preset || '';
    syncChain(); curveDraw(); nodesDraw(); if (!quick) { zonesDraw(); chipsDraw(); headDraw(); } else bubbleDraw();
    saveSoon();
  }

  // 목소리 구름 (실제 마이크 / 녹음 소리, 필터 거친 뒤)
  let fft = null, raf = 0;
  let tfT = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (V().view === 'comp') { histDraw(); const n = performance.now(); if (n - tfT > 60 && !tfDrag) { tfT = n; tfDraw(); } liveIn = Math.max(-120, liveIn - 0.6); return; }
    if (!A.an || !xsCache.length) { cloud.setAttribute('d', ''); edge.setAttribute('d', ''); return; }
    if (!fft || fft.length !== A.an.frequencyBinCount) fft = new Float32Array(A.an.frequencyBinCount);
    A.an.getFloatFrequencyData(fft);
    const hz = A.ctx.sampleRate / A.an.fftSize, base = H - 2, span = (H - top0()) * 0.85;
    let d = `M0 ${H} `, e = '';
    const vals = xsCache.map(([, f], i) => {
      const f2 = i + 1 < xsCache.length ? xsCache[i + 1][1] : f * 1.02, fb = f / hz;
      if (f2 / hz - fb < 1.5) { const k = Math.max(1, Math.min(fft.length - 2, Math.floor(fb))), t = fb - k; return fft[k] * (1 - t) + fft[k + 1] * t; }   // 저음: 칸 사이를 이어서
      const b0 = Math.max(1, Math.floor(fb)), b1 = Math.max(b0, Math.min(fft.length - 1, Math.floor(f2 / hz)));
      let m = -120; for (let k = b0; k <= b1; k++) if (fft[k] > m) m = fft[k];
      return m;
    });
    const sb = solo != null ? V().bands.find((b) => b.id === solo) : null, edges = sb ? soloEdges(sb) : null;
    for (let i = 0; i < vals.length; i++) {
      const x = xsCache[i][0], m = (vals[Math.max(0, i - 1)] + vals[i] * 2 + vals[Math.min(vals.length - 1, i + 1)]) / 4;   // 살짝 부드럽게
      const f = xsCache[i][1], out = edges && (f < edges[0] || f > edges[1]);           // 구간만 듣기: 구간 밖은 구름도 안 보이게
      const t = out ? 0 : Math.max(0, Math.min(1, (m + 95) / 70)), y = base - t * span;
      d += 'L' + x.toFixed(1) + ' ' + y.toFixed(1) + ' '; e += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
    cloud.setAttribute('d', d + `L${W} ${H} Z`); edge.setAttribute('d', e);
  }

  // ---------------------------------------------------------------- 조작
  const local = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  function grab(e, id, kind) { e.stopPropagation(); e.preventDefault(); if (solo != null && solo !== id) { solo = id; syncChain(); } sel = id; drag = { id, kind }; try { svg.setPointerCapture(e.pointerId); } catch {} nodesDraw(); zonesDraw(); chipsDraw(); }
  svg.addEventListener('pointerdown', () => { if (V().level !== 'easy') { sel = null; if (solo != null) { solo = null; syncChain(); } drawAll(); } });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const v = V(), b = v.bands.find((x) => x.id === drag.id); if (!b) return;
    const p = local(e);
    if (drag.kind === 'node') { b.f = Math.max(20, Math.min(20000, xf(p.x))); if (hasGain(b)) b.g = Math.max(-15, Math.min(15, yg(p.y))); }
    else b.q = qOf(Math.max(0.15, Math.min(4, 2 * Math.abs(Math.log2(xf(p.x) / b.f)))));
    v.preset = '';
    changed(true);
  });
  const endDrag = () => { if (drag) { drag = null; zonesDraw(); chipsDraw(); headDraw(); saveSoon(); } };
  svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('dblclick', (e) => {
    const v = V(); if (v.level !== 'pro' || v.bands.length >= 8) return;
    const p = local(e), id = Math.max(0, ...v.bands.map((b) => b.id)) + 1;
    v.bands.push({ id, type: 'bell', f: xf(p.x), g: Math.max(-15, Math.min(15, yg(p.y))), q: 1, on: true }); sel = id; v.preset = ''; changed();
  });
  Q('voLevel').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.l === 'easy') solo = null; V().level = b.dataset.l; drawAll(); saveSoon(); });
  Q('voPresets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; solo = null; const v = V();
    if (b.dataset.c) { Object.assign(v.comp, CPRESETS[b.dataset.c][1], { preset: b.dataset.c, auto: true, on: true }); syncChain(); headDraw(); saveSoon(); return; } v.bands = mkBands(PRESETS[b.dataset.p][1]); v.preset = b.dataset.p; sel = 2; changed(); });
  Q('voAB').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; bypass = b.dataset.ab === 'off'; changed(); });
  function easyApply() {
    const v = V(), k = v.tone / 100, bs = [];
    if (v.cutOn) bs.push(['hp', 90, 0, 0.71]);
    bs.push(['ls', 180, Math.max(0, -k) * 4, 0.71], ['bell', 340, -v.mud * 0.06, 1.1], ['bell', 3500, Math.max(0, k) * 4.5, 0.9], ['hs', 10000, k * 2.5, 0.71]);
    v.bands = mkBands(bs); v.preset = ''; changed();
  }
  Q('voTone').addEventListener('input', () => { V().tone = Number(Q('voTone').value); easyApply(); });
  Q('voMud').addEventListener('input', () => { V().mud = Number(Q('voMud').value); easyApply(); });
  Q('voCut').addEventListener('click', () => { V().cutOn = !V().cutOn; easyApply(); });

  // ---------------------------------------------------------------- 컴프레서 화면
  const vcSvg = Q('vcSvg'), vcHist = Q('vcHist');
  let tfW = 300, tfDrag = null;
  const DBMIN = -60;
  const tfX = (db) => 34 + (db - DBMIN) / -DBMIN * (tfW - 48);
  const tfY = (db) => tfW - 30 - (db - DBMIN) / -DBMIN * (tfW - 48);
  const tfDb = (px) => DBMIN + (px - 34) / (tfW - 48) * -DBMIN;
  function tfDraw() {
    const r = vcSvg.getBoundingClientRect(); tfW = Math.max(180, Math.round(Math.min(r.width, r.height)));
    vcSvg.setAttribute('viewBox', `0 0 ${tfW} ${tfW}`);
    const c = compParams(), on = c.on && !bypass;
    let grid = '';
    for (const d of [-48, -36, -24, -12, 0]) grid += `<line x1="${tfX(d)}" y1="${tfY(DBMIN)}" x2="${tfX(d)}" y2="${tfY(0)}" class="vc-grid"/><line x1="${tfX(DBMIN)}" y1="${tfY(d)}" x2="${tfX(0)}" y2="${tfY(d)}" class="vc-grid"/><text x="${tfX(d)}" y="${tfW - 12}" class="vc-ax" text-anchor="middle">${d}</text><text x="26" y="${tfY(d) + 4}" class="vc-ax" text-anchor="end">${d}</text>`;
    let d = '';
    for (let i = 0; i <= 120; i++) { const x = DBMIN + i * (-DBMIN) / 120, y = Math.min(0, (on ? gcDb(x, c.thr, c.ratio, c.knee) : x) + (on ? c.makeup : 0)); d += (i ? 'L' : 'M') + tfX(x).toFixed(1) + ' ' + tfY(Math.max(DBMIN, y)).toFixed(1) + ' '; }
    const ty = on ? gcDb(c.thr, c.thr, c.ratio, c.knee) + c.makeup : c.thr, ry = on ? gcDb(0, c.thr, c.ratio, c.knee) + c.makeup : 0;
    const li = Math.max(DBMIN, Math.min(0, liveIn)), lo = on ? gcDb(li, c.thr, c.ratio, c.knee) + c.makeup : li;
    vcSvg.innerHTML = grid +
      `<rect x="${tfX(c.thr)}" y="${tfY(0)}" width="${tfX(0) - tfX(c.thr)}" height="${tfY(DBMIN) - tfY(0)}" class="vc-zone"/>` +
      `<line x1="${tfX(DBMIN)}" y1="${tfY(DBMIN)}" x2="${tfX(0)}" y2="${tfY(0)}" class="vc-diag"/>` +
      `<line x1="${tfX(c.thr)}" y1="${tfY(DBMIN)}" x2="${tfX(c.thr)}" y2="${tfY(0)}" class="vc-thr"/>` +
      `<text x="${tfX(c.thr) - 6}" y="${tfY(0) + 16}" class="vc-thl" text-anchor="end">기준선 ${Math.round(c.thr)}</text>` +
      `<path d="${d}" class="vc-curve"/>` +
      (liveIn > DBMIN ? `<circle cx="${tfX(li)}" cy="${tfY(Math.max(DBMIN, Math.min(0, lo)))}" r="7" class="vc-live"/>` : '') +
      (V().level !== 'easy' ? `<circle cx="${tfX(c.thr)}" cy="${tfY(Math.max(DBMIN, Math.min(0, ty)))}" r="9" class="vc-h" data-h="thr"/>` : '') +
      (V().level !== 'easy' ? `<rect x="${tfX(0) - 14}" y="${tfY(Math.max(DBMIN, Math.min(0, ry))) - 6}" width="20" height="12" rx="6" class="vc-h" data-h="ratio"/>` : '');
  }
  vcSvg.addEventListener('pointerdown', (e) => { const h = e.target.closest('[data-h]'); if (!h) return; tfDrag = h.dataset.h; vcSvg.setPointerCapture(e.pointerId); e.preventDefault(); });
  vcSvg.addEventListener('pointermove', (e) => {
    if (!tfDrag) return;
    const r = vcSvg.getBoundingClientRect(), k = tfW / r.width, px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k, c = V().comp;
    if (tfDrag === 'thr') c.thr = Math.round(Math.max(-50, Math.min(-3, tfDb(px))));
    else { const outDb = DBMIN + (tfW - 30 - py) / (tfW - 48) * -DBMIN, mk = compParams().makeup; const red = (outDb - mk) - c.thr; c.ratio = Math.max(1, Math.min(20, red > 0.3 ? -c.thr / red : 20)); }
    c.preset = ''; syncChain(); tfDraw(); compCtrlDraw(true);
  });
  const tfUp = () => { if (tfDrag) { tfDrag = null; headDraw(); saveSoon(); } };
  vcSvg.addEventListener('pointerup', tfUp); vcSvg.addEventListener('pointercancel', tfUp);

  const CTRL = {
    thr: ['기준선', 'Threshold', -50, -3, 1, (v) => Math.round(v) + 'dB'],
    ratio: ['누르는 정도', 'Ratio', 1, 20, 0.1, (v) => v >= 19.9 ? '∞:1' : v.toFixed(1) + ':1'],
    att: ['반응 속도', 'Attack', 0.5, 100, 0.5, (v) => v.toFixed(v < 10 ? 1 : 0) + 'ms'],
    rel: ['풀리는 속도', 'Release', 20, 800, 5, (v) => Math.round(v) + 'ms'],
    knee: ['부드러움', 'Knee', 0, 18, 0.5, (v) => v.toFixed(1) + 'dB'],
    makeup: ['볼륨 보정', 'Makeup', -6, 18, 0.5, (v) => (v > 0 ? '+' : '') + v.toFixed(1) + 'dB'],
  };
  function compCtrlDraw(valuesOnly) {
    const v = V(), c = v.comp, box = Q('vcCtrl'), lv = v.level, P = compParams();
    if (valuesOnly) { box.querySelectorAll('[data-k]').forEach((row) => { const k = row.dataset.k, val = k === 'makeup' ? P.makeup : c[k]; row.querySelector('b').textContent = CTRL[k][5](val); const inp = row.querySelector('input'); if (document.activeElement !== inp) inp.value = val; }); return; }
    const sw = `<button class="vc-on${c.on ? ' on' : ''}" id="vcOn"><i></i>${c.on ? '컴프레서 켜짐' : '컴프레서 꺼짐'}</button>`;
    if (lv === 'easy') {
      box.innerHTML = sw + `<label class="vc-easy"><span><i>자연스럽게</i><b>목소리 크기 고르게</b><i>방송처럼</i></span><input type="range" id="vcEasy" min="0" max="100" value="${c.easy ?? 50}"></label>`;
    } else {
      const keys = lv === 'mid' ? ['thr', 'ratio'] : ['thr', 'ratio', 'att', 'rel', 'knee', 'makeup'];
      box.innerHTML = sw + keys.map((k) => {
        const [l, en, mn, mx, st, f] = CTRL[k], val = k === 'makeup' ? P.makeup : c[k], dis = k === 'makeup' && c.auto;
        return `<label class="vc-row${dis ? ' dis' : ''}" data-k="${k}" title="${en}"><span><em>${l}</em><b>${f(val)}</b></span><input type="range" min="${mn}" max="${mx}" step="${st}" value="${val}" ${dis ? 'disabled' : ''}></label>`;
      }).join('') + `<button class="vc-auto${c.auto ? ' on' : ''}" id="vcAuto">볼륨 자동 보정</button>`;
    }
  }
  Q('vcCtrl').addEventListener('input', (e) => {
    const c = V().comp;
    if (e.target.id === 'vcEasy') { easyComp(Number(e.target.value)); syncChain(); tfDraw(); saveSoon(); return; }
    const row = e.target.closest('[data-k]'); if (!row) return;
    c[row.dataset.k] = Number(e.target.value); c.preset = '';
    syncChain(); tfDraw(); compCtrlDraw(true); saveSoon();
  });
  Q('vcCtrl').addEventListener('change', () => headDraw());
  Q('vcCtrl').addEventListener('click', (e) => {
    const c = V().comp;
    if (e.target.closest('#vcOn')) { c.on = !c.on; syncChain(); headDraw(); saveSoon(); }
    if (e.target.closest('#vcAuto')) { if (c.auto) c.makeup = autoMakeup(c); c.auto = !c.auto; syncChain(); headDraw(); saveSoon(); }
  });
  // 목소리 크기 흐름 (최근 6초)
  function histDraw() {
    if (Q('voComp').hidden) return;
    const r = vcHist.getBoundingClientRect(), z = window.devicePixelRatio || 1, w = Math.round(r.width * z), h = Math.round(r.height * z);
    if (!w || !h) return;
    if (vcHist.width !== w || vcHist.height !== h) { vcHist.width = w; vcHist.height = h; }
    const g = vcHist.getContext('2d'), cs = getComputedStyle(ov), red = cs.getPropertyValue('--red').trim() || '#E5577E', sub = cs.getPropertyValue('--sub').trim() || '#888', line = cs.getPropertyValue('--line').trim() || '#ddd';
    g.clearRect(0, 0, w, h);
    const yOf = (db) => h - 8 * z - Math.max(0, Math.min(1, (db - DBMIN) / -DBMIN)) * (h - 40 * z);
    const N = 240, step = w / (N - 1), off = N - hist.length;
    const c = compParams();
    g.strokeStyle = line; g.lineWidth = 1 * z; g.setLineDash([4 * z, 5 * z]);
    g.beginPath(); g.moveTo(0, yOf(c.thr)); g.lineTo(w, yOf(c.thr)); g.stroke(); g.setLineDash([]);
    g.fillStyle = sub; g.font = `${11 * z}px sans-serif`; g.fillText('기준선', 6 * z, yOf(c.thr) - 5 * z);
    // 눌린 만큼 (위에서 내려옴)
    g.fillStyle = red; g.globalAlpha = 0.28;
    hist.forEach((d, i) => { const x = (i + off) * step, gh = Math.min(1, -d.gr / 24) * (h * 0.45); if (gh > 0.5) g.fillRect(x - step / 2, 0, Math.max(1, step), gh); });
    g.globalAlpha = 1;
    // 나가는 소리 (채움)
    g.beginPath(); g.moveTo(off * step, h);
    hist.forEach((d, i) => g.lineTo((i + off) * step, yOf(d.out)));
    g.lineTo((hist.length - 1 + off) * step, h); g.closePath(); g.fillStyle = red; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
    g.beginPath(); hist.forEach((d, i) => (i ? g.lineTo : g.moveTo).call(g, (i + off) * step, yOf(d.out))); g.strokeStyle = red; g.lineWidth = 2 * z; g.stroke();
    // 들어온 소리 (선)
    g.beginPath(); hist.forEach((d, i) => (i ? g.lineTo : g.moveTo).call(g, (i + off) * step, yOf(d.in))); g.strokeStyle = sub; g.globalAlpha = 0.6; g.lineWidth = 1.4 * z; g.stroke(); g.globalAlpha = 1;
    const gr = hist.length ? Math.min(...hist.slice(-6).map((d) => d.gr)) : 0;
    Q('vcGr').textContent = (gr < -0.05 ? gr : 0).toFixed(1);
    Q('vcGr').parentElement.classList.toggle('hot', gr < -0.5);
  }

  async function setSolo(id) {
    solo = id;
    if (id != null && !A.listening && !A.playing) {     // 듣는 중이 아니면 실시간 듣기를 같이 켬
      try { await micStart(); setListen(true); } catch (e) { toast('마이크를 열 수 없어요.', true); solo = null; }
    }
    syncChain(); curveDraw(); bubbleDraw(); renderTest();
  }
  // 들어보기
  function renderTest() {
    const lb = Q('voListen'), rb = Q('voRec'), st = Q('voStatus');
    if (!lb) return;
    lb.classList.toggle('on', A.listening); lb.querySelector('span').textContent = A.listening ? '듣는 중' : '실시간으로 듣기';
    if (A.rec) { rb.classList.add('on'); rb.querySelector('span').textContent = `녹음 중 ${Math.max(0, 5 - Math.floor((Date.now() - A.rec.t0) / 1000))}초`; }
    else if (A.playing) { rb.classList.add('on'); rb.querySelector('span').textContent = '반복 재생 중 · 멈추기'; }
    else { rb.classList.remove('on'); rb.querySelector('span').textContent = A.recBuf ? '다시 녹음 · 재생' : '5초 녹음해서 비교'; }
    st.textContent = solo != null ? '고른 구간 소리만 나와요 · 다시 누르면 전체 소리' : A.playing ? '위에서 [원래 소리] ↔ [필터]를 바꿔 가며 들어 보세요' : A.listening ? '이어폰으로 들어 주세요 (스피커면 소리가 울려요)' : '';
  }
  Q('voListen').addEventListener('click', async () => {
    try { await micStart(); } catch (e) { toast('마이크를 열 수 없어요: ' + (e.message || e), true); return; }
    setListen(!A.listening);
  });
  Q('voRec').addEventListener('click', () => { if (A.rec) return; if (A.playing) { stopPlay(); return; } if (A.recBuf && !A.listening) { playTest(); return; } recordTest(); });
  Q('voRec').addEventListener('contextmenu', (e) => { e.preventDefault(); A.recBuf = null; recordTest(); });
  Q('voMic').addEventListener('change', async () => { micStop(); try { await micStart(); } catch (e) { toast('마이크를 열 수 없어요.', true); } });

  // ---------------------------------------------------------------- 인증키 (테스트용 · 나중에 서버 로그인 확인으로 바꿀 것)
  // 프로그램을 켤 때마다 한 번 넣어야 함 (저장 안 함). 키 자체는 코드에 없고 해시만 비교.
  const KEY_HASH = '371400ed9be2e35fa162cf86447849392d210d158795eef532448262af9aa8fe';
  let unlocked = false;
  const keyHash = (k) => require('crypto').createHash('sha256').update(k).digest('hex');
  const normKey = (k) => String(k || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');
  function lockShow(on) {
    Q('voLock').hidden = !on;
    ov.classList.toggle('vo-locked', on);
    if (on) { Q('voKey').value = ''; Q('voKeyErr').textContent = ''; setTimeout(() => Q('voKey').focus(), 50); }
  }
  function tryKey() {
    const k = normKey(Q('voKey').value);
    if (!k) { Q('voKeyErr').textContent = '인증키를 넣어 주세요.'; return; }
    if (keyHash(k) !== KEY_HASH) { Q('voKeyErr').textContent = '인증키가 맞지 않아요.'; Q('voKey').select(); return; }
    unlocked = true; lockShow(false); open(true);
  }
  Q('voKeyGo').addEventListener('click', tryKey);
  Q('voKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryKey(); e.stopPropagation(); });

  // ---------------------------------------------------------------- 열기 / 닫기
  function open(on) {
    ov.hidden = !on;
    try { hidePreview('voice', on); } catch {}
    if (on && !unlocked) { lockShow(true); return; }
    if (on) {
      V(); sel = V().bands[1] ? V().bands[1].id : null;
      requestAnimationFrame(async () => {
        resize(); drawAll();
        try { await micStart(); await listMics(); } catch (e) { toast('마이크를 열 수 없어요. 윈도우 설정 → 개인 정보 → 마이크를 확인해 주세요.', true); }
        syncChain(); renderTest();
        if (!raf) loop();
      });
    } else {
      lockShow(false);
      if (!A.ctx && !raf) return;
      solo = null; stopPlay(true); setListen(false); micStop();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (A.ctx) { A.ctx.close().catch(() => {}); A.ctx = null; A.sig = ''; A.filters = []; A.soloNodes = []; A.comp = null; A.ready = null; }
      hist.length = 0;
      save();
    }
  }
  window.voiceOpen = open;
  Q('voClose').addEventListener('click', () => open(false));
  ov.addEventListener('click', (e) => { if (e.target === ov) open(false); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) { e.stopPropagation(); open(false); } }, true);
  window.addEventListener('resize', () => { if (!ov.hidden) { resize(); drawAll(); } });
  const btn = Q('voOpen'); if (btn) btn.addEventListener('click', () => open(true));
})();
