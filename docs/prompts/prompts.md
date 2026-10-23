# Proctorly — Prompt History & Development Discussions

Raw sequential prompt history logged during the implementation of the Proctorly desktop proctoring system. Built alongside Application Development lectures — concepts covered in class, AI used primarily for debugging and fixing errors during implementation.

---

## Phase 1: Project Setup & Electron Scaffold

### 1. Electron Window Setup

#### 💬 Developer Prompt
> "i set up the electron project with react and vite but the BrowserWindow isnt loading the vite dev server url, i have loadURL('http://localhost:5173') but it just shows a blank screen, is there a timing issue"

#### 💡 Discussion & Implementation
- The issue was that Electron was launching before Vite finished starting.
- Fixed by adding a `waitForVite()` helper that polls `localhost:5173` with `net.fetch` before calling `win.loadURL()`.
- Also ensured `webPreferences` had `contextIsolation: true` and `nodeIntegration: false` as covered in lecture.

---

### 2. Preload contextBridge Not Working

#### 💬 Developer Prompt
> "my preload script isnt exposing anything to the renderer, i did contextBridge.exposeInMainWorld but window.proctorly is undefined in react"

#### 💡 Discussion & Implementation
- The preload path in `BrowserWindow` config was pointing to a wrong relative path after the Vite build changed the output folder.
- Fixed the `preload` path to use `path.join(import.meta.dirname, 'preload.js')`.
- Confirmed `contextIsolation: true` was set — without it `contextBridge` silently does nothing.

---

### 3. EPIPE Crash on Terminal Close

#### 💬 Developer Prompt
> "getting write EIO errors when i close the terminal while electron is open, the whole app crashes, i know its a stream issue but how do i suppress it cleanly without ignoring real errors"

#### 💡 Discussion & Implementation
- Added error listeners on `process.stdout` and `process.stderr` at the top of `app.js` to catch and suppress only `EPIPE`/`EIO` error codes.
- Wrapped `console.*` methods in try/catch — in packaged apps the stdio streams are fully closed so any write throws synchronously.
- Added `process.on('uncaughtException')` as a final guard that only swallows stream errors and re-throws everything else.

---

## Phase 2: Backend Express Server

### 4. Fork vs Spawn for Backend

#### 💬 Developer Prompt
> "i used spawn to start the backend server from electron but the backend cant access the same env variables as the main process, we learned fork shares the parent env, but when i use fork the backend isnt starting"

#### 💡 Discussion & Implementation
- `fork()` requires the script to be a CommonJS or ESM module with a clear entry point — the backend `server.js` was missing a proper module guard.
- Fixed by making `backend/server.js` check `import.meta.url === process.argv[1]` before binding, so it works both when forked and when run standalone.
- Backend now starts correctly with `fork()` and shares the parent's `process.env`.

---

### 5. Atomic Write for Session JSON

#### 💬 Developer Prompt
> "i know from lecture that atomic writes use a temp file and rename, i implemented it but fs.rename is throwing EXDEV cross device error on some macs, how to fix"

#### 💡 Discussion & Implementation
- `EXDEV` happens when the temp file is on a different filesystem/volume than the destination.
- Fixed by writing the temp file to the same directory as the target file (not `/tmp`).
- Used `path.join(path.dirname(targetPath), '.tmp_' + path.basename(targetPath))` for the temp path.

---

### 6. Server-Side Deadline Not Firing

#### 💬 Developer Prompt
> "the exam isnt auto expiring when timer hits 0 on the server side, i have the deadline stored in the session but the check only runs when a request comes in, should i use setInterval on the server or is there a better way"

#### 💡 Discussion & Implementation
- Using a `setInterval` for per-session expiry creates a timer leak if sessions are never cleaned up.
- Kept the lazy approach: `closeIfOverdue()` runs on every incoming request and checks `session.deadline < Date.now()`.
- Added one global `setInterval` at 30-second granularity as a sweeper for sessions that receive no more requests (e.g., candidate closed the app).

---

## Phase 3: Kiosk Mode & OS Lockdown

### 7. Kiosk Mode Not Hiding Dock on macOS

#### 💬 Developer Prompt
> "win.setKiosk(true) works but the dock is still showing up on macos, i saw NSApplicationPresentationOptions in the electron docs, is that the right api to use here"

#### 💡 Discussion & Implementation
- `setKiosk(true)` on macOS doesn't reliably suppress the Dock in all macOS versions.
- Added explicit `app.dock.hide()` and passed `NSApplicationPresentationDisableProcessSwitching | NSApplicationPresentationHideDock | NSApplicationPresentationHideMenuBar` presentation options.
- Combined with `win.setAlwaysOnTop(true, 'screen-saver', 1)` to push the window above notification banners.

---

### 8. Three Finger Swipe Still Switches Spaces

#### 💬 Developer Prompt
> "even with kiosk on the candidate can do 3 finger swipe and slide to another space, i tried setVisibleOnAllWorkspaces but then the window opens in its own fullscreen space and its isolated"

#### 💡 Discussion & Implementation
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` with the `visibleOnFullScreen` flag prevents Space isolation while keeping the window pinned everywhere.
- Also called `win.setMovable(false)` and disabled the native fullscreen button so the app doesn't enter Lion's isolated fullscreen mode which creates a dedicated Space.

---

### 9. Kiosk Getting Dismissed by Notification Banners

#### 💬 Developer Prompt
> "notification banners are appearing over the exam window even with screen-saver level, and sometimes clicking them takes focus away, is there a way to reclaim focus automatically"

#### 💡 Discussion & Implementation
- Implemented `watchdogTick()` on a 1-second `setInterval` in the main process.
- On every tick: checks `win.isFocused()` — if false, calls `app.focus({ steal: true })` and `win.focus()`.
- Checks `win.isKiosk()` — if false (can happen after some system events), re-engages with `win.setKiosk(true)`.

---

### 10. Multi Display Detection

#### 💬 Developer Prompt
> "need to detect if a second monitor is connected before exam starts and also during exam, i know electron has a screen module with getAllDisplays, but i also need to catch if they plug one in during exam"

#### 💡 Discussion & Implementation
- `screen.getAllDisplays().length > 1` used in `checkDisplays()` for pre-flight.
- Subscribed to `screen.on('display-added', handleDisplayAdded)` in `startSession()` — fires immediately when a monitor is connected mid-exam.
- `handleDisplayAdded` flags the event, captures a screenshot as evidence, and sends a warning IPC to the renderer.

---

## Phase 4: Shortcut Blocking & Keystroke Logging

### 11. before-input-event Firing on Normal Typing

#### 💬 Developer Prompt
> "my isBlockedInput function is blocking shift+key combinations which is just capital letters, i have modifier checks but its still triggering, how do i write the condition correctly so shift alone doesnt block"

#### 💡 Discussion & Implementation
- The issue was checking `event.shift` without checking that no other modifier was active — `Shift+A` was matching because the function only checked for shift being present, not that shift was the *only* modifier.
- Rewrote the check to be strict: for each blocked combination, only match when the modifier set is **exactly** what the rule specifies (e.g., `Cmd+C` means `meta: true` and `ctrl: false, alt: false`).
- Shift alone on a printable key is now always allowed.

---

### 12. globalShortcut.register Failing for Cmd+Tab

#### 💬 Developer Prompt
> "globalShortcut.register for CommandOrControl+Tab is returning false on macos, i thought we could intercept any shortcut this way"

#### 💡 Discussion & Implementation
- `Cmd+Tab` is a system-reserved shortcut on macOS that Electron's `globalShortcut` API explicitly cannot override — the OS intercepts it before any application.
- Workaround: the kiosk watchdog (`watchdogTick`) reclaims focus within 1 second whenever `Cmd+Tab` succeeds in switching away.
- Additionally `app.focus({ steal: true })` is called on every `win.on('blur')` event as a secondary reclaim path.

---

### 13. Keystroke Buffer Sending Too Frequently

#### 💬 Developer Prompt
> "my keylog flush is running every second and spamming the backend with tiny requests, should i buffer more or is there a better pattern, we covered outbox pattern in lecture"

#### 💡 Discussion & Implementation
- Moved keystroke flushing into the existing outbox queue — same retry and backoff logic as other telemetry.
- Buffer flushes every 5 seconds or when buffer size exceeds 50 events, whichever comes first.
- Backend receives batches via `POST /keylog` and appends to `sessions/{id}/keylogs.json`.

---

## Phase 5: Surveillance Captures

### 14. desktopCapturer Returning Empty Sources

#### 💬 Developer Prompt
> "desktopCapturer.getSources is returning an empty array on macos monterey and above, works fine in dev but not when packaged"

#### 💡 Discussion & Implementation
- macOS requires Screen Recording permission for `desktopCapturer` — in packaged apps this must be requested and the `NSScreenCaptureDescription` key must be in `Info.plist`.
- Added the permission key via `electron-builder` `extendInfo` config.
- Added a preflight check for screen recording permission using `systemPreferences.getMediaAccessStatus('screen')`.
- Added a fallback: if `getSources` returns empty, log a flagged capture failure rather than crashing.

---

### 15. Webcam Snapshot IPC Timeout

#### 💬 Developer Prompt
> "sometimes the face snapshot ipc call never gets a response back, the renderer is busy rendering and drops the message i think, my main process just hangs waiting"

#### 💡 Discussion & Implementation
- Added an 8-second watchdog `setTimeout` in `expectFaceSnapshot()` — if the renderer doesn't respond within 8 seconds, logs a missed snapshot and cancels the wait.
- The renderer now processes `request-face-snapshot` in a `requestAnimationFrame` callback to avoid blocking mid-render.
- Added JPEG magic byte validation (`0xFF 0xD8`) on the received ArrayBuffer before writing — rejects corrupted frames silently.

---

### 16. Canvas Snapshot Brightness Check

#### 💬 Developer Prompt
> "need to detect if the webcam frame is completely black like if they covered the camera, i draw to canvas already so i can sample pixels there"

#### 💡 Discussion & Implementation
- After drawing to canvas, samples a 10×10 grid of pixels across the frame using `getImageData`.
- Averages the luminance (`0.299R + 0.587G + 0.114B`) across all sampled pixels.
- If average luminance < 15 (out of 255), the frame is flagged as a dark/covered camera and a `camera_covered` event is sent to the backend.

---

## Phase 6: Process Detection

### 17. ps Output Matching Too Broadly

#### 💬 Developer Prompt
> "my blocked app detection is flagging false positives, obs is matching a process called observer and zoom is matching zoomus helper, i need exact name matching not substring"

#### 💡 Discussion & Implementation
- Changed matching from `processName.includes(blockedName)` to: process name must either equal the blocked name exactly, or start with the blocked name followed by a space, dot, or dash.
- This makes `obs` match `obs` and `OBS` but not `Observer` or `obsidian`.
- Normalized both sides to lowercase before comparison to handle capitalization differences across macOS versions.

---

### 18. Process Scanner Failing Silently

#### 💬 Developer Prompt
> "if the ps command fails my scanner just returns no blocked apps which is wrong, it should fail loudly not pass as clean"

#### 💡 Discussion & Implementation
- Wrapped `getRunningProcesses()` in a try/catch — on error, returns `{ ok: false, error: reason }` instead of an empty array.
- `findBlockedApps()` propagates the `ok: false` state up to `runPreflight()` which shows it as a scan failure, not a clean result.
- Pre-flight check now shows "Unable to verify running applications" as a failed check rather than silently passing.

---

## Phase 7: Exam Timer & Auto Submit

### 19. Timer Drifting Due to setInterval

#### 💬 Developer Prompt
> "my exam countdown is drifting, after 30 mins its behind by like 10-15 seconds because setInterval isnt precise, we learned the correct way is to anchor to an absolute timestamp"

#### 💡 Discussion & Implementation
- Replaced `remainingTime--` per tick with `remaining = Math.max(0, deadline - Date.now())` on each tick.
- `deadline` is `session.startTime + session.durationMs`, stored in the session JSON at exam start.
- This way clock drift doesn't accumulate — every tick is independently correct regardless of interval jitter.

---

### 20. Double Submit Race Condition

#### 💬 Developer Prompt
> "if the timer expires at the same time the candidate clicks submit i get two finalize calls going to the server, the server handles idempotent writes but the renderer gets two score events, how to prevent"

#### 💡 Discussion & Implementation
- Added a `submitting` boolean flag in `proctoringController` set to `true` before the first finalize call.
- `handleExamExpired()` checks the flag and returns early if already submitting.
- Frontend `submitExam()` also disables the submit button immediately on first click and checks the flag via IPC before proceeding.

---

## Phase 8: Renderer Crash Recovery

### 21. Renderer Crash Loop Aborting Too Eagerly

#### 💬 Developer Prompt
> "my crash detection is counting crashes but its using a simple counter so if the app runs for an hour with 1 crash every 20 mins it eventually aborts, i need a sliding window"

#### 💡 Discussion & Implementation
- Replaced the simple counter with a `crashTimestamps[]` array.
- On each crash: push `Date.now()` and filter out entries older than 60 seconds.
- If `crashTimestamps.length >= 3` after filtering — abort. Otherwise reload the renderer.
- This correctly handles sparse crashes over a long session without false positives.

---

## Phase 9: React UI & Exam HUD

### 22. Preflight Checks Not Updating in Real Time

#### 💬 Developer Prompt
> "my preflight status in the setup screen only checks once on mount, i want it to keep checking every 5 seconds and update the ui, but using setInterval in useEffect i keep getting stale state"

#### 💡 Discussion & Implementation
- The stale state issue was from closing over an old state reference inside the interval callback.
- Fixed by using a `ref` to always read the latest state, or restructuring the effect to re-fetch and call `setState` directly without depending on previous state.
- Cleanup function in `useEffect` clears the interval on unmount to prevent memory leaks.

---

### 23. Webcam Preview Black on Exam Start

#### 💬 Developer Prompt
> "the webcam video element shows black when the exam starts even though i called getUserMedia, works fine if i add a 500ms delay, is there a proper event to wait for"

#### 💡 Discussion & Implementation
- The `<video>` element needs the `onloadedmetadata` event before the stream is actually rendering frames.
- Replaced the `setTimeout` hack with attaching the `srcObject` and waiting for `video.onloadedmetadata` before showing the preview.
- Also added `video.play()` explicitly since some browsers require it after programmatic stream assignment.

---

### 24. Lock Overlay Showing Behind Exam Content

#### 💬 Developer Prompt
> "my lock overlay component renders but its showing behind the quiz content, i have z-index 9999 but its not working"

#### 💡 Discussion & Implementation
- A parent element had `transform: translateZ(0)` applied for GPU acceleration which created a new stacking context, capping the child's effective z-index.
- Moved the lock overlay to render as a direct child of `<body>` using a React portal (`ReactDOM.createPortal`).
- This puts it outside any stacking context and correctly overlays everything.

---

## Phase 10: Outbox & Reliability

### 25. Outbox Retrying Infinitely on 4xx Errors

#### 💬 Developer Prompt
> "my outbox retries forever but if the backend returns a 400 bad request thats not a transient error it should not retry, only retry on network errors and 5xx"

#### 💡 Discussion & Implementation
- Added response status check in the `drain()` loop.
- `4xx` responses: item is moved to `outbox-failed.jsonl` as a dead-letter entry, not retried.
- `5xx` and network errors (`fetch` throws): exponential backoff retry up to 10 attempts.
- Backoff: 1s, 2s, 4s, 8s… capped at 30 seconds between retries.

---

### 26. IPC Message Sent to Destroyed Renderer

#### 💬 Developer Prompt
> "getting error 'object has been destroyed' when main process tries to send ipc to renderer right after a crash, the window is reloading but the send fires before its ready"

#### 💡 Discussion & Implementation
- Wrapped all `win.webContents.send()` calls in a guard: checks `!win.isDestroyed() && win.webContents.isLoading() === false`.
- Added a helper `safeIpcSend(channel, ...args)` used everywhere instead of calling `webContents.send` directly.
- During renderer reload, IPC messages are queued and flushed once `webContents.on('did-finish-load')` fires.

---

## Phase 11: Packaging & Icon

### 27. DMG Icon Not Showing Custom Icon

#### 💬 Developer Prompt
> "built the dmg with electron-builder but the volume icon in finder is still the default electron icon, i put icon.icns in build/ folder and referenced it in package.json"

#### 💡 Discussion & Implementation
- The `build.icon` field in `package.json` was correct but the `.icns` file was missing the required icon sizes — macOS DMG requires at least 512×512 and 1024×1024 inside the `.icns` bundle.
- Rebuilt `icon.icns` using `iconutil` with all required scales: 16, 32, 64, 128, 256, 512, 1024.
- Also set `build.dmg.icon` explicitly to point to `build/icon.icns` for the DMG volume badge separately from the app icon.

---

### 28. App Showing as Damaged After DMG Install

#### 💬 Developer Prompt
> "add the commands it is showing dmg file corrupted to by pass that give the dmg instructions also"

#### 💡 Discussion & Implementation
- Expected behavior for unsigned apps distributed outside the Mac App Store.
- macOS Gatekeeper sets a `com.apple.quarantine` extended attribute on anything downloaded from the internet.
- Primary fix: `xattr -d com.apple.quarantine ~/Downloads/Proctorly-0.0.0-arm64.dmg` before mounting.
- If already installed: `xattr -cr /Applications/Proctorly.app` clears all extended attributes recursively.
- Documented all 5 bypass methods in the README including the System Settings → Privacy & Security GUI path.

---

## Phase 12: Documentation

### 29. System Documentation

#### 💬 Developer Prompt
> "write a proper system documentation with hld diagrams, function matrix, all features explained with which file and line they are in"

#### 💡 Discussion & Implementation
- Created `docs/SYSTEM_DOCUMENTATION.md` with Mermaid diagrams:
  - Four-process architecture: Renderer → Preload Bridge → Main Process → Backend.
  - Exam lifecycle state machine (PRE_EXAM → STARTING → ACTIVE → SUBMITTING → SUBMITTED/EXPIRED/ABORTED).
  - Synchronized surveillance sequence diagram.
- Full feature matrix table referencing exact file and line number for every major function.
- Deep-dive per feature: threat model, architectural solution, exact code location.

---

### 30. README Setup & DMG Link

#### 💬 Developer Prompt
> "add the stup instructions and include commands for making the dmg, adndmg link also https://drive.google.com/file/d/1oEp7_WM4iqjNtCLcCfbrSQyoZVXxS4YC/view?usp=sharing, make it in proper format give in the chat copy pastable only"

#### 💡 Discussion & Implementation
- Added structured setup section: clone → install (root + backend) → dev mode (two terminals) → build → dist.
- Included architecture-specific `electron-builder` commands for arm64, x64, and universal.
- Pre-built DMG download link added with tested macOS version notes.

---

## Feature Matrix

| Feature | File | Key Function | Mechanism |
| :--- | :--- | :--- | :--- |
| **Kiosk Lockdown** | `proctoringController.js · kiosk` | `enter()` / `exit()` | `setKiosk`, screen-saver level, workspace pin |
| **Kiosk Watchdog** | `proctoringController.js · controller` | `watchdogTick()` | 1s interval, re-engage kiosk + reclaim focus |
| **Multi-Display Guard** | `proctoringController.js · controller` | `checkDisplays()` | `screen.getAllDisplays()` + `display-added` event |
| **Shortcut Blocker** | `proctoringController.js · input policy` | `isBlockedInput()` | Strict modifier matching, `before-input-event` |
| **Global Shortcut Trap** | `proctoringController.js · controller` | `registerGlobalShortcuts()` | `globalShortcut.register` for system-level shortcuts |
| **Keystroke Telemetry** | `proctoringController.js · telemetry` | `recordKey()` / `flushKeylogs()` | Buffered batches via outbox |
| **Desktop Capture** | `proctoringController.js · evidence` | `captureDesktop()` | `desktopCapturer` → JPEG |
| **Webcam Snapshot** | `proctoringController.js · evidence` | `saveFaceSnapshot()` | IPC request → canvas → ArrayBuffer → validate → write |
| **Process Scanner** | `proctoringController.js · scanner` | `findBlockedApps()` | `ps -axo comm=` + exact name match |
| **Reliable Outbox** | `proctoringController.js · outbox` | `enqueue()` / `drain()` | Backoff retry + dead-letter file |
| **Authoritative Timer** | `proctoringController.js · controller` | `startClockTimer()` | `deadline - Date.now()` per tick |
| **Auto-Expiry** | `proctoringController.js · controller` | `handleExamExpired()` | Single-flight, backend-first, then renderer notify |
| **Crash Recovery** | `proctoringController.js · controller` | `handleRendererGone()` | Sliding window crash count, reload or abort |
| **Secure IPC Bridge** | `preload.js` | `contextBridge.exposeInMainWorld()` | Named API only, no raw Node in renderer |
| **IPC Sender Validation** | `app.js` | `handle()` | Frame URL checked on every IPC call |
| **Atomic Session Store** | `backend/server.js` | `writeAtomic()` | Temp file + `fs.rename()` |
| **Deadline Enforcement** | `backend/server.js` | `closeIfOverdue()` | Server rejects late answers independently |
| **Idempotent Grading** | `backend/server.js` | `finalizeSession()` | Closed sessions never change again |
| **Exam HUD** | `src/App.jsx` | `App()` | Setup checks, start flow, IPC event wiring |
| **Quiz & Lock Overlay** | `src/components/Quiz/Quiz.jsx` | `submitExam()` | Answer saving, confirm dialog, lock modal |
