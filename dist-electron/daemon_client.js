import { spawn } from 'child_process';
export class DaemonClient {
    child = null;
    pythonPath;
    daemonScriptPath;
    mainWindow = null;
    pendingRequests = new Map();
    requestCounter = 0;
    isRestarting = false;
    constructor(pythonPath, daemonScriptPath) {
        this.pythonPath = pythonPath;
        this.daemonScriptPath = daemonScriptPath;
    }
    setMainWindow(win) {
        this.mainWindow = win;
    }
    start() {
        if (this.child)
            return;
        console.log(`Starting Python IPC Daemon: "${this.pythonPath}" "${this.daemonScriptPath}"`);
        this.child = spawn(this.pythonPath, [this.daemonScriptPath], {
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdoutBuffer = '';
        this.child.stdout?.on('data', (data) => {
            stdoutBuffer += data.toString('utf-8');
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || ''; // Keep trailing incomplete line
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                try {
                    const message = JSON.parse(trimmed);
                    if (message.type === 'progress') {
                        // Forward live progress streaming event to Electron renderer
                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                            this.mainWindow.webContents.send('daemon-progress', message);
                            if (message.method === 'run_nesting') {
                                this.mainWindow.webContents.send('nesting-progress', message);
                            }
                        }
                        continue;
                    }
                    if (message.id && this.pendingRequests.has(message.id)) {
                        const { resolve, reject } = this.pendingRequests.get(message.id);
                        this.pendingRequests.delete(message.id);
                        if (message.status === 'success') {
                            resolve(message.result !== undefined ? message.result : message);
                        }
                        else {
                            reject(new Error(message.error || 'Daemon request failed'));
                        }
                    }
                }
                catch (err) {
                    console.error(`Failed to parse daemon IPC stdout line: "${trimmed}"`, err);
                }
            }
        });
        this.child.stderr?.on('data', (data) => {
            console.warn(`[Daemon stderr]: ${data.toString('utf-8').trim()}`);
        });
        this.child.on('close', (code) => {
            console.warn(`Python Daemon process exited with code ${code}`);
            this.child = null;
            // Reject all pending requests
            for (const [id, { reject }] of this.pendingRequests.entries()) {
                reject(new Error(`Daemon process exited unexpectedly (code ${code})`));
            }
            this.pendingRequests.clear();
            // Auto-restart if not deliberately shut down
            if (!this.isRestarting) {
                console.log('Auto-restarting Python Daemon in 1 second...');
                setTimeout(() => this.start(), 1000);
            }
        });
        // Send initial ping to verify readiness
        this.sendRequest('ping', {}).then(res => {
            console.log('Python IPC Daemon ready:', res);
        }).catch(err => {
            console.error('Daemon ping check failed:', err.message);
        });
    }
    sendRequest(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.child || !this.child.stdin || this.child.killed) {
                this.start();
            }
            const reqId = `req_${Date.now()}_${++this.requestCounter}`;
            this.pendingRequests.set(reqId, { resolve, reject });
            const payload = {
                id: reqId,
                method,
                params
            };
            try {
                const jsonStr = JSON.stringify(payload) + '\n';
                this.child.stdin.write(jsonStr, 'utf-8');
            }
            catch (err) {
                this.pendingRequests.delete(reqId);
                reject(new Error(`Failed to write to daemon stdin: ${err.message}`));
            }
        });
    }
    stop() {
        this.isRestarting = true;
        if (this.child) {
            console.log('Stopping Python IPC Daemon...');
            try {
                this.child.kill();
            }
            catch (e) { }
            this.child = null;
        }
    }
}
