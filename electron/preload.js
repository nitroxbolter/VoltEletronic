const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload seguro — expõe apenas o necessário ao renderer.
 * contextIsolation=true garante que o frontend React não tem acesso
 * direto aos módulos Node.js, protegendo contra XSS.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  // Abre o seletor de arquivo nativo e retorna o caminho escolhido
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  // Escaneia a pasta Schematic recursivamente (ignora arquivos borderview)
  scanSchematics: () => ipcRenderer.invoke('scan-schematics'),
  // Abre um arquivo com o programa padrão do sistema operacional
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  // Lê um arquivo local como Data URL base64 para exibir inline
  readFileAsDataUrl: (filePath) => ipcRenderer.invoke('read-file-as-dataurl', filePath),
});

contextBridge.exposeInMainWorld('debugAPI', {
  getLogs: () => ipcRenderer.invoke('debug:get-logs'),
  clearLogs: () => ipcRenderer.invoke('debug:clear-logs'),
  log: (level, text) => ipcRenderer.invoke('debug:renderer-log', level, text),
  onLog: (callback) => {
    const handler = (_event, entry) => callback(entry);
    ipcRenderer.on('debug-log', handler);
    return () => ipcRenderer.removeListener('debug-log', handler);
  },
});
