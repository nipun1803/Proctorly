const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("athena", {
    // ─── Proctoring Session Management ───────────────────────────────────────
    startExamSession: (params) => {
        return ipcRenderer.invoke('start-exam-session', params);
    },
    stopExamSession: (endState, reason) => {
        return ipcRenderer.invoke('stop-exam-session', endState, reason);
    },
    getExamState: () => {
        return ipcRenderer.invoke('get-exam-state');
    },
    setCurrentQuestion: (questionId) => {
        return ipcRenderer.invoke('set-current-question', questionId);
    },
    enterFullscreen: () => {
        return ipcRenderer.invoke('enter-fullscreen');
    },
    exitFullscreen: () => {
        return ipcRenderer.invoke('exit-fullscreen');
    },

    // ─── Evidence Storage (Synchronized Timestamps) ──────────────────────────
    storeFaceSnapshot: (data, timestamp) => {
        return ipcRenderer.invoke('store-face-snapshot', data, timestamp);
    },
    captureDesktopImmediate: (reason) => {
        return ipcRenderer.invoke('capture-desktop-immediate', reason);
    },

    // ─── System & Process Checks ─────────────────────────────────────────────
    getBackgroundApps: () => {
        return ipcRenderer.invoke('get-background-apps');
    },

    // ─── Activity & Media Event Logging ──────────────────────────────────────
    flagActivity: (flagType, details, questionId) => {
        return ipcRenderer.invoke('flag-activity', flagType, details, questionId);
    },
    logMediaStatus: (eventType, details, questionId) => {
        return ipcRenderer.invoke('log-media-status', eventType, details, questionId);
    },
    logKey: (data) => {
        return ipcRenderer.invoke('log-key', data);
    },

    // ─── Event Listeners ─────────────────────────────────────────────────────
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
    },
    onExamStateChanged: (callback) => {
        const fn = (_event, data) => callback(data);
        ipcRenderer.on('exam-state-changed', fn);
        return () => ipcRenderer.removeListener('exam-state-changed', fn);
    },
    onBlockedKeybinding: (callback) => {
        const fn = (_event, data) => callback(data);
        ipcRenderer.on('blocked-keybinding', fn);
        return () => ipcRenderer.removeListener('blocked-keybinding', fn);
    },
    onFullscreenExited: (callback) => {
        const fn = (_event) => callback();
        ipcRenderer.on('fullscreen-exited', fn);
        return () => ipcRenderer.removeListener('fullscreen-exited', fn);
    },
    onFullscreenRestored: (callback) => {
        const fn = (_event) => callback();
        ipcRenderer.on('fullscreen-restored', fn);
        return () => ipcRenderer.removeListener('fullscreen-restored', fn);
    },
    onWindowFocusLost: (callback) => {
        const fn = (_event) => callback();
        ipcRenderer.on('window-focus-lost', fn);
        return () => ipcRenderer.removeListener('window-focus-lost', fn);
    },
    onWindowFocusRestored: (callback) => {
        const fn = (_event) => callback();
        ipcRenderer.on('window-focus-restored', fn);
        return () => ipcRenderer.removeListener('window-focus-restored', fn);
    },

    // ─── Legacy Adapters for Compatibility ───────────────────────────────────
    registerListenerForTimerTickFromMain: (callback) => {
        const fn = (_event, data) => callback(typeof data === 'object' ? data.elapsed : data);
        ipcRenderer.on('timer-tick', fn);
        return () => ipcRenderer.removeListener('timer-tick', fn);
    },
    registerListenerForCameraSnapFromMain: (callback) => {
        const fn = (_event, data) => callback(data);
        ipcRenderer.on('request-face-snapshot', fn);
        return () => ipcRenderer.removeListener('request-face-snapshot', fn);
    },
    registerListenerForBlockedKeybinding: (callback) => {
        const fn = (_event, data) => callback(data);
        ipcRenderer.on('blocked-keybinding', fn);
        return () => ipcRenderer.removeListener('blocked-keybinding', fn);
    },
    registerListenerForFullscreenExit: (callback) => {
        const fn = () => callback();
        ipcRenderer.on('fullscreen-exited', fn);
        return () => ipcRenderer.removeListener('fullscreen-exited', fn);
    },
    registerListenerForDurationExceeded: (callback) => {
        const fn = () => callback();
        ipcRenderer.on('exam-expired', fn);
        return () => ipcRenderer.removeListener('exam-expired', fn);
    },
    storeCameraSnapImageOnDisk: (data, sessionId) => {
        return ipcRenderer.invoke('store-camera-snap-image-on-disk', data, sessionId);
    },
    captureScreen: (sessionId) => {
        return ipcRenderer.invoke('capture-screen', sessionId);
    },
    setSessionId: (sessionId) => {
        return ipcRenderer.invoke('set-session-id', sessionId);
    }
});