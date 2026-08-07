import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DaemonClient } from './daemon_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
const activeProcesses: Map<string, any> = new Map();

// Force high-performance GPU hardware acceleration & WebGL performance in Electron
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('high-performance-gpu');
app.commandLine.appendSwitch('gpu-accelerated-canvas2d');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');

let pythonPath = 'C:\\Program Files\\FreeCAD 1.1\\bin\\python.exe';
const portablePython = path.join(__dirname, '../../FreeCAD_1.1.1-Windows-x86_64-py311/bin/python.exe');
if (fs.existsSync(portablePython)) {
  pythonPath = portablePython;
}
const daemonScriptPath = path.join(__dirname, '../backend/daemon.py');
const daemonClient = new DaemonClient(pythonPath, daemonScriptPath);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    backgroundColor: '#0F1016',
  });

  daemonClient.setMainWindow(mainWindow);
  daemonClient.start();

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    daemonClient.setMainWindow(null);
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
  console.log('Cadanest exiting: wiping session cache & terminating background processes...');
  try {
    await daemonClient.sendRequest('clear_cache', {});
  } catch (e) {}
  daemonClient.stop();
  for (const [pid, proc] of activeProcesses.entries()) {
    try {
      proc.kill();
      console.log(`Killed background process PID: ${pid}`);
    } catch (e) {}
  }
  activeProcesses.clear();
});

// IPC Handler for file selection (supporting MULTIPLE selections)
ipcMain.handle('select-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Sheet Metal Models, Assemblies & DXF Profiles',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'CAD Models, Assemblies & DXF', extensions: ['step', 'stp', 'iges', 'igs', 'dxf', 'asm', 'psm', 'par', 'sldprt', 'sldasm'] },
      { name: 'Solid Edge & SolidWorks CAD Assemblies', extensions: ['asm', 'psm', 'par', 'sldprt', 'sldasm'] },
      { name: '3D STEP Models', extensions: ['step', 'stp', 'iges', 'igs'] },
      { name: '2D DXF Flat Profiles', extensions: ['dxf'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths;
});

// IPC Handler to parse direct DXF files
ipcMain.handle('parse-dxf', async (_event, dxfPath: string) => {
  const desktopPath = path.join(app.getPath('desktop'), 'Cadanest');
  const exportsDir = path.join(desktopPath, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  const baseName = path.basename(dxfPath, path.extname(dxfPath));
  const svgPreviewOut = path.join(exportsDir, `${baseName}_preview.svg`);
  return daemonClient.sendRequest('parse_dxf', { dxfPath, svgPreviewOut });
});

// IPC Handler to parse Solid Edge & CAD assembly files (.asm, .psm, .par, .sldprt, .sldasm)
ipcMain.handle('parse-cad-assembly', async (_event, filePath: string) => {
  const desktopPath = path.join(app.getPath('desktop'), 'Cadanest');
  const exportsDir = path.join(desktopPath, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  return daemonClient.sendRequest('parse_cad_assembly', { filePath, exportDir: exportsDir });
});

// IPC Handler to batch-resolve & convert an assembly's .psm children to STEP
ipcMain.handle('parse-cad-assembly-batch', async (_event, asmPath: string) => {
  const desktopPath = path.join(app.getPath('desktop'), 'Cadanest');
  const exportsDir = path.join(desktopPath, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  return daemonClient.sendRequest('parse_cad_assembly_batch', { asmPath, exportDir: exportsDir });
});

// IPC Handler to load binary STL data safely into renderer process
ipcMain.handle('get-stl-data', async (_event, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    return null;
  } catch (e) {
    console.error('Error reading STL file:', e);
    return null;
  }
});

// IPC Handler to cancel any active background process
ipcMain.handle('cancel-process', async () => {
  console.log(`Cancelling active processes. Count: ${activeProcesses.size}`);
  for (const [pid, proc] of activeProcesses.entries()) {
    try {
      proc.kill();
      console.log(`Successfully killed process with PID: ${pid}`);
    } catch (e) {
      console.error(`Failed to kill process ${pid}:`, e);
    }
  }
  activeProcesses.clear();
  return true;
});

// IPC Handler to run fast 3D analysis & generate preview SVG & STL
ipcMain.handle('run-analyze', async (_event, stepPath: string, originalPath?: string) => {
  const desktopPath = path.join(app.getPath('desktop'), 'Cadanest');
  const exportsDir = path.join(desktopPath, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  const baseName = path.basename(stepPath, path.extname(stepPath));
  const svgPreviewOut = path.join(exportsDir, `${baseName}_preview.svg`);
  const stlPreviewOut = path.join(exportsDir, `${baseName}_preview.stl`);

  const res = await daemonClient.sendRequest('run_analyze', { stepPath, svgPreviewOut, stlPreviewOut, originalPath });
  if (res && res.status === 'success') {
    res.svg_preview_path = svgPreviewOut;
    res.stl_preview_path = stlPreviewOut;
    if (fs.existsSync(svgPreviewOut)) {
      res.svg_preview_content = fs.readFileSync(svgPreviewOut, 'utf8');
    }
  }
  return res;
});

// IPC Handler to batch run 3D geometry analysis in parallel via daemon multi-threading
ipcMain.handle('run-analyze-batch', async (_event, items: { stepPath: string; originalPath?: string }[]) => {
  const desktopPath = path.join(app.getPath('desktop'), 'Cadanest');
  const exportsDir = path.join(desktopPath, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const preparedItems = items.map((item) => {
    const baseName = path.basename(item.stepPath, path.extname(item.stepPath));
    const svgPreviewOut = path.join(exportsDir, `${baseName}_preview.svg`);
    const stlPreviewOut = path.join(exportsDir, `${baseName}_preview.stl`);
    return {
      stepPath: item.stepPath,
      originalPath: item.originalPath,
      svgPreviewOut,
      stlPreviewOut,
    };
  });

  const res = await daemonClient.sendRequest('run_analyze_batch', { items: preparedItems });
  if (res && res.status === 'success' && Array.isArray(res.results)) {
    for (const r of res.results) {
      if (r && r.status === 'success') {
        if (r.svg_preview_path && fs.existsSync(r.svg_preview_path)) {
          r.svg_preview_content = fs.readFileSync(r.svg_preview_path, 'utf8');
        }
      }
    }
  }
  return res;
});

// IPC Handler to run OpenCASCADE unfolding
ipcMain.handle('run-unfold', async (_event, args: { stepPath: string; kfactor: number; baseFace?: string; excludeBendLines?: boolean; bendStyle?: string; mirror?: boolean; exportMinimalDimpleHoles?: boolean; bendRadius?: number; etchMarkerPosition?: string; etchMarkerLength?: number }) => {
  const { stepPath, kfactor, baseFace, excludeBendLines, bendStyle, mirror, exportMinimalDimpleHoles, bendRadius, etchMarkerPosition, etchMarkerLength } = args;
  const desktopPath = path.join(app.getPath('desktop'), 'Cadanest');
  const exportsDir = path.join(desktopPath, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  const baseName = path.basename(stepPath, path.extname(stepPath));
  const baseFaceSuffix = baseFace ? `_${baseFace.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
  const mirrorSuffix = mirror ? '_MIR' : '';
  const dxfOut = path.join(exportsDir, `${baseName}${baseFaceSuffix}${mirrorSuffix}_unfolded.dxf`);
  const svgOut = path.join(exportsDir, `${baseName}${baseFaceSuffix}${mirrorSuffix}_unfolded.svg`);

  const res = await daemonClient.sendRequest('run_unfold', {
    stepPath,
    kfactor,
    dxfOut,
    svgOut,
    baseFace: baseFace || 'auto',
    excludeBendLines: Boolean(excludeBendLines),
    bendStyle: bendStyle || 'tick',
    mirror: Boolean(mirror),
    export_minimal_dimple_holes: exportMinimalDimpleHoles !== false,
    bendRadius,
    etchMarkerPosition: etchMarkerPosition || 'interior',
    etchMarkerLength: etchMarkerLength || 4.5
  });

  if (res && res.status === 'success') {
    res.dxf_path = dxfOut;
    res.svg_path = svgOut;
    if (fs.existsSync(svgOut)) {
      res.svg_content = fs.readFileSync(svgOut, 'utf8');
    }
  }
  return res;
});

// IPC Handler to run batch unfolding in parallel via daemon multi-threading
ipcMain.handle('run-unfold-batch', async (_event, items: Array<{ stepPath: string; kfactor: number; baseFace?: string; excludeBendLines?: boolean; bendStyle?: string; mirror?: boolean; exportMinimalDimpleHoles?: boolean; bendRadius?: number; etchMarkerPosition?: string; etchMarkerLength?: number }>) => {
  const desktopPath = path.join(app.getPath('desktop'), 'Cadanest');
  const exportsDir = path.join(desktopPath, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const preparedItems = items.map((item) => {
    const baseName = path.basename(item.stepPath, path.extname(item.stepPath));
    const baseFaceSuffix = item.baseFace ? `_${item.baseFace.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
    const mirrorSuffix = item.mirror ? '_MIR' : '';
    const dxfOut = path.join(exportsDir, `${baseName}${baseFaceSuffix}${mirrorSuffix}_unfolded.dxf`);
    const svgOut = path.join(exportsDir, `${baseName}${baseFaceSuffix}${mirrorSuffix}_unfolded.svg`);

    return {
      stepPath: item.stepPath,
      kfactor: item.kfactor,
      baseFace: item.baseFace || 'auto',
      excludeBendLines: Boolean(item.excludeBendLines),
      bendStyle: item.bendStyle || 'tick',
      mirror: Boolean(item.mirror),
      export_minimal_dimple_holes: item.exportMinimalDimpleHoles !== false,
      bendRadius: item.bendRadius,
      etchMarkerPosition: item.etchMarkerPosition || 'interior',
      etchMarkerLength: item.etchMarkerLength || 4.5,
      dxfOut,
      svgOut
    };
  });

  const res = await daemonClient.sendRequest('run_unfold_batch', { items: preparedItems });
  if (res && res.status === 'success' && Array.isArray(res.results)) {
    for (const r of res.results) {
      if (r && r.status === 'success') {
        if (r.svg_path && fs.existsSync(r.svg_path)) {
          r.svg_content = fs.readFileSync(r.svg_path, 'utf8');
        }
      }
    }
  }
  return res;
});

// IPC Handler to run BULK STEP processing
ipcMain.handle('run-batch-step', async (_event, args: { filePaths: string[]; kfactor?: number; bendStyle?: string; outputDir?: string }) => {
  const desktopPath = path.join(app.getPath('desktop'), 'Cadanest');
  const exportsDir = args.outputDir || path.join(desktopPath, 'exports', `Batch_${Date.now()}`);
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  return daemonClient.sendRequest('run_batch_step', {
    filePaths: args.filePaths,
    outputDir: exportsDir,
    kfactor: args.kfactor || 0.44,
    bendStyle: args.bendStyle || 'tick'
  });
});

// IPC Handler to clear persistent cache
ipcMain.handle('clear-cache', async () => {
  return daemonClient.sendRequest('clear_cache', {});
});

// IPC Handler to run FreeCAD nesting script
ipcMain.handle('run-nesting', async (_event, args: {
  sheetWidth: number;
  sheetHeight: number;
  spacing: number;
  margin: number;
  sheetCutoutWidth?: number;
  sheetCutoutHeight?: number;
  sheetProfile?: string;
  autoFill?: boolean;
  rotations?: number[];
  exportFilename?: string;
  excludeBendLines?: boolean;
  bendStyle?: string;
  etchMarkerPosition?: string;
  etchMarkerLength?: number;
  parts: Array<{
    id: string;
    stepPath: string;
    dxfPath?: string;
    quantity: number;
    kfactor: number;
    baseFace?: string;
    bendRadius?: number;
    etchMarkerPosition?: string;
    etchMarkerLength?: number;
  }>;
}) => {
  const desktopPath = path.join(app.getPath('desktop'), 'Cadanest');
  const exportsDir = path.join(desktopPath, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  const filename = args.exportFilename || `nested_${Date.now()}.dxf`;
  const exportDxfOut = path.join(exportsDir, filename);

  return daemonClient.sendRequest('run_nesting', {
    sheet_width: args.sheetWidth,
    sheet_height: args.sheetHeight,
    sheet_cutout_width: args.sheetCutoutWidth ?? null,
    sheet_cutout_height: args.sheetCutoutHeight ?? null,
    sheet_profile: args.sheetProfile ?? 'rect',
    spacing: args.spacing,
    margin: args.margin,
    auto_fill: args.autoFill || false,
    rotations: args.rotations || [0.0, 90.0, 180.0, 270.0],
    export_dxf_path: exportDxfOut,
    exclude_bend_lines: args.excludeBendLines || false,
    bend_style: (args as any).bendStyle || 'tick',
    allow_part_in_part: (args as any).allowPartInPart !== false,
    export_minimal_dimple_holes: (args as any).exportMinimalDimpleHoles !== false,
    parts: args.parts.map(p => ({
      id: p.id,
      step_path: p.stepPath,
      dxf_path: p.dxfPath || null,
      quantity: p.quantity,
      kfactor: p.kfactor,
      base_face: p.baseFace || null,
      name: (p as any).name || null,
      group: (p as any).group || null,
      material: (p as any).material || 'Mild Steel',
      thickness: typeof (p as any).thickness === 'number' ? (p as any).thickness : 2.0,
      bend_radius: p.bendRadius || null
    }))
  });
});

// IPC Handler to run reverse K-factor calibration solver
ipcMain.handle('calibrate-kfactor', async (_event, args: {
  targetFlatLength: number;
  straightSum: number;
  bendAngles: number[];
  bendRadii: number[];
  thickness: number;
}) => {
  return daemonClient.sendRequest('calibrate_kfactor', {
    target_flat_length: args.targetFlatLength,
    straight_sum: args.straightSum,
    bend_angles: args.bendAngles,
    bend_radii: args.bendRadii,
    thickness: args.thickness
  });
});

// IPC Handler to open a file/folder in Windows Explorer
ipcMain.handle('open-file', async (_event, filePath: string) => {
  if (!filePath) return false;
  try {
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved)) {
      shell.showItemInFolder(resolved);
      return true;
    }
  } catch (e) {
    console.error(`Failed to open path: ${filePath}`, e);
  }
  return false;
});

// IPC Handler to copy a file using dialog.showSaveDialog
ipcMain.handle('save-file-as', async (event, args: { sourcePath: string; defaultFilename: string }) => {
  if (!args.sourcePath || !fs.existsSync(args.sourcePath)) {
    return { status: 'error', error: 'Source file does not exist.' };
  }
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { filePath } = await dialog.showSaveDialog(win!, {
      title: 'Save DXF File As',
      defaultPath: path.join(app.getPath('documents'), args.defaultFilename),
      filters: [
        { name: 'DXF Files', extensions: ['dxf'] }
      ]
    });
    if (filePath) {
      fs.copyFileSync(args.sourcePath, filePath);
      return { status: 'success', filePath };
    }
    return { status: 'cancelled' };
  } catch (err: any) {
    return { status: 'error', error: err.message };
  }
});
