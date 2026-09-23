const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const questionsPath = path.join(__dirname, "data", "questions.json");
const sessionsPath = process.env.SESSIONS_PATH || path.join(__dirname, "data", "sessions.json");

function readQuestions() {
  if (!fs.existsSync(questionsPath)) return [];
  const all = JSON.parse(fs.readFileSync(questionsPath, "utf-8"));
  return all.slice(0, 5);
}

function readSessions() {
  if (!fs.existsSync(sessionsPath)) return [];
  try {
    const raw = fs.readFileSync(sessionsPath, "utf-8").trim();
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn("Recovering sessions.json:", err.message);
    return [];
  }
}

function saveSessions(sessions) {
  fs.writeFileSync(sessionsPath, JSON.stringify(sessions || [], null, 2));
}

function makeSessionId() {
  return `session-${Date.now()}`;
}

app.get("/", (req, res) => {
  res.json({ message: "Exam backend is running" });
});

// Start exam session
app.post("/exam/start", (req, res) => {
  const { userId, name, mode, durationSec } = req.body;
  if (!userId || !name) {
    return res.status(400).json({ message: "userId and name are required" });
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
    cameraShots: []
  };

  sessions.push(session);
  saveSessions(sessions);

  res.status(201).json({
    message: "Exam session started",
    sessionId: session.sessionId
  });
});

// Get individual question
app.get("/exam/mcq/:id", (req, res) => {
  const questions = readQuestions();
  const id = Number(req.params.id);
  const question = questions.find((item) => item.id === id);

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  res.json({
    id: question.id,
    question: question.question,
    options: question.options
  });
});

// Submit answer for single question
app.post("/exam/answer", (req, res) => {
  const { sessionId, questionId, selectedOption } = req.body;
  const sessions = readSessions();
  const session = sessions.find((s) => s.sessionId === sessionId);

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  const questions = JSON.parse(fs.readFileSync(questionsPath, "utf-8"));
  const q = questions.find((item) => item.id === Number(questionId));

  if (!q) {
    return res.status(404).json({ message: "Question not found" });
  }

  const isCorrect = q.correctAnswer === selectedOption;
  const existing = session.answers.find((a) => a.questionId === Number(questionId));

  if (existing) {
    existing.selectedOption = selectedOption;
    existing.isCorrect = isCorrect;
  } else {
    session.answers.push({
      questionId: Number(questionId),
      selectedOption,
      isCorrect
    });
  }

  session.attempted = session.answers.length;
  session.correct = session.answers.filter((a) => a.isCorrect).length;
  session.wrong = session.answers.filter((a) => !a.isCorrect).length;

  saveSessions(sessions);
  res.json({ message: "Answer recorded", session });
});

app.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
});
