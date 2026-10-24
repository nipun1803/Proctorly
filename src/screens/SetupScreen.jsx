import { AlarmClock, Camera, User, ShieldCheck, CheckCircle, XCircle } from 'lucide-react';

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1.5px solid #cbd5e1',
  fontSize: '14px', color: '#0f172a', outline: 'none'
};
const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' };

export default function SetupScreen({
  studentName, setStudentName, studentId, setStudentId, isReadyToStart, handleStartExam,
  cameraEnabled, cameraError, requestCameraAccess, attachVideo, isFullscreenActive, handleToggleFullscreen
}) {
  function handleCandidateKeyDown(e) {
    if (e.key === 'Enter' && isReadyToStart) {
      e.preventDefault();
      handleStartExam();
    }
  }

  return (
    <div className="page-container">
      <div className="header-section">
        <h1>Proctorly Exam</h1>
        <p>Candidate Information & System Readiness</p>
      </div>
      <div className="card-container">
        <div className="permission-item">
          <div className="icon-box"><User className="w-5 h-5" /></div>
          <div className="permission-content" style={{ width: '100%' }}>
            <h3>Candidate Information</h3>
            <p>Please enter your details to begin the examination session.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              <div>
                <label style={labelStyle}>Student Name <span style={{ color: '#dc2626' }}>*</span></label>
                <input type="text" value={studentName} onChange={e => setStudentName(e.target.value)}
                  onKeyDown={handleCandidateKeyDown} placeholder="Enter your full name" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Student ID <span style={{ color: '#dc2626' }}>*</span></label>
                <input type="text" value={studentId} onChange={e => setStudentId(e.target.value)}
                  onKeyDown={handleCandidateKeyDown} placeholder="Enter your student ID" style={inputStyle} />
              </div>
            </div>
          </div>
        </div>
        <div className="divider"></div>
        <div className="permission-item">
          <div className="icon-box"><Camera className="w-5 h-5" /></div>
          <div className="permission-content" style={{ width: '100%' }}>
            <h3>Camera Preview</h3>
            <p>Verify your camera placement. Camera monitoring will be active throughout the exam.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{
                width: '240px', height: '160px', background: '#0f172a', borderRadius: '10px',
                overflow: 'hidden', position: 'relative', border: '1px solid #cbd5e1'
              }}>
                <video ref={attachVideo} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                {!cameraEnabled && <button className="btn btn-black" onClick={requestCameraAccess}>Enable Camera</button>}
                {cameraError && <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '6px' }}>{cameraError}</p>}
              </div>
            </div>
          </div>
        </div>
        <div className="divider"></div>
        <div className="permission-item">
          <div className="icon-box"><ShieldCheck className="w-5 h-5" /></div>
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle className="w-4 h-4" style={{ color: isFullscreenActive ? '#059669' : '#0284c7' }} />
                  <span style={{ color: isFullscreenActive ? '#059669' : '#0f172a', fontWeight: 500 }}>
                    {isFullscreenActive ? 'Fullscreen Active' : 'Fullscreen Ready'}
                  </span>
                </div>
                <button type="button" onClick={handleToggleFullscreen} style={{
                  padding: '3px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '6px',
                  border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', cursor: 'pointer'
                }}>
                  {isFullscreenActive ? 'Exit' : 'Test / Enter'}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <CheckCircle className="w-4 h-4" style={{ color: '#059669' }} />
                <span style={{ color: '#059669', fontWeight: 500 }}>Exam environment ready</span>
              </div>
            </div>
          </div>
        </div>
        <div className="divider"></div>
        <div className="permission-item">
          <div className="icon-box"><AlarmClock className="w-5 h-5" /></div>
          <div className="permission-content">
            <h3>Exam Duration</h3>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>30:00 (5 questions)</p>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <button className="btn btn-black btn-start" disabled={!isReadyToStart} onClick={handleStartExam} style={{
          background: isReadyToStart ? '#059669' : '#94a3b8', color: '#ffffff', padding: '16px 48px',
          fontSize: '16px', borderRadius: '10px', cursor: isReadyToStart ? 'pointer' : 'not-allowed'
        }}>
          Start Exam
        </button>
        {!isReadyToStart && (
          <p style={{ fontSize: '13px', color: '#64748b' }}>Please enter your Student Name and Student ID to begin the exam.</p>
        )}
      </div>
    </div>
  );
}
