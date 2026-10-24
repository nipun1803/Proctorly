# Proctorly 🛡️

> **Next-Generation Desktop Examination Proctoring System** built with **Electron**, **React**, and **Node.js**.

Proctorly delivers a secure, fully monitored testing environment for candidates and educational institutions — featuring real-time anti-cheat surveillance, automated desktop and webcam capture, prohibited process detection, and low-level keystroke telemetry.

---

## 🚀 Key Features

### 🔒 Anti-Cheat & OS-Level Lockdown
- **Native Kiosk Mode**: Enforces `NSApplicationPresentationDisableProcessSwitching` on macOS, disabling Mission Control gestures, Spaces swiping, the Dock, and the Menu Bar.
- **Screen-Saver Level Window Priority**: Elevates the exam window to `NSScreenSaverWindowLevel` so no background app or floating notification can appear over the exam.
- **Multi-Display Detection**: Flags multiple displays at session start and newly connected displays during an active exam.
- **Cmd+Tab / Alt+Tab Interception**: Proactively blocks application-switching shortcuts and reclaims focus via `app.focus({ steal: true })` on every window blur event.
- **Workspace Pinning**: Pins the window across all desktop spaces while bypassing Lion Fullscreen isolation to prevent space-sliding.
- **Blur Event Surveillance**: Captures desktop evidence immediately upon any focus-loss event.

### 🕵️ Background Process Detection
Checks running applications before the exam, including Zoom, Discord, OBS, TeamViewer, AnyDesk, Slack, Skype, and more. The blocked-app screen provides a manual recheck after closing them.

### 📸 Synchronized Surveillance Snapshots
- Periodic desktop screenshots via Electron's `desktopCapturer`.
- Periodic candidate webcam snapshots paired with desktop images by filename timestamp.
- Initial capture after 3 seconds; recurring captures at 10, 20, 30 seconds, and so on.

### ⌨️ Keystroke & Shortcut Guard
Low-level blocking and logging of forbidden key combinations — Copy, Paste, Print Screen, DevTools Inspect, Alt+Tab, Cmd+Tab, Spotlight, and Mission Control — with strict modifier matching to eliminate false positives during normal typing.

### 🍎 Branded Native macOS Experience
Custom Proctorly icon (`.icns` multi-scale Retina bundle) embedded into the macOS `.app` bundle, `.dmg` installer volume, and the web interface.

### ⏱️ Session Lifecycle & Authoritative Clock
- In Electron, the main process manages the countdown and calls the backend expiration endpoint. Browser-only preview uses a limited React countdown without native monitoring.
- Fault-tolerant stream protection suppressing broken-pipe errors (`EIO` / `EPIPE`) with safe IPC dispatching.

### 🖥️ Examination HUD & Recovery UI
- Real-time webcam preview with live status badges.
- Self-healing **"Re-enter Fullscreen & Unlock Exam"** action for accidental focus loss recovery.
- Interactive MCQ navigation; answers are evaluated only on submission or expiration.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, Lucide React |
| Desktop Wrapper | Electron (secure IPC, `contextBridge`, native Kiosk APIs, `desktopCapturer`) |
| Backend | Express.js (session management, scoring, telemetry and capture metadata) |

---

## 📦 Local Setup & Installation

### Prerequisites

- **Node.js** `22.12+` and **npm** (required by Vite 8)
- **macOS** Ventura (`13.0`) or later (required for native kiosk APIs, screen capture, and `.dmg` packaging)
- A working **webcam** for candidate surveillance

Verify your Node.js version before starting:

```bash
node -v
```

---

### Step 1 — Clone the Repository

```bash
git clone https://github.com/nipun1803/Proctorly.git
cd Proctorly
```

### Step 2 — Install Dependencies

Install both the root (React + Electron) and backend (Express) dependencies:

```bash
# Root dependencies (Frontend + Electron)
npm install

# Backend dependencies (Express API)
npm --prefix backend install
```

### Step 3 — Grant macOS Permissions (First-Time Local Run)

When running Proctorly from a terminal in development mode, macOS attributes hardware permissions to your terminal app (e.g., Terminal, iTerm2, or VS Code):

1. Open **System Settings → Privacy & Security**.
2. Enable **Camera** and **Screen & System Audio Recording** for your terminal app (or Electron when prompted).
3. Close any prohibited background apps (such as Zoom, Discord, OBS, Slack, Skype, TeamViewer, or AnyDesk) before starting a proctored session, or Proctorly will pause at the pre-exam check screen.

### Step 4 — Run Locally

#### Option A — Full Electron Desktop App *(Recommended)*

Open **two separate terminals** from the repository root:

**Terminal 1 — Start the React/Vite dev server (`http://localhost:5173`):**
```bash
npm run dev
```

**Terminal 2 — Start Electron:**
```bash
npm start
```

> **How it works:** Wait until Vite reports `http://localhost:5173` is ready before running `npm start`. Electron automatically checks port `3000` and forks `backend/server.js` if the backend is not already running. If Vite is not running on port `5173`, Electron falls back to `dist/index.html`.

#### Option B — Browser-Only UI Preview

If you only want to inspect the React UI in a browser without native kiosk lockdown:

```bash
# Terminal 1 — Start the Express backend on http://localhost:3000
npm --prefix backend start

# Terminal 2 — Start the Vite frontend on http://localhost:5173
npm run dev
```

Open `http://localhost:5173` in your browser. Note that browser-only mode **cannot** enforce OS shortcut blocking, scan background processes, or capture desktop screenshots.

### Step 5 — Local Data & Quick Verification

- **Local session data:** During development, exam sessions, flags, keylogs, and captured screenshots/webcam shots are stored under `backend/data/sessions.json` and `backend/data/sessions/<sessionId>/`.
- **Verify everything works:** Run the automated test suite and syntax checks from the repository root:

```bash
node --test tests/*.test.cjs
node --check app/proctoringController.js
```

### Troubleshooting Local Setup

- **Blank window or stale UI in Electron:** Make sure `npm run dev` is running on port `5173` before launching `npm start`, or run `npm run vite:build` to refresh `dist/index.html`.
- **Port `3000` or `5173` already in use:** Stop the existing process (`lsof -ti:3000 | xargs kill` or `lsof -ti:5173 | xargs kill`) and restart.
- **Camera or desktop capture fails:** Check **System Settings → Privacy & Security** for **Camera** and **Screen & System Audio Recording** permissions, then restart your terminal/Electron.

---

## 🏗️ Building for Production

### Build the React Frontend

```bash
npm run vite:build
```

### Package & Generate the macOS `.dmg` Installer

```bash
# Using the configured npm script
npm run build

# Or package an already-built frontend directly
npx electron-builder --mac dmg
```

| Target Architecture | Command |
|---|---|
| Apple Silicon (M1/M2/M3) | `npx electron-builder --mac dmg --arm64` |
| Intel Mac | `npx electron-builder --mac dmg --x64` |
| Universal Binary | `npx electron-builder --mac dmg --universal` |

Output is placed in:
```
release/Proctorly-<version>-arm64.dmg
```

---

## 💿 Pre-Built DMG Download

A pre-built macOS installer is available for immediate use — no build step required.

**[⬇️ Download Proctorly-0.0.0-arm64.dmg](https://drive.google.com/file/d/1oEp7_WM4iqjNtCLcCfbrSQyoZVXxS4YC/view?usp=sharing)**

> Tested and verified on macOS Ventura & Sonoma — Apple Silicon (arm64).

---

## ⚠️ macOS Gatekeeper — Resolving "App is Damaged" Error

Since Proctorly is distributed outside the Mac App Store without an Apple notarization certificate, macOS Gatekeeper may display:

> *"Proctorly.app is damaged and can't be opened. You should move it to the Trash."*

This is expected behavior for unsigned third-party applications. Use any of the following methods to bypass it.

---

### Method 1 — Remove Quarantine Attribute from the DMG *(Recommended)*

Run this command **before** mounting the `.dmg`:

```bash
xattr -d com.apple.quarantine ~/Downloads/Proctorly-0.0.0-arm64.dmg
```

Then open the `.dmg` normally and drag `Proctorly.app` to `/Applications`.

---

### Method 2 — Remove Quarantine from the Installed App

If the app is already installed and showing the error:

```bash
xattr -cr /Applications/Proctorly.app
```

> `-c` clears all extended attributes; `-r` applies the operation recursively through the entire `.app` bundle.

---

### Method 3 — Allow via System Settings *(GUI)*

1. Attempt to open `Proctorly.app` — macOS will block it.
2. Open **System Settings → Privacy & Security**.
3. Scroll to the **Security** section.
4. Click **"Open Anyway"** next to the Proctorly entry and confirm.

---

### Method 4 — Right-Click to Open *(One-Time Bypass)*

1. **Right-click** (or Control-click) on `Proctorly.app`.
2. Select **"Open"** from the context menu.
3. Click **"Open"** in the confirmation dialog.

> After this one-time confirmation, the app will open normally on subsequent launches.

---

### Method 5 — Temporarily Disable Gatekeeper *(Advanced)*

> ⚠️ **Re-enable Gatekeeper immediately after launching.** Disabling it weakens overall system security.

```bash
# Disable Gatekeeper
sudo spctl --master-disable

# Launch Proctorly, then immediately re-enable
sudo spctl --master-enable
```

---

## 📚 System Architecture

For a comprehensive breakdown of system design, exact function locations, IPC contracts, and High-Level Design (HLD) diagrams, refer to the [System Documentation](docs/SYSTEM_DOCUMENTATION.md).

---

## 📁 Repository Structure

```text
Proctorly/
├── app/
│   ├── app.js                    # Electron main process & window management
│   ├── preload.js                # Context bridge — secure Proctorly proctoring API
│   └── proctoringController.js   # Single-file engine with shared in-file helpers
├── backend/
│   ├── data/
│   │   └── questions.json        # Assessment question dataset
│   ├── server.js                 # Express REST API (session management, telemetry)
│   └── README.md
├── build/
│   ├── icon.icns                 # Multi-scale Retina macOS icon bundle
│   └── icon.png                  # High-resolution PNG app icon
├── docs/
│   ├── SYSTEM_DOCUMENTATION.md   # Architecture, function map and debugging guide
│   └── UNUSED_CODE_AUDIT.md      # Current cleanup notes and historical audit
├── release/                      # Packaged DMG installer output
├── src/
│   ├── components/               # Quiz and UI components
│   ├── hooks/                    # Session, camera, apps and proctoring effects
│   ├── screens/                  # Setup, blocked apps, exam and results UI
│   ├── services/examApi.js       # Session-start and session-fetch requests
│   ├── utils/fullscreen.js       # Electron/browser fullscreen helpers
│   ├── App.jsx                   # Small screen selector (original priority retained)
│   ├── index.css                 # Tailwind design system tokens
│   └── main.jsx                  # React entry point
├── public/                       # Static assets and icons
├── tests/                        # Mocked controller and backend regression checks
└── vite.config.js                # Vite build configuration
```

---

## Validation & Debugging

```bash
node --test tests/*.test.cjs
node --check app/proctoringController.js
npm run vite:build
npx eslint src/App.jsx src/hooks src/screens src/services src/utils app/proctoringController.js
```

Controller/frontend tests compare against pre-cleanup commit `4eff01d`; retain that Git history to run them. Controller tests mock Electron, timers, network and disk writes. Frontend checks cover JSX structure, screen priority, syntax and start/reset/recovery actions using the existing parser packages. Backend tests exercise real route handlers with mocked routing and temporary storage, not a live HTTP server. No test opens kiosk mode or touches candidate evidence.

See the [debugging and manual-check guide](docs/SYSTEM_DOCUMENTATION.md#debugging-and-validation) for camera, screen-recording, focus recovery and shortcut checks. Mocked tests do not replace hardware/OS verification.

---

## 📄 License

This project is licensed under the **MIT License**.
