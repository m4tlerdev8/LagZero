const os = require('os');
const { runCmd } = require('./powershell');
const reg = require('./registry');
const sudo = require('sudo-prompt');

const KEYS = {
  toast: ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', 'ToastEnabled'],
  noc: ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings', 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'],
  qh: ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\QuietHours', 'Enabled'],
  dvr1: ['HKCU\\System\\GameConfigStore', 'GameDVR_Enabled'],
  dvr2: ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', 'AppCaptureEnabled']
};

function isWin11() {
  const parts = os.release().split('.');
  return parseInt(parts[2] || '0', 10) >= 22000;
}

async function blockNotifications() {
  const values = { toast: 0, noc: 0 };
  if (!isWin11()) values.qh = 1;
  return applyDwordChanges(values);
}

async function disableGameDVR() {
  return applyDwordChanges({ dvr1: 0, dvr2: 0 });
}

async function restoreBackup(backup) {
  if (!backup) return;
  const failures = [];
  for (const name of Object.keys(backup)) {
    if (!KEYS[name]) continue;
    const b = backup[name];
    let result;
    if (b.existed) {
      result = await reg.addDword(KEYS[name][0], KEYS[name][1], b.val);
    } else {
      result = await reg.deleteValue(KEYS[name][0], KEYS[name][1]);
    }
    if (!result.ok) failures.push(name);
  }
  if (failures.length) throw new Error('تعذرت استعادة إعدادات النظام: ' + failures.join(', '));
}

async function applyDwordChanges(values) {
  const names = Object.keys(values);
  const backup = {};
  for (const name of names) {
    backup[name] = await reg.queryDword(KEYS[name][0], KEYS[name][1]);
  }

  const applied = [];
  try {
    for (const name of names) {
      applied.push(name);
      const result = await reg.addDword(KEYS[name][0], KEYS[name][1], values[name]);
      if (!result.ok) throw new Error(result.err || 'تعذر تحديث إعداد النظام');
    }
  } catch (error) {
    if (applied.length) {
      const partialBackup = Object.fromEntries(applied.map(name => [name, backup[name]]));
      try {
        await restoreBackup(partialBackup);
      } catch (restoreError) {
        throw new Error(error.message + '; ' + restoreError.message);
      }
    }
    throw error;
  }

  return backup;
}

const HIGH_PERF = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
const GUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function sudoExec(cmd) {
  return new Promise(resolve => {
    sudo.exec(cmd, { name: 'LagZero' }, err => resolve(!err));
  });
}

async function getActiveScheme() {
  const r = await runCmd('powercfg', ['/getactivescheme']);
  const m = r.out.match(GUID_RX);
  return m ? m[0] : null;
}

async function listSchemes() {
  const r = await runCmd('powercfg', ['/list']);
  return r.out
    .split('\n')
    .map(line => {
      const g = line.match(GUID_RX);
      if (!g) return null;
      return { guid: g[0], name: line.slice(line.indexOf(g[0]) + 37).trim() };
    })
    .filter(Boolean);
}

async function setScheme(guid) {
  let r = await runCmd('powercfg', ['/setactive', guid]);
  if (!r.ok) {
    r = { ok: await sudoExec('powercfg /setactive ' + guid) };
  }
  return r.ok;
}

async function activateBestPerformance(options) {
  const createUltimate = options && options.createUltimate;
  let schemes = await listSchemes();
  const exists = guid => schemes.some(s => s.guid === guid);

  if (!exists(ULTIMATE) && createUltimate) {
    await sudoExec('powercfg -duplicatescheme ' + ULTIMATE);
  }
  schemes = await listSchemes();

  let target = null;
  if (schemes.some(s => s.guid === ULTIMATE)) target = ULTIMATE;
  else if (schemes.some(s => s.guid === HIGH_PERF)) target = HIGH_PERF;
  else {
    const found = schemes.find(s => /high/i.test(s.name));
    if (found) target = found.guid;
  }
  if (!target) return null;
  const ok = await setScheme(target);
  return ok ? target : null;
}

module.exports = {
  blockNotifications,
  disableGameDVR,
  restoreBackup,
  getActiveScheme,
  setScheme,
  activateBestPerformance
};