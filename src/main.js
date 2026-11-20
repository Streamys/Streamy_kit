// Streamy Kit — 메인 프로세스
// 화면(렌더러)이 방송 엔진을 불러오고, 여기서는 창 관리 · 경로 · 로그 · 충돌 복구 · 종료 처리를 맡습니다.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, net, screen, crashReporter, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const log = require('./log');
const server = require('./server');
const vts = require('./vts');

app.setName('Streamy Kit');
app.setAppUserModelId('com.streamy.kit');
log.init(path.join(app.getPath('userData'), 'logs'));
// 화면이 죽으면 덤프를 남김 (서버로 안 보냄, %APPDATA%\Streamy Kit\Crashpad 에만 저장) → 원인 분석용
try { crashReporter.start({ uploadToServer: false, compress: true, globalExtra: { ver: app.getVersion() } }); } catch {}
// 화면이 죽기 직전에 무엇을 했는지 (최근 30개 동작)
const crumbs = [];
log.info('main', `start v${app.getVersion()}${global.STREAMY?.patch ? ` (빠른 업데이트, 설치 ${global.STREAMY.baseVersion})` : ''} electron ${process.versions.electron} pid ${process.pid}`);

// 그래픽 가속 끄기 옵션 (화면이 검게 나오는 PC 대비). 설정에서 켜거나, GPU가 반복해서 죽으면 자동으로 켜짐
const GPU_OFF_FLAG = path.join(app.getPath('userData'), 'disable-gpu');
if (fs.existsSync(GPU_OFF_FLAG)) { app.disableHardwareAcceleration(); log.warn('main', 'hardware acceleration disabled by flag'); }

// ---------------------------------------------------------------- 한 개만 실행
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.info('main', 'another instance is running → exit');
  app.exit(0);
} else {
  main();
}

function main() {
  let win = null;
  let tray = null;
  function appIcon() {
    try { const p = path.join(app.getPath('userData'), 'app-icon.png'); if (fs.existsSync(p)) { const i = nativeImage.createFromPath(p); if (!i.isEmpty()) return i; } } catch {}
    return nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  }
  let quitting = false;      // 종료 절차 시작됨
  let rendererBusy = false;  // 응답 없음 상태
  let enginePrepared = null; // 남아 있는 엔진 정리 작업 (Promise)
  let crashCount = 0;
  let gpuCrashes = 0;

  function osnDir() {
    const candidates = [
      path.join(app.getAppPath(), 'node_modules', 'obs-studio-node'),
      path.join(process.resourcesPath || '', 'app', 'node_modules', 'obs-studio-node'),
    ];
    return candidates.find((p) => fs.existsSync(path.join(p, 'index.js'))) || candidates[0];
  }

  // 이 설치본의 엔진 프로세스(obs64.exe)만 강제 종료 — 사용자가 따로 쓰는 OBS는 건드리지 않음
  function killOwnEngine(reason) {
    if (process.platform !== 'win32') return Promise.resolve();
    const dir = osnDir().replace(/'/g, "''");
    const ps = `Get-CimInstance Win32_Process -Filter "Name='obs64.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
        const killed = String(stdout || '').trim();
        if (killed) log.warn('main', `killed leftover engine (${reason}): ${killed.replace(/\s+/g, ',')}`);
        if (err) log.warn('main', 'killOwnEngine', err.message);
        resolve();
      });
    });
  }

  function createWindow() {
    const t0 = Date.now();
    win = new BrowserWindow({
      width: 1440, height: 880, minWidth: 1180, minHeight: 720,
      title: 'Streamy Kit', backgroundColor: '#0B0B0D', show: false,
      icon: appIcon(),
      autoHideMenuBar: true,
      frame: false,                    // 창 버튼(최소화/최대화/닫기)은 화면에서 직접 그림
      thickFrame: true,                // 가장자리 끌어서 크기 조절 + 윈도우 스냅 유지
      webPreferences: {
        // 방송 엔진(네이티브 모듈)을 화면에서 직접 쓰기 위해 Node 통합 사용. 로컬 파일만 불러옵니다.
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
        spellcheck: false,
        webviewTag: true,          // 채팅 탭: 플랫폼 공식 채팅창 (로그인 유지, Node 접근 없음)
      },
    });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    // 화면이 그려지면 바로 보여줌. 혹시 늦어도 2초 뒤엔 무조건 보여줌 (로딩 화면이 먼저 그려짐)
    let shown = false;
    // 시작 애니메이션: 본 창 위에 투명 창을 덮음 (엔진 미리보기는 HTML 위에 뜨는 네이티브 창이라 본 창 안에선 못 가림)
    let intro = null, introReady = false;
    try {
      let st = {}; try { st = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')) || {}; } catch {}
      if (!process.env.SHOT_OUT) {          // 시작 애니메이션 = 로딩 화면이라 끄는 설정 없음
        intro = new BrowserWindow({
          parent: win, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
          show: false, hasShadow: false, backgroundColor: '#00000000', title: 'Streamy Kit',
          webPreferences: { nodeIntegration: false, contextIsolation: true, spellcheck: false, backgroundThrottling: false },
        });
        intro.loadFile(path.join(__dirname, 'renderer', 'intro.html'), { query: { c: /^#[0-9a-f]{6}$/i.test(st.accent || '') ? st.accent : '', b: String(Number(st.bootMs) || 0) } });
        intro.once('ready-to-show', () => { introReady = true; trigger('intro'); });
        intro.on('closed', () => { intro = null; });
        const place = () => { try { if (intro && !intro.isDestroyed() && win && !win.isDestroyed()) intro.setBounds(win.getContentBounds()); } catch {} };
        for (const ev of ['move', 'resize', 'maximize', 'unmaximize']) win.on(ev, place);
        // 화면이 준비 상태를 알려 줌 (엔진 준비 중 → 화면 불러오는 중 → 열기)
        const introJs = (js) => { try { if (intro && !intro.isDestroyed()) intro.webContents.executeJavaScript(js).catch(() => {}); } catch {} };
        ipcMain.removeAllListeners('intro:status'); ipcMain.removeAllListeners('intro:open');
        ipcMain.on('intro:status', (_e, t) => introJs(`introStatus(${JSON.stringify(String(t))})`));
        ipcMain.on('intro:open', () => introJs('introOpen()'));
        win.webContents.on('render-process-gone', () => introJs('introOpen()'));
        setTimeout(() => introJs('introOpen()'), 360000);                                          // 안전장치 (엔진은 최대 5분)
        setTimeout(() => { try { if (intro && !intro.isDestroyed()) intro.close(); } catch {} }, 362000);
      }
    } catch {}
    let winReady = false;
    const show = (why) => {
      if (shown || !win || win.isDestroyed()) return; shown = true;
      if (intro && !intro.isDestroyed() && introReady) { intro.setBounds(win.getContentBounds()); intro.showInactive(); }
      else if (intro && !intro.isDestroyed()) intro.close();
      win.show();
      if (intro && !intro.isDestroyed()) { intro.setBounds(win.getContentBounds()); intro.moveTop(); }
      log.info('main', `window shown (${why}) in ${Date.now() - t0}ms`);
    };
    function trigger(why) { if (winReady && (!intro || introReady)) show(why); }
    win.once('ready-to-show', () => { winReady = true; trigger('ready'); });
    // 빠른 업데이트로 켜졌으면, 15초 동안 문제없으면 "정상" 표시 (두 번 연속 실패하면 기본 버전으로 돌아감)
    setTimeout(() => { try { if (win && !win.isDestroyed() && !win.webContents.isCrashed()) global.STREAMY?.markGood?.(); } catch {} }, 15000);
    setTimeout(() => show('timeout'), 2000);

    const sendMax = () => { try { win.webContents.send('win:maximized', win.isMaximized()); } catch {} };
    win.on('maximize', sendMax); win.on('unmaximize', sendMax);
    // 편집 가이드 창이 본 창을 따라다니게
    for (const ev of ['move', 'resize', 'maximize', 'unmaximize', 'restore', 'show']) win.on(ev, () => ovPlace());
    for (const ev of ['minimize', 'hide']) win.on(ev, () => { try { if (ov && !ov.isDestroyed()) ov.hide(); } catch {} });
    // 최소화하면 미니 오버레이, 다시 열면 숨김
    win.on('minimize', () => { if (miniCfg.on) miniShow(); });
    win.on('restore', () => miniHide());
    win.on('focus', () => { if (!win.isMinimized()) miniHide(); });
    win.on('closed', () => { stopAudioSessions(); win = null; });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    // 화면 프로세스가 죽으면: 엔진 정리 후 자동으로 다시 띄움
    win.webContents.on('render-process-gone', async (_e, d) => {
      log.error('main', 'renderer gone', d);
      if (d.reason !== 'killed' && crumbs.length) log.error('main', 'last actions: ' + crumbs.map((c) => `${new Date(c.t).toISOString().slice(11, 23)} ${c.a}`).join(' | '));
      if (quitting) return;
      crashCount++;
      await killOwnEngine('renderer crash');
      if (crashCount <= 3) { enginePrepared = Promise.resolve(); win.reload(); }
      else {
        dialog.showMessageBox({ type: 'error', title: 'Streamy Kit', message: 'Streamy Kit이 여러 번 비정상 종료됐어요.', detail: '설정 → 문제 해결의 로그 폴더를 열어 로그 파일을 보내 주세요.', buttons: ['로그 폴더 열기', '종료'] })
          .then((r) => { if (r.response === 0) shell.openPath(log.dir()); quitting = true; app.exit(1); });
      }
    });
    // 응답 없음: 20초 넘게 멈추면 기다릴지 다시 시작할지 물어봄
    let hangT = null;
    win.on('unresponsive', () => {
      rendererBusy = true;
      log.warn('main', 'renderer unresponsive');
      clearTimeout(hangT);
      hangT = setTimeout(async () => {
        if (!rendererBusy || quitting || !win || win.isDestroyed()) return;
        if (engineBooting && Date.now() - engineBooting < 330000) { log.info('main', 'still booting engine, waiting'); return; }   // 엔진 켜는 중엔 기다림 (처음 켤 땐 1~2분 걸리는 PC가 있음)
        const r = await dialog.showMessageBox(win, { type: 'warning', title: 'Streamy Kit 응답 없음', message: 'Streamy Kit이 응답하지 않아요.', detail: '방송 엔진이 멈췄을 수 있어요. 다시 시작하면 장면 설정은 그대로 유지돼요.', buttons: ['다시 시작', '기다리기'], defaultId: 0 });
        if (r.response === 0) { log.warn('main', 'user chose restart on hang'); await killOwnEngine('hang'); app.relaunch(); quitting = true; app.exit(0); }
      }, 20000);
    });
    win.on('responsive', () => { rendererBusy = false; clearTimeout(hangT); log.info('main', 'renderer responsive again'); });

    // 창 닫기 = 종료 절차. 화면이 방송 중 확인 → 엔진 정리 → 'app:ready-to-quit'
    win.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      if (rendererBusy) { forceQuit('close while unresponsive'); return; }
      win.webContents.send('app:request-quit');
      // 화면이 3초 안에 응답(app:quitting/취소)하지 않으면 강제 종료
      quitAskT = setTimeout(() => forceQuit('no answer to quit request'), 3000);
    });
  }
  let quitAskT = null;
  let engineBooting = 0;
  ipcMain.on('engine:booting', (_e, on) => { engineBooting = on ? Date.now() : 0; });

  async function forceQuit(why) {
    if (quitting) return;
    quitting = true;
    stopAudioSessions(); stopWinWatch();
    try { chat.flushLog(); chat.stopAll(); } catch {}
    try { if (mini && !mini.isDestroyed()) mini.destroy(); } catch {}
    try { if (ov && !ov.isDestroyed()) ov.destroy(); } catch {}
    log.warn('main', 'force quit:', why);
    try { if (win && !win.isDestroyed()) win.hide(); } catch {}
    await killOwnEngine('force quit');
    app.exit(0);
  }

  function showWindow() {
    if (!win || win.isDestroyed()) { createWindow(); return; }
    if (win.webContents.isCrashed()) { win.reload(); }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  }

  // ---------------------------------------------------------------- 지금 소리 나는 프로그램 (윈도우 오디오 세션)
  let sessionProc = null, sessionBuf = '';
  function startAudioSessions() {
    if (process.platform !== 'win32' || sessionProc) return;
    const script = path.join(__dirname, 'audio-sessions.ps1');
    sessionProc = require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
    log.info('main', 'audio sessions start pid', sessionProc.pid);
    sessionProc.stdout.setEncoding('utf8');
    sessionProc.stdout.on('data', (chunk) => {
      sessionBuf += chunk;
      let i;
      while ((i = sessionBuf.indexOf('\n')) >= 0) {
        const line = sessionBuf.slice(0, i).trim(); sessionBuf = sessionBuf.slice(i + 1);
        if (!line) continue;
        try { const data = JSON.parse(line); if (win && !win.isDestroyed()) win.webContents.send('audio-sessions', data); }
        catch { /* 무시 */ }
      }
    });
    sessionProc.stderr.on('data', (d) => log.warn('audio-sessions', String(d).slice(0, 500)));
    sessionProc.on('exit', (code) => { log.info('main', 'audio sessions exit', code); sessionProc = null; sessionBuf = ''; });
  }
  function stopAudioSessions() { if (sessionProc) { try { sessionProc.kill(); } catch {} sessionProc = null; } }

  // 켜져 있는 프로그램 창 목록 (사운드 분리 · 버추얼 감지용). 엔진과 따로 도는 도우미가 2초마다 알려 줌
  let winProc = null, winBuf = '', winLast = null, winRetry = 0;
  function startWinWatch() {
    if (process.platform !== 'win32' || winProc || quitting) return;
    const script = path.join(__dirname, 'windows.ps1');
    winProc = require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
    log.info('main', 'window watch start pid', winProc.pid);
    winProc.stdout.setEncoding('utf8');
    winProc.stdout.on('data', (chunk) => {
      winBuf += chunk;
      let i;
      while ((i = winBuf.indexOf('\n')) >= 0) {
        const line = winBuf.slice(0, i).trim(); winBuf = winBuf.slice(i + 1);
        if (!line) continue;
        try {
          const data = JSON.parse(line);
          if (Array.isArray(data)) {
            winLast = data; winRetry = 0;
            const v = data.find((w) => /^vtube studio\.exe$/i.test(w.exe)); if (v && v.path) vts.rememberExe(v.path);
          }
          if (win && !win.isDestroyed()) win.webContents.send('windows', data);
        } catch {}
      }
    });
    winProc.stderr.on('data', (d) => log.warn('windows', String(d).slice(0, 500)));
    winProc.on('exit', (code) => {
      log.info('main', 'window watch exit', code); winProc = null; winBuf = '';
      if (!quitting && winRetry < 5) setTimeout(startWinWatch, 3000 * ++winRetry);     // 죽으면 다시 (최대 5번)
    });
  }
  function stopWinWatch() { if (winProc) { const p = winProc; winProc = null; winRetry = 99; try { p.kill(); } catch {} } }

  function createTray() {
    tray = new Tray(appIcon().resize({ width: 32, height: 32 }));
    tray.setToolTip('Streamy Kit');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Streamy Kit 열기', click: showWindow },
      { label: '로그 폴더 열기', click: () => shell.openPath(log.dir()) },
      { type: 'separator' },
      { label: '종료', click: () => (win && !win.isDestroyed() ? win.close() : app.exit(0)) },
    ]));
    tray.on('double-click', showWindow);
  }

  // ---------------------------------------------------------------- 업데이트 (GitHub Releases)
  // ---------------------------------------------------------------- 편집 가이드 (미리보기 위에 겹치는 투명 창)
  // 미리보기는 엔진이 그리는 별도 창이라 HTML을 위에 못 그림 → 마우스가 통과하는 투명 창을 정확히 겹쳐서 테두리·손잡이를 그림
  let ov = null, ovRect = null, ovWant = false, ovReady = false;
  function ovCreate() {
    if (ov && !ov.isDestroyed()) return ov;
    ov = new BrowserWindow({
      parent: win, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true,
      show: false, hasShadow: false, backgroundColor: '#00000000', title: 'Streamy Kit 편집 가이드',
      webPreferences: { nodeIntegration: true, contextIsolation: false, spellcheck: false, backgroundThrottling: false },
    });
    ov.setIgnoreMouseEvents(true);
    ov.loadFile(path.join(__dirname, 'renderer', 'guide.html'));
    ov.webContents.on('did-finish-load', () => { ovReady = true; ovPlace(); try { win.webContents.send('ov:ready'); } catch {} });
    ov.webContents.on('render-process-gone', () => { ovReady = false; try { win.webContents.send('ov:lost'); } catch {} });
    ov.on('closed', () => { ov = null; ovReady = false; });
    return ov;
  }
  function ovPlace() {
    if (!ov || ov.isDestroyed() || !win || win.isDestroyed()) return;
    const visible = ovWant && ovRect && ovRect.width > 4 && win.isVisible() && !win.isMinimized();
    if (!visible) { if (ov.isVisible()) ov.hide(); return; }
    const cb = win.getContentBounds();
    ov.setBounds({ x: Math.round(cb.x + ovRect.x), y: Math.round(cb.y + ovRect.y), width: Math.round(ovRect.width), height: Math.round(ovRect.height) });
    if (!ov.isVisible()) ov.showInactive();
  }
  ipcMain.on('ov:rect', (_e, r) => { ovRect = r; ovCreate(); ovPlace(); });
  ipcMain.on('ov:show', (_e, on) => { ovWant = !!on; if (ovWant) ovCreate(); ovPlace(); });
  ipcMain.on('ov:draw', (_e, d) => { try { if (ov && !ov.isDestroyed() && ovReady) ov.webContents.send('ov:draw', d); } catch {} });

  // ---------------------------------------------------------------- 미니 오버레이 (최소화했을 때)
  let mini = null, miniState = null, miniTimer = null;
  let miniCfg = { on: true, platforms: ['chzzk', 'youtube', 'soop'], opacity: 30, count: 5 };
  const recentChats = [];                       // 오버레이에 바로 보여줄 최근 채팅
  const miniPosFile = path.join(app.getPath('userData'), 'mini-overlay.json');
  const miniSend = (ch, d) => { try { if (mini && !mini.isDestroyed()) mini.webContents.send(ch, d); } catch {} };
  function miniCreate() {
    if (mini && !mini.isDestroyed()) return mini;
    let pos = null; try { pos = JSON.parse(fs.readFileSync(miniPosFile, 'utf8')); } catch {}
    const W = 340, H = 248;
    const disp = pos ? screen.getDisplayMatching({ x: pos.x, y: pos.y, width: W, height: H }) : screen.getDisplayMatching(win && !win.isDestroyed() ? win.getBounds() : screen.getPrimaryDisplay().bounds);
    const wa = disp.workArea;
    const inside = pos && pos.x >= wa.x - W + 40 && pos.x <= wa.x + wa.width - 40 && pos.y >= wa.y && pos.y <= wa.y + wa.height - 40;
    mini = new BrowserWindow({
      width: W, height: H, x: inside ? pos.x : wa.x + wa.width - W - 16, y: inside ? pos.y : wa.y + wa.height - H - 16,
      frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, backgroundColor: '#00000000', title: 'Streamy Kit 미니',
      webPreferences: { nodeIntegration: true, contextIsolation: false, spellcheck: false, backgroundThrottling: false },
    });
    mini.setAlwaysOnTop(true, 'screen-saver');
    mini.loadFile(path.join(__dirname, 'renderer', 'mini.html'));
    mini.webContents.on('did-finish-load', () => { miniSend('mini:config', miniCfg); if (miniState) miniSend('mini:state', miniState); miniSend('chat:messages', recentChats.slice(-20)); });
    mini.webContents.on('will-navigate', (e) => e.preventDefault());
    mini.on('moved', () => { try { const b = mini.getBounds(); fs.writeFileSync(miniPosFile, JSON.stringify({ x: b.x, y: b.y })); } catch {} });
    mini.on('closed', () => { mini = null; });
    return mini;
  }
  function miniShow() { const m = miniCreate(); if (m.webContents.isLoading()) m.once('ready-to-show', () => m.showInactive()); else m.showInactive(); }
  function miniHide() { if (mini && !mini.isDestroyed() && mini.isVisible()) mini.hide(); }
  ipcMain.on('mini:config', (_e, c) => { miniCfg = { ...miniCfg, ...c }; miniSend('mini:config', miniCfg); if (!miniCfg.on && win && win.isMinimized()) miniHide(); });
  ipcMain.on('mini:state', (_e, st) => { miniState = st; if (mini && mini.isVisible()) miniSend('mini:state', st); });
  ipcMain.on('mini:toggle', () => { if (mini && !mini.isDestroyed() && mini.isVisible()) miniHide(); else miniShow(); });
  ipcMain.on('mini:restore', () => { miniHide(); if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  ipcMain.on('mini:hide', () => miniHide());

  // ---------------------------------------------------------------- 통합 채팅
  const chat = require('./chat');
  chat.init({ net, log, send: (ch, d) => {
    try { if (win && !win.isDestroyed()) win.webContents.send(ch, d); } catch {}
    if (ch === 'chat:messages') { recentChats.push(...d.filter((m) => !m.recent)); if (recentChats.length > 60) recentChats.splice(0, recentChats.length - 60); miniSend(ch, d); }
  } });
  const chatLogDir = path.join(app.getPath('documents'), 'Streamy Kit', '채팅 로그');
  ipcMain.handle('chat:log', (_e, c = {}) => chat.setLog({ on: !!c.on, dir: chatLogDir }));
  ipcMain.handle('chat:log-open', () => { try { fs.mkdirSync(chatLogDir, { recursive: true }); } catch {} shell.openPath(chatLogDir); return chatLogDir; });
  // 녹화 폴더 열기 (녹화 폴더 안쪽만)
  ipcMain.handle('rec:open', (_e, sub) => {
    const base = path.join(app.getPath('videos'), 'Streamy Kit');
    let target = base;
    if (sub) { const t = path.resolve(String(sub)); if (t === base || t.startsWith(base + path.sep)) target = t; }
    try { fs.mkdirSync(target, { recursive: true }); } catch {}
    shell.openPath(target); return target;
  });
  ipcMain.handle('chat:configure', (_e, ch) => chat.configure(ch));
  ipcMain.handle('chat:kick', () => { chat.kick(); return true; });
  // 채팅창 webview 안전장치: Node 끄기, 새 창은 기본 브라우저로
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (_ev, prefs, params) => {
      delete prefs.preload; prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
      if (!/^https:\/\//.test(params.src || '')) _ev.preventDefault();
    });
    if (wc.getType() === 'webview') {
      wc.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    }
  });

  // ---------------------------------------------------------------- VTube Studio
  vts.init({ app, log, shell, getWindows: () => winLast || [], send: (ch, d) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, d); } catch {} } });
  const vtsCall = (fn) => async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: e.message }; } };
  ipcMain.handle('vts:status', () => vts.status());
  ipcMain.handle('vts:connect', vtsCall(() => vts.connect()));
  ipcMain.handle('vts:disconnect', vtsCall(() => vts.disconnect()));
  ipcMain.handle('vts:launch', vtsCall(() => vts.launch()));
  ipcMain.handle('vts:running', () => vts.isRunning());
  ipcMain.handle('vts:models', vtsCall(() => vts.models()));
  ipcMain.handle('vts:load', vtsCall((id) => vts.loadModel(id)));
  ipcMain.handle('vts:hotkeys', vtsCall(() => vts.hotkeys()));
  ipcMain.handle('vts:trigger', vtsCall((id) => vts.trigger(id)));
  ipcMain.handle('vts:expressions', vtsCall(() => vts.expressions()));
  ipcMain.handle('vts:expression', vtsCall((f, on) => vts.setExpression(f, on)));
  ipcMain.handle('vts:move', vtsCall((p) => vts.move(p)));
  ipcMain.handle('vts:model', vtsCall(() => vts.refreshModel()));
  ipcMain.handle('vts:port', vtsCall((p) => vts.setPort(p)));
  ipcMain.handle('vts:forget', vtsCall(() => vts.forget()));

  // ---------------------------------------------------------------- 방송 정보 (치지직 · 유튜브 제목/태그/설명/카테고리)
  const bc = require('./broadcast');
  bc.init({ app, net, log, shell, safeStorage, send: (ch, d) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, d); } catch {} } });
  server.onOAuth((which, q) => bc.onCallback(which, q));
  ipcMain.handle('bc:status', () => bc.status());
  ipcMain.handle('bc:set-app', vtsCall((p, a) => bc.setApp(p, a)));
  ipcMain.handle('bc:login', vtsCall((p) => bc.login(p)));
  ipcMain.handle('bc:logout', vtsCall((p) => bc.logout(p)));
  ipcMain.handle('bc:chzzk-categories', vtsCall((q) => bc.chzzkCategories(q)));
  ipcMain.handle('bc:chzzk-get', vtsCall(() => bc.chzzkGet()));
  ipcMain.handle('bc:youtube-get', vtsCall(() => bc.youtubeGet()));
  ipcMain.handle('bc:apply', vtsCall((info, targets) => bc.apply(info, targets)));
  ipcMain.handle('bc:focus', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });

  const updater = require('./updater');
  updater.init({ app, log, net, send: (ch, d) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, d); } catch {} } });
  ipcMain.handle('update:check', () => updater.check(true));
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:folder', () => { const d = updater.folder(); if (d) shell.openPath(d); return d; });
  ipcMain.handle('update:install', async () => {
    // 설치 파일을 조용히 실행(끝나면 Streamy Kit 다시 켜짐) → 화면이 엔진 정리 후 종료
    if (updater.isPatch()) { log.info('main', 'quick update → relaunch'); app.relaunch(); }   // 빠른 업데이트: 다시 켜기만 하면 적용
    else await updater.launchInstaller();     // 설치 파일: 윈도우 허용 창에서 "예"를 눌러야 넘어감. 실패하면 앱은 그대로
    try { win.webContents.send('app:quit-for-update'); } catch {}
    setTimeout(() => forceQuit('update install'), 8000);
    return true;
  });

  // ---------------------------------------------------------------- IPC
  // 포인트 색에 맞춘 아이콘 (화면에서 그려서 보내 줌, 다음 실행 때도 그 색으로 시작)
  ipcMain.on('app:icon', (_e, dataUrl) => {
    try {
      const img = nativeImage.createFromDataURL(String(dataUrl)); if (img.isEmpty()) return;
      if (win && !win.isDestroyed()) win.setIcon(img);
      if (tray) tray.setImage(img.resize({ width: 32, height: 32 }));
      fs.writeFileSync(path.join(app.getPath('userData'), 'app-icon.png'), img.toPNG());
    } catch {}
  });
  // 스트림 키 같은 비밀 값: 윈도우 보안 저장(safeStorage)으로 암호화 → 이 PC · 이 계정에서만 풀림
  ipcMain.on('secret:enc', (e, txt) => {
    try { e.returnValue = safeStorage.isEncryptionAvailable() ? 'e:' + safeStorage.encryptString(String(txt)).toString('base64') : null; } catch { e.returnValue = null; }
  });
  ipcMain.on('secret:dec', (e, b) => {
    try { e.returnValue = String(b || '').startsWith('e:') ? safeStorage.decryptString(Buffer.from(String(b).slice(2), 'base64')) : null; } catch { e.returnValue = null; }
  });
  ipcMain.on('app:info', (e) => {
    e.returnValue = {
      osnDir: osnDir(),
      dataDir: path.join(app.getPath('userData'), 'engine'),
      settingsFile: path.join(app.getPath('userData'), 'settings.json'),
      recordDir: path.join(app.getPath('videos'), 'Streamy Kit'),
      logDir: log.dir(),
      version: app.getVersion(),
      baseVersion: (global.STREAMY && global.STREAMY.baseVersion) || app.getVersion(),
      patch: (global.STREAMY && global.STREAMY.patch) || null,
      timerUrl: server.url('/overlay/timer'),
      platform: process.platform,
      gpuOff: fs.existsSync(GPU_OFF_FLAG),
    };
  });
  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:toggle-max', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
  ipcMain.on('win:close', () => win && win.close());
  ipcMain.on('audio-sessions:start', startAudioSessions);
  ipcMain.on('audio-sessions:stop', stopAudioSessions);
  ipcMain.on('windows:get', (e) => { e.returnValue = winLast || []; });
  ipcMain.on('app:window-handle', (e) => { e.returnValue = win.getNativeWindowHandle(); });
  // 엔진 시작 전에 지난번에 남은 엔진 프로세스부터 정리
  ipcMain.handle('engine:prepare', async () => { if (!enginePrepared) enginePrepared = killOwnEngine('startup'); await enginePrepared; return true; });
  ipcMain.on('app:quit-cancelled', () => { clearTimeout(quitAskT); });
  ipcMain.on('app:quitting', () => {
    // 사용자가 종료를 확정함 → 창부터 숨기고, 화면이 엔진을 정리할 시간을 8초 줌
    clearTimeout(quitAskT);
    try { if (win && !win.isDestroyed()) win.hide(); } catch {}
    setTimeout(() => forceQuit('engine shutdown timeout'), 8000);
  });
  ipcMain.on('app:ready-to-quit', async () => {
    if (quitting) return;
    quitting = true;
    stopAudioSessions(); stopWinWatch();
    try { chat.flushLog(); chat.stopAll(); } catch {}
    try { if (mini && !mini.isDestroyed()) mini.destroy(); } catch {}
    try { if (ov && !ov.isDestroyed()) ov.destroy(); } catch {}
    await killOwnEngine('after shutdown');
    log.info('main', 'quit');
    app.exit(0);
  });
  ipcMain.on('app:relaunch', async () => { log.warn('main', 'relaunch requested'); quitting = true; await killOwnEngine('relaunch'); app.relaunch(); app.exit(0); });
  ipcMain.on('crumb', (_e, a) => { crumbs.push({ t: Date.now(), a: String(a).slice(0, 80) }); if (crumbs.length > 30) crumbs.shift(); });
  ipcMain.on('log', (_e, level, ...args) => (log[level] || log.info)('renderer', ...args));
  ipcMain.handle('app:set-gpu', (_e, off) => { try { if (off) fs.writeFileSync(GPU_OFF_FLAG, '1'); else fs.rmSync(GPU_OFF_FLAG, { force: true }); } catch {} return fs.existsSync(GPU_OFF_FLAG); });
  ipcMain.handle('app:confirm', async (_e, { title, message, detail, buttons }) => {
    const r = await dialog.showMessageBox(win, { type: 'question', title, message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });
    return r.response;
  });
  // 화면 꾸미기: 사용자가 가져온 글꼴 파일 → 내 폴더(userData/fonts)로 복사
  ipcMain.handle('app:pick-font', async () => {
    const r = await dialog.showOpenDialog(win, { title: '글꼴 파일 고르기', properties: ['openFile', 'multiSelections'], filters: [{ name: '글꼴', extensions: ['ttf', 'otf', 'woff', 'woff2'] }] });
    if (r.canceled) return [];
    const dir = path.join(app.getPath('userData'), 'fonts'); fs.mkdirSync(dir, { recursive: true });
    return r.filePaths.map((f) => { const dst = path.join(dir, path.basename(f)); try { fs.copyFileSync(f, dst); } catch { return null; } return { file: dst, family: path.basename(f).replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_](Regular|Medium|Bold|Light|R|M|B)$/i, '') }; }).filter(Boolean);
  });
  ipcMain.handle('app:remove-font', async (_e, file) => {
    try { const dir = path.join(app.getPath('userData'), 'fonts'); if (file && path.dirname(file) === dir) fs.unlinkSync(file); } catch {}
    return true;
  });
  // 모니터 목록: 엔진에 물어보면(임시 소스 만들기) 일부 PC에서 엔진이 죽어서, 윈도우에서 직접 읽음 (OBS 모니터 캡처 ID 형식 그대로)
  let monCache = null;
  function loadMonitors() {
    if (process.platform !== 'win32') return;
    try {
      const cp = require('child_process');
      cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'monitors.ps1')], { windowsHide: true, timeout: 15000 }, (err, out) => {
        if (err) { log.warn('monitors', String(err.message || err).slice(0, 300)); return; }
        try { monCache = JSON.parse(String(out).trim()).sort((a, b) => a.x - b.x || a.y - b.y); log.info('monitors', monCache.map((m) => `${m.w}x${m.h}@${m.x},${m.y}${m.primary ? '*' : ''}`).join(' ')); } catch (e) { log.warn('monitors', 'parse', String(out).slice(0, 200)); }
      });
    } catch (e) { log.warn('monitors', String(e)); }
  }
  loadMonitors();
  app.whenReady().then(() => { try { screen.on('display-added', loadMonitors); screen.on('display-removed', loadMonitors); } catch {} });
  ipcMain.on('app:displays', (e) => {
    if (monCache && monCache.length) { e.returnValue = monCache.map((m, i) => ({ i, id: m.id, name: m.name, primary: m.primary, w: m.w, h: m.h })); return; }
    try {
      const pri = screen.getPrimaryDisplay().id;
      e.returnValue = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
        .map((d, i) => ({ i, id: null, primary: d.id === pri, w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) }));
    } catch { e.returnValue = []; }
  });
  ipcMain.handle('app:pick-image', async () => {
    const r = await dialog.showOpenDialog(win, { title: '이미지 고르기', properties: ['openFile'], filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  // 통합 시청자: 플랫폼별 현재 시청자 수 (방송 중이 아니면 null)
  ipcMain.handle('viewers:fetch', async (_e, ids = {}) => {
    const out = {};
    if (ids.chzzk && /^[0-9a-f]{32}$/i.test(ids.chzzk)) {
      try {
        const r = await net.fetch(`https://api.chzzk.naver.com/service/v2/channels/${ids.chzzk}/live-detail`, { headers: { 'User-Agent': 'Mozilla/5.0 StreamyKit' } });
        const c = (await r.json())?.content;
        out.chzzk = c && c.status === 'OPEN' ? Number(c.concurrentUserCount) || 0 : null;
      } catch { out.chzzk = null; }
    }
    return out;
  });
  ipcMain.handle('app:open-path', (_e, p) => shell.openPath(p));
  ipcMain.handle('app:open-url', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });
  ipcMain.handle('timer:action', (_e, a) => { server.applyAction(a); return true; });

  // ---------------------------------------------------------------- 앱 수명
  app.on('second-instance', () => { log.info('main', 'second-instance → focus'); showWindow(); });
  app.on('child-process-gone', (_e, d) => {
    log.error('main', 'child process gone', d);
    if (d.type === 'GPU' && d.reason !== 'clean-exit' && ++gpuCrashes >= 2 && !fs.existsSync(GPU_OFF_FLAG)) {
      try { fs.writeFileSync(GPU_OFF_FLAG, '1'); log.warn('main', 'GPU crashed twice → hardware acceleration will be off next start'); } catch {}
    }
  });
  process.on('uncaughtException', (e) => log.error('main', 'uncaught', e));
  process.on('unhandledRejection', (e) => log.error('main', 'unhandled rejection', e));

  app.whenReady().then(() => {
    enginePrepared = killOwnEngine('startup');   // 창 띄우는 동안 병렬로 정리
    try { server.start(); } catch (e) { log.error('main', 'server', e); }
    createWindow();
    createTray();
    setTimeout(() => { try { updater.cleanupLocal(); } catch {} updater.check(false); }, 5000);
    setTimeout(startWinWatch, 1500);                   // 켜져 있는 프로그램 창 목록 도우미
    setInterval(() => updater.check(false), 5 * 60 * 1000);   // 이후 5분마다 GitHub 릴리즈 확인 (폴더는 파일이 들어오면 바로 감지)
  });
  app.on('window-all-closed', () => { if (!quitting) forceQuit('all windows closed'); });
}
