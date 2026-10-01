const { contextBridge, ipcRenderer } = require('electron');

const allowed = [
  'boost:manual',
  'games:list',
  'games:addDialog',
  'games:capture',
  'games:remove',
  'processes:list',
  'processes:kill',
  'settings:get',
  'settings:save'
];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    if (allowed.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error('channel not allowed'));
  },
  onStats: cb => ipcRenderer.on('stats', (e, p) => cb(p)),
  onLog: cb => ipcRenderer.on('log', (e, p) => cb(p)),
  onBoostState: cb => ipcRenderer.on('boost-state', (e, p) => cb(p))
});