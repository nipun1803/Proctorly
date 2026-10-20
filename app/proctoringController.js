import fs from 'fs';
import path from 'path';
import electron from 'electron';
import { exec } from 'child_process';

const { desktopCapturer, globalShortcut } = electron;

export const EXAM_STATES = {
    PRE_EXAM: 'PRE_EXAM',
    READY: 'READY',
    STARTING: 'STARTING',
    ACTIVE: 'ACTIVE',
    SUBMITTING: 'SUBMITTING',
    SUBMITTED: 'SUBMITTED',
    EXPIRED: 'EXPIRED',
    ABORTED: 'ABORTED',
};

export const BLOCKED_APPS = [
    'zoom', 'teamviewer', 'discord', 'slack', 'skype', 'telegram',
    'anydesk', 'chrome remote desktop', 'vnc', 'screenshare',
    'obs', 'obs studio', 'streamlabs', 'bandicam', 'camtasia',
    'whatsapp', 'messenger', 'signal', 'line'
];

// Blocked key sets for high-performance O(1) input interception
const BLOCKED_CMD_CTRL_KEYS = new Set(['c', 'v', 'x', 'a', 'p', 's', 'f', 'u', 'r', 'h', 'w', 'm', 'tab', ' ']);
const BLOCKED_SHIFT_KEYS = new Set(['r', 'i', 'j', 'c']);
const BLOCKED_SYSTEM_KEYS = new Set(['printscreen', 'f3', 'f4', 'f11', 'f12', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

export class ProctoringController {
    constructor() {
        this.state = EXAM_STATES.PRE_EXAM;
        this.window = null;
        this.session = null;
        this.currentQuestionId = 1;
        this.captureIntervalMs = 10000;
        this.captureTimer = null;
        this.clockTimer = null;
        this.kioskEnforceTimer = null;
        this.keylogBuffer = [];
        this.keylogFlushTimer = null;
        this.backendUrl = 'http://localhost:3000';
    }

    initDisplayMonitoring() {
        try {
            if (electron.screen) {
                electron.screen.on('display-added', () => {
                    if (this.state === EXAM_STATES.ACTIVE) {
                        this.flagBackend('EXTERNAL_DISPLAY_DETECTED', 'Secondary display connected during exam', this.currentQuestionId);
                        this.captureImmediate('EXTERNAL_DISPLAY_DETECTED');
                        this.safeSend('external-display-detected', { count: electron.screen.getAllDisplays().length });
                        this.reclaimFocus();
                    }
                });
            }
        } catch {}
    }

    setWindow(win) {
        this.window = win;
        this.initDisplayMonitoring();
        // If window is already kiosk on creation, apply macOS workspace pinning safely
        if (this.window && !this.window.isDestroyed() && this.window.isKiosk()) {
            this.enterExamFullscreen();
        }
    }

    // ─── Kiosk & Display Lockdown ───────────────────────────────────────────
    enterExamFullscreen() {
        if (!this.window || this.window.isDestroyed()) return;
        try {
            this.window.setFullScreenable(true);
            // On macOS: pin window to ALL spaces/virtual desktops so 3-finger swipe does NOT switch screens
            if (process.platform === 'darwin') {
                this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
            }
            // Elevate window level above Mission Control, Dock, and other apps
            this.window.setAlwaysOnTop(true, 'screen-saver', 1);
            if (!this.window.isKiosk()) this.window.setKiosk(true);
            if (!this.window.isFullScreen()) this.window.setFullScreen(true);
            this.window.moveTop();
            this.window.focus();
        } catch (err) {
            console.warn('Failed to enter kiosk mode:', err.message);
        }
    }

    exitExamFullscreen() {
        if (!this.window || this.window.isDestroyed()) return;
        try {
            if (process.platform === 'darwin') {
                this.window.setVisibleOnAllWorkspaces(false);
            }
            this.window.setAlwaysOnTop(false);
            if (this.window.isKiosk()) this.window.setKiosk(false);
            if (this.window.isFullScreen()) this.window.setFullScreen(false);
        } catch (err) {
            console.warn('Failed to exit kiosk mode:', err.message);
        }
    }

    reclaimFocus() {
        if (!this.window || this.window.isDestroyed()) return;
        try {
            if (process.platform === 'darwin') {
                this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
            }
            this.window.setAlwaysOnTop(true, 'screen-saver', 1);
            this.window.moveTop();
            this.window.focus();
        } catch {}
    }

    safeSend(channel, payload) {
        try {
            if (this.window && !this.window.isDestroyed() && this.window.webContents && !this.window.webContents.isDestroyed()) {
                this.window.webContents.send(channel, payload);
                return true;
            }
        } catch {}
        return false;
    }

    getState() {
        return this.state;
    }

    getSession() {
        return this.session;
    }

    setCurrentQuestionId(qId) {
        const num = Number(qId);
        if (!isNaN(num) && num > 0) {
            this.currentQuestionId = num;
        }
    }

    getTimestamp() {
        return new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    }

    getSessionDir() {
        if (!this.session?.sessionId) return null;
        const dataDir = electron.app?.isPackaged
            ? path.join(electron.app.getPath('userData'), 'data')
            : path.join(import.meta.dirname, '../backend/data');
        return path.join(dataDir, 'sessions', this.session.sessionId);
    }

    ensureSessionDirs() {
        const dir = this.getSessionDir();
        if (!dir) return;
        fs.mkdirSync(path.join(dir, 'screenshots'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'camerashots'), { recursive: true });
    }

    // ─── Session Lifecycle ───────────────────────────────────────────────────
    async startSession({ sessionId, studentId, studentName, mode = 'PROCTORED', durationSec = 1800 }) {
        if (this.state === EXAM_STATES.ACTIVE) return this.session;

        this.state = EXAM_STATES.STARTING;
        const startedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + durationSec * 1000).toISOString();

        this.session = {
            sessionId,
            studentId,
            studentName,
            mode,
            startedAt,
            submittedAt: null,
            expiresAt,
            durationSec,
            status: EXAM_STATES.ACTIVE
        };

        this.ensureSessionDirs();

        // Check for multiple monitors connected
        const displayInfo = ProctoringController.checkDisplays();
        if (displayInfo.isMultiDisplay) {
            this.flagBackend('MULTI_DISPLAY_DETECTED', `Candidate started exam with ${displayInfo.count} connected displays`, this.currentQuestionId);
        }

        if (this.window && !this.window.isDestroyed()) {
            if (mode === 'PROCTORED') {
                this.enterExamFullscreen();
            }
            this.window.show();
            this.window.focus();
        }

        this.registerGlobalShortcuts();
        this.startKioskEnforcement();
        this.state = EXAM_STATES.ACTIVE;
        this.startClockTimer();
        this.startCaptureScheduler();

        return this.session;
    }

    async stopSession(endState = EXAM_STATES.SUBMITTED, reason = 'Normal submission') {
        if (this.state !== EXAM_STATES.ACTIVE && this.state !== EXAM_STATES.STARTING) return;

        this.state = EXAM_STATES.SUBMITTING;
        this.stopCaptureScheduler();
        this.stopClockTimer();
        this.stopKioskEnforcement();
        this.unregisterGlobalShortcuts();
        this.exitExamFullscreen();
        this.flushKeylogs();

        const eventType = endState === EXAM_STATES.EXPIRED ? 'EXAM_EXPIRED' : (endState === EXAM_STATES.ABORTED ? 'EXAM_ABORTED' : 'EXAM_SUBMITTED');
        this.logEvent(eventType, this.currentQuestionId, { reason });

        if (this.session) {
            this.session.status = endState;
            this.session.submittedAt = new Date().toISOString();
        }

        this.state = endState;
        this.safeSend('exam-state-changed', { state: this.state, sessionId: this.session?.sessionId });
    }

    // ─── Dual Synchronized Evidence Capture ──────────────────────────────────
    startCaptureScheduler() {
        this.stopCaptureScheduler();
        setTimeout(() => {
            if (this.state === EXAM_STATES.ACTIVE) this.triggerSynchronizedCapture();
        }, 3000);

        this.captureTimer = setInterval(() => {
            if (this.state !== EXAM_STATES.ACTIVE || !this.window || this.window.isDestroyed()) {
                this.stopCaptureScheduler();
                return;
            }
            this.triggerSynchronizedCapture();
        }, this.captureIntervalMs);
    }

    stopCaptureScheduler() {
        if (this.captureTimer) {
            clearInterval(this.captureTimer);
            this.captureTimer = null;
        }
    }

    async triggerSynchronizedCapture() {
        if (this.state !== EXAM_STATES.ACTIVE || !this.session) return;
        const timestamp = this.getTimestamp();
        await this.captureDesktop(timestamp);
        this.safeSend('request-face-snapshot', { timestamp });
    }

    async captureDesktop(timestamp) {
        if (!this.session) return;
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;

        let pngBuffer = null;
        try {
            const primary = electron.screen?.getPrimaryDisplay();
            if (!primary) return;
            const { width, height } = primary.size;
            const scale = primary.scaleFactor || 1;
            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: {
                    width: Math.min(1920, Math.floor(width * scale)),
                    height: Math.min(1080, Math.floor(height * scale))
                }
            });
            if (sources?.length > 0) {
                const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
                pngBuffer = screenSource.thumbnail.toPNG();
            }
        } catch {}

        if ((!pngBuffer || pngBuffer.length === 0) && this.window && !this.window.isDestroyed()) {
            try {
                const img = await this.window.webContents.capturePage();
                pngBuffer = img.toPNG();
            } catch {}
        }

        if (pngBuffer?.length > 0) {
            const filename = `${timestamp}.png`;
            const filePath = path.join(sessionDir, 'screenshots', filename);
            try {
                fs.writeFileSync(filePath, pngBuffer);
                fetch(`${this.backendUrl}/exam/capture`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: this.session.sessionId,
                        type: 'screen',
                        filename,
                        timestamp,
                        questionId: this.currentQuestionId,
                        path: path.relative(path.join(import.meta.dirname, '..'), filePath)
                    })
                }).catch(() => {});
                return filePath;
            } catch (err) {
                console.warn('Failed saving screenshot:', err.message);
            }
        }
    }

    async saveFaceSnapshot(arrayBuffer, timestamp) {
        if (this.state !== EXAM_STATES.ACTIVE || !this.session) return;
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;

        const filename = `${timestamp}.jpg`;
        const filePath = path.join(sessionDir, 'camerashots', filename);
        try {
            fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
            fetch(`${this.backendUrl}/exam/capture`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.session.sessionId,
                    type: 'camera',
                    filename,
                    timestamp,
                    questionId: this.currentQuestionId,
                    path: path.relative(path.join(import.meta.dirname, '..'), filePath)
                })
            }).catch(() => {});
            return filePath;
        } catch (err) {
            console.warn('Failed saving face snapshot:', err.message);
        }
    }

    async captureImmediate(reason) {
        if (this.state !== EXAM_STATES.ACTIVE || !this.session) return;
        try {
            const timestamp = this.getTimestamp();
            await this.captureDesktop(timestamp);
            this.logEvent('IMMEDIATE_CAPTURE', this.currentQuestionId, { reason, timestamp });
        } catch {}
    }

    // ─── Authoritative Clock ─────────────────────────────────────────────────
    startClockTimer() {
        this.stopClockTimer();
        const startTime = Date.now();
        const totalSec = this.session?.durationSec || 1800;

        this.safeSend('timer-tick', { elapsed: 0, remaining: totalSec });

        this.clockTimer = setInterval(() => {
            if (this.state !== EXAM_STATES.ACTIVE || !this.window || this.window.isDestroyed()) {
                this.stopClockTimer();
                return;
            }
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = Math.max(0, totalSec - elapsed);
            this.safeSend('timer-tick', { elapsed, remaining });

            if (remaining <= 0) {
                this.handleExamExpired();
            }
        }, 1000);
    }

    stopClockTimer() {
        if (this.clockTimer) {
            clearInterval(this.clockTimer);
            this.clockTimer = null;
        }
    }

    async handleExamExpired() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        this.safeSend('exam-expired');
        try {
            await fetch(`${this.backendUrl}/exam/expire`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.session?.sessionId })
            });
        } catch {}
        await this.stopSession(EXAM_STATES.EXPIRED, 'Exam duration limit reached');
    }

    // ─── Global Shortcuts & Continuous Lockdown Watchdog ────────────────────
    registerGlobalShortcuts() {
        this.unregisterGlobalShortcuts();
        const shortcuts = [
            'CommandOrControl+Space',
            'CommandOrControl+H',
            'CommandOrControl+M',
            'CommandOrControl+Alt+Escape',
            'CommandOrControl+W',
            'CommandOrControl+Tab',
            'Alt+Tab',
            'Alt+Escape',
            'Control+Left',
            'Control+Right',
            'Control+Up',
            'Control+Down',
            'F3',
            'F4',
            'F11',
            'F12'
        ];

        shortcuts.forEach(shortcut => {
            try {
                globalShortcut.register(shortcut, () => {
                    if (this.state === EXAM_STATES.ACTIVE) {
                        this.logEvent('SHORTCUT_BLOCKED', this.currentQuestionId, { shortcut });
                        this.flagBackend('SHORTCUT_BLOCKED', `Blocked global shortcut: ${shortcut}`, this.currentQuestionId);
                        this.safeSend('blocked-keybinding', { key: shortcut, timestamp: new Date().toISOString() });
                        this.reclaimFocus();
                    }
                });
            } catch {}
        });
    }

    unregisterGlobalShortcuts() {
        try {
            globalShortcut.unregisterAll();
        } catch {}
    }

    startKioskEnforcement() {
        this.stopKioskEnforcement();
        this.kioskEnforceTimer = setInterval(() => {
            if (this.state !== EXAM_STATES.ACTIVE || !this.window || this.window.isDestroyed()) {
                this.stopKioskEnforcement();
                return;
            }
            if (!this.window.isKiosk() || !this.window.isFocused()) {
                this.reclaimFocus();
            }
        }, 1000);
    }

    stopKioskEnforcement() {
        if (this.kioskEnforceTimer) {
            clearInterval(this.kioskEnforceTimer);
            this.kioskEnforceTimer = null;
        }
    }

    // ─── Window Event Handlers ───────────────────────────────────────────────
    async handleFocusLost() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        console.warn('Window focus lost during active exam');

        this.logEvent('WINDOW_FOCUS_LOST', this.currentQuestionId);
        this.flagBackend('WINDOW_FOCUS_LOST', 'Window focus lost (possible application switch)', this.currentQuestionId);
        await this.captureImmediate('WINDOW_FOCUS_LOST');
        this.flushKeylogs();
        this.safeSend('window-focus-lost');

        if (this.session?.mode === 'PROCTORED') {
            this.reclaimFocus();
        }
    }

    handleFocusRestored() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        this.logEvent('WINDOW_FOCUS_RESTORED', this.currentQuestionId);
        this.safeSend('window-focus-restored');
    }

    async handleFullscreenExited() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        if (this.window && !this.window.isDestroyed() && (this.window.isFullScreen() || this.window.isKiosk())) {
            return;
        }

        console.warn('Fullscreen mode exited during active exam');
        this.logEvent('FULLSCREEN_EXITED', this.currentQuestionId);
        this.flagBackend('FULLSCREEN_EXITED', 'Fullscreen exited', this.currentQuestionId);
        await this.captureImmediate('FULLSCREEN_EXITED');
        this.flushKeylogs();
        this.safeSend('fullscreen-exited');
    }

    handleFullscreenRestored() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        this.logEvent('FULLSCREEN_RESTORED', this.currentQuestionId);
        this.safeSend('fullscreen-restored');
    }

    // ─── Input & Keystroke Telemetry ─────────────────────────────────────────
    handleInputEvent(event, input) {
        if (this.state !== EXAM_STATES.ACTIVE) return;

        if (input.type === 'keyDown') {
            this.recordKeylog(input);
        }

        if (this.isBlockedInput(input)) {
            event.preventDefault();
            this.logEvent('SHORTCUT_BLOCKED', this.currentQuestionId, { key: input.key });
            this.flagBackend('SHORTCUT_BLOCKED', `Blocked shortcut: ${input.key}`, this.currentQuestionId);
            this.flushKeylogs();
            this.safeSend('blocked-keybinding', {
                key: input.key,
                ctrl: input.control,
                meta: input.meta,
                alt: input.alt,
                shift: input.shift,
                timestamp: new Date().toISOString()
            });
        }
    }

    isBlockedInput(input) {
        if (!input?.key) return false;
        const key = input.key.toLowerCase();
        const hasCmdOrCtrl = !!(input.control || input.meta);
        const hasShift = !!input.shift;
        const hasAlt = !!input.alt;

        if (hasCmdOrCtrl && hasShift && BLOCKED_SHIFT_KEYS.has(key)) return true;
        if (hasCmdOrCtrl && hasAlt && key === 'escape') return true;
        if (hasAlt && (key === 'tab' || key === 'f4')) return true;
        if (hasCmdOrCtrl && (BLOCKED_CMD_CTRL_KEYS.has(key) || BLOCKED_SYSTEM_KEYS.has(key))) return true;
        if (!hasCmdOrCtrl && !hasAlt && !hasShift && (key === 'printscreen' || key === 'f3' || key === 'f4' || key === 'f11' || key === 'f12')) {
            return true;
        }
        return false;
    }

    recordKeylog(input) {
        if (!this.session) return;
        const modifiers = [];
        if (input.meta) modifiers.push('Cmd');
        if (input.control) modifiers.push('Ctrl');
        if (input.alt) modifiers.push('Alt');
        if (input.shift) modifiers.push('Shift');
        const key = input.key || input.code || 'Unknown';
        const combo = modifiers.length > 0 && !modifiers.includes(key) ? `${modifiers.join('+')}+${key}` : key;

        const entry = {
            sessionId: this.session.sessionId,
            timestamp: new Date().toISOString(),
            questionId: this.currentQuestionId,
            eventType: input.type === 'keyDown' ? 'KEY_DOWN' : 'KEY_UP',
            key,
            combination: combo,
            modifiers: { meta: !!input.meta, ctrl: !!input.control, alt: !!input.alt, shift: !!input.shift },
            isBlocked: this.isBlockedInput(input)
        };

        this.keylogBuffer.push(entry);

        if (entry.isBlocked || input.meta || input.control || input.alt) {
            this.flushKeylogs();
        } else if (!this.keylogFlushTimer) {
            this.keylogFlushTimer = setTimeout(() => this.flushKeylogs(), 250);
        }
    }

    flushKeylogs() {
        if (this.keylogFlushTimer) {
            clearTimeout(this.keylogFlushTimer);
            this.keylogFlushTimer = null;
        }
        if (this.keylogBuffer.length === 0 || !this.session) return;
        const batch = [...this.keylogBuffer];
        this.keylogBuffer = [];

        // Append to local session log
        const sessionDir = this.getSessionDir();
        if (sessionDir) {
            try {
                const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
                fs.appendFileSync(path.join(sessionDir, 'keylogs.jsonl'), lines);
            } catch {}
        }

        // Post batch to backend (backend atomically syncs sessions.json and keylogs.json)
        fetch(`${this.backendUrl}/exam/keylog`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: this.session.sessionId, keylogs: batch })
        }).catch(() => {});
    }

    // ─── Proctoring Events & Backend Flags ────────────────────────────────────
    logEvent(eventType, questionId = null, metadata = {}) {
        if (!this.session) return;
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;

        const record = {
            sessionId: this.session.sessionId,
            timestamp: new Date().toISOString(),
            eventType,
            questionId: questionId !== null ? questionId : this.currentQuestionId,
            metadata
        };

        try {
            fs.appendFileSync(path.join(sessionDir, 'events.jsonl'), JSON.stringify(record) + '\n');
        } catch {}
    }

    async flagBackend(type, details = '', questionId = null) {
        if (!this.session) return;
        try {
            await fetch(`${this.backendUrl}/exam/flag`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.session.sessionId,
                    type,
                    details,
                    questionId: questionId !== null ? questionId : this.currentQuestionId,
                    timestamp: new Date().toISOString()
                })
            });
        } catch (err) {
            this.logEvent('BACKEND_UNAVAILABLE', questionId, { endpoint: '/exam/flag', error: err.message });
        }
    }

    // ─── Multi-Display Verification ──────────────────────────────────────────
    static checkDisplays() {
        try {
            if (!electron.screen) return { count: 1, isMultiDisplay: false, displays: [] };
            const displays = electron.screen.getAllDisplays();
            const primaryId = electron.screen.getPrimaryDisplay()?.id;
            return {
                count: displays.length,
                isMultiDisplay: displays.length > 1,
                displays: displays.map(d => ({
                    id: d.id,
                    bounds: d.bounds,
                    isPrimary: d.id === primaryId
                }))
            };
        } catch {
            return { count: 1, isMultiDisplay: false, displays: [] };
        }
    }

    // ─── Process Enumeration ─────────────────────────────────────────────────
    static getRunningProcesses() {
        return new Promise((resolve) => {
            const platform = process.platform;
            const cmd = platform === 'darwin'
                ? `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`
                : (platform === 'win32' ? 'tasklist /FO CSV /NH' : 'ps -eo comm --no-headers | sort -u');

            exec(cmd, (error, stdout) => {
                if (error || !stdout) {
                    return resolve({ allApps: [], blockedApps: [] });
                }

                let apps = [];
                if (platform === 'darwin') {
                    apps = stdout.split(',').map(s => s.trim()).filter(Boolean);
                } else if (platform === 'win32') {
                    apps = stdout.split('\n')
                        .map(l => (l.match(/^"([^"]+)"/) || [])[1]?.replace('.exe', ''))
                        .filter(Boolean);
                } else {
                    apps = stdout.split('\n').map(l => l.trim().split('/').pop()).filter(Boolean);
                }

                const ignored = new Set(['electron', 'athena', 'proctorly', 'antigravity ide', 'system events']);
                const filtered = [...new Set(apps)].filter(a => !ignored.has(a.toLowerCase()));
                const blocked = filtered.filter(a => BLOCKED_APPS.some(b => a.toLowerCase().includes(b)));

                resolve({ allApps: filtered, blockedApps: blocked });
            });
        });
    }
}
