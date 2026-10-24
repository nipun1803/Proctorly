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

// Sets keep shortcut checks fast without scanning lists on every keypress.
const BLOCKED_CMD_CTRL_KEYS = new Set(['c', 'v', 'x', 'a', 'p', 's', 'f', 'u', 'r', 'h', 'w', 'm', 'tab', ' ']);
const BLOCKED_SHIFT_KEYS = new Set(['r', 'i', 'j', 'c']);
const BLOCKED_SYSTEM_KEYS = new Set(['printscreen', 'f3', 'f4', 'f11', 'f12', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const BLOCKED_PLAIN_KEYS = new Set(['printscreen', 'f3', 'f4', 'f11', 'f12']);
const GLOBAL_SHORTCUTS = [
    'CommandOrControl+Space', 'CommandOrControl+H', 'CommandOrControl+M',
    'CommandOrControl+Alt+Escape', 'CommandOrControl+W', 'CommandOrControl+Tab',
    'Alt+Tab', 'Alt+Escape', 'Control+Left', 'Control+Right', 'Control+Up',
    'Control+Down', 'F3', 'F4', 'F11', 'F12'
];

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

    // HTTP failures are handled by each caller: flags record BACKEND_UNAVAILABLE,
    // while capture/keylog uploads are best-effort after evidence is saved locally.
    postBackend(endpoint, payload) {
        return fetch(`${this.backendUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    clearTimer(name, clear = clearInterval) {
        if (this[name]) {
            clear(this[name]);
            this[name] = null;
        }
    }

    // Recurring monitors stop when the exam ends or its window disappears.
    // The initial three-second capture remains separate and only checks exam state.
    scheduleActiveInterval(name, intervalMs, onTick) {
        this[name] = setInterval(() => {
            if (this.state !== EXAM_STATES.ACTIVE || !this.hasWindow()) {
                this.clearTimer(name);
                return;
            }
            onTick();
        }, intervalMs);
    }

    hasWindow() { return !!this.window && !this.window.isDestroyed(); }

    pinWindow() {
        // Pin to all macOS spaces and elevate above Mission Control and Dock.
        if (process.platform === 'darwin') {
            this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        }
        this.window.setAlwaysOnTop(true, 'screen-saver', 1);
    }

    focusWindow() {
        this.window.moveTop();
        if (electron.app?.focus) electron.app.focus({ steal: true });
        this.window.focus();
    }

    initDisplayMonitoring() {
        try {
            electron.screen?.on('display-added', () => {
                if (this.state !== EXAM_STATES.ACTIVE) return;
                this.flagBackend('EXTERNAL_DISPLAY_DETECTED', 'Secondary display connected during exam', this.currentQuestionId);
                this.captureImmediate('EXTERNAL_DISPLAY_DETECTED');
                this.safeSend('external-display-detected', { count: electron.screen.getAllDisplays().length });
                this.reclaimFocus();
            });
        } catch {} // Display APIs may be unavailable before Electron is ready.
    }

    setWindow(win) {
        this.window = win;
        this.initDisplayMonitoring();
        // If window is already kiosk on creation, apply macOS workspace pinning safely
        if (this.hasWindow() && this.window.isKiosk()) this.enterExamFullscreen();
    }

    // ─── Kiosk & Display Lockdown ───────────────────────────────────────────
    enterExamFullscreen() {
        if (!this.hasWindow()) return;
        try {
            this.window.setFullScreenable(true);
            this.pinWindow();
            if (!this.window.isKiosk()) this.window.setKiosk(true);
            if (process.platform !== 'darwin' && !this.window.isFullScreen()) this.window.setFullScreen(true);
            this.focusWindow();
        } catch (err) {
            console.warn('Failed to enter kiosk mode:', err.message);
        }
    }

    exitExamFullscreen() {
        if (!this.hasWindow()) return;
        try {
            if (process.platform === 'darwin') this.window.setVisibleOnAllWorkspaces(false);
            this.window.setAlwaysOnTop(false);
            if (this.window.isKiosk()) this.window.setKiosk(false);
            if (this.window.isFullScreen()) this.window.setFullScreen(false);
        } catch (err) {
            console.warn('Failed to exit kiosk mode:', err.message);
        }
    }

    reclaimFocus() {
        if (!this.hasWindow()) return;
        try {
            this.pinWindow();
            this.focusWindow();
        } catch {} // A closing window must not crash the main process.
    }

    safeSend(channel, payload) {
        try {
            if (this.hasWindow() && this.window.webContents && !this.window.webContents.isDestroyed()) {
                this.window.webContents.send(channel, payload);
                return true;
            }
        } catch {}
        return false;
    }

    getState() { return this.state; }
    getSession() { return this.session; }

    setCurrentQuestionId(qId) {
        const num = Number(qId);
        if (!isNaN(num) && num > 0) this.currentQuestionId = num;
    }

    getTimestamp() {
        return new Date().toISOString().replace(/[:.]/g, '-');
    }

    getSessionDir() {
        if (!this.session?.sessionId) return null;
        // Installed apps write to userData; development keeps the existing backend/data location.
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
            sessionId, studentId, studentName, mode, startedAt,
            submittedAt: null, expiresAt, durationSec, status: EXAM_STATES.ACTIVE
        };

        this.ensureSessionDirs();

        // Check for multiple monitors connected
        const displayInfo = ProctoringController.checkDisplays();
        if (displayInfo.isMultiDisplay) {
            this.flagBackend('MULTI_DISPLAY_DETECTED', `Candidate started exam with ${displayInfo.count} connected displays`, this.currentQuestionId);
        }

        if (this.hasWindow()) {
            if (mode === 'PROCTORED') this.enterExamFullscreen();
            this.window.show();
            this.window.focus();
        }

        // Register security first, then mark ACTIVE so clock/capture callbacks can run.
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
        // Stop monitoring before releasing kiosk mode, then flush remaining keys.
        this.stopCaptureScheduler();
        this.stopClockTimer();
        this.stopKioskEnforcement();
        this.unregisterGlobalShortcuts();
        this.exitExamFullscreen();
        this.flushKeylogs();

        const eventType = endState === EXAM_STATES.EXPIRED ? 'EXAM_EXPIRED'
            : endState === EXAM_STATES.ABORTED ? 'EXAM_ABORTED' : 'EXAM_SUBMITTED';
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
        // First capture at 3 s; the independent recurring interval fires at 10, 20, 30 s, etc.
        setTimeout(() => {
            if (this.state === EXAM_STATES.ACTIVE) this.triggerSynchronizedCapture();
        }, 3000);

        this.scheduleActiveInterval('captureTimer', this.captureIntervalMs, () => this.triggerSynchronizedCapture());
    }

    stopCaptureScheduler() { this.clearTimer('captureTimer'); }

    async triggerSynchronizedCapture() {
        if (this.state !== EXAM_STATES.ACTIVE || !this.session) return;
        const timestamp = this.getTimestamp();
        // Use the same filename timestamp for the desktop image and renderer's face image.
        await this.captureDesktop(timestamp);
        this.safeSend('request-face-snapshot', { timestamp });
    }

    saveCapture(buffer, type, timestamp, sessionDir) {
        const isCamera = type === 'camera';
        const filename = `${timestamp}.${isCamera ? 'jpg' : 'png'}`;
        const filePath = path.join(sessionDir, isCamera ? 'camerashots' : 'screenshots', filename);
        try {
            // Save the image before posting metadata; the backend does not receive image bytes.
            fs.writeFileSync(filePath, buffer);
            this.postBackend('/exam/capture', {
                sessionId: this.session.sessionId, type, filename, timestamp,
                questionId: this.currentQuestionId,
                path: path.relative(path.join(import.meta.dirname, '..'), filePath)
            }).catch(() => {});
            return filePath;
        } catch (err) {
            console.warn(isCamera ? 'Failed saving face snapshot:' : 'Failed saving screenshot:', err.message);
        }
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
        } catch {} // Screen recording can fail; try the exam-window fallback below.

        if ((!pngBuffer || pngBuffer.length === 0) && this.hasWindow()) {
            try {
                const img = await this.window.webContents.capturePage();
                pngBuffer = img.toPNG();
            } catch {}
        }

        if (pngBuffer?.length > 0) return this.saveCapture(pngBuffer, 'screen', timestamp, sessionDir);
    }

    async saveFaceSnapshot(arrayBuffer, timestamp) {
        if (this.state !== EXAM_STATES.ACTIVE || !this.session) return;
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;

        try {
            return this.saveCapture(Buffer.from(arrayBuffer), 'camera', timestamp, sessionDir);
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
        // Compute elapsed wall time instead of counting ticks, so delayed callbacks do not extend the exam.
        const totalSec = this.session?.durationSec || 1800;

        this.safeSend('timer-tick', { elapsed: 0, remaining: totalSec });

        this.scheduleActiveInterval('clockTimer', 1000, () => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = Math.max(0, totalSec - elapsed);
            this.safeSend('timer-tick', { elapsed, remaining });

            if (remaining <= 0) this.handleExamExpired();
        });
    }

    stopClockTimer() { this.clearTimer('clockTimer'); }

    async handleExamExpired() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        // Preserve the existing order: notify the UI, finalize backend, then stop local monitoring.
        this.safeSend('exam-expired');
        try {
            await this.postBackend('/exam/expire', { sessionId: this.session?.sessionId });
        } catch {}
        await this.stopSession(EXAM_STATES.EXPIRED, 'Exam duration limit reached');
    }

    // ─── Global Shortcuts & Continuous Lockdown Watchdog ────────────────────
    registerGlobalShortcuts() {
        this.unregisterGlobalShortcuts();
        GLOBAL_SHORTCUTS.forEach(shortcut => {
            try {
                globalShortcut.register(shortcut, () => {
                    if (this.state !== EXAM_STATES.ACTIVE) return;
                    this.logEvent('SHORTCUT_BLOCKED', this.currentQuestionId, { shortcut });
                    this.flagBackend('SHORTCUT_BLOCKED', `Blocked global shortcut: ${shortcut}`, this.currentQuestionId);
                    this.safeSend('blocked-keybinding', { key: shortcut, timestamp: new Date().toISOString() });
                    this.reclaimFocus();
                });
            } catch {} // Some OS-reserved shortcuts cannot be registered; input interception remains active.
        });
    }

    unregisterGlobalShortcuts() {
        try {
            globalShortcut.unregisterAll();
        } catch {}
    }

    startKioskEnforcement() {
        this.stopKioskEnforcement();
        this.scheduleActiveInterval('kioskEnforceTimer', 1000, () => {
            if (!this.window.isKiosk() || !this.window.isFocused()) this.reclaimFocus();
        });
    }

    stopKioskEnforcement() { this.clearTimer('kioskEnforceTimer'); }

    // ─── Window Event Handlers ───────────────────────────────────────────────
    async recordWindowViolation(type, details, channel) {
        // Keep this order when debugging: event -> flag -> screenshot -> key flush -> UI lock.
        this.logEvent(type, this.currentQuestionId);
        this.flagBackend(type, details, this.currentQuestionId);
        await this.captureImmediate(type);
        this.flushKeylogs();
        this.safeSend(channel);
    }

    async handleFocusLost() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        console.warn('Window focus lost during active exam');

        if (this.session?.mode === 'PROCTORED') this.reclaimFocus();

        await this.recordWindowViolation('WINDOW_FOCUS_LOST', 'Window focus lost (possible application switch)', 'window-focus-lost');
    }

    notifyWindowRestored(type, channel) {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        this.logEvent(type, this.currentQuestionId);
        this.safeSend(channel);
    }

    handleFocusRestored() { this.notifyWindowRestored('WINDOW_FOCUS_RESTORED', 'window-focus-restored'); }

    async handleFullscreenExited() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        // Electron can emit leave-full-screen while kiosk is still active; that is not a violation.
        if (this.hasWindow() && (this.window.isFullScreen() || this.window.isKiosk())) return;

        console.warn('Fullscreen mode exited during active exam');
        await this.recordWindowViolation('FULLSCREEN_EXITED', 'Fullscreen exited', 'fullscreen-exited');
    }

    handleFullscreenRestored() { this.notifyWindowRestored('FULLSCREEN_RESTORED', 'fullscreen-restored'); }

    // ─── Input & Keystroke Telemetry ─────────────────────────────────────────
    handleInputEvent(event, input) {
        if (this.state !== EXAM_STATES.ACTIVE) return;

        if (input.type === 'keyDown') this.recordKeylog(input);
        if (!this.isBlockedInput(input)) return;
        event.preventDefault();
        this.reclaimFocus();
        this.logEvent('SHORTCUT_BLOCKED', this.currentQuestionId, { key: input.key });
        this.flagBackend('SHORTCUT_BLOCKED', `Blocked shortcut: ${input.key}`, this.currentQuestionId);
        this.flushKeylogs();
        this.safeSend('blocked-keybinding', {
            key: input.key, ctrl: input.control, meta: input.meta, alt: input.alt, shift: input.shift,
            timestamp: new Date().toISOString()
        });
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
        return !hasCmdOrCtrl && !hasAlt && !hasShift && BLOCKED_PLAIN_KEYS.has(key);
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
            sessionId: this.session.sessionId, timestamp: new Date().toISOString(),
            questionId: this.currentQuestionId, eventType: input.type === 'keyDown' ? 'KEY_DOWN' : 'KEY_UP',
            key, combination: combo,
            modifiers: { meta: !!input.meta, ctrl: !!input.control, alt: !!input.alt, shift: !!input.shift },
            isBlocked: this.isBlockedInput(input)
        };

        this.keylogBuffer.push(entry);

        // Flush suspicious combinations immediately; batch ordinary typing for 250 ms.
        if (entry.isBlocked || input.meta || input.control || input.alt) {
            this.flushKeylogs();
        } else if (!this.keylogFlushTimer) {
            this.keylogFlushTimer = setTimeout(() => this.flushKeylogs(), 250);
        }
    }

    appendSessionLog(sessionDir, filename, records) {
        try {
            fs.appendFileSync(path.join(sessionDir, filename), records.map(record => JSON.stringify(record)).join('\n') + '\n');
        } catch {} // Local evidence errors must not crash the exam.
    }

    flushKeylogs() {
        this.clearTimer('keylogFlushTimer', clearTimeout);
        if (this.keylogBuffer.length === 0 || !this.session) return;
        const batch = [...this.keylogBuffer];
        this.keylogBuffer = [];

        // Append to local session log
        const sessionDir = this.getSessionDir();
        if (sessionDir) this.appendSessionLog(sessionDir, 'keylogs.jsonl', batch);

        // Backend updates sessions.json and its separate keylogs.json copy.
        this.postBackend('/exam/keylog', { sessionId: this.session.sessionId, keylogs: batch }).catch(() => {});
    }

    // ─── Proctoring Events & Backend Flags ────────────────────────────────────
    logEvent(eventType, questionId = null, metadata = {}) {
        if (!this.session) return;
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;

        this.appendSessionLog(sessionDir, 'events.jsonl', [{
            sessionId: this.session.sessionId, timestamp: new Date().toISOString(), eventType,
            questionId: questionId !== null ? questionId : this.currentQuestionId, metadata
        }]);
    }

    async flagBackend(type, details = '', questionId = null) {
        if (!this.session) return;
        try {
            await this.postBackend('/exam/flag', {
                sessionId: this.session.sessionId, type, details,
                questionId: questionId !== null ? questionId : this.currentQuestionId,
                timestamp: new Date().toISOString()
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
                displays: displays.map(d => ({ id: d.id, bounds: d.bounds, isPrimary: d.id === primaryId }))
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
                if (error || !stdout) return resolve({ allApps: [], blockedApps: [] });

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
