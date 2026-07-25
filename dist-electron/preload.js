"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    selectFile: () => electron_1.ipcRenderer.invoke('select-file'),
    getStlData: (filePath) => electron_1.ipcRenderer.invoke('get-stl-data', filePath),
    cancelProcess: () => electron_1.ipcRenderer.invoke('cancel-process'),
    runAnalyze: (stepPath) => electron_1.ipcRenderer.invoke('run-analyze', stepPath),
    parseDxf: (dxfPath) => electron_1.ipcRenderer.invoke('parse-dxf', dxfPath),
    parseCadAssembly: (filePath) => electron_1.ipcRenderer.invoke('parse-cad-assembly', filePath),
    runUnfold: (args) => electron_1.ipcRenderer.invoke('run-unfold', args),
    runBatchStep: (args) => electron_1.ipcRenderer.invoke('run-batch-step', args),
    clearCache: () => electron_1.ipcRenderer.invoke('clear-cache'),
    runNesting: (args) => electron_1.ipcRenderer.invoke('run-nesting', args),
    openFile: (filePath) => electron_1.ipcRenderer.invoke('open-file', filePath),
    saveFileAs: (args) => electron_1.ipcRenderer.invoke('save-file-as', args),
    onNestingProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('nesting-progress', listener);
        return () => {
            electron_1.ipcRenderer.removeListener('nesting-progress', listener);
        };
    }
});
