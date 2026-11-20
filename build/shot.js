// 데모 화면 캡처 (개발 · 검사 전용, 앱에 포함 안 됨)
//   SHOT_OUT=out.png SHOT_JS="openTab('sources');" xvfb-run -a npx electron build/shot.js --no-sandbox
//   - STREAMY_DEMO=1 로 실제 엔진 없이 화면만 띄움 (리눅스 · 맥에서도 됨)
//   - SHOT_JS: 화면에서 실행할 코드. 끝나지 않는 Promise(확인 창 등)는 setTimeout(..)으로 감싸고 끝에 1 을 붙일 것
const { app } = require('electron');
const path = require('path');
process.env.STREAMY_DEMO = '1';
let win;
app.on('browser-window-created', (_e, w) => {
  if (win) return; win = w;
  w.webContents.once('did-finish-load', () => setTimeout(async () => {
    if (process.env.SHOT_JS) { await w.webContents.executeJavaScript(process.env.SHOT_JS).catch((e) => console.log('js', e.message)); await new Promise((r) => setTimeout(r, 800)); }
    const img = await w.webContents.capturePage();
    require('fs').writeFileSync(process.env.SHOT_OUT || 'shot.png', img.toPNG());
    app.exit(0);
  }, 3500));
});
require(path.resolve(__dirname, '..', 'src', 'main.js'));
