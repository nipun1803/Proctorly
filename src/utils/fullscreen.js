export const isElectron = typeof window !== 'undefined' && !!(window.proctorly || window.athena);

export async function enterFullscreenUniversal() {
  if (isElectron && window.athena && window.athena.enterFullscreen) {
    try {
      await window.athena.enterFullscreen();
      return true;
    } catch (e) { console.warn('Electron enterFullscreen error:', e); }
  }
  const docEl = document.documentElement;
  const reqFn = docEl.requestFullscreen || docEl.webkitRequestFullscreen ||
    docEl.webkitRequestFullScreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
  if (reqFn) {
    try {
      const res = reqFn.call(docEl);
      if (res && typeof res.then === 'function') await res;
      return true;
    } catch (err) { console.warn('Browser requestFullscreen error:', err); }
  }
  return false;
}

export async function exitFullscreenUniversal() {
  if (isElectron && window.athena && window.athena.exitFullscreen) {
    try {
      await window.athena.exitFullscreen();
      return true;
    } catch (e) { console.warn('Electron exitFullscreen error:', e); }
  }
  const exitFn = document.exitFullscreen || document.webkitExitFullscreen ||
    document.webkitCancelFullScreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (exitFn) {
    try {
      const res = exitFn.call(document);
      if (res && typeof res.then === 'function') await res;
      return true;
    } catch (err) { console.warn('Browser exitFullscreen error:', err); }
  }
  return false;
}

export function checkIsFullscreenUniversal() {
  if (typeof document === 'undefined') return false;
  return !!(document.fullscreenElement || document.webkitFullscreenElement ||
    document.webkitCurrentFullScreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}
