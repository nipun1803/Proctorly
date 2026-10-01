import { useState, useEffect } from 'react';
import './Quiz.css';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const QUESTION_STATES = {
  NOT_VISITED: 'NOT_VISITED',
  VIEWED: 'VIEWED',
  ATTEMPTED: 'ATTEMPTED',
  MARKED_FOR_REVIEW: 'MARKED_FOR_REVIEW',
  ATTEMPTED_AND_MARKED: 'ATTEMPTED_AND_MARKED',
  CURRENT: 'CURRENT',
};

export default function Quiz({ sessionId, timer, restoredAnswers, examLocked, onFinish, onRestoreFullscreen }) {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState(restoredAnswers || {});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [markedForReview, setMarkedForReview] = useState(new Set());
  const [viewedQuestions, setViewedQuestions] = useState(new Set([0]));
  const [showGrid, setShowGrid] = useState(true);

  // Fetch exactly 5 questions
  useEffect(() => {
    fetch('http://localhost:3000/exam/mcq')
      .then(res => res.json())
      .then(data => {
        // Enforce exactly 5 questions
        const strictlyFive = (data || []).slice(0, 5);
        setQuestions(strictlyFive);
        if (strictlyFive.length > 0 && window.athena?.setCurrentQuestion) {
          window.athena.setCurrentQuestion(strictlyFive[0].id);
        }
      })
      .catch(err => console.error("Failed to fetch questions:", err));
  }, []);

  // Track viewed questions and notify main process of current question ID
  useEffect(() => {
    setViewedQuestions(prev => new Set([...prev, currentIndex]));
    if (questions[currentIndex] && window.athena?.setCurrentQuestion) {
      window.athena.setCurrentQuestion(questions[currentIndex].id);
    }
  }, [currentIndex, questions]);

  // Format timer string
  function formatTimer(seconds) {
    if (typeof seconds === 'string' && seconds.includes(':')) {
      return seconds;
    }
    const secs = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  }

  // Answer selection (never returns or displays correctness during exam)
  async function handleAnswerSelect(questionId, selectedAnswerIndex) {
    if (examLocked) return;

    const previousAnswer = answers[questionId];
    setAnswers(prev => ({ ...prev, [questionId]: selectedAnswerIndex }));

    try {
      const res = await fetch('http://localhost:3000/exam/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          questionId,
          selectedAnswer: selectedAnswerIndex
        })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Failed to submit answer:", data.message);
        setAnswers(prev => {
          const next = { ...prev };
          if (previousAnswer === undefined) delete next[questionId];
          else next[questionId] = previousAnswer;
          return next;
        });
      } else {
        if (window.athena?.flagActivity) {
          window.athena.flagActivity('ANSWER_SELECTED', `Option ${OPTION_LETTERS[selectedAnswerIndex]}`, questionId);
        }
      }
    } catch (err) {
      console.error("Network error submitting answer:", err);
      setAnswers(prev => {
        const next = { ...prev };
        if (previousAnswer === undefined) delete next[questionId];
        else next[questionId] = previousAnswer;
        return next;
      });
    }
  }

  async function handleClearSelection(questionId) {
    if (examLocked) return;
    if (answers[questionId] === undefined) return;

    const previousAnswer = answers[questionId];
    setAnswers(prev => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });

    try {
      const res = await fetch('http://localhost:3000/exam/clear-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, questionId })
      });
      if (!res.ok) {
        setAnswers(prev => ({ ...prev, [questionId]: previousAnswer }));
      }
    } catch (err) {
      console.error("Failed to clear answer:", err);
      setAnswers(prev => ({ ...prev, [questionId]: previousAnswer }));
    }
  }

  function toggleMarkForReview(questionId) {
    setMarkedForReview(prev => {
      const next = new Set(prev);
      const isMarked = next.has(questionId);
      if (isMarked) {
        next.delete(questionId);
        if (window.athena?.flagActivity) {
          window.athena.flagActivity('QUESTION_UNMARKED', 'Unmarked review', questionId);
        }
      } else {
        next.add(questionId);
        if (window.athena?.flagActivity) {
          window.athena.flagActivity('QUESTION_MARKED', 'Marked for review', questionId);
        }
      }
      return next;
    });
  }

  async function submitExamOnBackend() {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // 1. Tell main process to finalize session and flush all logs
      if (window.athena?.stopExamSession) {
        await window.athena.stopExamSession('SUBMITTED', 'Candidate submitted exam');
      }

      // 2. Submit to backend to calculate final score
      const res = await fetch('http://localhost:3000/exam/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await res.json();
      if (res.ok) {
        onFinish(data.result);
      } else {
        alert("Failed to submit exam: " + data.message);
        setIsSubmitting(false);
      }
    } catch (err) {
      console.error("Failed to submit exam:", err);
      setIsSubmitting(false);
    }
  }

  if (questions.length === 0) {
    return (
      <div className="quiz-loading">
        <div className="quiz-loading-spinner"></div>
        <p>Loading examination questions...</p>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const selectedOptIndex = answers[currentQuestion.id];
  const isCurrentMarked = markedForReview.has(currentQuestion.id);

  // Authoritative question state calculator
  function getQuestionStatus(idx) {
    const q = questions[idx];
    const isAttempted = answers[q.id] !== undefined;
    const isMarked = markedForReview.has(q.id);
    const isViewed = viewedQuestions.has(idx);
    const isCurrent = idx === currentIndex;

    let state = QUESTION_STATES.NOT_VISITED;
    if (isCurrent) state = QUESTION_STATES.CURRENT;
    else if (isAttempted && isMarked) state = QUESTION_STATES.ATTEMPTED_AND_MARKED;
    else if (isMarked) state = QUESTION_STATES.MARKED_FOR_REVIEW;
    else if (isAttempted) state = QUESTION_STATES.ATTEMPTED;
    else if (isViewed) state = QUESTION_STATES.VIEWED;

    return {
      state,
      isAttempted,
      isMarked,
      isViewed,
      isCurrent
    };
  }

  return (
    <div className="quiz-container">
      {/* ─── Top Header Bar ─── */}
      <header className="quiz-header">
        <div className="quiz-header-left">
          <span className="quiz-header-title">
            Application Runtime, Product Architecture, State Management, Application Behavior — Revision
          </span>
        </div>
        <div className="quiz-header-right">
          <span className="quiz-timer-badge">
            ⏱ {formatTimer(timer)}
          </span>
          <button
            className="btn-submit-quiz"
            onClick={submitExamOnBackend}
            disabled={isSubmitting || examLocked}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Quiz'}
          </button>
        </div>
      </header>

      {/* ─── Exam Locked Overlay ─── */}
      {examLocked && (
        <div className="exam-locked-overlay">
          <div className="exam-locked-content">
            <span className="exam-locked-icon">🔒</span>
            <h3>Exam Locked</h3>
            <p>Security violation detected (fullscreen exit or application switch). Answering is temporarily restricted.</p>
            <p>This incident has been recorded with desktop evidence.</p>
            {onRestoreFullscreen && (
              <button
                type="button"
                onClick={onRestoreFullscreen}
                style={{
                  marginTop: '20px',
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  padding: '10px 24px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(220, 38, 38, 0.3)'
                }}
              >
                Re-enter Fullscreen & Unlock Exam
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Main Content ─── */}
      <div className="quiz-main">
        {/* Question Card */}
        <div className="quiz-question-card">
          {/* Question meta row */}
          <div className="quiz-question-meta">
            <span className="quiz-question-counter">
              QUESTION {currentIndex + 1}/5
            </span>
            <div className="quiz-question-actions">
              <button
                className={`btn-mark-review ${isCurrentMarked ? 'active' : ''}`}
                onClick={() => toggleMarkForReview(currentQuestion.id)}
              >
                {isCurrentMarked ? '★ Marked for Review' : 'Mark for review'}
              </button>
              <button
                className="btn-clear-selection"
                onClick={() => handleClearSelection(currentQuestion.id)}
                disabled={selectedOptIndex === undefined || examLocked}
              >
                Clear Selection
              </button>
            </div>
          </div>

          {/* Question Text */}
          <div className="quiz-question-text">
            {currentQuestion.question}
          </div>

          {/* Options */}
          <div className="quiz-options">
            {currentQuestion.options.map((opt, optIdx) => {
              const isSelected = selectedOptIndex === optIdx;

              return (
                <div
                  key={optIdx}
                  className={`quiz-option ${isSelected ? 'selected' : ''} ${examLocked ? 'locked' : ''}`}
                  onClick={() => !examLocked && handleAnswerSelect(currentQuestion.id, optIdx)}
                >
                  <span className={`quiz-option-letter ${isSelected ? 'selected' : ''}`}>
                    {OPTION_LETTERS[optIdx]}
                  </span>
                  <span className="quiz-option-text">{opt}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend directly beneath question card */}
        <div className="quiz-bottom-legend">
          <div className="legend-item">
            <span className="legend-dot attempted"></span>
            <span>Attempted</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot viewed"></span>
            <span>Viewed</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot current"></span>
            <span>Current</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot-review"></span>
            <span>Marked for Review</span>
          </div>
        </div>
      </div>

      {/* ─── Bottom Navigation Bar (Directly Anchored at Bottom of Screen) ─── */}
      <footer className="quiz-bottom-bar">
        <div className="quiz-bottom-bar-content">
          {/* Left: Previous */}
          <div className="quiz-bottom-left">
            <button
              className="btn-bottom-prev"
              disabled={currentIndex === 0 || examLocked}
              onClick={() => setCurrentIndex(c => Math.max(0, c - 1))}
            >
              ‹ Previous
            </button>
          </div>

          {/* Center: Question Numbers & Mark for Review */}
          <div className="quiz-bottom-center">
            <div className="quiz-bottom-question-numbers">
              {questions.map((q, idx) => {
                const status = getQuestionStatus(idx);
                let btnClass = 'quiz-nav-btn';
                if (status.isCurrent) btnClass += ' current';
                else if (status.isAttempted) btnClass += ' attempted';
                else if (status.isViewed) btnClass += ' viewed';

                return (
                  <div key={q.id} className="quiz-nav-btn-wrapper">
                    <button
                      className={btnClass}
                      onClick={() => setCurrentIndex(idx)}
                      disabled={examLocked}
                      title={`Question ${idx + 1}`}
                    >
                      {idx + 1}
                    </button>
                    {status.isMarked && <span className="quiz-nav-review-dot" title="Marked for review"></span>}
                  </div>
                );
              })}
            </div>

            <div className="quiz-bottom-actions">
              <button
                className="btn-bottom-clear"
                onClick={() => handleClearSelection(currentQuestion.id)}
                disabled={selectedOptIndex === undefined || examLocked}
              >
                Clear Selection
              </button>
            </div>
          </div>

          {/* Right: Next or Finish */}
          <div className="quiz-bottom-right">
            {currentIndex < 4 ? (
              <button
                className="btn-bottom-next"
                onClick={() => setCurrentIndex(c => Math.min(4, c + 1))}
                disabled={examLocked}
              >
                Next ›
              </button>
            ) : (
              <button
                className="btn-bottom-submit"
                onClick={submitExamOnBackend}
                disabled={isSubmitting || examLocked}
              >
                {isSubmitting ? 'Submitting...' : 'Finish Exam'}
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
