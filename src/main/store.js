const Store = require('electron-store');

module.exports = new Store({
  defaults: {
    pollMs: 1000,
    enableKill: true,
    enableTrim: true,
    enableNotifications: true,
    enableGameDVR: true,
    enablePowerPlan: true,
    enablePriority: true,
    createUltimate: false,
    startAtLogin: false,
    games: [],
    killList: [
      'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'brave.exe',
      'onedrive.exe', 'dropbox.exe', 'skype.exe', 'teams.exe', 'slack.exe',
      'telegram.exe', 'whatsapp.exe', 'spotify.exe', 'zoom.exe', 'yourphone.exe'
    ]
  }
});