import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  getStlData: (filePath: string) => ipcRenderer.invoke('get-stl-data', filePath),
  cancelProcess: () => ipcRenderer.invoke('cancel-process'),
  runAnalyze: (stepPath: string) => ipcRenderer.invoke('run-analyze', stepPath),
  parseDxf: (dxfPath: string) => ipcRenderer.invoke('parse-dxf', dxfPath),
  parseCadAssembly: (filePath: string) => ipcRenderer.invoke('parse-cad-assembly', filePath),
  runUnfold: (args: { stepPath: string; kfactor: number; baseFace?: string; excludeBendLines?: boolean; bendStyle?: string }) => ipcRenderer.invoke('run-unfold', args),
  runBatchStep: (args: { filePaths: string[]; kfactor?: number; bendStyle?: string; outputDir?: string }) => ipcRenderer.invoke('run-batch-step', args),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  runNesting: (args: {
    sheetWidth: number;
    sheetHeight: number;
    spacing: number;
    margin: number;
    autoFill?: boolean;
    rotations?: number[];
    exportFilename?: string;
    excludeBendLines?: boolean;
    parts: Array<{
      id: string;
      stepPath: string;
      dxfPath?: string;
      quantity: number;
      kfactor: number;
      baseFace?: string;
    }>;
  }) => ipcRenderer.invoke('run-nesting', args),
  openFile: (filePath: string) => ipcRenderer.invoke('open-file', filePath),
  saveFileAs: (args: { sourcePath: string; defaultFilename: string }) => ipcRenderer.invoke('save-file-as', args),
  onNestingProgress: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('nesting-progress', listener);
    return () => {
      ipcRenderer.removeListener('nesting-progress', listener);
    };
  }
});
