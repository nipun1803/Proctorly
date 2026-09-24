const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("athena", {
    startExamSession: (params) => ipcRenderer.invoke('start-exam-session', params),
    stopExamSession: (endState, reason) => ipcRenderer.invoke('stop-exam-session', endState, reason),
    getExamState: () => ipcRenderer.invoke('get-exam-state'),
    setCurrentQuestion: (questionId) => ipcRenderer.invoke('set-current-question', questionId),
    enterFullscreen: () => ipcRenderer.invoke('enter-fullscreen'),
    exitFullscreen: () => ipcRenderer.invoke('exit-fullscreen')
});
