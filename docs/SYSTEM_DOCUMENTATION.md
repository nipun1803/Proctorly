# Proctorly 🛡️ — System Architecture & Interview Master Guide

> **Comprehensive Technical Reference, High-Level Design (HLD), and Interview Playbook**  
> An end-to-end breakdown of how each anti-cheat proctoring feature is built, which functions implement them, exact file locations, and architectural reasoning for technical interviews.

---

## 📑 Table of Contents

1. [High-Level Design (HLD) Diagrams](#1-high-level-design-hld-diagrams)
   - [System Context & Process Architecture](#system-context--process-architecture)
   - [Exam Lifecycle State Machine](#exam-lifecycle-state-machine)
   - [Synchronized Surveillance & Telemetry Flow](#synchronized-surveillance--telemetry-flow)
2. [Quick Function & Feature Matrix](#2-quick-function--feature-matrix)
3. [Deep-Dive Feature Implementations & Code Snippets](#3-deep-dive-feature-implementations--code-snippets)
   - [Feature 1: Process Inspector & Prohibited App Blocker](#feature-1-process-inspector--prohibited-app-blocker)
   - [Feature 2: Fullscreen Kiosk Mode & Multi-Display Guard](#feature-2-fullscreen-kiosk-mode--multi-display-guard)
   - [Feature 3: Window Focus / Blur Tracking & Clipboard Eraser](#feature-3-window-focus--blur-tracking--clipboard-eraser)
   - [Feature 4: Low-Level Keyboard Interception & Shortcut Lockout](#feature-4-low-level-keyboard-interception--shortcut-lockout)
   - [Feature 5: High-Frequency Keystroke Telemetry & Buffer Flushing](#feature-5-high-frequency-keystroke-telemetry--buffer-flushing)
   - [Feature 6: Synchronized Desktop & Webcam Surveillance Snapshots](#feature-6-synchronized-desktop--webcam-surveillance-snapshots)
   - [Feature 7: Authoritative Main-Process Clock & Auto-Submission](#feature-7-authoritative-main-process-clock--auto-submission)
   - [Feature 8: Secure Context Bridge & Process Isolation (IPC)](#feature-8-secure-context-bridge--process-isolation-ipc)
   - [Feature 9: Fault-Tolerant Atomic File Storage & Crash Recovery](#feature-9-fault-tolerant-atomic-file-storage--crash-recovery)
   - [Feature 10: Dynamic Student Examination HUD & Violation Banner](#feature-10-dynamic-student-examination-hud--violation-banner)
4. [Interview Playbook: Top 10 Technical Questions & Model Answers](#4-interview-playbook-top-10-technical-questions--model-answers)

---

## 1. High-Level Design (HLD) Diagrams

### System Context & Process Architecture

Proctorly employs a **three-tier isolated architecture**:
1. **Renderer Process (React + Vite)**: Renders the exam questions, webcams preview, and alerts. Zero direct access to Node.js or OS APIs.
2. **Preload Script (`contextBridge`)**: Strictly validated sandbox bridge exposing the `window.athena` API.
3. **Main Process (Electron)**: Orchestrates native window bounds, global shortcuts, screen capture, and process inspection.
4. **Backend Daemon (Express.js)**: Spawned via child process (`fork`), handling atomic session logs, assessment evaluation, and media storage.

```mermaid
graph TB
    subgraph Frontend["Renderer Process (React 18 + Vite)"]
        UI["Candidate HUD / Quiz View<br/>(src/App.jsx, src/components/Quiz/Quiz.jsx)"]
        WebcamStream["Webcam MediaStream<br/>(navigator.mediaDevices.getUserMedia)"]
        DomEvents["DOM Event Listeners<br/>(keydown, blur, copy/paste block)"]
    end

    subgraph Sandbox["Secure Preload Bridge (app/preload.js)"]
        AthenaBridge["window.athena (contextBridge)<br/>- IPC Invokers (send / invoke)<br/>- IPC Listeners (on / removeListener)"]
    end

    subgraph MainProcess["Electron Main Process (app/app.js)"]
        WinManager["BrowserWindow Manager<br/>- Kiosk mode, frame: true<br/>- before-input-event, blur/focus hooks"]
        Controller["ProctoringController (app/proctoringController.js)<br/>- State machine & Timer scheduler<br/>- Keystroke buffer & Flush worker<br/>- Screenshot scheduler (desktopCapturer)"]
        OS_Hooks["Native OS Integration<br/>- globalShortcut (Alt+Tab, Cmd+Tab block)<br/>- screen.getAllDisplays()<br/>- exec('ps' / 'tasklist')<br/>- clipboard.clear()"]
    end

    subgraph BackendProcess["Backend Service (backend/server.js)"]
        ExpressApp["Express.js Server (Port 3000)<br/>- /exam/start, /exam/answer, /exam/submit<br/>- /exam/capture, /exam/flag, /exam/keylog"]
        AtomicStorage["Atomic File Persistence<br/>- tmp file write + fs.renameSync<br/>- backend/data/sessions.json<br/>- backend/data/sessions/{sessionId}/"]
    end

    UI -->|"Calls window.athena API"| AthenaBridge
    WebcamStream -->|"Converts frame to Blob"| AthenaBridge
    DomEvents -->|"Forward keydown events"| AthenaBridge

    AthenaBridge -->|"IPC Invoke: 'start-exam-session', etc."| WinManager
    WinManager -->|"Delegates commands"| Controller
    Controller -->|"Low-level OS checks"| OS_Hooks
    Controller -->|"HTTP REST Telemetry"| ExpressApp
    ExpressApp -->|"Atomic Writes"| AtomicStorage
```

---

### Exam Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> PRE_EXAM: App Launch & System Diagnostics
    PRE_EXAM --> READY: Single Display Verified & Camera Granted
    READY --> STARTING: Candidate clicks 'Start Proctored Exam'
    STARTING --> ACTIVE: Fullscreen Locked, Shortcuts Registered, Timers Started
    
    state ACTIVE {
        [*] --> SurveillanceRunning
        SurveillanceRunning --> PeriodicCapture: Every 10s Timer
        PeriodicCapture --> SurveillanceRunning: Save Desktop & Face Frame
        
        SurveillanceRunning --> AnomalyDetected: Blur / Shortcut / Blocked App
        AnomalyDetected --> ImmediateCapture: Instant screenshot & Security flag
        ImmediateCapture --> SurveillanceRunning: Flag logged to backend
    }
    
    ACTIVE --> SUBMITTING: Candidate clicks Submit OR Timer Reaches 00:00
    ACTIVE --> ABORTED: Window closed or force quit confirmed
    ACTIVE --> EXPIRED: Countdown reached 0 (Main Process Enforced)
    
    SUBMITTING --> SUBMITTED: Backend answers evaluated & score tallied
    EXPIRED --> SUBMITTED: Auto-submission payload dispatched
    SUBMITTED --> [*]: Final Results Displayed to Candidate
    ABORTED --> [*]: Exam invalidated
```

---

### Synchronized Surveillance & Telemetry Flow

```mermaid
sequenceDiagram
    autonumber
    participant R as Renderer (React UI)
    participant M as Electron Main (ProctoringController)
    participant OS as Operating System / DesktopCapturer
    participant B as Express Backend (server.js)
    participant FS as Disk File System

    Note over M: Every 10 Seconds (Surveillance Interval)
    M->>OS: desktopCapturer.getSources({ types: ['screen'] })
    OS-->>M: Screen buffer (NativeImage)
    M->>M: Convert NativeImage to JPEG buffer
    M->>FS: Write to backend/data/sessions/{id}/screenshots/{timestamp}.png

    M->>R: IPC Send: 'request-face-snapshot' (timestamp, questionId)
    Note over R: Capture current frame from <video> element into <canvas>
    R->>R: canvas.toBlob() -> ArrayBuffer
    R->>M: IPC Invoke: 'store-face-snapshot' (ArrayBuffer, timestamp)
    M->>FS: Write to backend/data/sessions/{id}/camerashots/{timestamp}.jpg

    M->>B: POST /exam/capture (Metadata record linking both files)
    B->>FS: Atomically update sessions.json
```

---

## 2. Quick Function & Feature Matrix

| Feature | Primary File | Primary Method / Function | Purpose / Mechanism |
| :--- | :--- | :--- | :--- |
| **Prohibited Process Scanner** | [proctoringController.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L856-L910) | `static getRunningProcesses()` | Executes `ps -eo comm=` (macOS/Linux) or `tasklist` (Windows) and compares against `BLOCKED_APPS`. |
| **Multi-Display Detection** | [proctoringController.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L87-L95) | `checkDisplays()` | Queries `screen.getAllDisplays()` to ensure student is not using HDMI splitters or dual monitors. |
| **Kiosk & Fullscreen Lock** | [app.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/app.js#L149-L165) | `ipcMain.handle('enter-fullscreen')` | Sets `win.setFullScreen(true)` and enforces fullscreen boundaries. |
| **Window Blur & Focus Tracker** | [app.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/app.js#L104-L111) | `electronWindow.on('blur')` | Emits `handleFocusLost()`, clears the OS clipboard, and flags violation. |
| **Anti-Shortcut Interceptor** | [app.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/app.js#L86-L96) | `webContents.on('before-input-event')` | Intercepts keyboard events before DOM ingestion; blocks Ctrl+C, Ctrl+V, Alt+Tab, etc. |
| **Global Shortcut Trap** | [proctoringController.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L486-L528) | `registerGlobalShortcuts()` | Uses `globalShortcut.register()` to intercept system hotkeys (Cmd+Tab, Spotlight, Mission Control). |
| **Periodic Surveillance** | [proctoringController.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L273-L290) | `triggerSynchronizedCapture()` | Captures desktop screen via `desktopCapturer` and requests matching webcam snapshot from renderer. |
| **Keystroke Telemetry Logger** | [proctoringController.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L708-L798) | `recordKeylog()` & `flushKeylogs()` | Buffers keypress metadata in RAM and flushes to `keylogs.json` and `keylogs.jsonl`. |
| **Authoritative Exam Timer** | [proctoringController.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L419-L453) | `startClockTimer()` | 1-second interval driven by Main Process; sends `timer-tick` event to renderer; auto-submits on 0. |
| **Secure IPC Isolation** | [preload.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/preload.js#L3-L65) | `contextBridge.exposeInMainWorld()` | Grants renderer selective, safe access to electron IPC while disabling Node integration. |
| **Atomic Session Persistence** | [server.js](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/backend/server.js#L40-L52) | `saveSessions()` | Writes to temporary file (`.tmp`) and renames synchronously to guarantee zero data corruption. |
| **Candidate Exam Dashboard** | [App.jsx](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/src/App.jsx#L20-L852) | `App()` | Coordinates student verification, question navigation, timer HUD, and violation warnings. |

---

## 3. Deep-Dive Feature Implementations & Code Snippets

---

### Feature 1: Process Inspector & Prohibited App Blocker

#### 🎯 Problem & Threat Model
Students taking an online exam may run screen-sharing software (Zoom, TeamViewer, AnyDesk), communication apps (Discord, Slack, WhatsApp), or screen recorders (OBS Studio) to transmit exam questions or receive external assistance.

#### 💡 Architectural Solution
Proctorly inspects the OS process table before and during the exam. On macOS/Linux, it executes `ps -eo comm=`; on Windows, it executes `tasklist /FO CSV /NH`. The resulting processes are cross-referenced in real-time against `BLOCKED_APPS`.

#### 📍 Exact Location
- **File**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L856-L910)
- **Method**: `static getRunningProcesses()`
- **Frontend Hook**: [`src/App.jsx`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/src/App.jsx#L60-L75) (`checkApps()`)

#### 💻 Code Snippet
```javascript
// app/proctoringController.js (Lines 856-905)
static getRunningProcesses() {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        const cmd = isWin ? 'tasklist /FO CSV /NH' : 'ps -eo comm=';

        exec(cmd, { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout) {
                return resolve({ runningProcesses: [], blockedApps: [] });
            }

            const lines = stdout.toLowerCase().split('\n');
            const detectedBlocked = new Set();

            for (const target of BLOCKED_APPS) {
                for (const line of lines) {
                    if (line.includes(target)) {
                        detectedBlocked.add(target);
                        break;
                    }
                }
            }

            resolve({
                runningProcesses: Array.from(detectedBlocked),
                blockedApps: Array.from(detectedBlocked)
            });
        });
    });
}
```

#### 🎤 Interview Talking Points
> *"To prevent candidate cheating via unauthorized remote desktop or collaboration software, we implemented an asynchronous process auditor (`getRunningProcesses`) using Node's `child_process.exec`. We cross-reference native process names against an array of blacklisted process signatures (such as Discord, TeamViewer, and OBS). In `App.jsx`, this executes during the pre-check phase; if any blacklisted app is active, the candidate is blocked from beginning until the application is closed."*

---

### Feature 2: Fullscreen Kiosk Mode & Multi-Display Guard

#### 🎯 Problem & Threat Model
Students can connect external monitors, projectors, or side-car screens to view answers on one monitor while keeping the exam active on another. On macOS, trackpad gestures (e.g. 3-finger swipe up for Mission Control or 3-finger swipe left/right between Spaces) allow users to slide the exam window aside and view background applications (browser windows, chat apps) without closing the exam window.

#### 💡 Architectural Solution
1. **Multi-Display Check**: `checkDisplays()` queries Electron's `screen.getAllDisplays()`. If `displays.length > 1`, the system detects an external display and denies exam start.
2. **Native Kiosk Mode**: Electron's `win.setKiosk(true)` engages macOS system presentation options (`NSApplicationPresentationDisableProcessSwitching`). This programmatically suppresses Mission Control gestures, Spaces switching, the Dock, and the Menu Bar.
3. **Screen-Saver Level Priority**: `win.setAlwaysOnTop(true, 'screen-saver', 1)` elevates the window to native `NSScreenSaverWindowLevel`, preventing any notifications or background windows from rendering in front of the exam.
4. **Transition Mutex Lock**: Fullscreen and kiosk transitions use an `isTransitioningFullscreen` mutex guard (1200ms debounce) to prevent concurrent AppKit window mutations that could trigger `NSThemeFrame.m:5523` `SIGABRT` crashes.
5. **Dual State Validation & Exit Hook**: When the student exits fullscreen/kiosk, `handleFullscreenExited()` fires, triggering an immediate desktop snapshot and locking the exam HUD until restored.

#### 📍 Exact Location
- **Display Check**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L87-L95)
- **Kiosk Entry / Exit**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L102-L148) (`enterExamFullscreen()`, `exitExamFullscreen()`)
- **Fullscreen Event Handler**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L644-L675) (`handleFullscreenExited()`)
- **IPC Invocations**: [`app/app.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/app.js#L213-L245)

#### 💻 Code Snippet
```javascript
// app/proctoringController.js
enterExamFullscreen() {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.window.isKiosk() && this.window.isFullScreen()) return;
    if (this.isTransitioningFullscreen) return;

    this.isTransitioningFullscreen = true;
    try {
        this.window.setFullScreenable(true);
        this.window.setAlwaysOnTop(true, 'screen-saver', 1);
        this.window.setKiosk(true);
        this.window.focus();
    } catch (err) {
        console.warn('Failed to enter kiosk mode:', err);
    } finally {
        setTimeout(() => {
            this.isTransitioningFullscreen = false;
        }, 1200);
    }
}
```

#### 🎤 Interview Talking Points
> *"To prevent candidate cheating via Spaces switching or Mission Control on macOS, we enforce Electron's native `win.setKiosk(true)` combined with `win.setAlwaysOnTop(true, 'screen-saver', 1)`. Under the hood, this sets macOS `NSApplicationPresentationDisableProcessSwitching`, which locks out trackpad gestures, hides the Dock, and keeps the exam window above all floating applications. Furthermore, we wrap window state changes in an atomic transition mutex lock (`isTransitioningFullscreen`) to prevent AppKit assertion failures during rapid window level changes."*

---

### Feature 3: Window Focus / Blur Tracking & Clipboard Eraser

#### 🎯 Problem & Threat Model
A student may use Alt+Tab or mouse clicks to switch to an application behind the exam window or attempt to copy content from the exam or paste external answers.

#### 💡 Architectural Solution
1. **Blur Detection**: Native window `blur` listener detects when the Electron window loses OS focus.
2. **Immediate Evidence Capture**: Triggers `captureImmediate('WINDOW_BLUR')` to capture whatever window the user switched to.
3. **Clipboard Eradication**: A 2-second interval in `app.js` runs `clipboard.clear()`, wiping the candidate's clipboard buffer continuously during `EXAM_STATES.ACTIVE`.

#### 📍 Exact Location
- **Window Hook**: [`app/app.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/app.js#L104-L111) & [Lines 130-138](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/app.js#L130-L138)
- **Controller Logic**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L565-L605) (`handleFocusLost()`)

#### 💻 Code Snippet
```javascript
// app/proctoringController.js (Lines 565-595)
async handleFocusLost() {
    if (this.state !== EXAM_STATES.ACTIVE) return;

    try {
        clipboard.clear(); // Immediately wipe OS clipboard
    } catch {}

    this.logEvent('WINDOW_FOCUS_LOST', this.currentQuestionId, {
        details: 'Window focus lost (possible application switch)'
    });

    if (this.session?.mode === 'PROCTORED') {
        await this.flagBackend('WINDOW_FOCUS_LOST', 'Window focus lost', this.currentQuestionId);
        await this.captureImmediate('WINDOW_FOCUS_LOST');
    }

    if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('window-focus-lost');
    }
}
```

#### 🎤 Interview Talking Points
> *"Whenever the application loses OS focus, Electron's `blur` event triggers `handleFocusLost()`. We immediately call `clipboard.clear()` to prevent any copied text from leaving the sandbox, log a `WINDOW_FOCUS_LOST` anomaly with the exact question ID the student was on, capture a desktop snapshot of the candidate's active screen, and push a high-priority warning banner to the frontend."*

---

### Feature 4: Low-Level Keyboard Interception & Shortcut Lockout

#### 🎯 Problem & Threat Model
Students can trigger OS shortcuts (Cmd+Tab, Alt+Tab, Ctrl+C, Ctrl+V, PrintScreen, Spotlight search, Developer Tools) to copy questions, search answers, or switch windows.

#### 💡 Architectural Solution
Proctorly uses **two levels of keyboard interception**:
1. **Main Process `before-input-event`**: Intercepts keyboard input at the Chromium engine level *before* it reaches the renderer's DOM tree. It uses **strict boolean modifier set matching** (`reqCtrl === hasCtrl && reqMeta === hasMeta && reqAlt === hasAlt && reqShift === hasShift`) so that regular keystrokes (such as typing numbers or letters) are never falsely flagged, while forbidden shortcuts (Ctrl+C, Cmd+P, F12) trigger `event.preventDefault()` immediately.
2. **OS `globalShortcut`**: Selectively registers OS shortcuts (Cmd+Space, Cmd+H, Cmd+M) to suppress desktop-level controls without conflicting with native OS screenshot handlers.

#### 📍 Exact Location
- **Engine Interceptor**: [`app/app.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/app.js#L130-L140) (`before-input-event`)
- **Controller Decision Logic**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L680-L728) (`handleInputEvent()`, `isBlockedInput()`)
- **Global Shortcut Registry**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L535-L575) (`registerGlobalShortcuts()`)

#### 💻 Code Snippet
```javascript
// app/proctoringController.js
isBlockedInput(input) {
    if (!input || !input.key) return false;
    const keyLower = input.key.toLowerCase();
    return BLOCKED_KEYS.some(combo => {
        if (!combo.key || combo.key.toLowerCase() !== keyLower) return false;

        const reqCtrl = !!combo.ctrl;
        const reqMeta = !!combo.meta;
        const reqAlt = !!combo.alt;
        const reqShift = !!combo.shift;

        const hasCtrl = !!input.control;
        const hasMeta = !!input.meta;
        const hasAlt = !!input.alt;
        const hasShift = !!input.shift;

        return (
            reqCtrl === hasCtrl &&
            reqMeta === hasMeta &&
            reqAlt === hasAlt &&
            reqShift === hasShift
        );
    });
}
```

#### 🎤 Interview Talking Points
> *"Standard DOM `keydown` handlers can be bypassed or fail to prevent native OS shortcuts like Developer Tools (F12) or browser reloads (Ctrl+R). In Proctorly, we hook into Electron's `before-input-event` on `webContents` to intercept raw input at the native Chromium level prior to DOM dispatch. Crucially, we enforce exact boolean modifier equality: rather than checking if modifiers are merely truthy, we verify that the exact pressed set of Ctrl/Meta/Alt/Shift matches the definition, eliminating false positives during normal exam typing."*

---

### Feature 5: High-Frequency Keystroke Telemetry & Buffer Flushing

#### 🎯 Problem & Threat Model
Proctoring forensics require auditing candidate typing behavior. However, writing every single keystroke to disk or sending HTTP requests on every keypress causes massive I/O bottlenecks and freezes the UI.

#### 💡 Architectural Solution
Proctorly implements an in-memory **Keystroke Ring Buffer**:
- Every keypress is pushed to `this.keylogBuffer`.
- A dedicated timer flushes the buffer to disk asynchronously every 5 seconds or whenever the buffer reaches 50 events.
- Writes are persisted to both `keylogs.json` (for bulk inspection) and `keylogs.jsonl` (append-only stream for forensic timeline reconstruction).

#### 📍 Exact Location
- **Buffer & Recording**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L708-L748) (`recordKeylog()`)
- **Worker Flush**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L750-L798) (`flushKeylogs()`)

#### 💻 Code Snippet
```javascript
// app/proctoringController.js (Lines 750-785)
flushKeylogs() {
    if (this.keylogBuffer.length === 0 || !this.session) return;

    const sessionDir = this.getSessionDir();
    if (!sessionDir) return;

    const entriesToFlush = [...this.keylogBuffer];
    this.keylogBuffer = []; // Clear in-memory buffer

    const jsonlPath = path.join(sessionDir, 'keylogs.jsonl');
    const lines = entriesToFlush.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFile(jsonlPath, lines, 'utf-8', (err) => {
        if (err) console.error('Failed to append keylogs.jsonl:', err);
    });
}
```

#### 🎤 Interview Talking Points
> *"To ensure thorough auditability without degrading UI performance, we designed a batching buffer for keystroke telemetry. Keystrokes are buffered in memory with timestamps and question IDs. Rather than synchronous I/O, a background worker flushes batches into an append-only JSONL stream (`keylogs.jsonl`). On application exit or session submission, a final synchronous flush ensures zero event loss."*

---

### Feature 6: Synchronized Desktop & Webcam Surveillance Snapshots

#### 🎯 Problem & Threat Model
Offline video recording consumes gigabytes of storage and bandwidth. Periodic independent snapshots often suffer from timestamp drift, making it difficult to prove that a candidate looking away from their screen matched a specific illicit window on their desktop.

#### 💡 Architectural Solution
Proctorly uses **synchronized dual-capture**:
1. **Surveillance Loop**: A 10-second interval in `ProctoringController` generates a unified timestamp (e.g., `2026-10-01T03-14-52-510Z`).
2. **Desktop Capture**: Uses Electron's `desktopCapturer.getSources({ types: ['screen'] })` to capture the physical screen to JPEG.
3. **Webcam Capture**: Sends an IPC event `request-face-snapshot` containing that exact timestamp to the renderer. The React frontend grabs the active `<video>` frame into a `<canvas>`, exports an ArrayBuffer, and sends it back to be written to disk with the same timestamp.

#### 📍 Exact Location
- **Surveillance Dispatcher**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L273-L365) (`triggerSynchronizedCapture()`, `captureDesktop()`)
- **Webcam Handler in React**: [`src/App.jsx`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/src/App.jsx#L221-L248) (`onRequestFaceSnapshot`)
- **Backend Sync Endpoint**: [`backend/server.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/backend/server.js#L460-L496) (`/exam/capture`)

#### 💻 Code Snippet
```javascript
// src/App.jsx (Lines 221-245) - Frame extraction in Renderer
const removeFaceSnapshotListener = window.athena.onRequestFaceSnapshot(async ({ timestamp }) => {
  if (examState !== 'ACTIVE' || !videoRef.current) return;
  
  const video = videoRef.current;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  canvas.toBlob(async (blob) => {
    if (blob) {
      const buffer = await blob.arrayBuffer();
      // Send binary frame to Main Process with matching timestamp
      window.athena.storeFaceSnapshot(buffer, timestamp);
    }
  }, 'image/jpeg', 0.85);
});
```

#### 🎤 Interview Talking Points
> *"Instead of heavy continuous video streaming, we created a synchronized dual-capture system. Every 10 seconds, the Main process captures a desktop frame via `desktopCapturer` and simultaneously commands the renderer to extract the active webcam frame from the HTML5 video element. Both files are tagged with the identical ISO timestamp, enabling reviewers to view what was on the candidate's screen and their facial posture side-by-side."*

---

### Feature 7: Authoritative Main-Process Clock & Auto-Submission

#### 🎯 Problem & Threat Model
Client-side timers implemented in React via `setInterval` suffer from browser throttling (when windows are in background), system clock tampering by the candidate, and UI thread freezes during heavy rendering.

#### 💡 Architectural Solution
- The master countdown clock runs exclusively in the **Electron Main Process** inside `ProctoringController` using `startClockTimer()`.
- The Main process broadcasts a `timer-tick` event to the renderer every second for display purposes only.
- When `remainingSeconds === 0`, `handleExamExpired()` directly invokes the backend API (`POST /exam/expire` or `/exam/submit`), terminates the exam session, and notifies the UI.

#### 📍 Exact Location
- **Clock Engine**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L419-L453) (`startClockTimer()`)
- **Expiration Trigger**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L462-L484) (`handleExamExpired()`)
- **Backend Expiration Route**: [`backend/server.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/backend/server.js#L318-L368) (`/exam/expire`)

#### 💻 Code Snippet
```javascript
// app/proctoringController.js (Lines 419-450)
startClockTimer() {
    this.stopClockTimer();
    const totalSec = this.session?.durationSec || 1800;
    let remaining = totalSec;

    this.clockTimer = setInterval(() => {
        if (this.state !== EXAM_STATES.ACTIVE) return;
        remaining--;

        if (this.window && !this.window.isDestroyed()) {
            this.window.webContents.send('timer-tick', {
                remaining,
                total: totalSec,
                elapsed: totalSec - remaining
            });
        }

        if (remaining <= 0) {
            this.stopClockTimer();
            this.handleExamExpired();
        }
    }, 1000);
}
```

#### 🎤 Interview Talking Points
> *"Timers in web browsers can be manipulated by changing system time or suffer from event-loop throttling. In Proctorly, the clock is strictly authoritative in the Electron Main process. The UI is merely a subscriber to `timer-tick` messages. When the countdown reaches zero, the main process guarantees automatic session closure and submission to the backend, regardless of client UI state."*

---

### Feature 8: Secure Context Bridge & Process Isolation (IPC)

#### 🎯 Problem & Threat Model
Allowing Node.js access inside the React renderer creates catastrophic security holes: an XSS vulnerability in a question or package could execute malicious terminal commands on the student's machine.

#### 💡 Architectural Solution
Proctorly enforces strict Electron security and fault-tolerance best practices:
1. `contextIsolation: true` and `nodeIntegration: false` in `BrowserWindow` options.
2. `Menu.setApplicationMenu(null)` to eliminate OS menu access.
3. `preload.js` uses `contextBridge.exposeInMainWorld("athena", ...)` to expose only clean, parameter-checked wrapper functions.
4. **Stream & Terminal Write Error Suppression**: Handlers on `process.stdout`/`stderr` suppress broken-pipe errors (`EIO` and `EPIPE`) so that running in detached terminal windows does not trigger unhandled exception dialogs.
5. **Safe IPC Dispatching (`safeSend`)**: Validates `window.isDestroyed()`, `webContents.isCrashed()`, and frame availability before dispatching IPC messages.

#### 📍 Exact Location
- **Window Security Flags**: [`app/app.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/app.js#L94-L101)
- **Stream & Exception Guards**: [`app/app.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/app.js#L1-L42)
- **Safe IPC Bridge**: [`app/proctoringController.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/proctoringController.js#L145-L165) (`safeSend()`)
- **Preload Bridge**: [`app/preload.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/app/preload.js#L3-L65)

#### 💻 Code Snippet
```javascript
// app/proctoringController.js
safeSend(channel, payload) {
    if (!this.window || this.window.isDestroyed()) return false;
    try {
        const wc = this.window.webContents;
        if (!wc || wc.isDestroyed() || !wc.mainFrame) return false;
        if (typeof wc.isCrashed === 'function' && wc.isCrashed()) return false;
        wc.send(channel, payload);
        return true;
    } catch {
        return false;
    }
}
```

#### 🎤 Interview Talking Points
> *"We follow defense-in-depth principles for Electron security: `nodeIntegration` is disabled, and `contextIsolation` is enabled. All interactions between the React frontend and native capabilities pass through the `athena` namespace exposed via `contextBridge`. In addition, we safeguard against runtime instability by wrapping IPC in `safeSend()` (preventing crashes during window navigation) and attaching error handlers to standard I/O streams to gracefully handle detached terminals without displaying modal error dialogs."*

---

### Feature 9: Fault-Tolerant Atomic File Storage & Crash Recovery

#### 🎯 Problem & Threat Model
When multiple telemetry events (answers, flags, keylogs) arrive concurrently, writing directly to `sessions.json` via `fs.writeFileSync` can result in file truncation or corrupt JSON if the machine loses power or crashes mid-write.

#### 💡 Architectural Solution
1. **Atomic Swapping**: `saveSessions()` writes the new JSON data to a `.tmp` file first (`sessions.json.tmp`) and then calls `fs.renameSync()`. In POSIX and modern file systems, `rename` is an atomic operating system operation.
2. **Crash Recovery**: When reading `sessions.json`, `readSessions()` wraps parsing in a try/catch block and initializes missing structures if recovering from a dirty shutdown.

#### 📍 Exact Location
- **File**: [`backend/server.js`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/backend/server.js#L21-L52)
- **Functions**: `saveSessions()`, `readSessions()`

#### 💻 Code Snippet
```javascript
// backend/server.js (Lines 40-52)
function saveSessions(sessions) {
  try {
    const tmp = `${sessionsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(sessions || [], null, 2));
    fs.renameSync(tmp, sessionsPath); // Atomic OS file replacement
  } catch (err) {
    try {
      fs.writeFileSync(sessionsPath, JSON.stringify(sessions || [], null, 2));
    } catch (fallbackErr) {
      console.error("Failed to save sessions:", fallbackErr);
    }
  }
}
```

#### 🎤 Interview Talking Points
> *"In a JSON-backed storage architecture, concurrent writes risk file corruption. To ensure ACID-like persistence without an external database, we implemented atomic file replacement: writes are completed to a temporary file (`.tmp`) and then atomically renamed via `fs.renameSync()`. If the server crashes during write, the primary `sessions.json` remains undamaged."*

---

### Feature 10: Dynamic Student Examination HUD & Violation Banner

#### 🎯 Problem & Threat Model
Students need transparent visibility into their webcam verification status, remaining time, and security warnings so they do not inadvertently trigger flags without realizing it. Furthermore, if a student accidentally triggers a focus loss or gesture, there must be a self-healing mechanism to return to compliance without leaving them stranded.

#### 💡 Architectural Solution
In [`src/App.jsx`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/src/App.jsx) and [`src/components/Quiz/Quiz.jsx`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/src/components/Quiz/Quiz.jsx):
- **Live HUD**: A non-intrusive floating HUD renders in the top right displaying the live camera stream (`<video ref={videoRef} autoPlay playsInline muted />`), authoritative countdown timer, and secure proctor badge.
- **Pre-Exam Diagnostic**: Pre-flight system check includes an interactive "Test / Enter Fullscreen" button allowing candidates to verify their display mode before starting the exam.
- **Violation Overlays**: Responsive toast alerts pop up when a forbidden key is struck or focus is lost.
- **Self-Healing Lockout Recovery**: If the candidate leaves fullscreen or switches windows, `examLocked: true` overlays the quiz questions with a security warning and provides a **"Re-enter Fullscreen & Unlock Exam"** action that re-engages kiosk mode and unlocks the question view once compliance is restored.

#### 📍 Exact Location
- **HUD JSX**: [`src/App.jsx`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/src/App.jsx#L620-L710)
- **Warning Banners & Recovery Overlay**: [`src/components/Quiz/Quiz.jsx`](file:///Users/patlorinipun/Desktop/Semester_5/AD/Proctorly/src/components/Quiz/Quiz.jsx#L235-L265)

---

## 4. Interview Playbook: Top 10 Technical Questions & Model Answers

### Q1: Why build Proctorly as an Electron desktop application rather than a pure web application?
> **Answer**:  
> *"Web browsers run in an OS-level sandbox that prevents access to low-level hardware and system diagnostics. In a pure web app, we cannot inspect the candidate's running processes to detect Zoom or Discord, we cannot intercept OS-level shortcuts like Alt+Tab or Cmd+Space, and we cannot reliably capture the entire desktop beyond the browser tab without intrusive browser prompts. Electron gives us native Node.js and OS API bindings while retaining a modern React UI."*

### Q2: How did you ensure security between the Electron Main process and React Renderer?
> **Answer**:  
> *"We adhered strictly to the Electron Security Guide: `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`. The renderer cannot require Node modules like `fs` or `child_process`. Instead, we defined a secure `contextBridge` in `preload.js` named `window.athena`. The frontend only invokes predefined, validated IPC channels, preventing Remote Code Execution (RCE) in case of XSS."*

### Q3: How do you prevent candidates from switching windows, using Alt+Tab, or swiping into Mission Control?
> **Answer**:  
> *"We use a multi-tiered lockdown: First, we engage Electron's native `win.setKiosk(true)`, which triggers macOS `NSApplicationPresentationDisableProcessSwitching`. This disables trackpad gestures like 3-finger swipe up (Mission Control) and Spaces switching, and suppresses the Dock and Menu Bar. Second, we elevate the window with `win.setAlwaysOnTop(true, 'screen-saver', 1)`, placing it at `NSScreenSaverWindowLevel` so no other desktop application can render above it. Third, if the window does lose focus, Electron's `blur` event triggers `handleFocusLost()`. This immediately wipes the OS clipboard via `clipboard.clear()`, takes an instantaneous desktop snapshot of the offending screen, flags the violation in the session log, and locks the exam interface until the student clicks 'Re-enter Fullscreen & Unlock Exam'."*

### Q4: How does background application detection work cross-platform?
> **Answer**:  
> *"We built an OS-agnostic process query routine in `ProctoringController.getRunningProcesses()`. We inspect `process.platform`: if on Windows, we execute `tasklist /FO CSV /NH`; if on macOS or Linux, we execute `ps -eo comm=`. We normalize process names to lowercase and cross-reference them against our `BLOCKED_APPS` blacklist (such as `discord`, `zoom`, `obs`, `teamviewer`). If any are found, the exam start is blocked until the candidate closes them."*

### Q5: How do you synchronize desktop screenshots and webcam frames without video streaming overhead?
> **Answer**:  
> *"Streaming continuous video from hundreds of students consumes excessive bandwidth and storage. We designed a dual-capture polling engine. Every 10 seconds, the main process grabs a desktop screenshot using `desktopCapturer.getSources({ types: ['screen'] })` and simultaneously sends an IPC message `request-face-snapshot` with the exact timestamp to the renderer. The renderer draws the current `<video>` frame onto an HTML `<canvas>`, serializes it to a JPEG ArrayBuffer, and sends it back. Both images are saved on disk with the same ISO timestamp, giving proctors synchronized visual evidence."*

### Q6: Why is the countdown timer managed in the Electron Main process instead of React state?
> **Answer**:  
> *"JavaScript timers in browser environments (`setInterval` or `setTimeout`) are notoriously unreliable: browsers throttle background tabs to save battery, and high CPU usage in the renderer can cause clock drift. Furthermore, candidates could tamper with DOM state. Driving the timer in the Main process makes it authoritative; the React UI merely displays the `timer-tick` broadcast. When the timer expires, the Main process triggers `handleExamExpired()`, submitting the exam to the backend directly."*

### Q7: How does the backend prevent data corruption when saving sessions without a database?
> **Answer**:  
> *"In `backend/server.js`, we implemented an atomic write pattern in `saveSessions()`. Rather than overwriting `sessions.json` directly, we serialize to a temporary file (`sessions.json.tmp`) and then execute `fs.renameSync()`. Because filesystem rename operations are atomic at the OS level, even if the server crashes or loses power during the write, `sessions.json` will never be left in a half-written or corrupted state."*

### Q8: How did you implement keystroke logging without causing UI lag?
> **Answer**:  
> *"Synchronous file writes on every keystroke cause noticeable input latency. We resolved this by implementing an in-memory buffer in `ProctoringController`. Every key event is pushed to `this.keylogBuffer`. A worker flushes the accumulated buffer asynchronously every 5 seconds to an append-only JSONL stream (`keylogs.jsonl`). When the exam finishes, a final synchronous flush persists remaining keys. This provides full keystroke telemetry with zero frame drops."*

### Q9: What happens if a candidate disconnects their webcam mid-exam?
> **Answer**:  
> *"We attach an `onended` listener directly to the camera's `MediaStreamTrack` in `App.jsx`. If the physical USB cable is unplugged or permissions are revoked, `track.onended` immediately fires. The UI notifies the student, and calls `window.athena.logMediaStatus('CAMERA_DISCONNECTED')`, which logs a high-severity violation on the backend and triggers an immediate desktop snapshot."*

### Q10: How would you scale this architecture to support 100,000 concurrent candidates?
> **Answer**:  
> *"Currently, the backend uses local JSON file persistence suited for standalone/institutional setups. To scale to 100k students:
> 1. **Storage**: Replace JSON file writes with a distributed database like PostgreSQL or MongoDB with read-replicas.
> 2. **Media Storage**: Offload screenshots and webcam snapshots directly to an S3/Cloud Storage bucket using pre-signed URLs, relieving backend server bandwidth.
> 3. **Telemetry Ingestion**: Stream keystrokes and security flags into an Apache Kafka or AWS Kinesis topic for asynchronous processing.
> 4. **AI Anomaly Detection**: Introduce computer vision models (e.g., face orientation, multiple faces detected, eye gaze tracking) directly into the snapshot evaluation pipeline."*

---

*Documentation compiled for Proctorly — Next-Gen Desktop Examination Proctoring System.*
