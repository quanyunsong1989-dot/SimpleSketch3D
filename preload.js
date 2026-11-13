// 화면 쪽에서 쓸 수 있는 PC 기능 (파일 열기·저장 등)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  openDialog: (o) => ipcRenderer.invoke('open-dialog', o),
  saveDialog: (o) => ipcRenderer.invoke('save-dialog', o),
  readFile: (p, enc) => ipcRenderer.invoke('read-file', p, enc),
  writeFile: (p, d) => ipcRenderer.invoke('write-file', p, d),
  userData: () => ipcRenderer.invoke('user-data'),
  testScript: () => ipcRenderer.invoke('test-script'),
  capture: (f) => ipcRenderer.invoke('capture', f),
  testLog: (s) => ipcRenderer.send('test-log', s),
  testDone: () => ipcRenderer.send('test-done'),
  forceClose: () => ipcRenderer.send('force-close'),
  setTitle: (t) => ipcRenderer.send('set-title', t),
  toggleDevTools: () => ipcRenderer.send('devtools'),
  setZoom: (f) => ipcRenderer.send('set-zoom', f),
  relaunch: () => ipcRenderer.send('relaunch'),
  skpAvailable: () => ipcRenderer.invoke('skp-available'),
  skpRead: (p) => ipcRenderer.invoke('skp-read', p),
  skpWrite: (p, scene, ver) => ipcRenderer.invoke('skp-write', p, scene, ver),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (e, p) => cb(p)),
  onCloseRequest: (cb) => ipcRenderer.on('close-request', () => cb()),
});
