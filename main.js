// SimpleSketch 3D 창 (Electron 메인)
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 예전 이름(스케치3D, 1.4까지)의 설정·최근 파일·자동 저장 폴더를 새 이름 폴더로 한 번 옮겨 옴
try {
  const now = app.getPath('userData'), old = path.join(app.getPath('appData'), '스케치3D');
  if (!fs.existsSync(now) && fs.existsSync(old)) fs.cpSync(old, now, { recursive: true });
} catch (e) { /* */ }

let win = null;
let rwin = null;          // 렌더링 창
let rPayload = null;      // 렌더링 창에 넘길 장면 (창이 받아 가면 비움)
let allowClose = false;
let quitting = false;
app.on('before-quit', () => { quitting = true; });
const argVal = (name) => { const a = process.argv.find((x) => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
// 공개판(build.js --public)은 시험 스크립트 기능을 끈다 (아무 스크립트나 앱 안에서 돌릴 수 없게)
const PUBLIC = (() => { try { return !!require('./package.json').public; } catch (e) { return false; } })();
const testFile = PUBLIC ? null : argVal('test');
const testLog = argVal('test-log');
const fileArg = (argv) => argv.slice(1).find((a) => /\.(s3d|skp)$/i.test(a) && fs.existsSync(a));

if (!testFile && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const f = fileArg(argv);
  if (f) win.webContents.send('open-path', f);
});

function log(s) { if (testLog) fs.appendFileSync(testLog, s + '\n'); }

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 900, minHeight: 600,
    title: 'SimpleSketch 3D', backgroundColor: '#eceef1', show: false,
    icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'), testFile ? { query: { lang: argVal('lang') || 'ko' } } : undefined);   // 시험은 한국어 화면으로 (--lang=en 등으로 바꿈)
  win.once('ready-to-show', () => { if (!testFile) win.maximize(); win.show(); });
  win.on('close', (e) => {
    if (allowClose || testFile) return;
    e.preventDefault();
    win.webContents.send('close-request');
  });
  win.webContents.on('did-finish-load', () => {
    const f = fileArg(process.argv);
    if (f) win.webContents.send('open-path', f);
  });
  win.webContents.on('console-message', (e, level, msg, line, src) => log(`[console ${level}] ${msg} (${(src || '').split('/').pop()}:${line})`));
  win.webContents.on('render-process-gone', (e, d) => log('[gone] ' + JSON.stringify(d)));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.on('closed', () => { win = null; if (rwin) rwin.destroy(); });
}

// 렌더링 창: 모델 창이 만든 장면을 받아 사진처럼 그린다 (app/render.html). 한 개만 띄우고, 다시 누르면 새 장면으로 바꿈
function openRenderWindow() {
  if (rwin) {
    rwin.webContents.send('render-payload');
    if (!rwin.isVisible()) rwin.show();
    if (rwin.isMinimized()) rwin.restore();
    rwin.focus();
    return;
  }
  const b = win ? win.getBounds() : { x: 80, y: 60, width: 1500, height: 920 };
  const w = Math.min(1360, Math.max(800, b.width - 120)), h = Math.min(900, Math.max(560, b.height - 80));
  // backgroundThrottling: false = 두 창이 서로 가려도 멈추지 않게 (렌더링은 계속 계산하고, 모델 창은 '다시 가져오기'에 바로 답함)
  rwin = new BrowserWindow({
    width: w, height: h, x: Math.round(b.x + (b.width - w) / 2), y: Math.round(b.y + (b.height - h) / 2), minWidth: 640, minHeight: 420,
    title: 'SimpleSketch 3D', backgroundColor: '#2b2d31', show: false,
    icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  rwin.loadFile(path.join(__dirname, 'app', 'render.html'), testFile ? { query: { lang: argVal('lang') || 'ko', test: '1' } } : undefined);
  rwin.once('ready-to-show', () => rwin.show());
  // 닫기 = 숨기기 (다음에 누르면 바로 뜨게). 앱을 끝낼 때만 정말 닫음
  rwin.on('close', (e) => {
    if (quitting || !win) return;
    e.preventDefault();
    rwin.hide();
    rwin.webContents.send('render-hidden');
    win.webContents.send('render-status', { type: 'hidden' });
  });
  rwin.on('closed', () => { rwin = null; rPayload = null; if (win) win.webContents.send('render-status', { type: 'closed' }); });
  rwin.webContents.on('console-message', (e, level, msg, line, src) => log(`[render ${level}] ${msg} (${(src || '').split('/').pop()}:${line})`));
  rwin.webContents.on('render-process-gone', (e, d) => log('[render gone] ' + JSON.stringify(d)));
  rwin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  rwin.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') rwin.webContents.toggleDevTools();
  });
}

// .skp: skp-host.js가 있으면 그걸로 열고 저장 (Trimble 승인 뒤 추가 예정). 없으면 '지원 안 함'으로 답함
try { require('./skp-host.js')(ipcMain); } catch (e) {
  ipcMain.handle('skp-available', () => false);
  ipcMain.handle('skp-read', () => ({ ok: false, error: 'NO_SDK' }));
  ipcMain.handle('skp-write', () => ({ ok: false, error: 'NO_SDK' }));
}

const senderWin = (e) => BrowserWindow.fromWebContents(e.sender) || win;
ipcMain.handle('open-dialog', async (e, o) => { const r = await dialog.showOpenDialog(senderWin(e), { properties: ['openFile'], ...o }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('save-dialog', async (e, o) => { const r = await dialog.showSaveDialog(senderWin(e), o); return r.canceled ? null : r.filePath; });
ipcMain.handle('read-file', async (e, p, enc) => { const b = await fs.promises.readFile(p); return enc ? b.toString(enc) : new Uint8Array(b); });
ipcMain.handle('write-file', async (e, p, data) => { await fs.promises.writeFile(p, typeof data === 'string' ? data : Buffer.from(data)); return true; });
ipcMain.handle('user-data', () => app.getPath('userData'));
ipcMain.handle('test-script', () => (testFile ? fs.readFileSync(testFile, 'utf8') : null));
ipcMain.handle('capture', async (e, file) => { const img = await win.webContents.capturePage(); fs.writeFileSync(file, img.toPNG()); return true; });
ipcMain.on('test-log', (e, s) => log(s));
ipcMain.on('test-done', () => { allowClose = true; app.quit(); });
ipcMain.on('force-close', () => { allowClose = true; win.close(); });
ipcMain.on('set-title', (e, t) => { if (win) win.setTitle(t); });
ipcMain.on('devtools', () => win.webContents.toggleDevTools());
ipcMain.on('relaunch', () => { allowClose = true; app.relaunch(); app.exit(0); });
ipcMain.on('set-zoom', (e, f) => { if (win && f > 0.3 && f < 4) win.webContents.setZoomFactor(f); });
// 렌더링
ipcMain.handle('render-open', (e, p) => { rPayload = p; openRenderWindow(); return true; });
ipcMain.handle('render-payload', () => { const p = rPayload; rPayload = null; return p; });
ipcMain.on('render-refresh', () => { if (win) win.webContents.send('render-request'); });
ipcMain.on('render-status', (e, s) => { log('[render-status] ' + JSON.stringify(s)); if (win) win.webContents.send('render-status', s); });
ipcMain.on('render-cmd', (e, c) => { if (!rwin) return; if (c && c.type === 'close') rwin.close(); else rwin.webContents.send('render-cmd', c); });   // close = 닫기 단추와 같게 (시험용)
ipcMain.on('render-title', (e, t) => { if (rwin) rwin.setTitle(t); });
ipcMain.handle('capture-render', async (e, file) => { if (!rwin) return false; const img = await rwin.webContents.capturePage(); fs.writeFileSync(file, img.toPNG()); return true; });
// 앱 안의 파일 읽기 (렌더링 창의 노이즈 제거 가중치 등. file:// 은 fetch가 안 됨)
ipcMain.handle('read-app-file', async (e, rel) => {
  const base = path.join(__dirname, 'app'), p = path.resolve(base, rel);
  if (!p.startsWith(base + path.sep)) throw new Error('bad path');
  return new Uint8Array(await fs.promises.readFile(p));
});

app.whenReady().then(() => {
  if (testFile) { const sz = argVal('size'); if (sz) app.commandLine.appendSwitch('force-device-scale-factor', '1'); }
  createWindow();
  if (testFile) {
    const sz = (argVal('size') || '1400x860').split('x').map(Number);
    win.setContentSize(sz[0], sz[1]);
    setTimeout(() => { log('[timeout]'); allowClose = true; app.quit(); }, +(argVal('timeout') || 120000));
  }
});
app.on('window-all-closed', () => app.quit());
