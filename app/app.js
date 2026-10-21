// ─── Stream & Error Protection (Prevents write EIO / EPIPE crashes) ─────────
for (const stream of [process.stdout, process.stderr]) {
    if (stream && typeof stream.on === 'function') {
        stream.on('error', (err) => {
            if (err && (err.code === 'EPIPE' || err.code === 'EIO' || err.message?.includes('write EIO') || err.message?.includes('write EPIPE'))) {
                return; // Suppress broken pipe / closed terminal writes
            }
        });
    }
}

// Protect console methods from throwing synchronously on dead stdio
for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
    const orig = console[method];
    if (typeof orig === 'function') {
        console[method] = (...args) => {
            try {
                orig(...args);
            } catch (err) {
                if (err && (err.code === 'EPIPE' || err.code === 'EIO' || err.message?.includes('write EIO') || err.message?.includes('write EPIPE'))) {
                    return;
                }
            }
        };
    }
}

// Global uncaught exception filter to prevent Electron modal popups on stream write errors
process.on('uncaughtException', (err) => {
    if (err && (err.code === 'EPIPE' || err.code === 'EIO' || err.message?.includes('write EIO') || err.message?.includes('write EPIPE'))) {
        return; // Ignore broken stream write errors
    }
    console.error('Uncaught Exception in Main Process:', err);
});

process.on('unhandledRejection', (reason) => {
    if (reason && (reason.code === 'EPIPE' || reason.code === 'EIO' || reason.message?.includes('write EIO') || reason.message?.includes('fetch failed'))) {
        return;
    }
    console.error('Unhandled Rejection in Main Process:', reason);
});

import electron from "electron";
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, Menu, clipboard } = electron;
import path from "path";
import fs from "fs";
import { fork } from "child_process";
import { ProctoringController, EXAM_STATES } from "./proctoringController.js";

let electronWindow = null;
let forceQuit = false;
let backendProcess = null;
let clipboardInterval = null;
const proctoringController = new ProctoringController();

// ─── Quit Handler ─────────────────────────────────────────────────────────────
function attemptQuit() {
    if (forceQuit) return;
    const currentState = proctoringController.getState();
    const isExamActive = currentState === EXAM_STATES.ACTIVE;

    dialog.showMessageBox(electronWindow, {
        type: 'warning',
        buttons: ['Yes, Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Confirm Quit',
        message: isExamActive 
            ? 'An exam is currently in progress. Quitting now will abort your exam attempt. Are you sure?'
            : 'Are you sure you want to quit Proctorly?'
    }).then(async (res) => {
        if (res.response === 0) {
            forceQuit = true;
            if (isExamActive) {
                await proctoringController.stopSession(EXAM_STATES.ABORTED, 'Candidate confirmed quit');
            }
            app.quit();
        }
    });
}

// ─── Create Window ────────────────────────────────────────────────────────────
function createWindow() {
    electronWindow = new BrowserWindow({
        height: 1000,
        width: 1300,
        minWidth: 900,
        minHeight: 700,
        fullscreen: false,
        fullscreenable: true,
        kiosk: true,
        frame: false,
        icon: path.join(import.meta.dirname, '../build/icon.png'),
        autoHideMenuBar: true,
        webPreferences: {
            webSecurity: true,
            devTools: false,
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(import.meta.dirname, 'preload.js')
        }
    });

    if (process.platform === 'darwin' && typeof electronWindow.setWindowButtonVisibility === 'function') {
        try {
            electronWindow.setWindowButtonVisibility(false);
        } catch {
            // Frameless windows have no window buttons
        }
    }

    proctoringController.setWindow(electronWindow);

    if (app.isPackaged) {
        electronWindow.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
    } else {
        electronWindow.loadURL('http://localhost:5173').catch(() => {
            console.log("Dev server not detected on localhost:5173, loading production bundle from dist/index.html");
            electronWindow.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
        });
    }

    Menu.setApplicationMenu(null);

    // Prevent navigation to unknown domains
    electronWindow.webContents.on('will-navigate', (event, url) => {
        const allowedOrigins = ['http://localhost:5173', 'file://'];
        if (!allowedOrigins.some(origin => url.startsWith(origin))) {
            event.preventDefault();
        }
    });

    // Prevent opening new windows/popups
    electronWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });

    // ─── Keyboard Input & Shortcut Interception ───
    electronWindow.webContents.on('before-input-event', (event, input) => {
        // Handle Ctrl+Q / Cmd+Q for quit confirmation
        if ((input.control || input.meta) && input.key.toLowerCase() === 'q') {
            event.preventDefault();
            attemptQuit();
            return;
        }

        // Delegate to proctoring controller
        proctoringController.handleInputEvent(event, input);
    });

    // ─── Block context menu ───
    electronWindow.webContents.on('context-menu', (e) => {
        e.preventDefault();
    });

    // ─── Window Blur / Focus Monitoring ───
    electronWindow.on('blur', () => {
        proctoringController.handleFocusLost();
    });

    electronWindow.on('focus', () => {
        proctoringController.handleFocusRestored();
    });

    // ─── Fullscreen Exit / Enter Monitoring ───
    electronWindow.on('leave-full-screen', () => {
        proctoringController.handleFullscreenExited();
    });

    electronWindow.on('enter-full-screen', () => {
        proctoringController.handleFullscreenRestored();
    });

    // ─── Prevent window close without confirmation ───
    electronWindow.on('close', (e) => {
        if (!forceQuit) {
            e.preventDefault();
            attemptQuit();
        }
    });

    // ─── Renderer Crash / Disconnect Watchdog ───
    electronWindow.webContents.on('render-process-gone', (_event, details) => {
        console.warn('Renderer process gone:', details?.reason);
        proctoringController.stopClockTimer();
        proctoringController.stopCaptureScheduler();
        proctoringController.stopKioskEnforcement();
    });

    electronWindow.on('closed', () => {
        if (clipboardInterval) {
            clearInterval(clipboardInterval);
            clipboardInterval = null;
        }
        proctoringController.stopClockTimer();
        proctoringController.stopCaptureScheduler();
        proctoringController.stopKioskEnforcement();
        proctoringController.setWindow(null);
        electronWindow = null;
    });

    // ─── Clear clipboard during active exam ───
    if (clipboardInterval) clearInterval(clipboardInterval);
    clipboardInterval = setInterval(() => {
        if (proctoringController.getState() === EXAM_STATES.ACTIVE) {
            try {
                clipboard.clear();
            } catch {
                // Ignore clipboard errors
            }
        }
    }, 2000);
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// Start Exam Session
ipcMain.handle('start-exam-session', async (_event, params) => {
    return await proctoringController.startSession(params);
});

// Fullscreen Control
ipcMain.handle('enter-fullscreen', () => {
    if (electronWindow && !electronWindow.isDestroyed()) {
        try {
            proctoringController.enterExamFullscreen();
            return true;
        } catch (err) {
            console.error('Failed to enter fullscreen:', err);
            return false;
        }
    }
    return false;
});

ipcMain.handle('exit-fullscreen', () => {
    if (electronWindow && !electronWindow.isDestroyed()) {
        try {
            proctoringController.exitExamFullscreen();
            return true;
        } catch (err) {
            console.error('Failed to exit fullscreen:', err);
            return false;
        }
    }
    return false;
});

ipcMain.handle('is-fullscreen', () => {
    if (electronWindow && !electronWindow.isDestroyed()) {
        return electronWindow.isFullScreen() || electronWindow.isKiosk();
    }
    return false;
});

// Stop / Submit Exam Session
ipcMain.handle('stop-exam-session', async (_event, endState, reason) => {
    await proctoringController.stopSession(endState, reason);
    return { success: true };
});

// Get Exam State
ipcMain.handle('get-exam-state', () => {
    return proctoringController.getState();
});

// Track current question ID for log attribution
ipcMain.handle('set-current-question', (_event, questionId) => {
    proctoringController.setCurrentQuestionId(questionId);
});

// Store face snapshot from renderer with synchronized timestamp
ipcMain.handle('store-face-snapshot', async (_event, data, timestamp) => {
    return await proctoringController.saveFaceSnapshot(data, timestamp);
});

// Capture desktop screenshot immediately (e.g. on focus lost or fullscreen exit)
ipcMain.handle('capture-desktop-immediate', async (_event, reason) => {
    await proctoringController.captureImmediate(reason);
});

// Background applications check
ipcMain.handle('get-background-apps', async () => {
    return await ProctoringController.getRunningProcesses();
});

// Multi-display verification
ipcMain.handle('check-displays', () => {
    return ProctoringController.checkDisplays();
});

// Flag activity to backend and session events
ipcMain.handle('flag-activity', async (_event, flagType, details, questionId) => {
    proctoringController.logEvent(flagType, questionId, { details });
    await proctoringController.flagBackend(flagType, details, questionId);
});

// Media track disconnection / reconnection logging
ipcMain.handle('log-media-status', async (_event, eventType, details, questionId) => {
    proctoringController.logEvent(eventType, questionId, { details });
    await proctoringController.flagBackend(eventType, details, questionId);
});

// Keystroke logging from renderer
ipcMain.handle('log-key', (_event, data) => {
    proctoringController.recordKeylog(data);
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    const isPackaged = app.isPackaged;
    const serverPath = isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked/backend/server.js')
        : path.join(import.meta.dirname, '../backend/server.js');

    const dataDir = isPackaged
        ? path.join(app.getPath('userData'), 'data')
        : path.join(import.meta.dirname, '../backend/data');

    if (!fs.existsSync(dataDir)) {
        try { fs.mkdirSync(dataDir, { recursive: true }); } catch { }
    }
    const sessionsPath = path.join(dataDir, 'sessions.json');
    
    // Only fork backend if not already running on port 3000
    fetch('http://localhost:3000/exam/mcq')
        .then(() => {
            console.log('Backend server already running on http://localhost:3000');
        })
        .catch(() => {
            try {
                backendProcess = fork(serverPath, [], {
                    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SESSIONS_PATH: sessionsPath, DATA_DIR: dataDir },
                    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
                });
                backendProcess.on('error', (err) => {
                    console.warn('Backend process error:', err.message);
                });
            } catch (err) {
                console.warn('Failed to fork backend server:', err.message);
            }
        });

    app.on('will-quit', () => {
        proctoringController.flushKeylogs();
        proctoringController.unregisterGlobalShortcuts();
        proctoringController.stopKioskEnforcement();
        if (backendProcess) backendProcess.kill();
    });

    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
                const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
                callback({ video: screenSource, audio: 'loopback' });
            });
        },
        { useSystemPicker: true }
    );

    createWindow();
});