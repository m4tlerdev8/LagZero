const $ = id => document.getElementById(id);

function showToast(msg, type = 'info') {
  const box = $('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  t.setAttribute('role', 'alert');
  t.setAttribute('aria-live', 'polite');
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 320);
  }, 3400);
}

function setButtonLoading(btn, loading, originalText = '') {
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'جاري التحميل...';
    btn.classList.add('loading');
    btn.setAttribute('aria-busy', 'true');
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || originalText;
    btn.classList.remove('loading');
    btn.removeAttribute('aria-busy');
    delete btn.dataset.originalText;
  }
}

function setFocusTrap(container) {
  const focusableElements = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  container.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  });
}

const titles = { dash: 'الرئيسية', games: 'الألعاب', procs: 'العمليات', settings: 'الإعدادات' };

document.querySelectorAll('.navItem').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.navItem').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
    $('pageTitle').textContent = titles[btn.dataset.tab] || '';
    if (btn.dataset.tab === 'procs') {
      loadProcs().catch(e => {
        console.error('Process list error:', e);
        showToast('تعذر تحميل قائمة العمليات: ' + (e.message || 'خطأ غير معروف'), 'error');
      });
    }
  });

  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      btn.click();
    }
  });
});

window.api.onStats(s => {
  $('ramPct').textContent = s.ramUsedPct;
  $('cpuPct').textContent = s.cpuPct;
  $('ramPct').closest('.metricValue').classList.remove('unavailable');
  $('cpuPct').closest('.metricValue').classList.remove('unavailable');
});

window.api.onLog(item => {
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date(item.t).toLocaleTimeString('ar-EG');
  const span = document.createElement('span');
  span.textContent = item.msg;
  li.appendChild(time);
  li.appendChild(span);
  $('log').prepend(li);
  while ($('log').children.length > 200) $('log').lastChild.remove();
});

 $('btnClearLog').onclick = () => {
  $('log').innerHTML = '';
};

window.api.onBoostState(st => {
  const b = $('boostBadge');
  if (st.active) {
    b.textContent = 'وضع الالعاب: ' + st.game;
    b.classList.add('on');
  } else {
    b.textContent = 'الوضع العادي';
    b.classList.remove('on');
  }
});

 $('btnBoost').onclick = async () => {
  const button = $('btnBoost');
  const label = $('boostBtnText');
  button.disabled = true;
  label.textContent = 'BOOSTING';
  $('boostResult').textContent = 'جارٍ تنفيذ عمليات التعزيز';
  try {
    const r = await window.api.invoke('boost:manual');
    const memoryText = r.memoryDeltaMB === null
      ? 'تعذر قياس تغير الذاكرة'
      : `تغيرت الذاكرة المتاحة ${r.memoryDeltaMB > 0 ? '+' : ''}${r.memoryDeltaMB} ميغابايت`;
    $('boostResult').textContent = `تم إنهاء ${r.killed} عملية وتفريغ ذاكرة ${r.trimmed} عملية؛ ${memoryText}`;
    if (r.errors.length) {
      $('boostResult').textContent += `؛ تعذر تنفيذ بعض الخطوات: ${r.errors.join('؛ ')}`;
      showToast('اكتمل التعزيز جزئيًا. راجع النتيجة وسجل النشاط.', 'error');
    } else {
      showToast('اكتملت عملية التعزيز الفوري', 'success');
    }
  } catch (e) {
    console.error('Boost error:', e);
    $('boostResult').textContent = 'تعذر تنفيذ التعزيز';
    showToast('تعذر تنفيذ التعزيز: ' + (e.message || 'خطأ غير معروف'), 'error');
  } finally {
    button.disabled = false;
    label.textContent = 'BOOST';
  }
};

async function renderGames(games = null) {
  if (!games) games = await window.api.invoke('games:list');
  $('gamesCount').textContent = games.length;
  $('gamesEmpty').style.display = games.length ? 'none' : 'block';
  $('gamesList').innerHTML = '';
  games.forEach(g => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const n = document.createElement('span');
    n.className = 'gname';
    n.textContent = g.name || g.exe;
    const x = document.createElement('span');
    x.className = 'gexe';
    x.textContent = g.exe;
    info.appendChild(n);
    info.appendChild(x);
    const del = document.createElement('button');
    del.className = 'btn danger small';
    del.textContent = 'ازالة';
    del.onclick = async () => {
      try {
        const updatedGames = await window.api.invoke('games:remove', g.exe);
        await renderGames(updatedGames);
      } catch (e) {
        console.error('Remove game error:', e);
        showToast('تعذر إزالة اللعبة: ' + (e.message || 'خطأ غير معروف'), 'error');
      }
    };
    li.appendChild(info);
    li.appendChild(del);
    $('gamesList').appendChild(li);
  });
}

 $('btnAddExe').onclick = async () => {
  const btn = $('btnAddExe');
  setButtonLoading(btn, true);
  try {
    const result = await window.api.invoke('games:addDialog');
    await renderGames(result.games);
    if (result.status === 'added') showToast('تمت إضافة اللعبة بنجاح', 'success');
    if (result.status === 'exists') showToast('اللعبة موجودة بالفعل في القائمة');
  } catch (e) {
    console.error('Add game error:', e);
    showToast('تعذر إضافة اللعبة: ' + (e.message || 'خطأ غير معروف'), 'error');
  } finally {
    setButtonLoading(btn, false);
  }
};

 $('btnCapture').onclick = async () => {
  const btn = $('btnCapture');
  setButtonLoading(btn, true);
  showToast('انتقل إلى نافذة اللعبة خلال 3 ثوانٍ لالتقاطها');
  try {
    const result = await window.api.invoke('games:capture');
    await renderGames(result.games);
    if (result.status === 'added') showToast('تمت إضافة النافذة النشطة إلى قائمة الألعاب', 'success');
    if (result.status === 'exists') showToast('اللعبة موجودة بالفعل في القائمة');
    if (result.status === 'unavailable') showToast('تعذر تحديد الملف التنفيذي للنافذة النشطة', 'error');
    if (result.status === 'self') showToast('لا يمكن إضافة نافذة LagZero كلعبة', 'error');
  } catch (e) {
    console.error('Capture error:', e);
    showToast('تعذر التقاط النافذة: ' + (e.message || 'خطأ غير معروف'), 'error');
  } finally {
    setButtonLoading(btn, false);
  }
};

let protectedSet = new Set();

async function loadProcs() {
  const data = await window.api.invoke('processes:list');
  protectedSet = new Set(data.protected);
  const tb = $('procRows');
  tb.innerHTML = '';
  data.list.forEach(p => {
    const isProt = protectedSet.has(p.name);
    const tr = document.createElement('tr');
    if (isProt) tr.className = 'protected';
    const td1 = document.createElement('td');
    td1.className = 'colCheck';
    if (isProt) {
      td1.textContent = 'محمية';
      td1.style.fontSize = '0.7rem';
    } else {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'procCheck';
      cb.dataset.name = p.name;
      td1.appendChild(cb);
    }
    const td2 = document.createElement('td');
    td2.textContent = p.name + (isProt ? ' محمية' : '');
    const td3 = document.createElement('td');
    td3.textContent = p.memMB + ' ميغابايت';
    const td4 = document.createElement('td');
    td4.textContent = p.count;
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tb.appendChild(tr);
  });
}

 $('btnRefresh').onclick = async () => {
  const btn = $('btnRefresh');
  setButtonLoading(btn, true);
  try {
    await loadProcs();
  } catch (e) {
    console.error('Refresh error:', e);
    showToast('تعذر تحديث القائمة: ' + (e.message || 'خطأ غير معروف'), 'error');
  } finally {
    setButtonLoading(btn, false);
  }
};

 $('btnKill').onclick = async () => {
  const names = Array.from(document.querySelectorAll('.procCheck:checked')).map(c => c.dataset.name);
  if (!names.length) {
    showToast('لم يتم تحديد اي عملية', 'error');
    return;
  }
  const btn = $('btnKill');
  setButtonLoading(btn, true);
  try {
    const r = await window.api.invoke('processes:kill', names);
    showToast(`تم انهاء ${r.killed} عملية`, 'success');
    await loadProcs();
  } catch (e) {
    console.error('Kill error:', e);
    showToast('تعذر إنهاء العمليات: ' + (e.message || 'خطأ غير معروف'), 'error');
  } finally {
    setButtonLoading(btn, false);
  }
};

const toggles = [
  'enableKill', 'enableTrim', 'enableNotifications', 'enableGameDVR',
  'enablePowerPlan', 'enablePriority', 'createUltimate', 'startAtLogin'
];

async function loadSettings() {
  const s = await window.api.invoke('settings:get');
  toggles.forEach(k => {
    $('s_' + k).checked = !!s[k];
  });
  $('s_killList').value = (s.killList || []).join('\n');
  $('s_pollMs').value = s.pollMs || 1000;
}

 $('btnSave').onclick = async () => {
  const btn = $('btnSave');
  setButtonLoading(btn, true);
  try {
    const s = {};
    toggles.forEach(k => {
      s[k] = $('s_' + k).checked;
    });
    s.killList = $('s_killList').value.split('\n').map(v => v.trim()).filter(Boolean);
    s.pollMs = Math.max(500, parseInt($('s_pollMs').value, 10) || 1000);
    await window.api.invoke('settings:save', s);
    showToast('تم حفظ الاعدادات بنجاح', 'success');
  } catch (e) {
    console.error('Save settings error:', e);
    showToast('تعذر حفظ الإعدادات: ' + (e.message || 'خطأ غير معروف'), 'error');
  } finally {
    setButtonLoading(btn, false);
  }
};

renderGames().catch(e => {
  console.error('Load games error:', e);
  $('gamesEmpty').textContent = 'تعذر تحميل قائمة الألعاب';
  showToast('تعذر تحميل قائمة الألعاب: ' + (e.message || 'خطأ غير معروف'), 'error');
});
loadSettings().catch(e => {
  console.error('Load settings error:', e);
  showToast('تعذر تحميل الإعدادات: ' + (e.message || 'خطأ غير معروف'), 'error');
});