const BACKEND_URL = 'http://localhost:3000';

// Return the original Response so callers retain their existing error handling.
export function startExamSession(payload) {
  return fetch(`${BACKEND_URL}/exam/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function getExamSession(sessionId) {
  return fetch(`${BACKEND_URL}/exam/session/${sessionId}`);
}
