const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  getStlData: (filePath) => ipcRenderer.invoke('get-stl-data', filePath),
  cancelProcess: () => ipcRenderer.invoke('cancel-process'),
  runAnalyze: (stepPath, originalPath) => ipcRenderer.invoke('run-analyze', stepPath, originalPath),
  runAnalyzeBatch: (items) => ipcRenderer.invoke('run-analyze-batch', items),
  parseDxf: (dxfPath) => ipcRenderer.invoke('parse-dxf', dxfPath),
  parseCadAssembly: (filePath) => ipcRenderer.invoke('parse-cad-assembly', filePath),
  parseCadAssemblyBatch: (filePath) => ipcRenderer.invoke('parse-cad-assembly-batch', filePath),
  runUnfold: (args) => ipcRenderer.invoke('run-unfold', args),
  runUnfoldBatch: (items) => ipcRenderer.invoke('run-unfold-batch', items),
  runBatchStep: (args) => ipcRenderer.invoke('run-batch-step', args),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  runNesting: (args) => ipcRenderer.invoke('run-nesting', args),
  calibrateKFactor: (args) => ipcRenderer.invoke('calibrate-kfactor', args),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  saveFileAs: (args) => ipcRenderer.invoke('save-file-as', args),
  onNestingProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('nesting-progress', listener);
    return () => {
      ipcRenderer.removeListener('nesting-progress', listener);
    };
  }
});
