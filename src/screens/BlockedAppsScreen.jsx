import { RefreshCw, Check } from 'lucide-react';

export default function BlockedAppsScreen({ blockedAppsList, handleRecheckApps, setShowAppsPanel }) {
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
