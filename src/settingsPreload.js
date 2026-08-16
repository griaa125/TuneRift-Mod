const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listAddons: () => ipcRenderer.invoke('addons:list'),
  toggleAddon: (id, enabled) => ipcRenderer.invoke('addons:toggle', id, enabled),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value)
});
