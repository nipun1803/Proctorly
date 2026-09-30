import { useEffect, useRef, useState } from 'react';
import Quiz from './components/Quiz/Quiz';
import './App.css';
import {
  RefreshCw,
  Check,
  AlarmClock,
  Ban,
  AlertTriangle,
  CheckCircle2,
  Camera,
  User,
  ShieldCheck,
  CheckCircle,
  XCircle
} from 'lucide-react';

const isElectron = typeof window !== 'undefined' && !!window.athena;

export default function App() {
  // ─── Candidate & Session State ───────────────────────────────────────────
  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const sessionIdRef = useRef(null);

  // ─── Exam Lifecycle States ───────────────────────────────────────────────
  // PRE_EXAM -> ACTIVE -> SUBMITTED | EXPIRED
  const [examState, setExamState] = useState('PRE_EXAM');
  const [timerDisplay, setTimerDisplay] = useState('30:00');
  const [examResults, setExamResults] = useState(null);
  const [examLocked, setExamLocked] = useState(false);

  // ─── Hardware State ──────────────────────────────────────────────────────
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  // ─── Proctoring Alerts ───────────────────────────────────────────────────
  const [blockedAppsList, setBlockedAppsList] = useState([]);
  const [showAppsPanel, setShowAppsPanel] = useState(false);
  const [blockedKeyAlert, setBlockedKeyAlert] = useState(null);
  const [focusLostAlert, setFocusLostAlert] = useState(false);
  const [fullscreenViolation, setFullscreenViolation] = useState(false);

  // Video and Stream Refs
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Keep live camera stream attached to preview video element
  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraEnabled, examState]);

  // ─── Pre-Exam Background App Check ───────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return;
    async function checkApps() {
      try {
        const result = await window.athena.getBackgroundApps();
        if (result && result.blockedApps && result.blockedApps.length > 0) {
          setBlockedAppsList(result.blockedApps);
          setShowAppsPanel(true);
        }
      } catch (err) {
        console.error('Failed to check background apps:', err);
      }
    }
    checkApps();
  }, []);

  // ─── Camera Access (Preview Only on Permissions Page) ────────────────────
  async function requestCameraAccess() {
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraEnabled(true);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          setCameraEnabled(false);
          if (isElectron && sessionIdRef.current) {
            window.athena.logMediaStatus('CAMERA_DISCONNECTED', 'Camera hardware disconnected');
          }
        };
      }
      return true;
    } catch (err) {
      console.error('Camera access error:', err);
      setCameraEnabled(false);
      setCameraError('Camera access required. Please allow camera permissions in system settings.');
      return false;
    }
  }

  // Auto-request camera on load for convenient setup preview
  useEffect(() => {
    requestCameraAccess();
  }, []);

  // ─── Fullscreen & Focus Loss Listeners (Browser Fallback) ─────────────────
  useEffect(() => {
    // Only use DOM fullscreenchange in browser mode; Electron uses native window events
    if (isElectron) return;

    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      if (!isCurrentlyFullscreen && examState === 'ACTIVE') {
        setFullscreenViolation(true);
        setExamLocked(true);
      } else if (isCurrentlyFullscreen && examState === 'ACTIVE') {
        setFullscreenViolation(false);
        setExamLocked(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [examState]);

  // ─── Browser Fallback Timer & Exam State Guard ────────────────────────────
  useEffect(() => {
    if (examState !== 'ACTIVE') {
      setTimerDisplay('30:00');
      return;
    }

    // When running in a standard browser without Electron main process
    if (!isElectron) {
      let remaining = 1800;
      const interval = setInterval(() => {
        remaining = Math.max(0, remaining - 1);
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        setTimerDisplay(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
        if (remaining <= 0) {
          clearInterval(interval);
          setExamLocked(true);
          setExamState('EXPIRED');
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [examState]);

  // ─── Sync / Reset Stale Main-Process Sessions on Initial Load ──────────────
  useEffect(() => {
    if (!isElectron) return;
    async function syncExamState() {
      try {
        const state = await window.athena.getExamState();
        if (state === 'ACTIVE') {
          await window.athena.stopExamSession('ABORTED', 'Initial load sync reset');
          setTimerDisplay('30:00');
        }
      } catch (err) {
        console.error('Failed to sync initial exam state:', err);
      }
    }
    syncExamState();
  }, []);

  // ─── Copy / Paste & Context Menu Blocking ────────────────────────────────
  useEffect(() => {
    const blockCopyPaste = (e) => {
      if (examState !== 'ACTIVE') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
    };

    const blockContextMenu = (e) => {
      if (examState === 'ACTIVE') e.preventDefault();
    };

    document.addEventListener('copy', blockCopyPaste);
    document.addEventListener('paste', blockCopyPaste);
    document.addEventListener('cut', blockCopyPaste);
    document.addEventListener('contextmenu', blockContextMenu);
    document.addEventListener('dragstart', blockCopyPaste);
    document.addEventListener('drop', blockCopyPaste);

    return () => {
      document.removeEventListener('copy', blockCopyPaste);
      document.removeEventListener('paste', blockCopyPaste);
      document.removeEventListener('cut', blockCopyPaste);
      document.removeEventListener('contextmenu', blockContextMenu);
      document.removeEventListener('dragstart', blockCopyPaste);
      document.removeEventListener('drop', blockCopyPaste);
    };
  }, [examState]);

  // ─── Electron Listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return;

    // 1. Authoritative Timer Tick
    const removeTimerListener = window.athena.onTimerTick(({ remaining }) => {
      if (examState !== 'ACTIVE') return;
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      setTimerDisplay(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    });

    // 2. Synchronized Face Snapshot Request
    const removeFaceSnapshotListener = window.athena.onRequestFaceSnapshot(async ({ timestamp }) => {
      if (examState !== 'ACTIVE' || !videoRef.current || !streamRef.current) return;
      try {
        const video = videoRef.current;
        let width = video.videoWidth;
        let height = video.videoHeight;
        if (!width || !height) {
          await video.play().catch(() => {});
          width = video.videoWidth || 640;
          height = video.videoHeight || 480;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob(async (blob) => {
          if (blob) {
            const buffer = await blob.arrayBuffer();
            window.athena.storeFaceSnapshot(buffer, timestamp);
          }
        }, 'image/jpeg', 0.85);
      } catch (err) {
        console.error('Failed to capture face frame:', err);
      }
    });

    // 2b. Direct Renderer Keydown Logger
    const handleWindowKeyDown = (e) => {
      if (examState !== 'ACTIVE') return;
      if (window.athena && window.athena.logKey) {
        window.athena.logKey({
          type: 'keyDown',
          key: e.key,
          code: e.code,
          meta: e.metaKey,
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey
        });
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);

    // 3. Blocked Keybinding Alert
    const removeBlockedKeyListener = window.athena.onBlockedKeybinding((data) => {
      setBlockedKeyAlert(data);
      setTimeout(() => setBlockedKeyAlert(null), 2500);
    });

    // 4. Window Focus Loss & Restoration
    const removeFocusLostListener = window.athena.onWindowFocusLost(() => {
      setFocusLostAlert(true);
      setExamLocked(true);
    });

    const removeFocusRestoredListener = window.athena.onWindowFocusRestored(() => {
      setFocusLostAlert(false);
      if (!fullscreenViolation) {
        setExamLocked(false);
      }
    });

    // 5. Fullscreen Exit
    const removeFullscreenExitedListener = window.athena.onFullscreenExited(() => {
      setFullscreenViolation(true);
      setExamLocked(true);
    });

    const removeFullscreenRestoredListener = window.athena.onFullscreenRestored(() => {
      setFullscreenViolation(false);
      setExamLocked(false);
    });

    // 6. Exam Expiration
    const removeExpiredListener = window.athena.onExamExpired(async () => {
      setExamLocked(true);
      setExamState('EXPIRED');
      if (sessionIdRef.current) {
        try {
          const res = await fetch(`http://localhost:3000/exam/session/${sessionIdRef.current}`);
          if (res.ok) {
            const data = await res.json();
            setExamResults({
              attempted: data.attempted || 0,
              correct: data.correct || 0,
              wrong: data.wrong || 0,
              total: 5,
              percentage: Math.round(((data.correct || 0) / 5) * 100)
            });
          }
        } catch (err) {
          console.error('Failed to fetch expired session details:', err);
        }
      }
    });

    return () => {
      removeTimerListener();
      removeFaceSnapshotListener();
      window.removeEventListener('keydown', handleWindowKeyDown);
      removeBlockedKeyListener();
      removeFocusLostListener();
      removeFocusRestoredListener();
      removeFullscreenExitedListener();
      removeFullscreenRestoredListener();
      removeExpiredListener();
    };
  }, [examState]);

  // ─── Start Exam Flow ─────────────────────────────────────────────────────
  async function handleStartExam(e) {
    if (e && e.preventDefault) e.preventDefault();

    if (!studentName.trim() || !studentId.trim()) {
      alert('Please enter your Student Name and Student ID.');
      return;
    }

    // Ensure camera is active
    if (!cameraEnabled) {
      const ok = await requestCameraAccess();
      if (!ok) {
        alert('Camera access is required for identity verification.');
        return;
      }
    }

    try {
      // 1. Enter fullscreen in Electron or browser
      if (isElectron && window.athena.enterFullscreen) {
        await window.athena.enterFullscreen();
      } else if (!isElectron && document.documentElement.requestFullscreen) {
        try {
          await document.documentElement.requestFullscreen();
        } catch {}
      }

      // 2. Create session on backend
      const res = await fetch('http://localhost:3000/exam/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: studentId.trim(),
          name: studentName.trim(),
          mode: 'PROCTORED',
          durationSec: 1800
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert('Failed to start session: ' + (data.message || 'Unknown error'));
        return;
      }

      const newSessionId = data.sessionId;
      setSessionId(newSessionId);
      sessionIdRef.current = newSessionId;

      // 3. Immediately transition UI to ACTIVE quiz so the student sees the quiz right away
      setExamState('ACTIVE');

      // 4. Start authoritative main process proctoring controller
      if (isElectron && window.athena.startExamSession) {
        await window.athena.startExamSession({
          sessionId: newSessionId,
          studentId: studentId.trim(),
          studentName: studentName.trim(),
          mode: 'PROCTORED',
          durationSec: 1800
        });
      }
    } catch (err) {
      console.error('Start exam failure:', err);
      alert('Network or server error while initiating exam: ' + err.message);
    }
  }

  // ─── Reset for New Candidate Exam ─────────────────────────────────────────
  function handleResetNewExam() {
    setExamResults(null);
    setSessionId(null);
    setStudentName('');
    setStudentId('');
    setExamState('PRE_EXAM');
    setExamLocked(false);
    setTimerDisplay('30:00');
    setFullscreenViolation(false);
    if (isElectron && window.athena.exitFullscreen) {
      window.athena.exitFullscreen();
    }
  }

  // ─── Re-check Background Apps ─────────────────────────────────────────────
  async function handleRecheckApps() {
    if (!isElectron) return;
    try {
      const result = await window.athena.getBackgroundApps();
      setBlockedAppsList(result.blockedApps || []);
      if (!result.blockedApps || result.blockedApps.length === 0) {
        setShowAppsPanel(false);
      }
    } catch (err) {
      console.error('Re-check apps failed:', err);
    }
  }

  async function handleRestoreFullscreen() {
    if (isElectron && window.athena.enterFullscreen) {
      await window.athena.enterFullscreen();
    }
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch {}
    setFullscreenViolation(false);
    setExamLocked(false);
  }

  const isReadyToStart = studentName.trim().length > 0 && studentId.trim().length > 0;

  // ─── Screen 1: Background Applications Warning ────────────────────────────
  if (showAppsPanel && blockedAppsList.length > 0) {
    return (
      <div className="apps-screen">
        <div className="apps-panel">
          <div className="apps-panel-header">
            <h2>Pre-Exam Environment Verification</h2>
            <p>Potentially conflicting applications were detected. Please close the flagged applications before starting your examination.</p>
          </div>

          <div className="apps-section">
            <h3 className="apps-section-title apps-blocked-title">
              <span className="apps-count-badge blocked">{blockedAppsList.length}</span>
              Flagged — Must Close
            </h3>
            <div className="apps-grid">
              {blockedAppsList.map((app, i) => (
                <div key={i} className="app-card blocked">
                  <div className="app-icon-circle blocked">{app.charAt(0).toUpperCase()}</div>
                  <span className="app-name">{app}</span>
                  <span className="app-status-dot blocked"></span>
                </div>
              ))}
            </div>
          </div>

          <div className="apps-panel-footer">
            <button className="btn btn-outline" onClick={handleRecheckApps}>
              <RefreshCw className="w-4 h-4 mr-2" style={{ display: 'inline' }} /> Re-check Applications
            </button>
            {blockedAppsList.length === 0 && (
              <button className="btn btn-black" onClick={() => setShowAppsPanel(false)}>
                <Check className="w-4 h-4 mr-2" style={{ display: 'inline' }} /> Continue Setup
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Screen 2: Exam Results / Expired ────────────────────────────────────
  if (examState === 'SUBMITTED' || examState === 'EXPIRED') {
    return (
      <div className="page-container" style={{ maxWidth: '640px' }}>
        <div className="header-section">
          <h1>Proctorly Examination</h1>
          <p>{examState === 'EXPIRED' ? 'Exam Session Expired' : 'Submission Completed'}</p>
        </div>

        <div className="card-container" style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '24px' }}>
            {examState === 'EXPIRED' ? (
              <AlarmClock className="w-16 h-16" style={{ margin: '0 auto', color: '#dc2626' }} />
            ) : (
              <CheckCircle2 className="w-16 h-16" style={{ margin: '0 auto', color: '#059669' }} />
            )}
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginTop: '16px', color: '#0f172a' }}>
              {examState === 'EXPIRED' ? 'Exam Duration Expired' : 'Exam Results'}
            </h2>
            <p style={{ color: '#64748b', fontSize: '15px', marginTop: '6px' }}>
              Candidate: <strong>{studentName}</strong> (ID: {studentId})
            </p>
          </div>

          {examResults && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', margin: '24px 0', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                <span style={{ color: '#475569', fontWeight: 500 }}>Questions Attempted</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{examResults.attempted} / 5</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                <span style={{ color: '#475569', fontWeight: 500 }}>Correct Answers</span>
                <span style={{ fontWeight: 700, color: '#059669' }}>{examResults.correct}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                <span style={{ color: '#475569', fontWeight: 500 }}>Incorrect Answers</span>
                <span style={{ fontWeight: 700, color: '#dc2626' }}>{examResults.wrong}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0', fontSize: '16px' }}>
                <span style={{ color: '#0f172a', fontWeight: 600 }}>Score Percentage</span>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>{examResults.percentage || 0}%</span>
              </div>
            </div>
          )}

          <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px' }}>
            All session evidence, timestamps, and activity logs have been safely recorded and synchronized.
          </p>

          <button className="btn btn-black" onClick={handleResetNewExam} style={{ width: '100%' }}>
            Start New Exam Session
          </button>
        </div>
      </div>
    );
  }

  // ─── Screen 3: Active Quiz ───────────────────────────────────────────────
  if (examState === 'ACTIVE') {
    return (
      <div style={{ position: 'relative' }}>
        {/* Blocked Key Alert Toast */}
        {blockedKeyAlert && (
          <div className="blocked-key-toast">
            <Ban className="w-4 h-4 mr-2" style={{ display: 'inline', verticalAlign: 'middle' }} />
            Shortcut Blocked: {blockedKeyAlert.key.toUpperCase()} combination
          </div>
        )}

        {/* Fullscreen Violation Alert Bar */}
        {fullscreenViolation && (
          <div className="fullscreen-violation-bar">
            <AlertTriangle className="w-4 h-4 mr-2" style={{ display: 'inline', verticalAlign: 'middle' }} />
            Fullscreen mode exited — please return to fullscreen to resume answering.
            <button
              onClick={handleRestoreFullscreen}
              style={{
                marginLeft: '12px',
                background: '#ffffff',
                color: '#dc2626',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Re-enter Fullscreen
            </button>
          </div>
        )}

        {/* Focus Lost Lock Bar */}
        {focusLostAlert && (
          <div className="fullscreen-violation-bar" style={{ background: '#b91c1c' }}>
            <AlertTriangle className="w-4 h-4 mr-2" style={{ display: 'inline', verticalAlign: 'middle' }} />
            Application switch or screen change detected — Answering is locked. Please return to Proctorly.
          </div>
        )}

        {/* Proctoring camera stream (visible overlay removed per user request; runs off-screen for proctoring snapshots) */}
        <video
          ref={(el) => {
            videoRef.current = el;
            if (el && streamRef.current) {
              if (el.srcObject !== streamRef.current) {
                el.srcObject = streamRef.current;
              }
              el.play().catch(() => {});
            }
          }}
          autoPlay
          playsInline
          muted
          style={{
            position: 'fixed',
            bottom: '0px',
            right: '0px',
            width: '160px',
            height: '120px',
            opacity: 0.001,
            pointerEvents: 'none',
            zIndex: -9999
          }}
        />

        <Quiz
          sessionId={sessionId}
          timer={timerDisplay}
          restoredAnswers={{}}
          examLocked={examLocked}
          onFinish={(results) => {
            setExamResults(results);
            setExamState('SUBMITTED');
          }}
        />
      </div>
    );
  }

  // ─── Screen 4: Setup / Permissions Page (Clean White Reference UI) ────────
  return (
    <div className="page-container">
      {/* Header */}
      <div className="header-section">
        <h1>Proctorly Exam</h1>
        <p>Candidate Information & System Readiness</p>
      </div>

      {/* Main Card */}
      <div className="card-container">
        {/* Candidate Information Section */}
        <div className="permission-item">
          <div className="icon-box">
            <User className="w-5 h-5" />
          </div>
          <div className="permission-content" style={{ width: '100%' }}>
            <h3>Candidate Information</h3>
            <p>Please enter your details to begin the examination session.</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Student Name <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isReadyToStart) {
                      e.preventDefault();
                      handleStartExam();
                    }
                  }}
                  placeholder="Enter your full name"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '14px',
                    color: '#0f172a',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Student ID <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isReadyToStart) {
                      e.preventDefault();
                      handleStartExam();
                    }
                  }}
                  placeholder="Enter your student ID"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '14px',
                    color: '#0f172a',
                    outline: 'none'
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="divider"></div>

        {/* Camera Preview Section */}
        <div className="permission-item">
          <div className="icon-box">
            <Camera className="w-5 h-5" />
          </div>
          <div className="permission-content" style={{ width: '100%' }}>
            <h3>Camera Preview</h3>
            <p>Verify your camera placement. Camera monitoring will be active throughout the exam.</p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: '240px',
                  height: '160px',
                  background: '#0f172a',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  position: 'relative',
                  border: '1px solid #cbd5e1'
                }}
              >
                <video
                  ref={(el) => {
                    videoRef.current = el;
                    if (el && streamRef.current) {
                      if (el.srcObject !== streamRef.current) {
                        el.srcObject = streamRef.current;
                      }
                      el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {!cameraEnabled && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                    <Camera className="w-8 h-8 mb-2" />
                    <span style={{ fontSize: '12px', fontWeight: 600 }}>Camera Offline</span>
                  </div>
                )}
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  {cameraEnabled ? (
                    <>
                      <CheckCircle className="w-5 h-5" style={{ color: '#059669' }} />
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#059669' }}>Camera Ready</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-5 h-5" style={{ color: '#dc2626' }} />
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#dc2626' }}>Camera permission required</span>
                    </>
                  )}
                </div>

                {!cameraEnabled && (
                  <button className="btn btn-black" onClick={requestCameraAccess}>
                    Enable Camera
                  </button>
                )}
                {cameraError && (
                  <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '6px' }}>{cameraError}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="divider"></div>

        {/* System Checks Summary */}
        <div className="permission-item">
          <div className="icon-box">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="permission-content" style={{ width: '100%' }}>
            <h3>System Checks</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <CheckCircle className="w-4 h-4" style={{ color: '#059669' }} />
                <span style={{ color: '#059669', fontWeight: 500 }}>Camera permission</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <CheckCircle className="w-4 h-4" style={{ color: '#059669' }} />
                <span style={{ color: '#059669', fontWeight: 500 }}>Screen recording</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <CheckCircle className="w-4 h-4" style={{ color: '#059669' }} />
                <span style={{ color: '#059669', fontWeight: 500 }}>Fullscreen ready</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <CheckCircle className="w-4 h-4" style={{ color: '#059669' }} />
                <span style={{ color: '#059669', fontWeight: 500 }}>Exam environment ready</span>
              </div>
            </div>
          </div>
        </div>

        <div className="divider"></div>

        {/* Exam Duration */}
        <div className="permission-item">
          <div className="icon-box">
            <AlarmClock className="w-5 h-5" />
          </div>
          <div className="permission-content">
            <h3>Exam Duration</h3>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
              30:00 (5 questions)
            </p>
          </div>
        </div>
      </div>

      {/* Start Button Area */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <button
          className="btn btn-black btn-start"
          disabled={!isReadyToStart}
          onClick={handleStartExam}
          style={{
            background: isReadyToStart ? '#059669' : '#94a3b8',
            color: '#ffffff',
            padding: '16px 48px',
            fontSize: '16px',
            borderRadius: '10px',
            cursor: isReadyToStart ? 'pointer' : 'not-allowed'
          }}
        >
          Start Exam
        </button>

        {!isReadyToStart && (
          <p style={{ fontSize: '13px', color: '#64748b' }}>
            Please enter your Student Name and Student ID to begin the exam.
          </p>
        )}
      </div>
    </div>
  );
}