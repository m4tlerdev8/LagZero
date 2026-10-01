const path = require('path');
const si = require('systeminformation');
const processes = require('./processes');
const optimize = require('./optimize');

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = class GameMonitor {
  constructor(options) {
    this.store = options.store;
    this.send = options.send;
    this.boosting = false;
    this.exitTicks = 0;
    this.game = null;
    this.nBackup = null;
    this.dvrBackup = null;
    this.prevScheme = null;
    this.pidMap = new Map();
    this.pidMapAt = 0;
  }

  start() {
    const ms = Math.max(500, this.store.get('pollMs') || 1000);
    this.timer = setInterval(() => {
      this.tick().catch(e => console.error('Monitor tick error:', e));
    }, ms);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  log(msg) {
    this.send('log', { t: Date.now(), msg });
  }

  state(p) {
    this.send('boost-state', p);
  }

  async resolveExe(win) {
    try {
      if (win && win.path) return path.basename(win.path).toLowerCase();
      const pid = win && win.processId;
      if (!pid) return null;
      const now = Date.now();
      if (now - this.pidMapAt > 5000) {
        this.pidMap = await processes.getPidPaths();
        this.pidMapAt = now;
      }
      const p = this.pidMap.get(pid);
      return p ? path.basename(p).toLowerCase() : null;
    } catch (e) {
      return null;
    }
  }

  async tick() {
    let win = null;
    try {
      win = await processes.getActiveWindow();
    } catch (e) {
      console.error('Error getting active window:', e);
      return;
    }
    const exe = await this.resolveExe(win);

    if (this.boosting) {
      if (exe && this.game && exe === this.game.exe) {
        this.exitTicks = 0;
      } else {
        this.exitTicks++;
        if (this.exitTicks >= 3) await this.restore();
      }
      return;
    }

    if (!exe) return;
    const games = this.store.get('games') || [];
    const g = games.find(x => x.exe === exe);
    if (g) {
      this.game = Object.assign({}, g, { pid: win ? win.processId : null });
      await this.boost();
    }
  }

  async boost() {
    this.boosting = true;
    this.exitTicks = 0;
    const s = this.store.store;
    const gameExe = this.game.exe;
    this.log('بدء وضع الالعاب: ' + gameExe);
    this.state({ active: true, game: gameExe });

    let beforeFree = null;
    try {
      beforeFree = (await si.mem()).free;
    } catch (e) {
      this.log('تعذر قياس الذاكرة قبل التعزيز: ' + e.message);
    }

    try {
      if (s.enableKill) {
        try {
          const res = await processes.killByName(s.killList, [gameExe]);
          this.log('تم إنهاء ' + res.killed + ' عملية خلفية');
        } catch (e) {
          this.log('تعذر إنهاء عمليات الخلفية: ' + e.message);
        }
      }

      if (s.enableTrim) {
        const exclude = [process.pid];
        if (this.game.pid) exclude.push(this.game.pid);
        try {
          const trimmed = await processes.trimWorkingSets(exclude, [gameExe]);
          this.log('تم تفريغ ذاكرة ' + trimmed + ' عملية');
        } catch (e) {
          this.log('تعذر تفريغ ذاكرة العمليات: ' + e.message);
        }
      }

      if (s.enableNotifications) {
        try {
          this.nBackup = await optimize.blockNotifications();
          this.log('تم حظر الإشعارات حتى نهاية الجلسة');
        } catch (e) {
          this.log('تعذر حظر الإشعارات: ' + e.message);
        }
      }

      if (s.enableGameDVR) {
        try {
          this.dvrBackup = await optimize.disableGameDVR();
          this.log('تم تعطيل مسجل الألعاب');
        } catch (e) {
          this.log('تعذر تعطيل مسجل الألعاب: ' + e.message);
        }
      }

      if (s.enablePowerPlan) {
        this.prevScheme = await optimize.getActiveScheme();
        const ok = await optimize.activateBestPerformance({ createUltimate: !!s.createUltimate });
        this.log(ok ? 'تم تفعيل خطة الاداء العالي' : 'تعذر تغيير خطة الطاقة');
      }

      if (s.enablePriority) {
        const changed = await processes.setPriority(gameExe);
        if (changed) {
          setTimeout(() => processes.setPriority(gameExe), 4000);
          this.log('تم رفع أولوية اللعبة');
        } else {
          this.log('تعذر رفع أولوية اللعبة');
        }
      }

      await sleep(1500);
      if (beforeFree !== null) {
        const afterFree = (await si.mem()).free;
        const deltaMB = Math.round((afterFree - beforeFree) / 1048576);
        this.log('تغيرت الذاكرة المتاحة بمقدار ' + deltaMB + ' ميغابايت أثناء التعزيز');
      }
    } catch (e) {
      console.error('Boost error:', e);
      this.log('حدث خطأ اثناء التعزيز: ' + e.message);
    }
  }

  async restore() {
    if (!this.boosting) return;
    const failures = [];
    try {
      if (this.nBackup) {
        await optimize.restoreBackup(this.nBackup);
        this.log('تمت استعادة اعدادات الاشعارات');
      }
    } catch (e) {
      failures.push(e.message);
    }
    try {
      if (this.dvrBackup) {
        await optimize.restoreBackup(this.dvrBackup);
        this.log('تمت استعادة إعدادات مسجل الألعاب');
      }
    } catch (e) {
      failures.push(e.message);
    }
    try {
      if (this.prevScheme) {
        const restored = await optimize.setScheme(this.prevScheme);
        if (!restored) throw new Error('تعذر تغيير خطة الطاقة');
        this.log('تمت استعادة خطة الطاقة السابقة');
      }
    } catch (e) {
      failures.push(e.message);
    }
    this.nBackup = null;
    this.dvrBackup = null;
    this.prevScheme = null;
    this.game = null;
    this.boosting = false;
    this.state({ active: false });
    this.log(failures.length
      ? 'انتهى وضع الألعاب، لكن تعذرت استعادة بعض الإعدادات: ' + failures.join('؛ ')
      : 'انتهى وضع الألعاب وتمت استعادة الإعدادات');
  }

  restoreIfNeeded() {
    if (this.boosting) return this.restore();
  }
};