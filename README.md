# Proctorly 🛡️

> **Next-Generation Desktop Examination Proctoring System** built with **Electron**, **React**, and **Node.js**.

Proctorly provides a secure, monitored testing environment for candidates and educational institutions with active anti-cheat surveillance, automated desktop and webcam captures, prohibited application detection, and low-level keystroke telemetry.

---

## 🚀 Key Features

- **Automated Anti-Cheat Surveillance**:
  - Fullscreen lock and kiosk enforcement.
  - Multi-display and external monitor detection.
  - Window blur and application-switching alerts.
- **Prohibited Background Process Detection**:
  - Detects background processes such as Zoom, Discord, OBS, TeamViewer, AnyDesk, Slack, Skype, etc.
- **Surveillance Snapshots**:
  - Periodic desktop screenshots using Electron's `desktopCapturer`.
  - Periodic candidate webcam snapshots synchronized by session timestamp.
- **Keystroke & Shortcut Guard**:
  - Low-level blocking and logging of forbidden key combinations (Copy, Paste, Print, Inspect, Alt+Tab, Cmd+Tab, Spotlight, Mission Control).
- **Session Lifecycle & Auto-Submission**:
  - Synchronized countdown timer managed by main process.
  - Automatic submission and session closure on timer expiration or abort.
- **Interactive Examination HUD**:
  - Real-time webcam preview.
  - Live proctoring status indicators.
  - Interactive MCQ navigation and instant score evaluation.

---

## 🛠️ Technology Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide React, Radix UI.
- **Desktop Wrapper**: Electron with secure IPC (`contextIsolation`, preload `contextBridge`).
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

## 📁 Repository Structure

```text
Proctorly/
├── app/
│   ├── app.js                   # Electron main process & window management
│   ├── preload.js               # Context bridge exposing secure Athena proctoring API
│   └── proctoringController.js  # Proctoring engine (detections, captures, timers)
├── backend/
│   ├── data/
│   │   └── questions.json       # Assessment question dataset
│   ├── server.js                # Express REST API for session management
│   └── README.md
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
