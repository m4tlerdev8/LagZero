const { runCmd } = require('./powershell');

async function queryDword(key, name) {
  const r = await runCmd('reg.exe', ['query', key, '/v', name]);
  const m = r.out.match(/REG_DWORD\s+0x([0-9a-f]+)/i);
  if (m) return { existed: true, val: parseInt(m[1], 16) };
  if (!r.ok) {
    const output = r.out + '\n' + r.err;
    if (/unable to find the specified registry key or value|cannot find the specified registry key or value/i.test(output)) {
      return { existed: false, val: 0 };
    }
    throw new Error(r.err || r.out || 'تعذرت قراءة قيمة سجل Windows');
  }
  throw new Error('قيمة سجل Windows ليست من نوع DWORD: ' + name);
}

async function addDword(key, name, data) {
  return runCmd('reg.exe', ['add', key, '/v', name, '/t', 'REG_DWORD', '/d', String(data), '/f']);
}

async function deleteValue(key, name) {
  return runCmd('reg.exe', ['delete', key, '/v', name, '/f']);
}

module.exports = { queryDword, addDword, deleteValue };