const path = require('path');
const fs = require('fs');
const si = require('systeminformation');
const store = require('./store');
const processes = require('./processes');
const GameMonitor = require('./monitor');

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');

const WIN_ONLY = process.platform === 'win32';
let win = null;
let tray = null;
let monitor = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0d14',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../assets/tray.svg'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.on('closed', () => { win = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/tray.svg');
  if (!fs.existsSync(iconPath)) return;
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('LagZero');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'فتح النافذة', click: () => { if (win) win.show(); } },
    { label: 'تعزيز فوري', click: manualBoost },
    { type: 'separator' },
    { label: 'خروج', click: () => app.quit() }
  ]));
  tray.on('double-click', () => { if (win) win.show(); });
}

async function manualBoost() {
  if (win) win.show();
  return doManualBoost();
}

async function doManualBoost() {
  const result = { killed: 0, trimmed: 0, memoryDeltaMB: null, errors: [] };
  const gameExe = monitor && monitor.game ? monitor.game.exe : '';

  let beforeFree = null;
  try {
    beforeFree = (await si.mem()).free;
  } catch (error) {
    result.errors.push('قياس الذاكرة قبل التنفيذ: ' + error.message);
  }

  try {
    const killResult = await processes.killByName(store.get('killList'), [gameExe]);
    result.killed = killResult.killed;
  } catch (error) {
    result.errors.push('إنهاء عمليات الخلفية: ' + error.message);
  }

  try {
    result.trimmed = await processes.trimWorkingSets([process.pid], [gameExe]);
  } catch (error) {
    result.errors.push('تفريغ ذاكرة العمليات: ' + error.message);
  }

  await new Promise(r => setTimeout(r, 1200));
  if (beforeFree !== null) {
    try {
      const afterFree = (await si.mem()).free;
      result.memoryDeltaMB = Math.round((afterFree - beforeFree) / 1048576);
    } catch (error) {
      result.errors.push('قياس الذاكرة بعد التنفيذ: ' + error.message);
    }
  }

  return result;
}

function setupIpcHandlers() {
  ipcMain.handle('boost:manual', async () => doManualBoost());

  ipcMain.handle('games:list', () => store.get('games'));

  ipcMain.handle('games:addDialog', async () => {
    try {
      const r = await dialog.showOpenDialog(win, {
        title: 'اختيار الملف التنفيذي للعبة',
        filters: [{ name: 'ملفات تنفيذية', extensions: ['exe'] }],
        properties: ['openFile']
      });
      if (r.canceled || !r.filePaths[0]) {
        return { status: 'cancelled', games: store.get('games') };
      }
      const p = r.filePaths[0];
      const games = store.get('games');
      const exe = path.basename(p).toLowerCase();
      if (games.some(g => g.exe === exe)) {
        return { status: 'exists', games };
      }
      games.push({ name: path.basename(p, path.extname(p)), exe: exe, path: p });
      store.set('games', games);
      return { status: 'added', games: store.get('games') };
    } catch (e) {
      console.error('Add game dialog error:', e);
      throw new Error('تعذر فتح نافذة اختيار الملف');
    }
  });

  ipcMain.handle('games:capture', async () => {
    await new Promise(resolve => setTimeout(resolve, 3000));
    let w = null;
    try {
      w = await processes.getActiveWindow();
    } catch (e) {
      w = null;
    }
    const selfExe = path.basename(process.execPath).toLowerCase();
    let exe = null;
    let name = null;
    if (w && w.path) {
      exe = path.basename(w.path).toLowerCase();
      name = path.basename(w.path, path.extname(w.path));
    } else if (w && w.processId) {
      const map = await processes.getPidPaths();
      const p = map.get(w.processId);
      if (p) {
        exe = path.basename(p).toLowerCase();
        name = path.basename(p, path.extname(p));
      }
    }
    const games = store.get('games');
    if (!exe) return { status: 'unavailable', games };
    if (exe === selfExe) return { status: 'self', games };
    if (games.some(g => g.exe === exe)) return { status: 'exists', games };

    games.push({ name: name, exe: exe, path: w && w.path ? w.path : '' });
    store.set('games', games);
    return { status: 'added', games: store.get('games') };
  });

  ipcMain.handle('games:remove', (e, exe) => {
    store.set('games', store.get('games').filter(g => g.exe !== exe));
    return store.get('games');
  });

  ipcMain.handle('processes:list', async () => ({
    list: await processes.listGrouped(),
    protected: Array.from(processes.PROTECTED)
  }));

  ipcMain.handle('processes:kill', async (e, names) => {
    const gameExe = monitor && monitor.game ? monitor.game.exe : '';
    return processes.killByName(names, [gameExe]);
  });

  ipcMain.handle('settings:get', () => store.store);

  ipcMain.handle('settings:save', (e, s) => {
    const keys = [
      'pollMs', 'enableKill', 'enableTrim', 'enableNotifications', 'enableGameDVR',
      'enablePowerPlan', 'enablePriority', 'createUltimate', 'startAtLogin', 'killList'
    ];
    keys.forEach(k => {
      if (k in s) store.set(k, s[k]);
    });
    app.setLoginItemSettings({ openAtLogin: !!store.get('startAtLogin') });
    return store.store;
  });
}

app.whenReady().then(async () => {
  if (!WIN_ONLY) {
    dialog.showErrorBox('نظام غير مدعوم', 'يعمل هذا التطبيق على نظام ويندوز فقط.');
    app.quit();
    return;
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.setAppUserModelId('com.lagzero.app');
  setupIpcHandlers();
  createWindow();
  createTray();
  monitor = new GameMonitor({
    store: store,
    send: (ch, p) => { if (win) win.webContents.send(ch, p); }
  });
  monitor.start();
  app.setLoginItemSettings({ openAtLogin: !!store.get('startAtLogin') });

  let statsInterval = setInterval(async () => {
    if (!win) return;
    try {
      const results = await Promise.all([si.mem(), si.currentLoad()]);
      const mem = results[0];
      const load = results[1];
      win.webContents.send('stats', {
        ramTotalMB: Math.round(mem.total / 1048576),
        ramUsedMB: Math.round(mem.used / 1048576),
        ramUsedPct: Math.round((mem.used / mem.total) * 100),
        cpuPct: Math.round(load.currentLoad)
      });
    } catch (e) {
      console.error('Stats update error:', e);
    }
  }, 2000);

  app.on('window-all-closed', () => {
    clearInterval(statsInterval);
  });
});

app.on('second-instance', () => { if (win) win.show(); });

app.on('before-quit', e => {
  if (monitor && monitor.boosting) {
    e.preventDefault();
    monitor.restoreIfNeeded().finally(() => {
      monitor.stop();
      app.exit(0);
    });
  } else if (monitor) {
    monitor.stop();
  }
});