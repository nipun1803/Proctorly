import { useEffect, useRef, useState } from 'react';
import useCamera from './useCamera';
import useBackgroundApps from './useBackgroundApps';
import useProctoring from './useProctoring';
import { isElectron, enterFullscreenUniversal, exitFullscreenUniversal } from '../utils/fullscreen';
import { startExamSession } from '../services/examApi';

export default function useExamSession() {
  const [studentName, setStudentName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const sessionIdRef = useRef(null);
  const [examState, setExamState] = useState('PRE_EXAM');
  const [timerDisplay, setTimerDisplay] = useState('30:00');
  const [examResults, setExamResults] = useState(null);
  const [examLocked, setExamLocked] = useState(false);
  const [blockedKeyAlert, setBlockedKeyAlert] = useState(null);
  const [focusLostAlert, setFocusLostAlert] = useState(false);
  const [fullscreenViolation, setFullscreenViolation] = useState(false);
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  const backgroundApps = useBackgroundApps();
  const camera = useCamera(examState, sessionIdRef);

  // Reset an active main-process session on initial renderer load, as before.
  useEffect(() => {
    if (!isElectron) return;
    async function syncExamState() {
      try {
        const state = await window.athena.getExamState();
        if (state === 'ACTIVE') {
          await window.athena.stopExamSession('ABORTED', 'Initial load sync reset');
          setTimerDisplay('30:00');
        }
      } catch (err) { console.error('Failed to sync initial exam state:', err); }
    }
    syncExamState();
  }, []);

  useProctoring({
    examState, fullscreenViolation, sessionIdRef, videoRef: camera.videoRef, streamRef: camera.streamRef,
    setTimerDisplay, setExamLocked, setExamState, setExamResults, setFullscreenViolation,
    setIsFullscreenActive, setBlockedKeyAlert, setFocusLostAlert
  });

  async function handleStartExam(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!studentName.trim() || !studentId.trim()) {
      alert('Please enter your Student Name and Student ID.');
      return;
    }
    // Start fullscreen before awaiting camera/network access to retain the gesture.
    const fsPromise = enterFullscreenUniversal();
    if (!camera.cameraEnabled) {
      if (!(await camera.requestCameraAccess())) {
        alert('Camera access is required for identity verification.');
        return;
      }
    }
    try {
      await fsPromise;
      setIsFullscreenActive(true);
      const res = await startExamSession({
        userId: studentId.trim(), name: studentName.trim(), mode: 'PROCTORED', durationSec: 1800
      });
      const data = await res.json();
      if (!res.ok) {
        alert('Failed to start session: ' + (data.message || 'Unknown error'));
        return;
      }
      const newSessionId = data.sessionId;
      setSessionId(newSessionId);
      sessionIdRef.current = newSessionId;
      // Show the quiz before starting main-process monitoring, matching the old flow.
      setExamState('ACTIVE');
      if (isElectron && window.athena.startExamSession) {
        await window.athena.startExamSession({
          sessionId: newSessionId, studentId: studentId.trim(), studentName: studentName.trim(),
          mode: 'PROCTORED', durationSec: 1800
        });
      }
    } catch (err) {
      console.error('Start exam failure:', err);
      alert('Network or server error while initiating exam: ' + err.message);
    }
  }

  function handleResetNewExam() {
    setExamResults(null);
    setSessionId(null);
    setStudentName('');
    setStudentId('');
    setExamState('PRE_EXAM');
    setExamLocked(false);
    setTimerDisplay('30:00');
    setFullscreenViolation(false);
    exitFullscreenUniversal();
    setIsFullscreenActive(false);
  }

  async function handleRestoreFullscreen() {
    await enterFullscreenUniversal();
    setFullscreenViolation(false);
    setExamLocked(false);
    setIsFullscreenActive(true);
  }

  async function handleToggleFullscreen() {
    if (isFullscreenActive) {
      await exitFullscreenUniversal();
      setIsFullscreenActive(false);
    } else {
      await enterFullscreenUniversal();
      setIsFullscreenActive(true);
    }
  }

  function handleFinish(results) {
    setExamResults(results);
    setExamState('SUBMITTED');
  }

  return {
    studentName, setStudentName, studentId, setStudentId, sessionId, examState, timerDisplay,
    examResults, examLocked, blockedKeyAlert, focusLostAlert, fullscreenViolation, isFullscreenActive,
    isReadyToStart: studentName.trim().length > 0 && studentId.trim().length > 0,
    handleStartExam, handleResetNewExam, handleRestoreFullscreen, handleToggleFullscreen, handleFinish,
    ...backgroundApps, ...camera
  };
}
