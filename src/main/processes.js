const path = require('path');
const { runPS } = require('./powershell');

const PROTECTED = new Set([
  'system', 'idle', 'registry', 'memcompression', 'csrss', 'wininit', 'winlogon',
  'smss', 'services', 'lsass', 'svchost', 'dwm', 'explorer', 'conhost', 'dllhost',
  'runtimebroker', 'sihost', 'ctfmon', 'fontdrvhost', 'wmiprvse', 'spoolsv',
  'searchindexer', 'audiodg', 'taskhostw', 'wudfhost', 'cmd', 'powershell',
  'applicationframehost', 'steam', 'steamwebhelper', 'epicgameslauncher',
  'riotclientservices', 'valorant', 'battle.net', 'origin', 'eadesktop', 'upc',
  path.basename(process.execPath).replace(/\.exe$/i, '').toLowerCase()
]);

function norm(n) {
  return String(n || '').trim().replace(/\.exe$/i, '').toLowerCase();
}

async function listGrouped() {
  const r = await runPS(`
[Console]::OutputEncoding=[Text.Encoding]::UTF8
 $g = Get-Process | Group-Object ProcessName | ForEach-Object {
  [pscustomobject]@{
    name  = $_.Name.ToLowerInvariant()
    count = $_.Count
    memMB = [math]::Round(($_.Group | Measure-Object WorkingSet64 -Sum).Sum/1MB, 1)
    pids  = ($_.Group.Id -join ' ')
  }
}
@($g | Sort-Object memMB -Descending | Select-Object -First 80) | ConvertTo-Json -Compress -Depth 2`);
  if (!r.ok) throw new Error(r.err || 'تعذر قراءة قائمة عمليات Windows');
  try {
    let arr = JSON.parse(r.out);
    if (!Array.isArray(arr)) arr = [arr];
    return arr;
  } catch {
    throw new Error('تعذر تحليل قائمة العمليات من Windows');
  }
}

async function killByName(names, extraProtected) {
  const targets = (names || []).map(norm).filter(Boolean);
  if (!targets.length) return { killed: 0 };
  const prot = Array.from(new Set([...PROTECTED, ...(extraProtected || []).map(norm)]));
  const tArr = targets.map(n => "'" + n.replace(/'/g, '') + "'").join(',');
  const pArr = prot.map(n => "'" + n.replace(/'/g, '') + "'").join(',');

  const r = await runPS(`
 $ErrorActionPreference='SilentlyContinue'
 $targets=@(${tArr})
 $prot=@(${pArr})
 $k=0
Get-Process | ForEach-Object {
  $n = $_.ProcessName.ToLowerInvariant()
  if ($targets -contains $n -and $prot -notcontains $n) {
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; $k++ } catch {}
  }
}
Write-Output "KILLED=$k"`);
  if (!r.ok) throw new Error(r.err || 'تعذر تنفيذ أمر إنهاء العمليات');
  const m = r.out.match(/KILLED=(\d+)/);
  if (!m) throw new Error('لم تصل نتيجة إنهاء العمليات');
  return { killed: m ? parseInt(m[1], 10) : 0 };
}

async function trimWorkingSets(excludePids, extraProtected) {
  const ids = Array.from(excludePids || []).join(',');
  const prot = Array.from(new Set([...PROTECTED, ...(extraProtected || []).map(norm)]))
    .map(n => "'" + n.replace(/'/g, '') + "'")
    .join(',');

  const r = await runPS(`
 $ErrorActionPreference='SilentlyContinue'
Add-Type -Namespace LZ -Name PS -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr h); [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint a,bool i,int p); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);'
 $ids=@(${ids})
 $prot=@(${prot})
 $c=0
Get-Process | ForEach-Object {
  $n = $_.ProcessName.ToLowerInvariant()
  if ($ids -notcontains $_.Id -and $prot -notcontains $n) {
    $h = [LZ.PS]::OpenProcess(0x0500, $false, $_.Id)
    if ($h -ne [IntPtr]::Zero) {
      if ([LZ.PS]::EmptyWorkingSet($h)) { $c++ }
      [LZ.PS]::CloseHandle($h) | Out-Null
    }
  }
}
Write-Output "TRIMMED=$c"`);
  if (!r.ok) throw new Error(r.err || 'تعذر تفريغ ذاكرة العمليات');
  const m = r.out.match(/TRIMMED=(\d+)/);
  if (!m) throw new Error('لم تصل نتيجة تفريغ الذاكرة');
  return m ? parseInt(m[1], 10) : 0;
}

async function setPriority(exeName) {
  const name = norm(exeName).replace(/'/g, '');
  if (!name) return false;
  const r = await runPS(`
 $ErrorActionPreference='SilentlyContinue'
Get-Process -Name '${name}' | ForEach-Object { try { $_.PriorityClass='High' } catch {} }`);
  return r.ok;
}

async function getPidPaths() {
  const r = await runPS(`
 $ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Get-Process | Where-Object { $_.Path } | Select-Object Id, Path | ConvertTo-Json -Compress`);
  const map = new Map();
  if (r.ok) {
    try {
      let arr = JSON.parse(r.out);
      if (!Array.isArray(arr)) arr = [arr];
      arr.forEach(x => {
        if (x && x.Id && x.Path) map.set(x.Id, x.Path);
      });
    } catch (e) {}
  }
  return map;
}

async function getActiveWindow() {
  const r = await runPS(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LagZeroForegroundWindow {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$handle = [LagZeroForegroundWindow]::GetForegroundWindow()
[uint32]$foregroundProcessId = 0
[LagZeroForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$foregroundProcessId) | Out-Null
$process = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
[pscustomobject]@{ processId = $foregroundProcessId; path = $process.Path } | ConvertTo-Json -Compress`);
  if (!r.ok || !r.out.trim()) return null;
  try {
    return JSON.parse(r.out);
  } catch (e) {
    return null;
  }
}

module.exports = { PROTECTED, listGrouped, killByName, trimWorkingSets, setPriority, getPidPaths, getActiveWindow, norm };