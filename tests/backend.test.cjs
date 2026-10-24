const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real route handlers with disposable storage and mocked routing.
// No live backend, Express startup or localhost connections are needed.
test('exam API handlers preserve answers, scoring, validation and evidence storage', { timeout: 20000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proctorly-api-test-'));
  const previousEnv = { DATA_DIR: process.env.DATA_DIR, SESSIONS_PATH: process.env.SESSIONS_PATH };
  process.env.DATA_DIR = dataDir;
  process.env.SESSIONS_PATH = path.join(dataDir, 'sessions.json');
  const entry = path.resolve('backend/server.js');
  const routes = [];
  const app = {
    use() {}, listen() {},
    get: (route, handler) => routes.push({ method: 'GET', route, handler }),
    post: (route, handler) => routes.push({ method: 'POST', route, handler }),
  };
  const expressForTest = Object.assign(() => app, { json: () => () => {} });
  const testRequire = (id) => {
    if (id === 'express') return expressForTest;
    if (id === 'cors') return () => () => {};
    return require(id);
  };
  try {
    vm.runInNewContext(fs.readFileSync(entry, 'utf8'), {
      require: testRequire, __dirname: path.dirname(entry), process, console,
    }, { filename: entry });
    async function request(route, body) {
      const method = body === undefined ? 'GET' : 'POST';
      const segments = route.split('/');
      const match = routes.find(candidate => candidate.method === method
        && candidate.route.split('/').length === segments.length
        && candidate.route.split('/').every((part, i) => part.startsWith(':') || part === segments[i]));
      assert.ok(match, `${method} ${route} is registered`);
      const params = {};
      match.route.split('/').forEach((part, i) => { if (part.startsWith(':')) params[part.slice(1)] = segments[i]; });
      const result = { status: 200 };
      const res = {
        status: code => { result.status = code; return res; },
        json: value => { result.body = JSON.parse(JSON.stringify(value)); return res; },
      };
      await match.handler({ body, params }, res);
      return result;
    }
    assert.deepEqual(await request('/'), { status: 200, body: { message: 'Exam backend is running' } });
    assert.equal((await request('/exam/start', {})).status, 400);
    const questions = (await request('/exam/mcq')).body;
    assert.equal(questions.length, 5);
    assert.deepEqual(Object.keys(questions[0]), ['id', 'question', 'options']);
    assert.deepEqual((await request(`/exam/mcq/${questions[0].id}`)).body, questions[0]);
    assert.equal((await request('/exam/mcq/999')).status, 404);
    const started = await request('/exam/start', { userId: 'test-id', name: 'Test Candidate' });
    assert.equal(started.status, 201);
    const sessionId = started.body.sessionId;
    const q = questions[0].id;
    const answer = selectedAnswer => request('/exam/answer', { sessionId, questionId: q, selectedAnswer });
    assert.deepEqual((await answer(0)).body, { message: 'Answer saved', attempted: 1 });
    assert.deepEqual((await answer(1)).body, { message: 'Answer updated', attempted: 1 });
    const progress = (await request(`/exam/session/${sessionId}`)).body;
    assert.equal(progress.mode, 'PROCTORED');
    assert.equal(progress.durationSec, 1800);
    assert.equal(progress.answers[0].selectedAnswer, 1);
    assert.equal('isCorrect' in progress.answers[0], false);
    assert.deepEqual((await request('/exam/clear-answer', { sessionId, questionId: q })).body,
      { message: 'Answer cleared', attempted: 0 });
    assert.deepEqual((await request('/exam/clear-answer', { sessionId, questionId: q })).body,
      { message: 'No answer to clear', attempted: 0 });
    const keylogs = [{ key: 'a', questionId: q }];
    assert.deepEqual((await request('/exam/keylog', { sessionId, keylogs })).body,
      { message: 'Keylogs saved', count: 1 });
    assert.deepEqual((await request(`/exam/keylogs/${sessionId}`)).body, keylogs);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'sessions', sessionId, 'keylogs.json'))), keylogs);
    const flag = (await request('/exam/flag', { sessionId, flagType: 'TEST', questionId: 0 })).body.flag;
    assert.equal(flag.type, 'TEST');
    assert.equal(flag.questionId, 0);
    assert.deepEqual((await request(`/exam/flags/${sessionId}`)).body, [flag]);
    for (const type of ['screen', 'camera', 'face']) {
      const capture = (await request('/exam/capture', { sessionId, type, filename: `${type}.png` })).body.capture;
      assert.equal(capture.type, type === 'screen' ? 'screen' : 'camera');
      assert.equal(capture.questionId, null);
    }
    const captures = (await request(`/exam/captures/${sessionId}`)).body;
    assert.equal(captures.screenshots.length, 1);
    assert.equal(captures.cameraShots.length, 2);
    const originals = JSON.parse(fs.readFileSync(path.resolve('backend/data/questions.json'))).slice(0, 5);
    await answer(originals[0].correctAnswer);
    await request('/exam/answer', {
      sessionId, questionId: originals[1].id, selectedAnswer: (originals[1].correctAnswer + 1) % originals[1].options.length,
    });
    const result = await request('/exam/submit', { sessionId });
    assert.deepEqual(result.body, {
      message: 'Exam submitted successfully', result: { attempted: 2, correct: 1, wrong: 1, total: 5, percentage: 20 },
    });
    assert.equal((await answer(0)).status, 400);
    assert.equal((await request('/exam/clear-answer', { sessionId, questionId: q })).status, 400);
    // Existing behavior permits re-finalization; the refactor must not silently change it.
    const expired = await request('/exam/expire', { sessionId });
    assert.deepEqual(expired.body.result, result.body.result);
    assert.equal((await request(`/exam/session/${sessionId}`)).body.status, 'expired');
    for (const route of ['answer', 'clear-answer', 'submit', 'expire', 'flag', 'keylog', 'capture']) {
      assert.equal((await request(`/exam/${route}`, {})).status, 400);
    }
    for (const route of ['session', 'flags', 'keylogs', 'captures']) {
      assert.equal((await request(`/exam/${route}/missing`)).status, 404);
    }
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
