# Proctorly 🛡️

> **Next-Generation Desktop Examination Proctoring System** built with **Electron**, **React**, and **Node.js**.

Proctorly provides a secure, monitored testing environment for candidates and educational institutions with active anti-cheat surveillance, automated desktop and webcam captures, prohibited application detection, and low-level keystroke telemetry.

---

## 🚀 Key Features

- **Automated Anti-Cheat Surveillance**:
  - **Native Kiosk Mode & OS Lockdown**: Enforces native kiosk presentation options (`NSApplicationPresentationDisableProcessSwitching`) on macOS to disable Mission Control gestures, Spaces swipe, the Dock, and the Menu Bar.
  - **Screen-Saver Level Priority**: Elevates the examination window to `NSScreenSaverWindowLevel` (`win.setAlwaysOnTop(true, 'screen-saver', 1)`) so no background apps or floating notifications can display over the exam.
  - **Multi-Display & External Monitor Detection**: Disallows multiple monitors or side-car displays.
  - **Command + Tab Interception & Focus Stealing**: Proactively blocks `Command + Tab` and `Alt + Tab` shortcuts and engages `app.focus({ steal: true })` with synchronous focus reclaim on window blur to prevent candidate desktop switching.
  - **Workspace Pinning Without Spaces Separation**: Pins window across all desktop spaces while bypassing Lion Fullscreen isolation to prevent space-sliding.
  - **Window Focus / Blur Monitoring**: Tracks window blur events and immediately captures desktop evidence if focus is lost.
- **Prohibited Background Process Detection**:
  - Detects unauthorized background processes such as Zoom, Discord, OBS, TeamViewer, AnyDesk, Slack, Skype, etc.
- **Synchronized Surveillance Snapshots**:
  - Periodic desktop screenshots using Electron's `desktopCapturer`.
  - Periodic candidate webcam snapshots synchronized by session timestamp.
- **Precision Keystroke & Shortcut Guard**:
  - Low-level blocking and logging of forbidden key combinations (Copy, Paste, Print, Inspect, Alt+Tab, Cmd+Tab, Spotlight, Mission Control) with strict modifier matching to prevent false positives during normal typing.
- **Branded Native macOS Experience**:
  - Custom Proctorly icon (`.icns` multi-scale Retina bundle & PNGs) embedded into the macOS `.app` bundle, `.dmg` installer volume, and web interface.
- **Session Lifecycle & Authoritative Clock**:
  - Authoritative countdown timer managed by the main process with automatic submission on expiration.
  - Fault-tolerant stream protection suppressing broken-pipe errors (`EIO`/`EPIPE`) and safe IPC message dispatching.
- **Interactive Examination HUD & Recovery UI**:
  - Real-time webcam preview with status badges.
  - Self-healing "Re-enter Fullscreen & Unlock Exam" action to recover from accidental focus loss.
  - Interactive MCQ navigation and instant score evaluation.

---

## 🛠️ Technology Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide React.
- **Desktop Wrapper**: Electron with secure IPC (`contextIsolation`, preload `contextBridge`), native Kiosk APIs, and `desktopCapturer`.
- **Backend**: Express.js server managing question evaluation, session telemetry, and media uploads.

---

## 📦 Getting Started

### 1. Install Dependencies

```bash
# Install root (Frontend & Electron) dependencies
npm install

# Install backend dependencies
cd backend && npm install && cd ..
```

### 2. Run the Application

```bash
# In one terminal, start the backend server
cd backend && npm start

# In another terminal, start the React dev server & Electron app
npm run dev
```

---

## 📚 System Architecture Guide

For a comprehensive breakdown of the system design, exact function locations, and High-Level Design (HLD) diagrams, refer to the [System Documentation](docs/SYSTEM_DOCUMENTATION.md).

---

## 📁 Repository Structure

```text
Proctorly/
├── app/
│   ├── app.js                   # Electron main process & window management
│   ├── preload.js               # Context bridge exposing secure Proctorly proctoring API
│   └── proctoringController.js  # Proctoring engine (detections, captures, timers)
├── backend/
│   ├── data/
│   │   └── questions.json       # Assessment question dataset
│   ├── server.js                # Express REST API for session management
│   └── README.md
├── build/
│   ├── icon.icns                # Native multi-scale macOS icon bundle
│   └── icon.png                 # High-resolution PNG app icon
├── docs/
│   └── SYSTEM_DOCUMENTATION.md  # Comprehensive HLD and function matrix
├── release/                     # Packaged DMG installer (Proctorly-0.0.0-arm64.dmg)
├── src/
│   ├── components/              # Quiz and UI components
│   ├── App.jsx                  # Main candidate examination dashboard
│   ├── index.css                # Tailwind design system tokens
│   └── main.jsx
├── public/                      # Static assets & icons
└── vite.config.js
```

---

## 📄 License

MIT
