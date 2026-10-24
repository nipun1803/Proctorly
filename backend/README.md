# Exam Backend

A very small Express backend for the Electron exam application.

It uses JSON files instead of a database so students can understand the complete flow before introducing MongoDB, PostgreSQL, or another database.

## Folder Structure

```text
backend/
├── data/
│   ├── questions.json
│   ├── sessions.json             # Created when a session is saved
│   └── sessions/<sessionId>/
│       ├── screenshots/          # Desktop PNGs written by Electron
│       ├── camerashots/          # Webcam JPEGs written by Electron
│       ├── events.jsonl          # Controller event log
│       ├── keylogs.jsonl         # Controller append-only key log
│       └── keylogs.json          # Backend's separate key log copy
├── package.json
├── server.js
└── README.md
```

## Setup

```bash
npm install
npm start
```

Server runs at:

```text
http://localhost:3000
```

## API Flow

```text
Student starts exam
        ↓
POST /exam/start
        ↓
Session is created
        ↓
GET /exam/mcq/1
        ↓
Question is returned
        ↓
POST /exam/answer
        ↓
Answer and attempted count are saved (correctness is withheld)
        ↓
POST /exam/submit
        ↓
Answers are scored and session is marked submitted
```

## 1. Start Exam

### Request

```http
POST /exam/start
Content-Type: application/json
```

```json
{
  "userId": "student-101",
  "name": "Aditya"
}
```

### Response

```json
{
  "message": "Exam session started",
  "sessionId": "session-1789830000000"
}
```

Save this `sessionId` in the frontend. It identifies this particular exam attempt.

## 2. Get One Question

```http
GET /exam/mcq/1
```

Example response:

```json
{
  "id": 1,
  "question": "Which Electron process is responsible for creating BrowserWindow?",
  "options": [
    "Renderer Process",
    "Main Process",
    "React Process",
    "Preload Process"
  ]
}
```

The correct answer is deliberately not sent to the frontend.

## 3. Get All Questions

```http
GET /exam/mcq
```

## 4. Submit One Answer

```http
POST /exam/answer
Content-Type: application/json
```

```json
{
  "sessionId": "session-1789830000000",
  "questionId": 1,
  "selectedAnswer": 1
}
```

`selectedAnswer` is the option index:

```text
0 = first option
1 = second option
2 = third option
3 = fourth option
```

Example response:

```json
{
  "message": "Answer saved",
  "attempted": 1
}
```

Updating an existing answer returns `"Answer updated"` with the same attempted count. Neither response exposes correctness; scoring happens only on submission or expiration.

## 5. Check Session

```http
GET /exam/session/session-1789830000000
```

This returns the stored session, including answers, flags, keylogs and capture metadata. During the active exam, answers have no `isCorrect` field; `correct` and `wrong` are finalized only when the exam ends.

## 6. Submit Exam

```http
POST /exam/submit
Content-Type: application/json
```

```json
{
  "sessionId": "session-1789830000000"
}
```

Example response:

```json
{
  "message": "Exam submitted successfully",
  "result": {
    "attempted": 3,
    "correct": 2,
    "wrong": 1,
    "total": 5,
    "percentage": 40
  }
}
```

## Important Teaching Point

The frontend never receives `correctAnswer` when fetching a question.

The backend keeps the correct answer inside `questions.json` and evaluates saved answers when the exam is submitted or expired. It serves only the first five questions.

That gives students the basic client/server idea:

```text
Frontend             Backend
   │                    │
   │ GET question       │
   ├───────────────────→│
   │                    │ read questions.json
   │ question           │
   │←───────────────────┤
   │                    │
   │ POST answer        │
   ├───────────────────→│
   │                    │ saves answer, no correctness
   │ attempted count    │ updates sessions.json
   │←───────────────────┤
```

## Why JSON Files For Now?

The JSON files are acting as our database.

```text
questions.json = question database
sessions.json  = exam session database
```

Later these can be replaced with a real database without changing the basic API idea.

## Other Endpoints

| Method | Route | Request / response |
|---|---|---|
| POST | `/exam/clear-answer` | `{ sessionId, questionId }`; returns message and attempted count |
| POST | `/exam/expire` | `{ sessionId }`; finalizes scoring with status `expired` |
| POST | `/exam/flag` | `{ sessionId, type, details?, timestamp?, questionId? }`; also accepts `flagType` instead of `type` |
| GET | `/exam/flags/:sessionId` | Stored flag records |
| POST | `/exam/keylog` | `{ sessionId, keylogs }`; accepts an array or single entry |
| GET | `/exam/keylogs/:sessionId` | Stored keystroke records |
| POST | `/exam/capture` | `{ sessionId, type, filename, path?, timestamp?, questionId? }` |
| GET | `/exam/captures/:sessionId` | `{ screenshots, cameraShots }` metadata arrays |

`/exam/capture` registers metadata only, not image bytes. `camera` and `face` types are stored as camera records; other types are stored as screen records. Electron's `saveCapture()` writes the images first. The React session API helper is `src/services/examApi.js`; quiz answer requests remain in `src/components/Quiz/Quiz.jsx`.

## Storage and Failure Handling

- `DATA_DIR` overrides the writable session/evidence directory; `SESSIONS_PATH` overrides the session index file. Questions always load from `backend/data/questions.json`.
- Development uses `backend/data`; packaged Electron supplies `<userData>/data` for both backend and controller.
- `saveSessions()` first writes a temporary file and renames it; if that fails, it tries a direct write. This is not a database transaction or a guarantee against power-loss corruption.
- `keylogs.json` is a separate write from the session index. Controller JSONL logs are synchronous, best-effort append operations.
- Invalid required fields return 400; missing sessions/questions return 404. Existing submit/expire handlers permit re-finalization; the readability cleanup does not change that behavior.

## Testing

From the repository root:

```bash
node --test tests/backend.test.cjs
```

This loads the real handlers with mocked Express routing and temporary storage, covering validation, answer updates/clearing, withheld correctness, scoring, flags, keylogs and capture metadata. It does not start port 3000 or modify real session files. See [System Documentation](../docs/SYSTEM_DOCUMENTATION.md) for the Electron lifecycle and debugging guide.
