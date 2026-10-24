import { useEffect } from 'react';
import { isElectron, checkIsFullscreenUniversal } from '../utils/fullscreen';
import { getExamSession } from '../services/examApi';
import { storeFaceFrame } from './useCamera';

// Event registration is kept separate from UI and session-start/reset actions.
export default function useProctoring({
  examState, fullscreenViolation, sessionIdRef, videoRef, streamRef,
  setTimerDisplay, setExamLocked, setExamState, setExamResults,
  setFullscreenViolation, setIsFullscreenActive, setBlockedKeyAlert, setFocusLostAlert
}) {
  useEffect(() => {
    async function syncFs() {
      if (isElectron && window.athena && window.athena.isFullscreen) {
        try {
          setIsFullscreenActive(!!(await window.athena.isFullscreen()));
          return;
        } catch {}
      }
      setIsFullscreenActive(checkIsFullscreenUniversal());
    }
    syncFs();
    if (isElectron) return;
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = checkIsFullscreenUniversal();
      setIsFullscreenActive(isCurrentlyFullscreen);
      if (examState === 'ACTIVE') {
        setFullscreenViolation(!isCurrentlyFullscreen);
        setExamLocked(!isCurrentlyFullscreen);
      }
    };
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    events.forEach(evt => document.addEventListener(evt, handleFullscreenChange));
    return () => events.forEach(evt => document.removeEventListener(evt, handleFullscreenChange));
  }, [examState, setExamLocked, setFullscreenViolation, setIsFullscreenActive]);

  useEffect(() => {
    if (examState !== 'ACTIVE') {
      setTimerDisplay('30:00');
      return;
    }
    if (!isElectron) {
      let remaining = 1800;
      const interval = setInterval(() => {
        remaining = Math.max(0, remaining - 1);
        setTimerDisplay(formatRemaining(remaining));
        if (remaining <= 0) {
          clearInterval(interval);
          setExamLocked(true);
          setExamState('EXPIRED');
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [examState, setExamLocked, setExamState, setTimerDisplay]);

  useEffect(() => {
    const blockCopyPaste = e => {
      if (examState !== 'ACTIVE') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
    };
    const blockContextMenu = e => { if (examState === 'ACTIVE') e.preventDefault(); };
    const events = ['copy', 'paste', 'cut', 'dragstart', 'drop'];
    events.forEach(evt => document.addEventListener(evt, blockCopyPaste));
    document.addEventListener('contextmenu', blockContextMenu);
    return () => {
      events.forEach(evt => document.removeEventListener(evt, blockCopyPaste));
      document.removeEventListener('contextmenu', blockContextMenu);
    };
  }, [examState]);

  useEffect(() => {
    if (!isElectron) return;
    const removeTimerListener = window.athena.onTimerTick(({ remaining }) => {
      if (examState === 'ACTIVE') setTimerDisplay(formatRemaining(remaining));
    });
    const removeFaceSnapshotListener = window.athena.onRequestFaceSnapshot(async ({ timestamp }) => {
      if (examState === 'ACTIVE') await storeFaceFrame(videoRef, streamRef, timestamp);
    });
    const handleWindowKeyDown = e => {
      if (examState !== 'ACTIVE') return;
      if (window.athena && window.athena.logKey) {
        window.athena.logKey({
          type: 'keyDown', key: e.key, code: e.code,
          meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey
        });
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    const removeBlockedKeyListener = window.athena.onBlockedKeybinding(data => {
      setBlockedKeyAlert(data);
      setTimeout(() => setBlockedKeyAlert(null), 2500);
    });
    const removeFocusLostListener = window.athena.onWindowFocusLost(() => {
      setFocusLostAlert(true);
      setExamLocked(true);
    });
    const removeFocusRestoredListener = window.athena.onWindowFocusRestored(() => {
      setFocusLostAlert(false);
      if (!fullscreenViolation) setExamLocked(false);
    });
    const removeFullscreenExitedListener = window.athena.onFullscreenExited(() => {
      setFullscreenViolation(true);
      setExamLocked(true);
      setIsFullscreenActive(false);
    });
    const removeFullscreenRestoredListener = window.athena.onFullscreenRestored(() => {
      setFullscreenViolation(false);
      setExamLocked(false);
      setIsFullscreenActive(true);
    });
    const removeExpiredListener = window.athena.onExamExpired(async () => {
      setExamLocked(true);
      setExamState('EXPIRED');
      if (sessionIdRef.current) {
        try {
          const res = await getExamSession(sessionIdRef.current);
          if (res.ok) {
            const data = await res.json();
            setExamResults({
              attempted: data.attempted || 0, correct: data.correct || 0, wrong: data.wrong || 0,
              total: 5, percentage: Math.round(((data.correct || 0) / 5) * 100)
            });
          }
        } catch (err) { console.error('Failed to fetch expired session details:', err); }
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
    // Preserve the original subscription lifetime and captured violation state.
    // Changing this to resubscribe on alerts would be a separate behavior change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examState]);
}

function formatRemaining(remaining) {
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
