const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const path = require('node:path');
const { sameWorkspace, externalUrl } = require('./policy');
const { startupWorkspace } = require('./workspace');
let workspace, origin;
const preferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };
async function openExternal(url) {
  if (!externalUrl(url)) return;
  const answer = await dialog.showMessageBox({ type: 'question', buttons: ['Cancel', 'Open browser'], defaultId: 0, cancelId: 0, message: 'Open an external page?', detail: url });
  if (answer.response === 1) await shell.openExternal(url);
}
function openWorkspace(url) {
  origin = url;
  if (workspace && !workspace.isDestroyed()) { workspace.focus(); return; }
  workspace = new BrowserWindow({ width: 1320, height: 900, minWidth: 700, minHeight: 560, title: 'LyricalSource CMS', backgroundColor: '#f3f5f1', icon: path.join(__dirname, 'icons/icon.png'), webPreferences: { ...preferences, partition: `persist:workspace-${Buffer.from(origin).toString('hex')}` } });
  const win = workspace;
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  const restrict = (event, target) => { if (!sameWorkspace(target, origin)) event.preventDefault(); };
  win.webContents.on('will-navigate', restrict);
  win.webContents.on('will-redirect', restrict);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameWorkspace(url, origin)) win.loadURL(url).catch(() => {});
    else openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('did-fail-load', async (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3 || win.isDestroyed()) return;
    const answer = await dialog.showMessageBox(win, { type: 'error', message: 'Workspace unavailable', detail: 'LyricalSource could not be reached. Check your internet connection and try again.', buttons: ['Retry', 'Close'], cancelId: 1, defaultId: 0 });
    if (win.isDestroyed()) return;
    if (answer.response === 0) win.loadURL(origin).catch(() => {}); else win.close();
  });
  win.on('closed', () => { workspace = null; });
  win.loadURL(origin).catch(() => {});
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const win = workspace; if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'Workspace', submenu: [{ label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => workspace?.webContents.reload() }, { role: 'close' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
      { label: 'Help', submenu: [{ label: 'About LyricalSource CMS', click: () => dialog.showMessageBox({ type: 'info', message: 'LyricalSource CMS', detail: `Version ${app.getVersion()}\nConnected to the shared LyricalSource CMS.\nUpdates are installed manually from the latest release.` }) }, { label: 'Check for updates', click: () => shell.openExternal('https://github.com/petercodes07/lyricalsource-cms/releases/latest') }] }
    ]));
    openWorkspace(startupWorkspace({ packaged: app.isPackaged, args: process.argv }));
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) openWorkspace(origin || startupWorkspace({ packaged: app.isPackaged, args: process.argv })); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
