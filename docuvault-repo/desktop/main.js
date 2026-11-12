// DocuVault for Windows: shows the DocuVault app (copied into ./web by the build) in its own window.
// Pages load from app://docuvault, a private secure address, so offline storage works and the app can
// talk to the DocuVault server set in web/config.js. Your offline copy lives in the user's AppData folder.
const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

if (!app.requestSingleInstanceLock()) app.quit();
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 900, minHeight: 600,
    title: 'DocuVault', backgroundColor: '#F9F9FB', autoHideMenuBar: true,
    icon: path.join(__dirname, 'web', 'icons', 'icon-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true }
  });
  win.loadURL('app://docuvault/index.html');
  // Links to other websites open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('app://')) shell.openExternal(url);
    return { action: url.startsWith('app://') ? 'allow' : 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); shell.openExternal(url); } });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  const root = path.join(__dirname, 'web');
  protocol.handle('app', (request) => {
    let rel = decodeURIComponent(new URL(request.url).pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'DocuVault', submenu: [{ role: 'reload', label: 'Reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'quit', label: 'Close DocuVault' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] }
  ]));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
