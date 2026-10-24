import { AlarmClock, CheckCircle2 } from 'lucide-react';

export default function ResultsScreen({ examState, studentName, studentId, examResults, handleResetNewExam }) {
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
