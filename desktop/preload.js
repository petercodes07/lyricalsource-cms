const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('workspace', {
  get: () => ipcRenderer.invoke('workspace:get'),
  connect: value => ipcRenderer.invoke('workspace:connect', value)
});
