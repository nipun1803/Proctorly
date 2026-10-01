import electron from "electron";
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, screen, Menu, clipboard } = electron;
import path from "path";
import fs from "fs";
import { fork } from "child_process";
import { ProctoringController, EXAM_STATES } from "./proctoringController.js";

let electronWindow = null;
let forceQuit = false;
let backendProcess = null;
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
        kiosk: false,
        frame: true,
        autoHideMenuBar: true,
        webPreferences: {
            webSecurity: true,
            devTools: false,
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(import.meta.dirname, 'preload.js')
        }
    });

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

    // ─── Clear clipboard during active exam ───
    setInterval(() => {
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
        electronWindow.setFullScreenable(true);
        electronWindow.setFullScreen(true);
        electronWindow.focus();
        return true;
    }
    return false;
});

ipcMain.handle('exit-fullscreen', () => {
    if (electronWindow && !electronWindow.isDestroyed()) {
        electronWindow.setFullScreen(false);
        return true;
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

// Legacy backward-compatibility adapters
ipcMain.handle('set-session-id', (_event, sessionId) => {
    if (proctoringController.session) {
        proctoringController.session.sessionId = sessionId;
    }
});

ipcMain.handle('store-camera-snap-image-on-disk', async (_event, data, _sessionId) => {
    const ts = proctoringController.getTimestamp();
    return await proctoringController.saveFaceSnapshot(data, ts);
});

ipcMain.handle('capture-screen', async () => {
    return await proctoringController.captureImmediate('MANUAL_OR_LEGACY');
});

ipcMain.handle('log-key', (_event, data) => {
    proctoringController.recordKeylog(data);
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    const serverPath = path.join(import.meta.dirname, '../backend/server.js');
    const sessionsPath = path.join(import.meta.dirname, '../backend/data/sessions.json');
    
    // Only fork backend if not already running on port 3000
    backendProcess = fork(serverPath, [], {
        env: { ...process.env, SESSIONS_PATH: sessionsPath }
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