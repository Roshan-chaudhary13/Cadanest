"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
let mainWindow = null;
const activeProcesses = new Map();
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        titleBarStyle: 'default',
        autoHideMenuBar: true,
        backgroundColor: '#0F1016',
    });
    const isDev = !electron_1.app.isPackaged && process.env.NODE_ENV !== 'production';
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('will-quit', () => {
    console.log('Cadanest exiting: terminating background child processes...');
    for (const [pid, proc] of activeProcesses.entries()) {
        try {
            proc.kill();
            console.log(`Killed background process PID: ${pid}`);
        }
        catch (e) { }
    }
    activeProcesses.clear();
});
let pythonPath = 'C:\\Program Files\\FreeCAD 1.1\\bin\\python.exe';
const portablePython = path_1.default.join(__dirname, '../../FreeCAD_1.1.1-Windows-x86_64-py311/bin/python.exe');
if (fs_1.default.existsSync(portablePython)) {
    pythonPath = portablePython;
}
const scriptPath = path_1.default.join(__dirname, '../backend/unfolder.py');
const nesterScriptPath = path_1.default.join(__dirname, '../backend/nester.py');
const batchScriptPath = path_1.default.join(__dirname, '../backend/batch_processor.py');
const solidBridgePath = path_1.default.join(__dirname, '../backend/solid_edge_bridge.py');
// IPC Handler for file selection (supporting MULTIPLE selections)
electron_1.ipcMain.handle('select-file', async () => {
    if (!mainWindow)
        return null;
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
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
electron_1.ipcMain.handle('parse-dxf', async (_event, dxfPath) => {
    return new Promise((resolve) => {
        const desktopPath = path_1.default.join(electron_1.app.getPath('desktop'), 'Cadanest');
        const exportsDir = path_1.default.join(desktopPath, 'exports');
        if (!fs_1.default.existsSync(exportsDir)) {
            fs_1.default.mkdirSync(exportsDir, { recursive: true });
        }
        const baseName = path_1.default.basename(dxfPath, path_1.default.extname(dxfPath));
        const svgPreviewOut = path_1.default.join(exportsDir, `${baseName}_preview.svg`);
        const cmdArgs = [scriptPath, 'parse_dxf', dxfPath, svgPreviewOut];
        console.log(`Spawning DXF Parse: "${pythonPath}" ${cmdArgs.join(' ')}`);
        const child = (0, child_process_1.spawn)(pythonPath, cmdArgs);
        let stdoutData = '';
        let stderrData = '';
        child.stdout.on('data', (d) => stdoutData += d.toString());
        child.stderr.on('data', (d) => stderrData += d.toString());
        child.on('close', (code) => {
            if (code !== 0) {
                resolve({ status: 'error', error: `DXF parse failed: ${stderrData || 'Unknown error'}` });
                return;
            }
            try {
                const jsonMatch = stdoutData.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    resolve(JSON.parse(jsonMatch[0]));
                }
                else {
                    resolve({ status: 'error', error: 'Invalid response from DXF parser script' });
                }
            }
            catch (err) {
                resolve({ status: 'error', error: `Failed to parse DXF JSON: ${err.message}` });
            }
        });
    });
});
// IPC Handler to parse Solid Edge & CAD assembly files (.asm, .psm, .par, .sldprt, .sldasm)
electron_1.ipcMain.handle('parse-cad-assembly', async (_event, filePath) => {
    return new Promise((resolve) => {
        const desktopPath = path_1.default.join(electron_1.app.getPath('desktop'), 'Cadanest');
        const exportsDir = path_1.default.join(desktopPath, 'exports');
        if (!fs_1.default.existsSync(exportsDir)) {
            fs_1.default.mkdirSync(exportsDir, { recursive: true });
        }
        const cmdArgs = [solidBridgePath, filePath, exportsDir];
        console.log(`Spawning CAD Assembly Bridge: "${pythonPath}" ${cmdArgs.join(' ')}`);
        const child = (0, child_process_1.spawn)(pythonPath, cmdArgs);
        let stdoutData = '';
        let stderrData = '';
        child.stdout.on('data', (d) => stdoutData += d.toString());
        child.stderr.on('data', (d) => stderrData += d.toString());
        child.on('close', (code) => {
            if (code !== 0) {
                resolve({ status: 'error', error: `CAD Assembly parse failed: ${stderrData || 'Unknown error'}` });
                return;
            }
            try {
                const jsonMatch = stdoutData.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    resolve(JSON.parse(jsonMatch[0]));
                }
                else {
                    resolve({ status: 'error', error: 'Invalid response from CAD assembly bridge' });
                }
            }
            catch (err) {
                resolve({ status: 'error', error: `Failed to parse assembly JSON: ${err.message}` });
            }
        });
    });
});
// IPC Handler to load binary STL data safely into renderer process
electron_1.ipcMain.handle('get-stl-data', async (_event, filePath) => {
    try {
        if (fs_1.default.existsSync(filePath)) {
            const buffer = fs_1.default.readFileSync(filePath);
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        }
        return null;
    }
    catch (e) {
        console.error('Error reading STL file:', e);
        return null;
    }
});
// IPC Handler to cancel any active background process
electron_1.ipcMain.handle('cancel-process', async () => {
    console.log(`Cancelling active processes. Count: ${activeProcesses.size}`);
    for (const [pid, proc] of activeProcesses.entries()) {
        try {
            proc.kill();
            console.log(`Successfully killed process with PID: ${pid}`);
        }
        catch (e) {
            console.error(`Failed to kill process ${pid}:`, e);
        }
    }
    activeProcesses.clear();
    return true;
});
// IPC Handler to run fast 3D analysis & generate preview SVG & STL
electron_1.ipcMain.handle('run-analyze', async (_event, stepPath) => {
    return new Promise((resolve) => {
        const desktopPath = path_1.default.join(electron_1.app.getPath('desktop'), 'Cadanest');
        const exportsDir = path_1.default.join(desktopPath, 'exports');
        if (!fs_1.default.existsSync(exportsDir)) {
            fs_1.default.mkdirSync(exportsDir, { recursive: true });
        }
        const baseName = path_1.default.basename(stepPath, path_1.default.extname(stepPath));
        const svgPreviewOut = path_1.default.join(exportsDir, `${baseName}_preview.svg`);
        const stlPreviewOut = path_1.default.join(exportsDir, `${baseName}_preview.stl`);
        const cmdArgs = [scriptPath, 'analyze', stepPath, svgPreviewOut, stlPreviewOut];
        console.log(`Spawning: "${pythonPath}" ${cmdArgs.join(' ')}`);
        const child = (0, child_process_1.spawn)(pythonPath, cmdArgs);
        const pidStr = child.pid?.toString() || Math.random().toString();
        activeProcesses.set(pidStr, child);
        const timeout = setTimeout(() => {
            if (activeProcesses.has(pidStr)) {
                console.warn(`Analysis process timed out for path: ${stepPath}. Killing process...`);
                try {
                    child.kill();
                }
                catch (e) { }
                activeProcesses.delete(pidStr);
                resolve({
                    status: 'error',
                    error: 'Analysis timed out. The CAD model might be too complex or double-curved.'
                });
            }
        }, 15000);
        let stdoutData = '';
        let stderrData = '';
        child.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderrData += data.toString();
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            activeProcesses.delete(pidStr);
            if (code !== 0) {
                resolve({
                    status: 'error',
                    error: `Analysis backend failed with code ${code}. Error: ${stderrData || 'Unknown error'}`
                });
                return;
            }
            try {
                const lines = stdoutData.trim().split('\n');
                const lastLine = lines[lines.length - 1];
                const resultJson = JSON.parse(lastLine);
                if (resultJson.status === 'success') {
                    resultJson.svg_preview_path = svgPreviewOut;
                    resultJson.stl_preview_path = stlPreviewOut;
                    if (fs_1.default.existsSync(svgPreviewOut)) {
                        resultJson.svg_preview_content = fs_1.default.readFileSync(svgPreviewOut, 'utf8');
                    }
                }
                resolve(resultJson);
            }
            catch (err) {
                resolve({
                    status: 'error',
                    error: `Failed to parse analysis output: ${err.message}. Output was: ${stdoutData}`
                });
            }
        });
    });
});
// IPC Handler to run single unfolding script
electron_1.ipcMain.handle('run-unfold', async (_event, args) => {
    return new Promise((resolve) => {
        const { stepPath, kfactor, baseFace, excludeBendLines, bendStyle } = args;
        const desktopPath = path_1.default.join(electron_1.app.getPath('desktop'), 'Cadanest');
        const exportsDir = path_1.default.join(desktopPath, 'exports');
        if (!fs_1.default.existsSync(exportsDir)) {
            fs_1.default.mkdirSync(exportsDir, { recursive: true });
        }
        const baseName = path_1.default.basename(stepPath, path_1.default.extname(stepPath));
        const baseFaceSuffix = baseFace ? `_${baseFace.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
        const dxfOut = path_1.default.join(exportsDir, `${baseName}${baseFaceSuffix}_unfolded.dxf`);
        const svgOut = path_1.default.join(exportsDir, `${baseName}${baseFaceSuffix}_unfolded.svg`);
        const cmdArgs = [
            scriptPath,
            'unfold',
            stepPath,
            kfactor.toString(),
            dxfOut,
            svgOut,
            baseFace || 'auto',
            excludeBendLines ? 'true' : 'false',
            bendStyle || 'tick'
        ];
        console.log(`Spawning: "${pythonPath}" ${cmdArgs.join(' ')}`);
        const child = (0, child_process_1.spawn)(pythonPath, cmdArgs);
        const pidStr = child.pid?.toString() || Math.random().toString();
        activeProcesses.set(pidStr, child);
        const timeout = setTimeout(() => {
            if (activeProcesses.has(pidStr)) {
                console.warn(`Unfold process timed out for path: ${stepPath}. Killing process...`);
                try {
                    child.kill();
                }
                catch (e) { }
                activeProcesses.delete(pidStr);
                resolve({
                    status: 'error',
                    error: 'Unfold process timed out.'
                });
            }
        }, 25000);
        let stdoutData = '';
        let stderrData = '';
        child.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderrData += data.toString();
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            activeProcesses.delete(pidStr);
            if (code !== 0) {
                resolve({
                    status: 'error',
                    error: `Unfolding backend failed with code ${code}. Error: ${stderrData || 'Unknown error'}`
                });
                return;
            }
            try {
                const lines = stdoutData.trim().split('\n');
                const lastLine = lines[lines.length - 1];
                const resultJson = JSON.parse(lastLine);
                if (resultJson.status === 'success') {
                    resultJson.dxf_path = dxfOut;
                    resultJson.svg_path = svgOut;
                    if (fs_1.default.existsSync(svgOut)) {
                        resultJson.svg_content = fs_1.default.readFileSync(svgOut, 'utf8');
                    }
                }
                resolve(resultJson);
            }
            catch (err) {
                resolve({
                    status: 'error',
                    error: `Failed to parse backend output: ${err.message}. Output was: ${stdoutData}`
                });
            }
        });
    });
});
// IPC Handler to run BULK STEP processing
electron_1.ipcMain.handle('run-batch-step', async (_event, args) => {
    return new Promise((resolve) => {
        const desktopPath = path_1.default.join(electron_1.app.getPath('desktop'), 'Cadanest');
        const exportsDir = args.outputDir || path_1.default.join(desktopPath, 'exports', `Batch_${Date.now()}`);
        if (!fs_1.default.existsSync(exportsDir)) {
            fs_1.default.mkdirSync(exportsDir, { recursive: true });
        }
        const configPath = path_1.default.join(electron_1.app.getPath('temp'), `batch_config_${Date.now()}.json`);
        const configData = {
            file_paths: args.filePaths,
            output_dir: exportsDir,
            kfactor: args.kfactor || 0.40,
            bend_style: args.bendStyle || 'tick'
        };
        try {
            fs_1.default.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
        }
        catch (e) {
            resolve({ status: 'error', error: `Failed to write batch config: ${e.message}` });
            return;
        }
        const pythonCode = `
import json, sys
from batch_processor import run_batch_step_processing
with open(r'${configPath.replace(/\\/g, '\\\\')}', 'r', encoding='utf-8') as f:
    cfg = json.load(f)
res = run_batch_step_processing(cfg['file_paths'], cfg['output_dir'], cfg['kfactor'], cfg['bend_style'])
print(json.dumps(res))
`;
        const cmdArgs = ['-c', pythonCode];
        console.log(`Spawning Batch STEP Processor: "${pythonPath}" ${cmdArgs.join(' ')}`);
        const child = (0, child_process_1.spawn)(pythonPath, cmdArgs);
        const pidStr = child.pid?.toString() || Math.random().toString();
        activeProcesses.set(pidStr, child);
        let stdoutData = '';
        let stderrData = '';
        child.stdout.on('data', (d) => stdoutData += d.toString());
        child.stderr.on('data', (d) => stderrData += d.toString());
        child.on('close', (code) => {
            activeProcesses.delete(pidStr);
            try {
                if (fs_1.default.existsSync(configPath))
                    fs_1.default.unlinkSync(configPath);
            }
            catch (e) { }
            if (code !== 0) {
                resolve({ status: 'error', error: `Batch processing failed: ${stderrData || stdoutData}` });
                return;
            }
            try {
                const lines = stdoutData.trim().split('\n');
                const lastLine = lines[lines.length - 1];
                resolve(JSON.parse(lastLine));
            }
            catch (err) {
                resolve({ status: 'error', error: `Failed to parse batch output: ${err.message}` });
            }
        });
    });
});
// IPC Handler to clear persistent cache
electron_1.ipcMain.handle('clear-cache', async () => {
    return new Promise((resolve) => {
        const pythonCode = `
import json
from cache_manager import clear_cache_folder
clear_cache_folder()
print(json.dumps({"status": "success"}))
`;
        const child = (0, child_process_1.spawn)(pythonPath, ['-c', pythonCode]);
        child.on('close', () => resolve({ status: 'success' }));
    });
});
// IPC Handler to run FreeCAD nesting script
electron_1.ipcMain.handle('run-nesting', async (_event, args) => {
    return new Promise((resolve) => {
        const desktopPath = path_1.default.join(electron_1.app.getPath('desktop'), 'Cadanest');
        const exportsDir = path_1.default.join(desktopPath, 'exports');
        if (!fs_1.default.existsSync(exportsDir)) {
            fs_1.default.mkdirSync(exportsDir, { recursive: true });
        }
        const filename = args.exportFilename || `nested_${Date.now()}.dxf`;
        const exportDxfOut = path_1.default.join(exportsDir, filename);
        const configPath = path_1.default.join(electron_1.app.getPath('temp'), `nest_config_${Date.now()}.json`);
        const pythonConfig = {
            sheet_width: args.sheetWidth,
            sheet_height: args.sheetHeight,
            spacing: args.spacing,
            margin: args.margin,
            auto_fill: args.autoFill || false,
            rotations: args.rotations || [0.0, 90.0, 180.0, 270.0],
            export_dxf_path: exportDxfOut,
            exclude_bend_lines: args.excludeBendLines || false,
            parts: args.parts.map(p => ({
                id: p.id,
                step_path: p.stepPath,
                dxf_path: p.dxfPath || null,
                quantity: p.quantity,
                kfactor: p.kfactor,
                base_face: p.baseFace || null,
                name: p.name || null,
                group: p.group || null
            }))
        };
        try {
            fs_1.default.writeFileSync(configPath, JSON.stringify(pythonConfig, null, 2), 'utf8');
        }
        catch (writeErr) {
            resolve({
                status: 'error',
                error: `Failed to write nesting configuration: ${writeErr.message}`
            });
            return;
        }
        const cmdArgs = [nesterScriptPath, configPath];
        console.log(`Spawning Nesting Process: "${pythonPath}" ${cmdArgs.join(' ')}`);
        const child = (0, child_process_1.spawn)(pythonPath, cmdArgs);
        const pidStr = child.pid?.toString() || Math.random().toString();
        activeProcesses.set(pidStr, child);
        const timeout = setTimeout(() => {
            if (activeProcesses.has(pidStr)) {
                console.warn(`Nesting process timed out. Killing...`);
                try {
                    child.kill();
                }
                catch (e) { }
                activeProcesses.delete(pidStr);
                resolve({
                    status: 'error',
                    error: 'Nesting process timed out. Try reducing part count or increasing spacing.'
                });
            }
        }, 900000);
        let stdoutData = '';
        let stderrData = '';
        child.stdout.on('data', (data) => {
            const text = data.toString();
            stdoutData += text;
            const lines = text.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (parsed.type === 'progress') {
                            mainWindow?.webContents.send('nesting-progress', parsed);
                        }
                    }
                    catch (e) { }
                }
            }
        });
        child.stderr.on('data', (data) => {
            stderrData += data.toString();
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            activeProcesses.delete(pidStr);
            try {
                if (fs_1.default.existsSync(configPath)) {
                    fs_1.default.unlinkSync(configPath);
                }
            }
            catch (err) { }
            if (code !== 0) {
                resolve({
                    status: 'error',
                    error: `Nesting backend failed with code ${code}. Error: ${stderrData || 'Unknown error or cancelled'}`
                });
                return;
            }
            try {
                const lines = stdoutData.trim().split('\n');
                const lastLine = lines[lines.length - 1];
                const resultJson = JSON.parse(lastLine);
                resolve(resultJson);
            }
            catch (err) {
                resolve({
                    status: 'error',
                    error: `Failed to parse nesting output: ${err.message}. Output was: ${stdoutData}`
                });
            }
        });
    });
});
// IPC Handler to open a file/folder in Windows Explorer
electron_1.ipcMain.handle('open-file', async (_event, filePath) => {
    if (!filePath)
        return false;
    try {
        const resolved = path_1.default.resolve(filePath);
        if (fs_1.default.existsSync(resolved)) {
            electron_1.shell.showItemInFolder(resolved);
            return true;
        }
    }
    catch (e) {
        console.error(`Failed to open path: ${filePath}`, e);
    }
    return false;
});
// IPC Handler to copy a file using dialog.showSaveDialog
electron_1.ipcMain.handle('save-file-as', async (event, args) => {
    if (!args.sourcePath || !fs_1.default.existsSync(args.sourcePath)) {
        return { status: 'error', error: 'Source file does not exist.' };
    }
    try {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        const { filePath } = await electron_1.dialog.showSaveDialog(win, {
            title: 'Save DXF File As',
            defaultPath: path_1.default.join(electron_1.app.getPath('documents'), args.defaultFilename),
            filters: [
                { name: 'DXF Files', extensions: ['dxf'] }
            ]
        });
        if (filePath) {
            fs_1.default.copyFileSync(args.sourcePath, filePath);
            return { status: 'success', filePath };
        }
        return { status: 'cancelled' };
    }
    catch (err) {
        return { status: 'error', error: err.message };
    }
});
