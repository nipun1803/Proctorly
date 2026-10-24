import { useCallback, useEffect, useRef, useState } from 'react';
import { isElectron } from '../utils/fullscreen';

export default function useCamera(examState, sessionIdRef) {
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [cameraEnabled, examState]);

  const requestCameraAccess = useCallback(async () => {
    setCameraError(null);
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
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
  }, [sessionIdRef]);

  useEffect(() => { requestCameraAccess(); }, [requestCameraAccess]);

  // Shared by the setup preview and the hidden active-exam video.
  function attachVideo(el) {
    videoRef.current = el;
    if (el && streamRef.current) {
      if (el.srcObject !== streamRef.current) el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }

  return { cameraEnabled, cameraError, requestCameraAccess, videoRef, streamRef, attachVideo };
}

export async function storeFaceFrame(videoRef, streamRef, timestamp) {
  if (!videoRef.current || !streamRef.current) return;
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
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    canvas.toBlob(async blob => {
      if (blob) window.athena.storeFaceSnapshot(await blob.arrayBuffer(), timestamp);
    }, 'image/jpeg', 0.85);
  } catch (err) { console.error('Failed to capture face frame:', err); }
}
