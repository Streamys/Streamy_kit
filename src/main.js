// Streamy Kit — 메인 프로세스
// 화면(렌더러)이 방송 엔진을 직접 불러오므로, 여기서는 창 관리·경로·종료 처리만 합니다.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const server = require('./server');

app.setName('Streamy Kit');
app.setAppUserModelId('com.streamy.kit');
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
let tray = null;
let quitting = false;

function osnDir() {
  // 설치본: resources/app/node_modules/obs-studio-node  (asar 미사용)
  const candidates = [
    path.join(app.getAppPath(), 'node_modules', 'obs-studio-node'),
    path.join(process.resourcesPath || '', 'app', 'node_modules', 'obs-studio-node'),
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, 'index.js'))) || candidates[0];
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 880, minWidth: 1180, minHeight: 720,
    title: 'Streamy Kit', backgroundColor: '#0B0B0D', show: false,
    icon: path.join(__dirname, 'tray.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0B0B0D', symbolColor: '#F4F4F5', height: 36 },
    webPreferences: {
      // 방송 엔진(네이티브 모듈)을 화면에서 직접 쓰기 위해 Node 통합 사용. 로컬 파일만 불러옵니다.
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    // 화면 쪽에서 방송 중인지 확인하고 엔진을 정리한 뒤 'app:ready-to-quit'을 보냄
    win.webContents.send('app:request-quit');
    // 화면이 응답하지 않으면 10초 뒤 강제 종료
    setTimeout(() => { if (!quitting) { quitting = true; app.exit(0); } }, 10000);
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('Streamy Kit');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Streamy Kit 열기', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: '종료', click: () => win.close() },
  ]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}

ipcMain.on('app:info', (e) => {
  e.returnValue = {
    osnDir: osnDir(),
    dataDir: path.join(app.getPath('userData'), 'engine'),
    settingsFile: path.join(app.getPath('userData'), 'settings.json'),
    recordDir: path.join(app.getPath('videos'), 'Streamy Kit'),
    version: app.getVersion(),
    timerUrl: server.url('/overlay/timer'),
    platform: process.platform,
  };
});
ipcMain.on('app:window-handle', (e) => { e.returnValue = win.getNativeWindowHandle(); });
ipcMain.on('app:ready-to-quit', () => { quitting = true; app.quit(); });
ipcMain.handle('app:confirm', async (_e, { title, message, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', title, message, buttons, defaultId: 0, cancelId: buttons.length - 1 });
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
      const j = await r.json();
      const c = j && j.content;
      out.chzzk = c && c.status === 'OPEN' ? Number(c.concurrentUserCount) || 0 : null;
    } catch { out.chzzk = null; }
  }
  return out;
});
ipcMain.handle('app:open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('app:open-url', (_e, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });
ipcMain.handle('timer:action', (_e, a) => { server.applyAction(a); return true; });

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(() => {
  server.start();
  createWindow();
  createTray();
});
app.on('window-all-closed', () => app.quit());
