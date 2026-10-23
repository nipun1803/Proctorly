# Proctorly 🛡️

> **Next-Generation Desktop Examination Proctoring System** built with **Electron**, **React**, and **Node.js**.

Proctorly delivers a secure, fully monitored testing environment for candidates and educational institutions — featuring real-time anti-cheat surveillance, automated desktop and webcam capture, prohibited process detection, and low-level keystroke telemetry.

---

## 🚀 Key Features

### 🔒 Anti-Cheat & OS-Level Lockdown
- **Native Kiosk Mode**: Enforces `NSApplicationPresentationDisableProcessSwitching` on macOS, disabling Mission Control gestures, Spaces swiping, the Dock, and the Menu Bar.
- **Screen-Saver Level Window Priority**: Elevates the exam window to `NSScreenSaverWindowLevel` so no background app or floating notification can appear over the exam.
- **Multi-Display Detection**: Automatically disallows multiple monitors or sidecar displays during an active session.
- **Cmd+Tab / Alt+Tab Interception**: Proactively blocks application-switching shortcuts and reclaims focus via `app.focus({ steal: true })` on every window blur event.
- **Workspace Pinning**: Pins the window across all desktop spaces while bypassing Lion Fullscreen isolation to prevent space-sliding.
- **Blur Event Surveillance**: Captures desktop evidence immediately upon any focus-loss event.

### 🕵️ Background Process Detection
Detects and flags unauthorized background processes including Zoom, Discord, OBS, TeamViewer, AnyDesk, Slack, Skype, and more.

### 📸 Synchronized Surveillance Snapshots
- Periodic desktop screenshots via Electron's `desktopCapturer`.
- Periodic candidate webcam snapshots synchronized by session timestamp.

### ⌨️ Keystroke & Shortcut Guard
Low-level blocking and logging of forbidden key combinations — Copy, Paste, Print Screen, DevTools Inspect, Alt+Tab, Cmd+Tab, Spotlight, and Mission Control — with strict modifier matching to eliminate false positives during normal typing.

### 🍎 Branded Native macOS Experience
Custom Proctorly icon (`.icns` multi-scale Retina bundle) embedded into the macOS `.app` bundle, `.dmg` installer volume, and the web interface.

### ⏱️ Session Lifecycle & Authoritative Clock
- Countdown timer managed exclusively by the main process with automatic submission on expiration.
- Fault-tolerant stream protection suppressing broken-pipe errors (`EIO` / `EPIPE`) with safe IPC dispatching.

### 🖥️ Examination HUD & Recovery UI
- Real-time webcam preview with live status badges.
- Self-healing **"Re-enter Fullscreen & Unlock Exam"** action for accidental focus loss recovery.
- Interactive MCQ navigation with instant score evaluation.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, Lucide React |
| Desktop Wrapper | Electron (secure IPC, `contextBridge`, native Kiosk APIs, `desktopCapturer`) |
| Backend | Express.js (session management, telemetry, media uploads) |

---

## 📦 Setup & Installation

### Prerequisites

- **Node.js** v18+ and **npm** v9+
- **macOS** Ventura or later (required for native kiosk APIs and `.dmg` packaging)
- A connected webcam for candidate surveillance

---

### Step 1 — Clone the Repository

```bash
git clone https://github.com/your-username/Proctorly.git
cd Proctorly
```

### Step 2 — Install Dependencies

```bash
# Root dependencies (Frontend + Electron)
npm install

# Backend dependencies
cd backend && npm install && cd ..
```

### Step 3 — Run in Development Mode

Open **two separate terminals** and run the following:

**Terminal 1 — Backend Server:**
```bash
cd backend && npm start
```

**Terminal 2 — React Dev Server + Electron:**
```bash
npm run dev
```

---

## 🏗️ Building for Production

### Build the React Frontend

```bash
npm run build
```

### Package & Generate the macOS `.dmg` Installer

```bash
# Using the configured npm script
npm run dist

# Or invoke electron-builder directly
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
│   └── proctoringController.js   # Proctoring engine (detections, captures, timers)
├── backend/
│   ├── data/
│   │   └── questions.json        # Assessment question dataset
│   ├── server.js                 # Express REST API (session management, telemetry)
│   └── README.md
├── build/
│   ├── icon.icns                 # Multi-scale Retina macOS icon bundle
│   └── icon.png                  # High-resolution PNG app icon
├── docs/
│   └── SYSTEM_DOCUMENTATION.md  # HLD diagrams and function reference matrix
├── release/                      # Packaged DMG installer output
├── src/
│   ├── components/               # Quiz and UI components
│   ├── App.jsx                   # Main candidate examination dashboard
│   ├── index.css                 # Tailwind design system tokens
│   └── main.jsx                  # React entry point
├── public/                       # Static assets and icons
└── vite.config.js                # Vite build configuration
```

---

## 📄 License

This project is licensed under the **MIT License**.
