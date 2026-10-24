import { Ban, AlertTriangle } from 'lucide-react';
import Quiz from '../components/Quiz/Quiz';

export default function ExamScreen({
  blockedKeyAlert, fullscreenViolation, focusLostAlert, attachVideo,
  sessionId, timerDisplay, examLocked, handleRestoreFullscreen, handleFinish
}) {
  return (
    <div style={{ position: 'relative' }}>
      {blockedKeyAlert && (
        <div className="blocked-key-toast">
          <Ban className="w-4 h-4 mr-2" style={{ display: 'inline', verticalAlign: 'middle' }} />
          Shortcut Blocked: {blockedKeyAlert.key.toUpperCase()} combination
        </div>
      )}
      {fullscreenViolation && (
        <div className="fullscreen-violation-bar">
          <AlertTriangle className="w-4 h-4 mr-2" style={{ display: 'inline', verticalAlign: 'middle' }} />
          Fullscreen mode exited — please return to fullscreen to resume answering.
          <button onClick={handleRestoreFullscreen} style={{
            marginLeft: '12px', background: '#ffffff', color: '#dc2626', border: 'none',
            padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 700, cursor: 'pointer'
          }}>
            Re-enter Fullscreen
          </button>
        </div>
      )}
      {focusLostAlert && (
        <div className="fullscreen-violation-bar" style={{ background: '#b91c1c' }}>
          <AlertTriangle className="w-4 h-4 mr-2" style={{ display: 'inline', verticalAlign: 'middle' }} />
          Application switch or screen change detected — Answering is locked. Please return to Proctorly.
        </div>
      )}
      {/* Hidden video remains playing for synchronized proctoring snapshots. */}
      <video ref={attachVideo} autoPlay playsInline muted style={{
        position: 'fixed', bottom: '0px', right: '0px', width: '160px', height: '120px',
        opacity: 0.001, pointerEvents: 'none', zIndex: -9999
      }} />
      <Quiz
        sessionId={sessionId} timer={timerDisplay} restoredAnswers={{}} examLocked={examLocked}
        onRestoreFullscreen={handleRestoreFullscreen} onFinish={handleFinish}
      />
    </div>
  );
}
