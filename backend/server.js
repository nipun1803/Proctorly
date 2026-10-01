const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use("/captures", express.static(path.join(__dirname, "data", "captures")));

const questionsPath = path.join(__dirname, "data", "questions.json");
const sessionsPath = process.env.SESSIONS_PATH || path.join(__dirname, "data", "sessions.json");

function readQuestions() {
  const all = JSON.parse(fs.readFileSync(questionsPath, "utf-8"));
  return all.slice(0, 5);
}

function readSessions() {
  if (!fs.existsSync(sessionsPath)) return [];
  try {
    const raw = fs.readFileSync(sessionsPath, "utf-8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((s) => ({
      ...s,
      flags: s.flags || [],
      keylogs: s.keylogs || [],
      screenshots: s.screenshots || [],
      cameraShots: s.cameraShots || []
    }));
  } catch (err) {
    console.warn("Recovering corrupted sessions.json:", err.message);
    return [];
  }
}

function saveSessions(sessions) {
  try {
    const tmp = `${sessionsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(sessions || [], null, 2));
    fs.renameSync(tmp, sessionsPath);
  } catch (err) {
    try {
      fs.writeFileSync(sessionsPath, JSON.stringify(sessions || [], null, 2));
    } catch (fallbackErr) {
      console.error("Failed to save sessions:", fallbackErr);
    }
  }
}

function makeSessionId() {
  return `session-${Date.now()}`;
}

function questionForStudent(question) {
  return {
    id: question.id,
    question: question.question,
    options: question.options,
  };
}

app.get("/", (req, res) => {
  res.json({ message: "Exam backend is running" });
});

// Start a new exam session
app.post("/exam/start", (req, res) => {
  const { userId, name, mode, durationSec } = req.body;

  if (!userId || !name) {
    return res.status(400).json({
      message: "userId and name are required",
    });
  }

  const sessions = readSessions();

  const session = {
    sessionId: makeSessionId(),
    userId,
    name,
    mode: mode || "PROCTORED",
    durationSec: durationSec || 1800,
    startedAt: new Date().toISOString(),
    submittedAt: null,
    status: "in-progress",
    attempted: 0,
    correct: 0,
    wrong: 0,
    answers: [],
    flags: [],
    keylogs: [],
    screenshots: [],
    cameraShots: [],
  };

  // Ensure dedicated session directory and subfolders
  const sessionDir = path.join(__dirname, "data", "sessions", session.sessionId);
  const screenshotsDir = path.join(sessionDir, "screenshots");
  const camerashotsDir = path.join(sessionDir, "camerashots");

  try {
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
    if (!fs.existsSync(camerashotsDir)) fs.mkdirSync(camerashotsDir, { recursive: true });

    const keylogsPath = path.join(sessionDir, "keylogs.json");
    if (!fs.existsSync(keylogsPath)) {
      fs.writeFileSync(keylogsPath, "[]", "utf-8");
    }
  } catch (err) {
    console.error("Failed creating session directories:", err.message);
  }

  sessions.push(session);
  saveSessions(sessions);

  res.status(201).json({
    message: "Exam session started",
    sessionId: session.sessionId,
  });
});

// Get one question
app.get("/exam/mcq/:id", (req, res) => {
  const questions = readQuestions();
  const id = Number(req.params.id);

  const question = questions.find((item) => item.id === id);

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  res.json(questionForStudent(question));
});

// Get all questions without correct answers (strictly capped at 5)
app.get("/exam/mcq", (req, res) => {
  const questions = readQuestions().slice(0, 5);
  res.json(questions.map(questionForStudent));
});

// Submit one answer (does NOT return correctness during active exam)
app.post("/exam/answer", (req, res) => {
  const { sessionId, questionId, selectedAnswer } = req.body;

  if (!sessionId || questionId === undefined || selectedAnswer === undefined) {
    return res.status(400).json({
      message: "sessionId, questionId and selectedAnswer are required",
    });
  }

  const questions = readQuestions();
  const sessions = readSessions();

  const question = questions.find(
    (item) => item.id === Number(questionId)
  );

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  const session = sessions.find(
    (item) => item.sessionId === sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (session.status !== "in-progress") {
    return res.status(400).json({ message: "Exam is already submitted" });
  }

  const alreadyAnswered = session.answers.find(
    (answer) => answer.questionId === Number(questionId)
  );

  if (alreadyAnswered) {
    alreadyAnswered.selectedAnswer = Number(selectedAnswer);
    alreadyAnswered.answeredAt = new Date().toISOString();
    saveSessions(sessions);

    return res.json({
      message: "Answer updated",
      attempted: session.answers.length,
    });
  }

  session.answers.push({
    questionId: question.id,
    selectedAnswer: Number(selectedAnswer),
    answeredAt: new Date().toISOString(),
  });

  session.attempted = session.answers.length;
  saveSessions(sessions);

  res.json({
    message: "Answer saved",
    attempted: session.attempted,
  });
});

// Clear a previously submitted answer
app.post("/exam/clear-answer", (req, res) => {
  const { sessionId, questionId } = req.body;

  if (!sessionId || questionId === undefined) {
    return res.status(400).json({
      message: "sessionId and questionId are required",
    });
  }

  const sessions = readSessions();
  const session = sessions.find((item) => item.sessionId === sessionId);

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (session.status !== "in-progress") {
    return res.status(400).json({ message: "Exam is already submitted" });
  }

  const answerIndex = session.answers.findIndex(
    (answer) => answer.questionId === Number(questionId)
  );

  if (answerIndex === -1) {
    return res.json({ message: "No answer to clear", attempted: session.answers.length });
  }

  session.answers.splice(answerIndex, 1);
  session.attempted = session.answers.length;
  saveSessions(sessions);

  res.json({
    message: "Answer cleared",
    attempted: session.attempted,
  });
});

// Get current session progress
app.get("/exam/session/:sessionId", (req, res) => {
  const sessions = readSessions();

  const session = sessions.find(
    (item) => item.sessionId === req.params.sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  res.json(session);
});

// Submit the whole exam (evaluates correctness only upon submission)
app.post("/exam/submit", (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ message: "sessionId is required" });
  }

  const sessions = readSessions();

  const session = sessions.find(
    (item) => item.sessionId === sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  const questions = readQuestions().slice(0, 5);
  let correct = 0;
  let wrong = 0;

  session.answers.forEach((ans) => {
    const q = questions.find((item) => item.id === ans.questionId);
    if (q) {
      const isCorrect = Number(ans.selectedAnswer) === q.correctAnswer;
      ans.isCorrect = isCorrect;
      if (isCorrect) correct++;
      else wrong++;
    }
  });

  session.correct = correct;
  session.wrong = wrong;
  session.attempted = session.answers.length;
  session.status = "submitted";
  session.submittedAt = new Date().toISOString();

  saveSessions(sessions);

  res.json({
    message: "Exam submitted successfully",
    result: {
      attempted: session.attempted,
      correct: session.correct,
      wrong: session.wrong,
      total: questions.length,
      percentage: Math.round((correct / questions.length) * 100)
    },
  });
});

// Expire the exam when duration runs out
app.post("/exam/expire", (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ message: "sessionId is required" });
  }

  const sessions = readSessions();

  const session = sessions.find(
    (item) => item.sessionId === sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  const questions = readQuestions().slice(0, 5);
  let correct = 0;
  let wrong = 0;

  session.answers.forEach((ans) => {
    const q = questions.find((item) => item.id === ans.questionId);
    if (q) {
      const isCorrect = Number(ans.selectedAnswer) === q.correctAnswer;
      ans.isCorrect = isCorrect;
      if (isCorrect) correct++;
      else wrong++;
    }
  });

  session.correct = correct;
  session.wrong = wrong;
  session.attempted = session.answers.length;
  session.status = "expired";
  session.submittedAt = new Date().toISOString();

  saveSessions(sessions);

  res.json({
    message: "Exam expired and finalized",
    result: {
      attempted: session.attempted,
      correct: session.correct,
      wrong: session.wrong,
      total: questions.length,
      percentage: Math.round((correct / questions.length) * 100)
    },
  });
});

// ─── Flag proctoring activity (Stored per session) ──────────────────────────
app.post("/exam/flag", (req, res) => {
  const { sessionId, type, flagType, details, timestamp, questionId } = req.body;
  const resolvedType = type || flagType;

  if (!sessionId || !resolvedType) {
    return res.status(400).json({ message: "sessionId and type/flagType are required" });
  }

  const sessions = readSessions();
  const session = sessions.find((s) => s.sessionId === sessionId);

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (!session.flags) session.flags = [];

  const flagRecord = {
    sessionId,
    type: resolvedType,
    details: details || '',
    questionId: questionId !== undefined ? questionId : null,
    timestamp: timestamp || new Date().toISOString(),
  };

  session.flags.push(flagRecord);
  saveSessions(sessions);

  res.json({ message: "Activity flagged", flag: flagRecord });
});

// Get flags for a session
app.get("/exam/flags/:sessionId", (req, res) => {
  const sessions = readSessions();
  const session = sessions.find((s) => s.sessionId === req.params.sessionId);
  if (!session) return res.status(404).json({ message: "Session not found" });
  res.json(session.flags || []);
});

// ─── Log keybindings (Stored per session) ────────────────────────────────────
app.post("/exam/keylog", (req, res) => {
  const { sessionId, keylogs } = req.body;

  if (!sessionId || !keylogs) {
    return res.status(400).json({ message: "sessionId and keylogs are required" });
  }

  const sessions = readSessions();
  const session = sessions.find((s) => s.sessionId === sessionId);

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (!session.keylogs) session.keylogs = [];
  const entries = Array.isArray(keylogs) ? keylogs : [keylogs];
  session.keylogs.push(...entries);
  saveSessions(sessions);

  // Synchronize with backend/data/sessions/<sessionId>/keylogs.json
  const sessionDir = path.join(__dirname, "data", "sessions", sessionId);
  try {
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    const keylogsPath = path.join(sessionDir, "keylogs.json");
    let existing = [];
    if (fs.existsSync(keylogsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(keylogsPath, "utf-8"));
      } catch {
        existing = [];
      }
    }
    existing.push(...entries);
    fs.writeFileSync(keylogsPath, JSON.stringify(existing, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed updating session keylogs.json:", err.message);
  }

  res.json({ message: "Keylogs saved", count: entries.length });
});

// Get keylogs for a session
app.get("/exam/keylogs/:sessionId", (req, res) => {
  const sessions = readSessions();
  const session = sessions.find((s) => s.sessionId === req.params.sessionId);
  if (!session) return res.status(404).json({ message: "Session not found" });
  res.json(session.keylogs || []);
});

// ─── Log screenshots & camera snapshots (Stored per session) ───────────────
app.post("/exam/capture", (req, res) => {
  const { sessionId, type, filename, path: filePath, timestamp, questionId } = req.body;

  if (!sessionId || !type || !filename) {
    return res.status(400).json({ message: "sessionId, type, and filename are required" });
  }

  const sessions = readSessions();
  const session = sessions.find((s) => s.sessionId === sessionId);

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (!session.screenshots) session.screenshots = [];
  if (!session.cameraShots) session.cameraShots = [];

  const captureRecord = {
    sessionId,
    filename,
    type: (type === 'camera' || type === 'face') ? 'camera' : 'screen',
    path: filePath || '',
    questionId: questionId !== undefined ? questionId : null,
    timestamp: timestamp || new Date().toISOString(),
  };

  if (captureRecord.type === 'camera') {
    session.cameraShots.push(captureRecord);
  } else {
    session.screenshots.push(captureRecord);
  }

  saveSessions(sessions);

  res.json({ message: "Capture recorded", capture: captureRecord });
});

// Get captures for a session
app.get("/exam/captures/:sessionId", (req, res) => {
  const sessions = readSessions();
  const session = sessions.find((s) => s.sessionId === req.params.sessionId);
  if (!session) return res.status(404).json({ message: "Session not found" });
  res.json({
    screenshots: session.screenshots || [],
    cameraShots: session.cameraShots || []
  });
});

app.listen(PORT, () => {
  console.log(`Exam backend running at http://localhost:${PORT}`);
});
