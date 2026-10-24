const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

// Compare observable behavior with the pre-cleanup controller, not its private helpers.
// All OS APIs, timers, network requests and evidence writes are mocked.
const baseline = '4eff01d312be4ee7efdd5817063185f2d07479af';
const original = execFileSync('git', ['show', `${baseline}:app/proctoringController.js`], { encoding: 'utf8' });
const current = fs.readFileSync(path.resolve('app/proctoringController.js'), 'utf8');
const normalize = value => JSON.parse(JSON.stringify(value));

function loadController(source, options = {}) {
  const trace = [];
  const timers = new Map();
  const shortcuts = new Map();
  const displayListeners = [];
  let now = Date.parse('2026-11-25T10:00:00.000Z');
  let nextTimer = 1;
  const status = { destroyed: false, contentsDestroyed: false, kiosk: false, fullscreen: false, focused: true };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const schedule = (kind, callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { kind, callback, delay });
    trace.push([kind, id, delay]);
    return id;
  };
  const clear = (kind, id) => { trace.push([kind, id]); timers.delete(id); };
  const io = kind => (filename, data) => {
    trace.push([kind, filename, typeof data === 'string' ? data : [...data]]);
    if (options.ioFailure) throw new Error('disk unavailable');
  };
  const primary = { id: 1, size: { width: 1440, height: 900 }, scaleFactor: 2, bounds: { x: 0, y: 0 } };
  const electron = {
    app: { isPackaged: !!options.packaged, getPath: () => '/mock/userData', focus: opts => trace.push(['app.focus', opts]) },
    screen: {
      on: (channel, callback) => { trace.push(['screen.on', channel]); displayListeners.push(callback); },
      getPrimaryDisplay: () => options.noPrimary ? undefined : primary,
      getAllDisplays: () => options.multiDisplay ? [primary, { ...primary, id: 2 }] : [primary],
    },
    desktopCapturer: { getSources: async opts => {
      trace.push(['getSources', opts]);
      if (options.captureFailure) throw new Error('permission denied');
      return options.emptySources ? [] : [{ id: 'screen:1', thumbnail: { toPNG: () => Buffer.from('desktop') } }];
    } },
    globalShortcut: {
      register: (key, callback) => { trace.push(['register', key]); shortcuts.set(key, callback); },
      unregisterAll: () => { trace.push(['unregisterAll']); shortcuts.clear(); },
    },
  };
  if (options.noScreen) electron.screen = undefined;
  const window = {
    isDestroyed: () => status.destroyed,
    isKiosk: () => status.kiosk,
    isFullScreen: () => status.fullscreen,
    isFocused: () => status.focused,
    webContents: {
      isDestroyed: () => status.contentsDestroyed,
      send: (channel, payload) => trace.push(['send', channel, payload]),
      capturePage: async () => {
        trace.push(['capturePage']);
        if (options.fallbackFailure) throw new Error('window unavailable');
        return { toPNG: () => Buffer.from('window') };
      },
    },
  };
  for (const method of ['setFullScreenable', 'setVisibleOnAllWorkspaces', 'setAlwaysOnTop', 'moveTop', 'show', 'focus', 'setKiosk', 'setFullScreen']) {
    window[method] = (...args) => {
      trace.push([method, ...args]);
      if (options.windowFailure) throw new Error('window unavailable');
      if (method === 'setKiosk') status.kiosk = args[0];
      if (method === 'setFullScreen') status.fullscreen = args[0];
    };
  }
  const script = source.replace(/^import .*;$/gm, '').replace(/\bexport /g, '')
    .replace(/import\.meta\.dirname/g, '__dirname') + '\n({ ProctoringController, EXAM_STATES, BLOCKED_APPS });';
  const exports = vm.runInNewContext(script, {
    fs: { mkdirSync: (dir, opts) => trace.push(['mkdir', dir, opts]), writeFileSync: io('write'), appendFileSync: io('append') },
    path, electron, Buffer, Date: Clock, __dirname: path.resolve('app'),
    process: { platform: options.platform || 'darwin' },
    console: { warn: (...args) => trace.push(['warn', ...args]) },
    setInterval: (cb, ms) => schedule('interval', cb, ms),
    setTimeout: (cb, ms) => schedule('timeout', cb, ms),
    clearInterval: id => clear('clearInterval', id),
    clearTimeout: id => clear('clearTimeout', id),
    fetch: (url, request) => {
      trace.push(['fetch', url, { ...request, body: JSON.parse(request.body) }]);
      if (options.syncNetworkFailure) throw new Error('network unavailable');
      return options.networkFailure ? Promise.reject(new Error('network unavailable')) : Promise.resolve({ ok: true });
    },
    exec: (cmd, callback) => {
      trace.push(['exec', cmd]);
      callback(options.processFailure ? new Error('process unavailable') : null, options.processOutput || '');
    },
  });
  const controller = new exports.ProctoringController();
  return {
    ...exports, controller, window, status, trace, timers, shortcuts, displayListeners,
    advance: ms => { now += ms; },
    fire: async id => {
      const timer = timers.get(id);
      if (timer.kind === 'timeout') timers.delete(id);
      await timer.callback();
      // Async capture/expiry callbacks are intentionally not awaited by real intervals.
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  };
}

async function compare(options, scenario) {
  async function run(source) {
    const h = loadController(source, options);
    const result = await scenario(h);
    return normalize({ result, trace: h.trace, session: h.controller.session, state: h.controller.state,
      questionId: h.controller.currentQuestionId, keys: h.controller.keylogBuffer,
      timers: [...h.timers].map(([id, { kind, delay }]) => ({ id, kind, delay })) });
  }
  assert.deepEqual(await run(current), await run(original));
}

async function start(h, mode = 'PROCTORED') {
  h.controller.setWindow(h.window);
  await h.controller.startSession({ sessionId: 'test-session', studentId: 'test-id', studentName: 'Test', mode, durationSec: 60 });
}

test('all existing public controller methods and constants remain available', () => {
  const before = loadController(original);
  const after = loadController(current);
  for (const method of Object.getOwnPropertyNames(before.ProctoringController.prototype)) {
    assert.equal(typeof after.controller[method], 'function', method);
  }
  for (const method of ['checkDisplays', 'getRunningProcesses']) assert.equal(typeof after.ProctoringController[method], 'function');
  assert.deepEqual(normalize(after.EXAM_STATES), normalize(before.EXAM_STATES));
  assert.deepEqual(normalize(after.BLOCKED_APPS), normalize(before.BLOCKED_APPS));
});

for (const platform of ['darwin', 'win32', 'linux']) {
  for (const endState of ['SUBMITTED', 'EXPIRED', 'ABORTED']) {
    test(`${platform}: session start/stop and ${endState} preserve order and payloads`, () => compare({ platform, multiDisplay: true }, async h => {
      await start(h);
      const duplicate = await h.controller.startSession({ sessionId: 'ignored' });
      assert.equal(duplicate, h.controller.getSession());
      await h.controller.stopSession(endState, 'Test end');
      await h.controller.stopSession(endState);
    }));
  }
}

test('all key/modifier combinations preserve shortcut decisions', () => compare({}, h => {
  const keys = ['a', 'c', 'v', 'x', 'p', 's', 'f', 'u', 'r', 'h', 'w', 'm', 'tab', ' ', 'i', 'j', 'escape',
    'printscreen', 'f3', 'f4', 'f11', 'f12', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', '9', 'Shift', 'Cmd', ''];
  const decisions = [];
  for (const key of keys) for (let mask = 0; mask < 16; mask++) {
    decisions.push(h.controller.isBlockedInput({ key: key.toUpperCase(), control: !!(mask & 1), meta: !!(mask & 2), alt: !!(mask & 4), shift: !!(mask & 8) }));
  }
  return [...decisions, h.controller.isBlockedInput(null), h.controller.isBlockedInput({})];
}));

for (const options of [{}, { networkFailure: true }, { ioFailure: true }]) {
  test(`keystroke batching, blocked keys, flags and JSONL: ${JSON.stringify(options)}`, () => compare(options, async h => {
    await start(h);
    h.controller.setCurrentQuestionId('3');
    for (const q of [0, -1, 'bad']) h.controller.setCurrentQuestionId(q);
    const event = { preventDefault: () => h.trace.push(['preventDefault']) };
    h.controller.handleInputEvent(event, { type: 'keyDown', key: 'a' });
    h.controller.handleInputEvent(event, { type: 'keyDown', key: '9', shift: true });
    await h.fire(h.controller.keylogFlushTimer);
    h.controller.handleInputEvent(event, { type: 'keyDown', key: 'c', control: true });
    h.controller.handleInputEvent(event, { type: 'keyUp', key: 'F12' });
    h.shortcuts.get('Alt+Tab')();
    await h.controller.flagBackend('TEST', 'Details', 0);
    h.controller.logEvent('TEST_EVENT', 0, { test: true });
    await h.controller.stopSession();
    h.controller.handleInputEvent(event, { type: 'keyDown', key: 'a' });
  }));
}

for (const options of [{}, { packaged: true }, { captureFailure: true }, { emptySources: true },
  { noPrimary: true }, { noScreen: true }, { captureFailure: true, fallbackFailure: true },
  { ioFailure: true }, { networkFailure: true }, { syncNetworkFailure: true }]) {
  test(`desktop/face evidence, fallback and failures: ${JSON.stringify(options)}`, () => compare(options, async h => {
    await start(h);
    await h.controller.triggerSynchronizedCapture();
    const saved = await h.controller.saveFaceSnapshot(new Uint8Array([1, 2, 3]).buffer, 'frame');
    await h.controller.captureImmediate('TEST');
    await h.controller.stopSession();
    await h.controller.saveFaceSnapshot(new Uint8Array([4]).buffer, 'ignored');
    return saved;
  }));
}

test('timers preserve 3-second warm-up, 10-second capture and wall-clock countdown', () => compare({}, async h => {
  await start(h);
  const warmup = [...h.timers].find(([, timer]) => timer.delay === 3000)[0];
  h.advance(3000);
  await h.fire(warmup);
  h.advance(7000);
  await h.fire(h.controller.captureTimer);
  await h.fire(h.controller.clockTimer);
  h.status.focused = false;
  await h.fire(h.controller.kioskEnforceTimer);
  h.advance(50000);
  await h.fire(h.controller.clockTimer);
}));

for (const condition of ['destroyed', 'inactive', 'nullWindow']) {
  test(`recurring monitors and safe IPC stop for ${condition}`, () => compare({}, async h => {
    await start(h);
    if (condition === 'destroyed') h.status.destroyed = true;
    if (condition === 'inactive') h.controller.state = 'SUBMITTED';
    if (condition === 'nullWindow') h.controller.window = null;
    for (const name of ['captureTimer', 'clockTimer', 'kioskEnforceTimer']) await h.fire(h.controller[name]);
    return h.controller.safeSend('test');
  }));
}

for (const mode of ['PROCTORED', 'UNPROCTORED']) {
  test(`focus, fullscreen and display violations: ${mode}`, () => compare({}, async h => {
    await start(h, mode);
    await h.controller.handleFocusLost();
    h.controller.handleFocusRestored();
    await h.controller.handleFullscreenExited(); // Kiosk still active: ignore this event.
    h.status.kiosk = false;
    h.status.fullscreen = false;
    await h.controller.handleFullscreenExited();
    h.controller.handleFullscreenRestored();
    h.displayListeners[0]();
    await h.controller.stopSession();
    await h.controller.handleFocusLost();
    h.displayListeners[0]();
  }));
}

test('expiry notifies UI before network finalization, including network failure', async () => {
  for (const options of [{}, { networkFailure: true }]) await compare(options, async h => {
    await start(h);
    await h.controller.handleExamExpired();
  });
});

for (const options of [{ contentsDestroyed: true }, { windowFailure: true }]) {
  test(`window failures remain best-effort: ${JSON.stringify(options)}`, () => compare(options, async h => {
    try {
      await start(h);
    } catch (error) {
      // Startup's show/focus calls already propagate window errors in the original.
      if (!options.windowFailure) throw error;
      h.trace.push(['startupError', error.message]);
      h.controller.state = 'ACTIVE';
    }
    h.status.contentsDestroyed = !!options.contentsDestroyed;
    h.controller.reclaimFocus();
    h.controller.safeSend('test', { test: true });
    await h.controller.stopSession();
  }));
}

for (const [platform, processOutput] of [
  ['darwin', 'Electron, Proctorly, Chrome, Zoom, Zoom, OBS Studio, System Events'],
  ['win32', '"electron.exe","1"\n"Zoom.exe","2"\n"notepad.exe","3"'],
  ['linux', '/usr/bin/electron\n/usr/bin/zoom\n/usr/bin/slack\n/usr/bin/bash'],
]) {
  test(`${platform}: process scanning, filtering and command failure`, async () => {
    for (const processFailure of [false, true]) await compare({ platform, processOutput, processFailure }, h => h.ProctoringController.getRunningProcesses());
  });
}
