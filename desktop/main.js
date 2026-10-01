const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { workspaceUrl, sameWorkspace, externalUrl } = require('./policy');
const demo = !app.isPackaged && process.argv.includes('--demo');
const sshWorkspace = !app.isPackaged && process.argv.includes('--ssh-workspace');
let workspace, setup, origin;
const setupFile = path.join(__dirname, 'setup.html');
const setupUrl = pathToFileURL(setupFile).href;
const configFile = () => path.join(app.getPath('userData'), 'workspace.json');
const preferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };
function showSetup() {
  if (setup && !setup.isDestroyed()) { setup.focus(); return; }
  setup = new BrowserWindow({ width: 620, height: 560, minWidth: 480, minHeight: 500, title: 'Connect your workspace — LyricalSource CMS', backgroundColor: '#f3f5f1', webPreferences: { ...preferences, preload: path.join(__dirname, 'preload.js') } });
  setup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  setup.webContents.on('will-navigate', event => event.preventDefault());
  setup.on('closed', () => { setup = null; });
  setup.loadFile(setupFile);
}
async function openExternal(url) {
  if (!externalUrl(url)) return;
  const answer = await dialog.showMessageBox({ type: 'question', buttons: ['Cancel', 'Open browser'], defaultId: 0, cancelId: 0, message: 'Open an external page?', detail: url });
  if (answer.response === 1) await shell.openExternal(url);
}
function openWorkspace(url) {
  origin = url;
  if (workspace && !workspace.isDestroyed()) { workspace.focus(); return; }
  workspace = new BrowserWindow({ width: 1320, height: 900, minWidth: 700, minHeight: 560, title: sshWorkspace ? 'LyricalSource CMS — SSH workspace' : 'LyricalSource CMS', backgroundColor: '#f3f5f1', icon: path.join(__dirname, 'icons/icon.png'), webPreferences: { ...preferences, partition: `persist:workspace-${Buffer.from(origin).toString('hex')}` } });
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
    const answer = await dialog.showMessageBox(win, { type: 'error', message: 'Workspace unavailable', detail: 'Check your internet connection and workspace address. No changes have been submitted by this retry.', buttons: ['Retry', 'Connection settings'], defaultId: 0 });
    if (win.isDestroyed()) return;
    if (answer.response === 0) win.loadURL(origin).catch(() => {}); else showSetup();
  });
  win.on('closed', () => { workspace = null; });
  win.loadURL(origin).catch(() => {});
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const win = workspace || setup; if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ipcMain.handle('workspace:get', event => {
      if (event.sender !== setup?.webContents || event.senderFrame !== setup.webContents.mainFrame || event.senderFrame.url !== setupUrl) throw new Error('Not allowed');
      return { url: origin || '', demo };
    });
    ipcMain.handle('workspace:connect', async (event, value) => {
      if (event.sender !== setup?.webContents || event.senderFrame !== setup.webContents.mainFrame || event.senderFrame.url !== setupUrl) throw new Error('Not allowed');
      try {
        const url = workspaceUrl(value, demo || sshWorkspace);
        if (workspace && !workspace.isDestroyed()) {
          const answer = await dialog.showMessageBox(setup, { type: 'question', buttons: ['Cancel', 'Switch workspace'], defaultId: 0, message: 'Switch workspace?', detail: 'Save your edits first. This closes the current workspace window.' });
          if (answer.response !== 1) return { error: 'Workspace unchanged.' };
          workspace.close();
          if (workspace && !workspace.isDestroyed()) return { error: 'Close or save the current editor before switching.' };
        }
        if (!demo && !sshWorkspace) fs.writeFileSync(configFile(), JSON.stringify({ url }), { mode: 0o600 });
        openWorkspace(url);
        setup.close();
        return { ok: true };
      } catch (error) { return { error: error.message }; }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'Workspace', submenu: [{ label: 'Connection settings', click: showSetup }, { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => workspace?.webContents.reload() }, { role: 'close' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
    ]));
    if (demo || sshWorkspace) openWorkspace('http://127.0.0.1:3100');
    else {
      try { origin = workspaceUrl(JSON.parse(fs.readFileSync(configFile(), 'utf8')).url); openWorkspace(origin); }
      catch { showSetup(); }
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) origin ? openWorkspace(origin) : showSetup(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
