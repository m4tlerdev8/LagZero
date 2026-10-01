const { spawn } = require('child_process');

function sanitizePSOutput(output) {
  if (typeof output !== 'string') return '';
  return output.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

function runPS(script, timeoutMs = 25000) {
  return new Promise(resolve => {
    if (!script || typeof script !== 'string') {
      resolve({ ok: false, out: '', err: 'Invalid script' });
      return;
    }

    const safeScript = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`;
    const encoded = Buffer.from(safeScript, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encoded
    ], { windowsHide: true });

    let out = '';
    let err = '';
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok, out: sanitizePSOutput(out), err: sanitizePSOutput(err) });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, timeoutMs);

    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('close', code => finish(code === 0));
    child.on('error', () => finish(false));
  });
}

function runCmd(file, args, timeoutMs = 15000) {
  return new Promise(resolve => {
    if (!file || typeof file !== 'string') {
      resolve({ ok: false, out: '', err: 'Invalid command' });
      return;
    }

    const child = spawn(file, args, { windowsHide: true });
    let out = '';
    let err = '';
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok, out: sanitizePSOutput(out), err: sanitizePSOutput(err) });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, timeoutMs);

    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('close', code => finish(code === 0));
    child.on('error', () => finish(false));
  });
}

module.exports = { runPS, runCmd };