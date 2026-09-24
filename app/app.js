import electron from "electron";
const { app, BrowserWindow, ipcMain, dialog } = electron;
import path from "path";
import { fork } from "child_process";

let mainWindow = null;
let backendProcess = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1300,
        height: 1000,
        minWidth: 900,
        minHeight: 700,
        fullscreen: false,
        kiosk: false,
        autoHideMenuBar: true,
        webPreferences: {
            webSecurity: true,
            devTools: false,
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(import.meta.dirname, 'preload.js')
        }
    });

    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
    }

    mainWindow.on('close', (e) => {
        // Confirmation dialog for window close
    });
}

function startBackend() {
    const backendPath = path.join(import.meta.dirname, '../backend/server.js');
    backendProcess = fork(backendPath, [], { stdio: 'inherit' });
}

app.whenReady().then(() => {
    startBackend();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (backendProcess) backendProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});
