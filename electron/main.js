const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const http = require('http');
const net  = require('net');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development';
const backendPort = Number(process.env.VOLT_BACKEND_PORT || 3003);
const devFrontendUrl = process.env.VOLT_FRONTEND_URL || 'http://localhost:5176';
const localElectronDataDir = isDev
  ? path.join(__dirname, '..', 'resources', 'electron-user-data')
  : path.join(process.resourcesPath, 'electron-user-data');

fs.mkdirSync(localElectronDataDir, { recursive: true });
app.setPath('userData', localElectronDataDir);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');

let mainWindow = null;
let debugWindow = null;
let backendProcess = null;
let ollamaProcess = null;

const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b';
const debugLogs = [];
const MAX_DEBUG_LOGS = 1200;

function formatDebugLine(level, args) {
  const text = args.map((arg) => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack || arg.message;
    try { return JSON.stringify(arg); }
    catch (_) { return String(arg); }
  }).join(' ');

  return {
    at: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
    level,
    text,
  };
}

function pushDebugLog(level, args) {
  const entry = formatDebugLine(level, args);
  if (entry.text.includes('Error sending from webFrameMain')) return;

  debugLogs.push(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.shift();

  if (debugWindow && !debugWindow.isDestroyed() && !debugWindow.webContents.isDestroyed()) {
    try {
      debugWindow.webContents.send('debug-log', entry);
    } catch (_) {
      // A janela pode estar sendo recriada/fechada durante falhas do renderer.
    }
  }
}

for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    pushDebugLog(level, args);
  };
}

// ─── Ollama ───────────────────────────────────────────────────────────────────

/**
 * Resolve o caminho do executável ollama.
 * Prioridade:
 *   1. ollama.exe embutido no app (resources/ollama/ollama.exe)
 *   2. ollama no PATH do sistema
 * Retorna null se não encontrar.
 */
function resolveOllamaPath() {
  // 1) Bundled — dentro do pacote Electron
  const bundledPath = isDev
    ? path.join(__dirname, '..', 'resources', 'ollama', 'ollama.exe')
    : path.join(process.resourcesPath, 'ollama', 'ollama.exe');

  if (fs.existsSync(bundledPath)) {
    console.log('[Ollama] Usando executável embutido:', bundledPath);
    return bundledPath;
  }

  // 2) Sistema — verifica se está no PATH
  const systemPaths = [
    'C:\\Users\\' + (process.env.USERNAME || '') + '\\AppData\\Local\\Programs\\Ollama\\ollama.exe',
    'C:\\Program Files\\Ollama\\ollama.exe',
    'ollama', // PATH genérico (funciona no Linux/Mac também)
  ];

  for (const p of systemPaths) {
    try {
      if (p === 'ollama' || fs.existsSync(p)) {
        console.log('[Ollama] Usando executável do sistema:', p);
        return p;
      }
    } catch (_) { /* ignora */ }
  }

  return null;
}

/**
 * Mantem dados do Ollama centralizados junto ao projeto/app.
 * Em desenvolvimento: app/resources/ollama/{home,models}
 * Empacotado: resources/ollama/{home,models}
 */
function getOllamaRuntimePaths() {
  const rootDir = isDev
    ? path.join(__dirname, '..', 'resources', 'ollama')
    : path.join(process.resourcesPath, 'ollama');

  return {
    rootDir,
    homeDir: path.join(rootDir, 'home'),
    modelsDir: path.join(rootDir, 'models'),
  };
}

function ensureOllamaRuntimeDirs() {
  const paths = getOllamaRuntimePaths();
  fs.mkdirSync(paths.homeDir, { recursive: true });
  fs.mkdirSync(paths.modelsDir, { recursive: true });
  return paths;
}

function buildOllamaEnv(extra = {}) {
  const paths = ensureOllamaRuntimeDirs();
  return {
    ...process.env,
    USERPROFILE: paths.homeDir,
    HOME: paths.homeDir,
    OLLAMA_MODELS: paths.modelsDir,
    OLLAMA_ORIGINS: '*',
    ...extra,
  };
}

/**
 * Verifica se o Ollama já está respondendo na porta 11434.
 * @returns {Promise<boolean>}
 */
/**
 * Verifica se a porta 11434 está aceitando conexões TCP.
 * Usa socket direto em 127.0.0.1 para evitar problema de resolução
 * localhost → ::1 (IPv6) no Windows quando Ollama só escuta IPv4.
 * @returns {Promise<boolean>}
 */
function isOllamaRunning() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(3000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error',   () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(11434, '127.0.0.1');
  });
}

/**
 * Aguarda o Ollama ficar disponível (máx. 90 segundos).
 * @returns {Promise<boolean>}
 */
function waitForOllama(retries = 45, delayMs = 2000) {
  return new Promise(async (resolve) => {
    for (let i = 0; i < retries; i++) {
      if (await isOllamaRunning()) return resolve(true);
      const elapsed = ((i + 1) * delayMs / 1000).toFixed(0);
      console.log(`[Ollama] ⏳ Aguardando porta 11434... (${elapsed}s)`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    resolve(false);
  });
}

/**
 * Faz um request de aquecimento para forçar o modelo a carregar na memória.
 * Tenta cada modelo na lista até um funcionar.
 * @param {string[]} models
 * @returns {Promise<string|null>} nome do modelo que funcionou, ou null
 */
function warmupModel(models) {
  const tryModel = (model) => new Promise((resolve) => {
    console.log(`[Ollama] Carregando modelo para memoria...`);
    const body = JSON.stringify({ model, prompt: 'ok', stream: false, options: { num_predict: 1 } });

    let elapsed = 0;
    const ticker = setInterval(() => {
      elapsed += 15;
      console.log(`[Ollama] Ainda carregando modelo... (${elapsed}s)`);
    }, 15000);

    const req = http.request(
      { hostname: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        clearInterval(ticker);
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log(`[Ollama] Modelo carregado em RAM (CPU)`);
            resolve(true);
          } else {
            console.warn(`[Ollama] Warmup status ${res.statusCode}: ${raw.slice(0, 200)}`);
            resolve(false);
          }
        });
      }
    );
    req.on('error', (e) => { clearInterval(ticker); console.error('[Ollama] Erro no warmup:', e.message); resolve(false); });
    req.setTimeout(120000, () => { clearInterval(ticker); req.destroy(); console.warn('[Ollama] Warmup timeout.'); resolve(false); });
    req.write(body);
    req.end();
  });

  return (async () => {
    for (const model of models) {
      console.log(`[Ollama] Tentando modelo "${model}"...`);
      const ok = await tryModel(model);
      if (ok) return model;
      console.warn(`[Ollama] Modelo "${model}" falhou, tentando proximo...`);
    }
    return null;
  })();
}

/**
 * Aguarda o backend Express responder em /health.
 * @returns {Promise<boolean>}
 */
function waitForBackend(retries = 20, delayMs = 1000) {
  return new Promise(async (resolve) => {
    for (let i = 0; i < retries; i++) {
      const up = await new Promise((res) => {
        const req = http.get(`http://127.0.0.1:${backendPort}/health`, (r) => {
          r.resume();
          res(r.statusCode === 200);
        });
        req.on('error', () => res(false));
        req.setTimeout(2000, () => { req.destroy(); res(false); });
      });
      if (up) return resolve(true);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    resolve(false);
  });
}

function isBackendHealthy() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${backendPort}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

function getBackendDebugInfo() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${backendPort}/debug-info`, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(raw)); }
        catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(1500, () => { req.destroy(); resolve(null); });
  });
}

function getPidsUsingPort(port) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve([]);
      const pids = new Set();
      stdout.split(/\r?\n/).forEach((line) => {
        if (!line.includes(`:${port}`) || !line.includes('LISTENING')) return;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid > 0) pids.add(pid);
      });
      resolve([...pids]);
    });
  });
}

async function stopProcessesUsingPort(port) {
  const pids = await getPidsUsingPort(port);
  for (const pid of pids) {
    console.warn(`[Backend] Encerrando processo antigo na porta ${port} | pid=${pid}`);
    await new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    });
  }
  if (pids.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return pids;
}

/**
 * Inicia o Ollama (`ollama serve`) se ainda não estiver rodando.
 */
async function startOllama() {
  // Já está rodando? Não precisa iniciar.
  if (await isOllamaRunning()) {
    console.log('[Ollama] Ja esta rodando na porta 11434.');
    return true;
  }

  const ollamaExe = resolveOllamaPath();
  if (!ollamaExe) {
    dialog.showErrorBox(
      'Ollama não encontrado',
      'O Ollama não está instalado nem embutido no app.\n\n' +
      'Baixe em: https://ollama.com\n' +
      'Ou coloque o ollama.exe em: resources/ollama/ollama.exe'
    );
    return false;
  }

  console.log('[Ollama] Iniciando servidor Ollama...');
  const ollamaDir = path.dirname(ollamaExe);
  const runtimePaths = ensureOllamaRuntimeDirs();
  console.log('[Ollama] Modelos centralizados em:', runtimePaths.modelsDir);
  console.log('[Ollama] Home centralizado em:', runtimePaths.homeDir);

  ollamaProcess = spawn(ollamaExe, ['serve'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    windowsHide: true,
    cwd: ollamaDir,
    env: buildOllamaEnv({
      PATH: ollamaDir + ';' + process.env.PATH,
      // Desabilita GPU para evitar crash de memória CUDA na GTX 1650
      // Troque para '' quando quiser testar com GPU novamente
      CUDA_VISIBLE_DEVICES: '-1',
    }),
  });

  // Filtra a saída verbosa do Ollama — só exibe eventos relevantes
  function handleOllamaLog(d) {
    const line = d.toString();
    if (line.includes('Listening on'))      console.log('[Ollama] Porta 11434 ativa - servidor respondendo');
    else if (line.includes('inference compute')) console.log('[Ollama] Modelo carregado em RAM (CPU)');
    else if (line.includes('starting runner'))   console.log('[Ollama] Carregando modelo para memoria...');
    else if (line.includes('model loaded'))      console.log('[Ollama] Modelo pronto.');
    else if (line.includes('/api/generate'))     console.log('[Ollama] Requisicao /api/generate finalizada');
    else if (line.includes('/api/chat'))         console.log('[Ollama] Requisicao /api/chat finalizada');
    else if (line.includes('/api/pull'))         console.log('[Ollama] Download/verificacao de modelo finalizada');
    else if (line.includes('level=ERROR') || line.includes('level=FATAL')) {
      console.error('[Ollama] ' + line.trim());
    }
    // Todo o resto (ENV vars, blobs, GPU discovery, WARN sobre CUDA) é suprimido
  }
  ollamaProcess.stdout?.on('data', handleOllamaLog);
  ollamaProcess.stderr?.on('data', handleOllamaLog);

  ollamaProcess.on('error', (err) => {
    console.error('[Ollama] Erro ao iniciar processo:', err.message);
  });

  ollamaProcess.on('close', (code) => {
    if (code !== 0 && code !== null) console.warn(`[Ollama] Processo encerrado com código ${code}`);
  });

  // Aguarda o serviço subir (porta 11434 responder)
  console.log('[Ollama] Aguardando porta 11434 (max. 90s)...');
  const ready = await waitForOllama();
  if (!ready) {
    console.error('[Ollama] Timeout - porta 11434 nao respondeu em 90s. Verifique se outro processo esta usando a porta.');
    return false;
  }

  console.log('[Ollama] Servidor HTTP ativo.');
  return true;
}

/**
 * Verifica se o modelo está baixado; se não estiver, faz pull automaticamente.
 * AGUARDA a conclusão antes de retornar.
 * @param {string} ollamaExe - Caminho do executável
 * @param {string} model     - Nome do modelo
 * @returns {Promise<boolean>}
 */
function ensureModel(ollamaExe, model) {
  return new Promise((resolve) => {
    console.log(`[Ollama] Verificando / baixando modelo "${model}"...`);
    const ollamaDir = path.dirname(ollamaExe);
    const pull = spawn(ollamaExe, ['pull', model], {
      stdio: 'inherit',
      windowsHide: true,
      cwd: ollamaDir,
      env: buildOllamaEnv({ PATH: ollamaDir + ';' + process.env.PATH }),
    });
    pull.on('close', (code) => {
      if (code === 0) {
        console.log(`[Ollama] Modelo "${model}" disponivel localmente.`);
        resolve(true);
      } else {
        console.warn(`[Ollama] Pull do modelo "${model}" retornou codigo ${code}.`);
        resolve(false);
      }
    });
    pull.on('error', (err) => {
      console.error(`[Ollama] Erro ao baixar modelo: ${err.message}`);
      resolve(false);
    });
  });
}

// ─── Backend Express ──────────────────────────────────────────────────────────

/**
 * Inicia o servidor Express como processo filho.
 */
async function startBackend() {
  if (await isBackendHealthy()) {
    const debugInfo = await getBackendDebugInfo();
    if (debugInfo?.app === 'volt' && debugInfo?.debugProtocol >= 2 && debugInfo?.chatFlowLogs) {
      console.log(`[Backend] Porta ${backendPort} ja esta ativa com Volt atual. Reutilizando backend existente. pid=${debugInfo.pid || '-'}`);
      backendProcess = null;
      return true;
    }

    console.warn(`[Backend] Porta ${backendPort} tem backend antigo/sem protocolo de debug. Fechando para iniciar a versao atual.`);
    await stopProcessesUsingPort(backendPort);
  }

  const serverPath = isDev
    ? path.join(__dirname, '..', 'backend', 'server.js')
    : path.join(process.resourcesPath, 'backend', 'server.js');

  backendProcess = spawn('node', [serverPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(backendPort), OLLAMA_MODEL: DEFAULT_OLLAMA_MODEL },
  });

  backendProcess.stdout?.on('data', (data) => {
    data.toString().split(/\r?\n/).filter(Boolean).forEach((line) => {
      console.log(`[Backend] ${line}`);
    });
  });

  backendProcess.stderr?.on('data', (data) => {
    data.toString().split(/\r?\n/).filter(Boolean).forEach((line) => {
      console.error(`[Backend] ${line}`);
    });
  });

  backendProcess.on('error', (err) => {
    console.error('[Backend] Falha ao iniciar:', err.message);
  });

  backendProcess.on('close', (code) => {
    console.log(`[Backend] Encerrado com código ${code}`);
  });

  return true;
}

// ─── Janela principal ─────────────────────────────────────────────────────────

/**
 * Atualiza o status exibido na tela de loading.
 * Só funciona enquanto loading.html estiver carregado.
 */
function setLoadingStatus(msg, detail = '', type = '') {
  if (!mainWindow) return;
  const m = JSON.stringify(msg);
  const d = JSON.stringify(detail);
  const t = JSON.stringify(type);
  mainWindow.webContents.executeJavaScript(
    `typeof setStatus==='function' && setStatus(${m},${d},${t}); typeof addLog==='function' && addLog(${m},${t});`
  ).catch(() => {});
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 600,
    minHeight: 500,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,  // isola contexto para segurança
      nodeIntegration: false,  // desabilitado por segurança
    },
    titleBarStyle: 'default',
  });

  // Abre links externos no navegador padrão do sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Mostra tela de loading enquanto os serviços sobem
  return mainWindow.loadFile(path.join(__dirname, 'loading.html'));
}

function createDebugWindow() {
  debugWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 420,
    backgroundColor: '#080b10',
    title: 'Volt Debug',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  debugWindow.loadFile(path.join(__dirname, 'debug.html'));
  debugWindow.on('closed', () => {
    debugWindow = null;
  });
}

// ─── Ciclo de vida do app ─────────────────────────────────────────────────────

app.whenReady().then(async () => {
  process.env.OLLAMA_MODEL = DEFAULT_OLLAMA_MODEL;

  // ─ IPC handlers ────────────────────────────────────────────────────
  ipcMain.handle('debug:get-logs', () => debugLogs);
  ipcMain.handle('debug:clear-logs', () => {
    debugLogs.length = 0;
    return true;
  });
  ipcMain.handle('debug:renderer-log', (_event, level = 'log', text = '') => {
    const safeLevel = ['log', 'info', 'warn', 'error'].includes(level) ? level : 'log';
    pushDebugLog(safeLevel, [`[Frontend] ${String(text || '')}`]);
    return true;
  });

  // Escaneia a pasta Schematic recursivamente e retorna lista de arquivos
  // Ignora arquivos com "borderview" no nome
  ipcMain.handle('scan-schematics', () => {
    const schematicsDir = isDev
      ? path.join(__dirname, '..', '..', 'Schematic')
      : path.join(app.getPath('documents'), 'Schematics');

    if (!fs.existsSync(schematicsDir)) return [];

    const ALLOWED_EXT = new Set([
      '.pdf', '.jpg', '.jpeg', '.png', '.bmp',
      '.bdv', '.brd', '.obd', '.obdlocal', '.fz', '.cad', '.sqlite', '.sqlite3',
      '.zip', '.rar', '.7z',
    ]);
    const results = [];

    function walk(dir, relBase) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (_) { return; }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath  = relBase ? relBase + '/' + entry.name : entry.name;

        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else if (entry.isFile()) {
          if (!ALLOWED_EXT.has(path.extname(entry.name).toLowerCase())) continue;
          results.push({ label: relPath, path: fullPath });
        }
      }
    }

    walk(schematicsDir, '');
    return results;
  });

  // Abre seletor de arquivo nativo apontando para a pasta Schematic do projeto
  ipcMain.handle('open-file-dialog', async () => {
    const schematicsDir = isDev
      ? path.join(__dirname, '..', '..', 'Schematic')
      : path.join(app.getPath('documents'), 'Schematics');

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Esquema Elétrico',
      defaultPath: fs.existsSync(schematicsDir) ? schematicsDir : app.getPath('documents'),
      filters: [
        { name: 'Esquemas e Boardviews', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'bmp', 'bdv', 'brd', 'obd', 'obdlocal', 'fz', 'cad', 'sqlite', 'sqlite3', 'zip', 'rar', '7z'] },
        { name: 'Todos os arquivos', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Abre um arquivo com o programa padrão do sistema
  ipcMain.handle('open-path', async (_event, filePath) => {
    if (!filePath) return;
    await shell.openPath(filePath);
  });

  // Lê um arquivo local e retorna como Data URL (base64)
  // Necessário para exibir PDFs e imagens inline sem bloqueio de file://
  ipcMain.handle('read-file-as-dataurl', async (_event, filePath) => {
    if (!filePath) return null;
    const MIME = {
      pdf: 'application/pdf',
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', bmp: 'image/bmp',
      gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
    };
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = MIME[ext] || 'application/octet-stream';
    const buffer = fs.readFileSync(filePath);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  });

  // ─ Abre janela com loading screen ──────────────────────────────────
  const loadingReady = createWindow();
  createDebugWindow();

  // Aguarda a loading.html terminar de carregar antes de mandar JS
  await loadingReady;

  // ─ Etapa 1: Ollama ──────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[Startup] Etapa 1/3 — Ollama');
  setLoadingStatus('Iniciando Ollama...', 'Etapa 1 de 3');

  const ollamaOk = await startOllama();
  if (!ollamaOk) {
    setLoadingStatus(
      '❌ Ollama não respondeu',
      'Verifique se outro processo está usando a porta 11434 e reinicie o app.',
      'error'
    );
    console.error('[Startup] ❌ Ollama falhou — app ficará na tela de erro.');
    return;
  }

  const ollamaExe = resolveOllamaPath();
  if (ollamaExe) {
    setLoadingStatus(
      'Verificando modelo de IA...',
      `${DEFAULT_OLLAMA_MODEL} - download automatico se necessario`
    );
    await ensureModel(ollamaExe, DEFAULT_OLLAMA_MODEL);
  }

  // ─ Etapa 2: Backend ─────────────────────────────────────────────────
  console.log('\n[Startup] Etapa 2/3 — Backend');
  setLoadingStatus('Iniciando Backend...', 'Etapa 2 de 3');

  await startBackend();

  const backendOk = await waitForBackend();
  if (!backendOk) {
    setLoadingStatus(
      '❌ Backend não respondeu',
      `O servidor Express (porta ${backendPort}) não iniciou. Verifique os logs.`,
      'error'
    );
    console.error('[Startup] ❌ Backend falhou — app ficará na tela de erro.');
    return;
  }
  console.log(`[Startup] ✅ Backend OK — http://localhost:${backendPort}`);

  // ─ Etapa 3: Aquecimento do modelo ───────────────────────────────────
  console.log('\n[Startup] Etapa 3/3 — Aquecimento do modelo');
  setLoadingStatus(
    'Carregando modelo de IA...',
    'Etapa 3 de 3 — pode levar até 3 min na primeira vez'
  );

  const workingModel = await warmupModel([DEFAULT_OLLAMA_MODEL]);
  if (!workingModel) {
    console.warn('[Startup] ⚠  Modelo não aqueceu — app abrirá assim mesmo, 1ª resposta pode demorar.');
    setLoadingStatus('⚠️ Modelo não carregou', 'O app abrirá, mas a IA pode não responder.', 'warn');
    await new Promise((r) => setTimeout(r, 2500));
  } else {
    // Passa o modelo que funcionou para o backend via variável de ambiente
    process.env.OLLAMA_MODEL = workingModel;
    console.log(`[Startup] ✅ Modelo ativo: ${workingModel}`);
    setLoadingStatus('✅ Tudo pronto!', 'Abrindo...', 'done');
    await new Promise((r) => setTimeout(r, 800));
  }

  // ─ Navega para o app ─────────────────────────────────────────────────
  console.log('\n[Startup] ✅ Todos os serviços prontos — abrindo interface.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  if (isDev) {
    mainWindow.loadURL(devFrontendUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Encerra processos filhos ao fechar o app
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }

  // Só mata o Ollama se foi iniciado por nós (não se era do sistema)
  if (ollamaProcess) { ollamaProcess.kill(); ollamaProcess = null; }

  if (process.platform !== 'darwin') app.quit();
});
