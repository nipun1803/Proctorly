const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("athena", {
    startExamSession: (params) => ipcRenderer.invoke('start-exam-session', params),
    stopExamSession: (endState, reason) => ipcRenderer.invoke('stop-exam-session', endState, reason),
    getExamState: () => ipcRenderer.invoke('get-exam-state'),
    setCurrentQuestion: (questionId) => ipcRenderer.invoke('set-current-question', questionId),
    enterFullscreen: () => ipcRenderer.invoke('enter-fullscreen'),
    exitFullscreen: () => ipcRenderer.invoke('exit-fullscreen'),

    // Evidence & Media Storage
    storeFaceSnapshot: (data, timestamp) => ipcRenderer.invoke('store-face-snapshot', data, timestamp),
    captureDesktopImmediate: (reason) => ipcRenderer.invoke('capture-desktop-immediate', reason),

    // System Process Checks
    getBackgroundApps: () => ipcRenderer.invoke('get-background-apps'),

    // Security & Keystroke Telemetry
    flagActivity: (flagType, details, questionId) => ipcRenderer.invoke('flag-activity', flagType, details, questionId),
    logMediaStatus: (eventType, details, questionId) => ipcRenderer.invoke('log-media-status', eventType, details, questionId),
    logKey: (data) => ipcRenderer.invoke('log-key', data),

    // Event Listeners
    onTimerTick: (callback) => {
        const fn = (_event, data) => callback(data);
        ipcRenderer.on('timer-tick', fn);
        return () => ipcRenderer.removeListener('timer-tick', fn);
    },
    onRequestFaceSnapshot: (callback) => {
        const fn = (_event, data) => callback(data);
        ipcRenderer.on('request-face-snapshot', fn);
        return () => ipcRenderer.removeListener('request-face-snapshot', fn);
    },
    onExamExpired: (callback) => {
        const fn = (_event) => callback();
        ipcRenderer.on('exam-expired', fn);
        return () => ipcRenderer.removeListener('exam-expired', fn);
    }
});
