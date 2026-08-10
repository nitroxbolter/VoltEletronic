const { execFile } = require('child_process');

const PORTS = [3003, 5176];

function getPidsUsingPort(port) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve([]);
      const pids = new Set();
      stdout.split(/\r?\n/).forEach((line) => {
        if (!line.includes(`:${port}`) || !line.includes('LISTENING')) return;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid > 0 && pid !== process.pid) pids.add(pid);
      });
      resolve([...pids]);
    });
  });
}

function killPid(pid, port) {
  return new Promise((resolve) => {
    console.log(`[dev] Fechando processo antigo na porta ${port} | pid=${pid}`);
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        console.warn(`[dev] Nao foi possivel fechar pid=${pid} na porta ${port}: ${(stderr || error.message).trim()}`);
      }
      resolve();
    });
  });
}

(async () => {
  for (const port of PORTS) {
    const pids = await getPidsUsingPort(port);
    for (const pid of pids) {
      await killPid(pid, port);
    }
  }
})();
