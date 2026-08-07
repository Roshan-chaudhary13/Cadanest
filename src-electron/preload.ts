import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  getStlData: (filePath: string) => ipcRenderer.invoke('get-stl-data', filePath),
  cancelProcess: () => ipcRenderer.invoke('cancel-process'),
  runAnalyze: (stepPath: string, originalPath?: string) => ipcRenderer.invoke('run-analyze', stepPath, originalPath),
  runAnalyzeBatch: (items: Array<{ stepPath: string; originalPath?: string }>) => ipcRenderer.invoke('run-analyze-batch', items),
  parseDxf: (dxfPath: string) => ipcRenderer.invoke('parse-dxf', dxfPath),
  parseCadAssembly: (filePath: string) => ipcRenderer.invoke('parse-cad-assembly', filePath),
  parseCadAssemblyBatch: (filePath: string) => ipcRenderer.invoke('parse-cad-assembly-batch', filePath),
  runUnfold: (args: { stepPath: string; kfactor: number; baseFace?: string; excludeBendLines?: boolean; bendStyle?: string; mirror?: boolean; exportMinimalDimpleHoles?: boolean; bendRadius?: number; etchMarkerPosition?: string; etchMarkerLength?: number }) => ipcRenderer.invoke('run-unfold', args),
  runUnfoldBatch: (items: Array<{ stepPath: string; kfactor: number; baseFace?: string; excludeBendLines?: boolean; bendStyle?: string; mirror?: boolean; exportMinimalDimpleHoles?: boolean; bendRadius?: number; etchMarkerPosition?: string; etchMarkerLength?: number }>) => ipcRenderer.invoke('run-unfold-batch', items),
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
    etchMarkerPosition?: string;
    etchMarkerLength?: number;
    parts: Array<{
      id: string;
      stepPath: string;
      dxfPath?: string;
      quantity: number;
      kfactor: number;
      baseFace?: string;
      etchMarkerPosition?: string;
      etchMarkerLength?: number;
    }>;
  }) => ipcRenderer.invoke('run-nesting', args),
  calibrateKFactor: (args: { targetFlatLength: number; straightSum: number; bendAngles: number[]; bendRadii: number[]; thickness: number }) => ipcRenderer.invoke('calibrate-kfactor', args),
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
