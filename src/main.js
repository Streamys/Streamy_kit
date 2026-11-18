// Streamy Kit — 메인 프로세스
// 화면(렌더러)이 방송 엔진을 불러오고, 여기서는 창 관리 · 경로 · 로그 · 충돌 복구 · 종료 처리를 맡습니다.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const log = require('./log');
const server = require('./server');

app.setName('Streamy Kit');
app.setAppUserModelId('com.streamy.kit');
log.init(path.join(app.getPath('userData'), 'logs'));
log.info('main', `start v${app.getVersion()} electron ${process.versions.electron} pid ${process.pid}`);

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
      },
    });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    // 화면이 그려지면 바로 보여줌. 혹시 늦어도 2초 뒤엔 무조건 보여줌 (로딩 화면이 먼저 그려짐)
    let shown = false;
    const show = (why) => { if (shown || !win || win.isDestroyed()) return; shown = true; win.show(); log.info('main', `window shown (${why}) in ${Date.now() - t0}ms`); };
    win.once('ready-to-show', () => show('ready'));
    setTimeout(() => show('timeout'), 2000);

    const sendMax = () => { try { win.webContents.send('win:maximized', win.isMaximized()); } catch {} };
    win.on('maximize', sendMax); win.on('unmaximize', sendMax);
    win.on('closed', () => { stopAudioSessions(); win = null; });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    // 화면 프로세스가 죽으면: 엔진 정리 후 자동으로 다시 띄움
    win.webContents.on('render-process-gone', async (_e, d) => {
      log.error('main', 'renderer gone', d);
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
    stopAudioSessions();
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
  const updater = require('./updater');
  updater.init({ app, log, net, send: (ch, d) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, d); } catch {} } });
  ipcMain.handle('update:check', () => updater.check(true));
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', async () => {
    // 설치 파일을 조용히 실행(끝나면 Streamy Kit 다시 켜짐) → 화면이 엔진 정리 후 종료
    updater.launchInstaller();
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
    stopAudioSessions();
    await killOwnEngine('after shutdown');
    log.info('main', 'quit');
    app.exit(0);
  });
  ipcMain.on('app:relaunch', async () => { log.warn('main', 'relaunch requested'); quitting = true; await killOwnEngine('relaunch'); app.relaunch(); app.exit(0); });
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
    setTimeout(() => updater.check(false), 8000);            // 켜고 8초 뒤 한 번
    setInterval(() => updater.check(false), 6 * 3600 * 1000); // 이후 6시간마다
  });
  app.on('window-all-closed', () => { if (!quitting) forceQuit('all windows closed'); });
}
