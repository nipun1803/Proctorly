import fs from 'fs';
import path from 'path';
import electron from 'electron';
const { app, desktopCapturer, screen, globalShortcut } = electron;
import { exec } from 'child_process';

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

export const BLOCKED_KEYS = [
    { ctrl: true, key: 'c' },
    { ctrl: true, key: 'v' },
    { ctrl: true, key: 'x' },
    { ctrl: true, key: 'a' },
    { ctrl: true, key: 'p' },
    { ctrl: true, key: 's' },
    { ctrl: true, key: 'f' },
    { ctrl: true, key: 'u' },
    { ctrl: true, key: 'r' },
    { ctrl: true, shift: true, key: 'r' },
    { ctrl: true, shift: true, key: 'i' },
    { ctrl: true, shift: true, key: 'j' },
    { ctrl: true, shift: true, key: 'c' },
    { meta: true, key: 'c' },
    { meta: true, key: 'v' },
    { meta: true, key: 'x' },
    { meta: true, key: 'a' },
    { meta: true, key: 'p' },
    { meta: true, key: 's' },
    { meta: true, key: 'f' },
    { meta: true, key: 'u' },
    { meta: true, key: 'r' },
    { meta: true, shift: true, key: 'r' },
    { meta: true, shift: true, key: 'i' },
    { meta: true, shift: true, key: 'j' },
    { meta: true, shift: true, key: 'c' },
    { meta: true, key: 'h' },
    { meta: true, key: 'w' },
    { meta: true, key: 'm' },
    { meta: true, key: 'Tab' },
    { alt: true, key: 'Tab' },
    { meta: true, key: ' ' },
    { meta: true, alt: true, key: 'Escape' },
    { ctrl: true, key: 'ArrowUp' },
    { ctrl: true, key: 'ArrowDown' },
    { ctrl: true, key: 'ArrowLeft' },
    { ctrl: true, key: 'ArrowRight' },
    { alt: true, key: 'F4' },
    { key: 'PrintScreen' },
    { key: 'F3' },
    { key: 'F11' },
    { key: 'F12' }
];

export class ProctoringController {
    constructor() {
        this.state = EXAM_STATES.PRE_EXAM;
        this.window = null;
        this.session = null;
        this.currentQuestionId = 1;
        this.captureIntervalMs = 10000; // Synchronized capture every 10s
        this.captureTimer = null;
        this.clockTimer = null;
        this.keylogBuffer = [];
        this.keylogFlushTimer = null;
        this.backendUrl = 'http://localhost:3000';
    }

    setWindow(win) {
        this.window = win;
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
            if (this.state === EXAM_STATES.ACTIVE) {
                this.logEvent('QUESTION_VIEWED', this.currentQuestionId);
            }
        }
    }

    getTimestamp() {
        // Safe for filenames: e.g. 2026-09-30T15-20-01-123Z
        return new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    }

    getSessionDir() {
        if (!this.session || !this.session.sessionId) {
            return null;
        }
        return path.join(import.meta.dirname, '../backend/data/sessions', this.session.sessionId);
    }

    ensureSessionDirs() {
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;
        const screenshotsDir = path.join(sessionDir, 'screenshots');
        const camerashotsDir = path.join(sessionDir, 'camerashots');
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
        if (!fs.existsSync(camerashotsDir)) fs.mkdirSync(camerashotsDir, { recursive: true });

        const keylogsPath = path.join(sessionDir, 'keylogs.json');
        if (!fs.existsSync(keylogsPath)) {
            fs.writeFileSync(keylogsPath, '[]', 'utf-8');
        }
    }

    // ─── Session Initialization ──────────────────────────────────────────────
    async startSession({ sessionId, studentId, studentName, mode = 'PROCTORED', durationSec = 1800 }) {
        if (this.state === EXAM_STATES.ACTIVE) {
            console.warn('Session already active');
            return this.session;
        }

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
            status: EXAM_STATES.ACTIVE,
            files: [],
            screenshots: [],
            cameraShots: [],
            keylogs: [],
            flags: []
        };

        this.ensureSessionDirs();
        this.saveMetadata();

        // Log session start event
        this.logEvent('EXAM_STARTED', this.currentQuestionId, { mode, durationSec });

        // Configure window for exam mode (macOS space-locked kiosk)
        if (this.window && !this.window.isDestroyed()) {
            if (mode === 'PROCTORED') {
                this.window.setFullScreenable(true);
                this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
                this.window.setAlwaysOnTop(true, 'screen-saver', 1);
                this.window.setKiosk(true);
                this.window.setFullScreen(true);
            }
            app.focus({ steal: true });
            this.window.show();
            this.window.focus();
            this.window.moveTop();
        }

        // Register global shortcuts to block OS-level switching and screenshot shortcuts
        this.registerGlobalShortcuts();

        // Start continuous kiosk & focus watchdog
        this.startKioskEnforcement();

        this.state = EXAM_STATES.ACTIVE;

        // Start authoritative clock timer (1s interval)
        this.startClockTimer();

        // Start authoritative synchronized evidence capture
        this.startCaptureScheduler();

        return this.session;
    }

    // ─── Stop and Finalize Session ───────────────────────────────────────────
    async stopSession(endState = EXAM_STATES.SUBMITTED, reason = 'Normal submission') {
        if (this.state !== EXAM_STATES.ACTIVE && this.state !== EXAM_STATES.STARTING) {
            return;
        }

        this.state = EXAM_STATES.SUBMITTING;

        // 1. Stop all capture, tick intervals, and kiosk watchdog
        this.stopCaptureScheduler();
        this.stopClockTimer();
        this.stopKioskEnforcement();
        this.unregisterGlobalShortcuts();

        // 2. Release window locks
        if (this.window && !this.window.isDestroyed()) {
            try {
                this.window.setVisibleOnAllWorkspaces(false);
                this.window.setAlwaysOnTop(false);
                this.window.setKiosk(false);
                this.window.setFullScreen(false);
            } catch {
                // Ignore
            }
        }

        // 3. Flush pending keylogs and write final event
        this.flushKeylogs();
        const eventType = endState === EXAM_STATES.EXPIRED ? 'EXAM_EXPIRED' : (endState === EXAM_STATES.ABORTED ? 'EXAM_ABORTED' : 'EXAM_SUBMITTED');
        this.logEvent(eventType, this.currentQuestionId, { reason });

        // 4. Update session metadata
        if (this.session) {
            this.session.status = endState;
            this.session.submittedAt = new Date().toISOString();
            this.saveMetadata();
        }

        this.state = endState;

        // Notify renderer of state change
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('exam-state-changed', {
                state: this.state,
                sessionId: this.session?.sessionId
            });
        }
    }

    // ─── Synchronized Evidence Capture ────────────────────────────────────────
    startCaptureScheduler() {
        this.stopCaptureScheduler();
        // Initial capture after 3s of starting
        setTimeout(() => {
            if (this.state === EXAM_STATES.ACTIVE) {
                this.triggerSynchronizedCapture();
            }
        }, 3000);

        // Periodic synchronized capture
        this.captureTimer = setInterval(() => {
            if (this.state === EXAM_STATES.ACTIVE) {
                this.triggerSynchronizedCapture();
            }
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

        // 1. Capture Desktop Screen
        try {
            await this.captureDesktop(timestamp);
        } catch (err) {
            console.error('Desktop capture failed:', err);
            this.logEvent('CAPTURE_FAILED', this.currentQuestionId, { type: 'screen', error: err.message });
        }

        // 2. Request Face Frame from Renderer with the EXACT same timestamp
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('request-face-snapshot', { timestamp });
        }
    }

    async captureDesktop(timestamp) {
        if (!this.session) return;
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;

        let pngBuffer = null;

        // 1. Attempt desktopCapturer for primary screen
        try {
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.size;
            const scaleFactor = primaryDisplay.scaleFactor || 1;

            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                thumbnailSize: {
                    width: Math.min(1920, Math.floor(width * scaleFactor)),
                    height: Math.min(1080, Math.floor(height * scaleFactor))
                }
            });

            if (sources && sources.length > 0) {
                const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
                pngBuffer = screenSource.thumbnail.toPNG();
            }
        } catch {
            // desktopCapturer may lack macOS Screen Recording permission
        }

        // 2. Reliable fallback: capture exam window via webContents.capturePage()
        if ((!pngBuffer || pngBuffer.length === 0) && this.window && !this.window.isDestroyed()) {
            try {
                const image = await this.window.webContents.capturePage();
                pngBuffer = image.toPNG();
            } catch {
                // Secondary fallback
            }
        }

        if (pngBuffer && pngBuffer.length > 0) {
            const filename = `${timestamp}.png`;
            const filePath = path.join(sessionDir, 'screenshots', filename);

            try {
                fs.writeFileSync(filePath, pngBuffer);
                const record = {
                    sessionId: this.session.sessionId,
                    type: 'screen',
                    filename,
                    timestamp,
                    questionId: this.currentQuestionId,
                    path: path.relative(path.join(import.meta.dirname, '..'), filePath)
                };

                this.session.files.push(record);
                if (!this.session.screenshots) this.session.screenshots = [];
                this.session.screenshots.push(record);

                this.saveMetadata();
                this.logEvent('SCREENSHOT_CAPTURED', this.currentQuestionId, { filename });

                // Synchronize capture with backend sessions.json
                fetch(`${this.backendUrl}/exam/capture`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(record)
                }).catch(() => {});

                return filePath;
            } catch (err) {
                console.warn('Failed to write screenshot file:', err.message);
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

            const record = {
                sessionId: this.session.sessionId,
                type: 'camera',
                filename,
                timestamp,
                questionId: this.currentQuestionId,
                path: path.relative(path.join(import.meta.dirname, '..'), filePath)
            };

            this.session.files.push(record);
            if (!this.session.cameraShots) this.session.cameraShots = [];
            this.session.cameraShots.push(record);

            this.saveMetadata();
            this.logEvent('FACE_CAPTURED', this.currentQuestionId, { filename });

            // Synchronize capture with backend sessions.json
            fetch(`${this.backendUrl}/exam/capture`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record)
            }).catch(() => {});

            return filePath;
        } catch (err) {
            console.warn('Failed to write face snapshot file:', err.message);
        }
    }

    async captureImmediate(reason) {
        if (this.state !== EXAM_STATES.ACTIVE || !this.session) return;
        try {
            const timestamp = this.getTimestamp();
            await this.captureDesktop(timestamp);
            this.logEvent('IMMEDIATE_CAPTURE', this.currentQuestionId, { reason, timestamp });
        } catch (err) {
            console.error('Immediate desktop capture failed:', err);
        }
    }

    // ─── Authoritative Exam Timer ─────────────────────────────────────────────
    startClockTimer() {
        this.stopClockTimer();
        const startTime = Date.now();
        const totalSec = this.session?.durationSec || 1800;

        // Emit initial tick immediately (at t=0) so renderer is updated right away
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('timer-tick', {
                elapsed: 0,
                remaining: totalSec
            });
        }

        this.clockTimer = setInterval(() => {
            if (this.state !== EXAM_STATES.ACTIVE) {
                this.stopClockTimer();
                return;
            }

            const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
            const remainingSec = Math.max(0, totalSec - elapsedSec);

            if (this.window && !this.window.isDestroyed()) {
                this.window.webContents.send('timer-tick', {
                    elapsed: elapsedSec,
                    remaining: remainingSec
                });
            }

            // Expiration condition
            if (remainingSec <= 0) {
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
        console.log('Exam duration expired for session:', this.session?.sessionId);

        // Lock answering and notify renderer
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('exam-expired');
        }

        // Call backend expire endpoint
        try {
            await fetch(`${this.backendUrl}/exam/expire`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.session.sessionId })
            });
        } catch (err) {
            console.error('Failed to notify backend of expiration:', err);
        }

        await this.stopSession(EXAM_STATES.EXPIRED, 'Exam duration limit reached');
    }

    // ─── Global Shortcuts & Kiosk Lockdown ──────────────────────────────────
    registerGlobalShortcuts() {
        this.unregisterGlobalShortcuts();
        const shortcuts = [
            'CommandOrControl+Space',
            'Alt+Tab',
            'CommandOrControl+H',
            'CommandOrControl+M',
            'CommandOrControl+Shift+3',
            'CommandOrControl+Shift+4',
            'CommandOrControl+Shift+5',
            'CommandOrControl+Alt+Escape',
            'F11',
            'F12'
        ];

        shortcuts.forEach(shortcut => {
            try {
                globalShortcut.register(shortcut, () => {
                    console.warn(`Blocked global shortcut: ${shortcut}`);
                    this.recordKeylog({
                        type: 'keyDown',
                        key: shortcut,
                        meta: shortcut.includes('Command'),
                        control: shortcut.includes('Control'),
                        alt: shortcut.includes('Alt'),
                        shift: shortcut.includes('Shift')
                    });
                    this.logEvent('SHORTCUT_BLOCKED', this.currentQuestionId, { shortcut });
                    this.flagBackend('SHORTCUT_BLOCKED', `Blocked global shortcut: ${shortcut}`, this.currentQuestionId);
                    this.flushKeylogs();

                    if (this.window && !this.window.isDestroyed()) {
                        this.window.webContents.send('blocked-keybinding', {
                            key: shortcut,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
            } catch (err) {
                // Ignore registration errors on OS-protected shortcuts
            }
        });
    }

    unregisterGlobalShortcuts() {
        try {
            globalShortcut.unregisterAll();
        } catch {
            // Ignore
        }
    }

    startKioskEnforcement() {
        this.stopKioskEnforcement();
        this.kioskEnforceTimer = setInterval(() => {
            if (this.state === EXAM_STATES.ACTIVE && this.window && !this.window.isDestroyed()) {
                if (!this.window.isFocused()) {
                    app.focus({ steal: true });
                    this.window.moveTop();
                    this.window.focus();
                }
                if (!this.window.isKiosk()) {
                    this.window.setKiosk(true);
                }
                if (!this.window.isFullScreen()) {
                    this.window.setFullScreen(true);
                }
            }
        }, 400);
    }

    stopKioskEnforcement() {
        if (this.kioskEnforceTimer) {
            clearInterval(this.kioskEnforceTimer);
            this.kioskEnforceTimer = null;
        }
    }

    // ─── Focus and Fullscreen Event Handlers ──────────────────────────────────
    async handleFocusLost() {
        if (this.state !== EXAM_STATES.ACTIVE) return;

        // Debounce to prevent rapid oscillation loops on macOS
        const now = Date.now();
        if (this.lastFocusLostTime && (now - this.lastFocusLostTime) < 2000) {
            return;
        }
        this.lastFocusLostTime = now;

        console.warn('Window focus lost during active exam');

        this.logEvent('WINDOW_FOCUS_LOST', this.currentQuestionId);
        this.flagBackend('WINDOW_FOCUS_LOST', 'Window focus lost (possible application switch)', this.currentQuestionId);

        // Attempt immediate screenshot to document desktop state
        await this.captureImmediate('WINDOW_FOCUS_LOST');

        // Flush pending keylogs immediately
        this.flushKeylogs();

        // Notify renderer
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('window-focus-lost');

            // Reclaim focus immediately in PROCTORED mode
            if (this.session?.mode === 'PROCTORED') {
                setTimeout(() => {
                    if (this.window && !this.window.isDestroyed() && this.state === EXAM_STATES.ACTIVE) {
                        app.focus({ steal: true });
                        this.window.show();
                        this.window.setAlwaysOnTop(true, 'screen-saver', 1);
                        this.window.setKiosk(true);
                        this.window.setFullScreen(true);
                        this.window.moveTop();
                        this.window.focus();
                    }
                }, 100);
            }
        }
    }

    handleFocusRestored() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        this.logEvent('WINDOW_FOCUS_RESTORED', this.currentQuestionId);
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('window-focus-restored');
        }
    }

    async handleFullscreenExited() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        if (this.window && !this.window.isDestroyed() && this.window.isFullScreen()) {
            return;
        }
        console.warn('Fullscreen mode exited during active exam');

        this.logEvent('FULLSCREEN_EXITED', this.currentQuestionId);
        this.flagBackend('FULLSCREEN_EXITED', 'Fullscreen exited', this.currentQuestionId);

        // Attempt immediate screenshot
        await this.captureImmediate('FULLSCREEN_EXITED');
        this.flushKeylogs();

        // Lock exam answering in renderer and re-enforce kiosk
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('fullscreen-exited');
            if (this.session?.mode === 'PROCTORED') {
                setTimeout(() => {
                    if (this.window && !this.window.isDestroyed() && this.state === EXAM_STATES.ACTIVE) {
                        app.focus({ steal: true });
                        this.window.setKiosk(true);
                        this.window.setFullScreen(true);
                        this.window.moveTop();
                        this.window.focus();
                    }
                }, 200);
            }
        }
    }

    handleFullscreenRestored() {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        this.logEvent('FULLSCREEN_RESTORED', this.currentQuestionId);
        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('fullscreen-restored');
        }
    }

    // ─── Input and Key Event Handling ─────────────────────────────────────────
    handleInputEvent(event, input) {
        if (this.state !== EXAM_STATES.ACTIVE) return;

        // Log keydown events for exam evidence
        if (input.type === 'keyDown') {
            this.recordKeylog(input);
        }

        // Check for blocked combinations
        if (this.isBlockedInput(input)) {
            event.preventDefault();
            this.logEvent('SHORTCUT_BLOCKED', this.currentQuestionId, {
                key: input.key,
                ctrl: input.control,
                meta: input.meta,
                alt: input.alt,
                shift: input.shift
            });
            this.flagBackend('SHORTCUT_BLOCKED', `Blocked shortcut: ${input.key}`, this.currentQuestionId);
            this.flushKeylogs();

            if (this.window && !this.window.isDestroyed()) {
                this.window.webContents.send('blocked-keybinding', {
                    key: input.key,
                    ctrl: input.control,
                    meta: input.meta,
                    alt: input.alt,
                    shift: input.shift,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    isBlockedInput(input) {
        const keyLower = input.key ? input.key.toLowerCase() : '';
        return BLOCKED_KEYS.some(combo => {
            const keyMatch = combo.key && combo.key.toLowerCase() === keyLower;
            const ctrlMatch = combo.ctrl ? input.control : true;
            const metaMatch = combo.meta ? input.meta : true;
            const altMatch = combo.alt ? input.alt : true;
            const shiftMatch = combo.shift ? input.shift : true;

            // If a modifier is required, ensure it is pressed
            if (combo.ctrl && !input.control) return false;
            if (combo.meta && !input.meta) return false;
            if (combo.alt && !input.alt) return false;
            if (combo.shift && !input.shift) return false;

            return keyMatch && ctrlMatch && metaMatch && altMatch && shiftMatch;
        });
    }

    recordKeylog(input) {
        if (!this.session) return;

        const modifiers = [];
        if (input.meta) modifiers.push('Cmd');
        if (input.control) modifiers.push('Ctrl');
        if (input.alt) modifiers.push('Alt');
        if (input.shift) modifiers.push('Shift');
        const key = input.key || input.code || 'Unknown';
        const combo = modifiers.length > 0 && !modifiers.includes(key)
            ? `${modifiers.join('+')}+${key}`
            : key;

        const entry = {
            sessionId: this.session.sessionId,
            timestamp: new Date().toISOString(),
            questionId: this.currentQuestionId,
            eventType: input.type === 'keyDown' ? 'KEY_DOWN' : 'KEY_UP',
            key,
            combination: combo,
            modifiers: {
                meta: !!input.meta,
                ctrl: !!input.control,
                alt: !!input.alt,
                shift: !!input.shift
            },
            isBlocked: this.isBlockedInput(input)
        };

        this.keylogBuffer.push(entry);

        // Immediate flush on modifiers or blocked shortcut attempts; rapid 100ms debounce for others
        if (entry.isBlocked || input.meta || input.control || input.alt) {
            this.flushKeylogs();
        } else {
            if (this.keylogFlushTimer) clearTimeout(this.keylogFlushTimer);
            this.keylogFlushTimer = setTimeout(() => {
                this.flushKeylogs();
            }, 100);
        }
    }

    flushKeylogs() {
        if (this.keylogFlushTimer) {
            clearTimeout(this.keylogFlushTimer);
            this.keylogFlushTimer = null;
        }

        if (this.keylogBuffer.length === 0 || !this.session) return;
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;

        const batch = [...this.keylogBuffer];
        this.keylogBuffer = [];

        // 1. Write formatted array to backend/data/sessions/<sessionId>/keylogs.json
        const keylogsJsonPath = path.join(sessionDir, 'keylogs.json');
        try {
            let existingKeylogs = [];
            if (fs.existsSync(keylogsJsonPath)) {
                try {
                    existingKeylogs = JSON.parse(fs.readFileSync(keylogsJsonPath, 'utf-8'));
                } catch {
                    existingKeylogs = [];
                }
            }
            existingKeylogs.push(...batch);
            fs.writeFileSync(keylogsJsonPath, JSON.stringify(existingKeylogs, null, 2), 'utf-8');
        } catch (err) {
            console.error('Failed updating session keylogs.json:', err.message);
        }

        // 2. Append to keylogs.jsonl for stream log integrity
        const keylogsPath = path.join(sessionDir, 'keylogs.jsonl');
        const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
        try {
            fs.appendFileSync(keylogsPath, lines);
        } catch (err) {
            console.error('Failed to append keylogs.jsonl:', err);
        }

        // 3. Send to backend sessions.json
        fetch(`${this.backendUrl}/exam/keylog`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: this.session.sessionId, keylogs: batch })
        }).catch(err => {
            console.error('Failed to send keylogs to backend:', err);
        });
    }

    // ─── Proctoring Events & Flags ────────────────────────────────────────────
    logEvent(eventType, questionId = null, metadata = {}) {
        if (!this.session) return;
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;

        const eventRecord = {
            sessionId: this.session.sessionId,
            timestamp: new Date().toISOString(),
            eventType,
            questionId: questionId !== null ? questionId : this.currentQuestionId,
            metadata
        };

        const eventsPath = path.join(sessionDir, 'events.jsonl');
        try {
            fs.appendFileSync(eventsPath, JSON.stringify(eventRecord) + '\n');
        } catch (err) {
            console.error('Failed to write event record:', err);
        }
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
            console.error('Failed to post flag to backend:', err);
            this.logEvent('BACKEND_UNAVAILABLE', questionId, { endpoint: '/exam/flag', error: err.message });
        }
    }

    // ─── Manifest & Metadata File ─────────────────────────────────────────────
    saveMetadata() {
        if (!this.session) return;
        const sessionDir = this.getSessionDir();
        if (!sessionDir) return;

        const metadataPath = path.join(sessionDir, 'metadata.json');
        try {
            fs.writeFileSync(metadataPath, JSON.stringify(this.session, null, 2));
        } catch (err) {
            console.error('Failed to write session metadata:', err);
        }
    }

    // ─── Process Enumeration for Background Apps ──────────────────────────────
    static getRunningProcesses() {
        return new Promise((resolve) => {
            const platform = process.platform;
            let cmd;
            if (platform === 'darwin') {
                cmd = `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`;
            } else if (platform === 'win32') {
                cmd = 'tasklist /FO CSV /NH';
            } else {
                cmd = 'ps -eo comm --no-headers | sort -u';
            }

            exec(cmd, (error, stdout) => {
                if (error) {
                    console.error('Process check failed:', error);
                    resolve({ allApps: [], blockedApps: [] });
                    return;
                }

                let appNames = [];
                if (platform === 'darwin') {
                    appNames = stdout.split(',').map(n => n.trim()).filter(Boolean);
                } else if (platform === 'win32') {
                    appNames = stdout.split('\n')
                        .map(l => l.trim())
                        .filter(Boolean)
                        .map(l => {
                            const m = l.match(/^"([^"]+)"/);
                            return m ? m[1].replace('.exe', '') : null;
                        })
                        .filter(Boolean);
                    appNames = [...new Set(appNames)];
                } else {
                    appNames = stdout.split('\n').map(l => {
                        const parts = l.trim().split('/');
                        return parts[parts.length - 1];
                    }).filter(Boolean);
                    appNames = [...new Set(appNames)];
                }

                const filtered = appNames.filter(name => {
                    const lower = name.toLowerCase();
                    return lower !== 'electron' && lower !== 'athena' && lower !== 'proctorly' && lower !== 'antigravity ide';
                });

                const blocked = filtered.filter(name => {
                    const lower = name.toLowerCase();
                    return BLOCKED_APPS.some(b => lower.includes(b));
                });

                resolve({ allApps: filtered, blockedApps: blocked });
            });
        });
    }
}
