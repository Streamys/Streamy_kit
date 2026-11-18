// Streamy Kit — 메인 프로세스
// 화면(렌더러)이 방송 엔진을 불러오고, 여기서는 창 관리 · 경로 · 로그 · 충돌 복구 · 종료 처리를 맡습니다.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, net, screen, crashReporter } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const log = require('./log');
const server = require('./server');

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
      icon: path.join(__dirname, 'tray.png'),
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
    const show = (why) => { if (shown || !win || win.isDestroyed()) return; shown = true; win.show(); log.info('main', `window shown (${why}) in ${Date.now() - t0}ms`); };
    win.once('ready-to-show', () => show('ready'));
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
        try { const data = JSON.parse(line); if (Array.isArray(data)) { winLast = data; winRetry = 0; } if (win && !win.isDestroyed()) win.webContents.send('windows', data); } catch {}
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
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
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
