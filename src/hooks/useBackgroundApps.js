import { useEffect, useState } from 'react';
import { isElectron } from '../utils/fullscreen';

export default function useBackgroundApps() {
  const [blockedAppsList, setBlockedAppsList] = useState([]);
  const [showAppsPanel, setShowAppsPanel] = useState(false);

  useEffect(() => {
    if (!isElectron) return;
    async function checkApps() {
      try {
        const result = await window.athena.getBackgroundApps();
        if (result && result.blockedApps && result.blockedApps.length > 0) {
          setBlockedAppsList(result.blockedApps);
          setShowAppsPanel(true);
        }
      } catch (err) { console.error('Failed to check background apps:', err); }
    }
    checkApps();
  }, []);

  async function handleRecheckApps() {
    if (!isElectron) return;
    try {
      const result = await window.athena.getBackgroundApps();
      setBlockedAppsList(result.blockedApps || []);
      if (!result.blockedApps || result.blockedApps.length === 0) setShowAppsPanel(false);
    } catch (err) { console.error('Re-check apps failed:', err); }
  }

  return { blockedAppsList, showAppsPanel, setShowAppsPanel, handleRecheckApps };
}
