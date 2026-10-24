const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const Parser = require('acorn').Parser.extend(require('acorn-jsx')());
const parse = source => Parser.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const read = file => fs.readFileSync(file, 'utf8');
// Pin the pre-cleanup commit so tests keep checking the old behavior after a commit.
const baseline = '4eff01d312be4ee7efdd5817063185f2d07479af';
const original = execFileSync('git', ['show', `${baseline}:src/App.jsx`], { encoding: 'utf8' });
const originalApp = parse(original).body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
const sessionSource = read('src/hooks/useExamSession.js');
const sessionHook = parse(sessionSource).body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
const cameraSource = read('src/hooks/useCamera.js');
const cameraHook = parse(cameraSource).body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
const normalize = value => JSON.parse(JSON.stringify(value));

function findFunction(body, name) {
  return body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
}

// Compare JSX structure after resolving styles and callbacks that were hoisted.
// This is not a browser rendering, React lifecycle or hardware integration test.
function canonical(node, bindings = {}) {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.filter(item => item?.type !== 'JSXEmptyExpression')
    .map(item => canonical(item, bindings)).filter(item => item !== null);
  if (node.type === 'Identifier' && bindings[node.name]) return canonical(bindings[node.name]);
  if (node.type === 'JSXText') {
    const text = node.value.replace(/\s+/g, ' ').trim();
    return text ? { type: 'JSXText', value: text } : null;
  }
  if (node.type === 'JSXExpressionContainer' && node.expression.type === 'JSXEmptyExpression') return null;
  if (node.type === 'FunctionDeclaration' || node.type === 'ArrowFunctionExpression') {
    return { type: 'Callback', async: node.async, params: canonical(node.params), body: canonical(node.body) };
  }
  if (node.type === 'BlockStatement' && node.body.length === 1) return canonical(node.body[0], bindings);
  return Object.fromEntries(Object.entries(node).filter(([key]) => !['start', 'end', 'raw', 'selfClosing'].includes(key))
    .map(([key, value]) => [key, canonical(value, bindings)]));
}

const originalReturns = originalApp.body.body.filter(node => node.type === 'IfStatement' && node.consequent.type === 'BlockStatement'
  && node.consequent.body[0]?.type === 'ReturnStatement');
const screens = ['BlockedAppsScreen', 'ResultsScreen', 'ExamScreen', 'SetupScreen'];
for (const [index, name] of screens.entries()) {
  test(`${name} preserves original markup, text, styles and callbacks`, () => {
    const tree = parse(read(`src/screens/${name}.jsx`));
    const component = tree.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
    const bindings = {
      attachVideo: findFunction(cameraHook.body.body, 'attachVideo'),
      handleFinish: findFunction(sessionHook.body.body, 'handleFinish'),
      handleToggleFullscreen: findFunction(sessionHook.body.body, 'handleToggleFullscreen'),
      handleCandidateKeyDown: findFunction(component.body.body, 'handleCandidateKeyDown'),
    };
    for (const declaration of tree.body.filter(node => node.type === 'VariableDeclaration')) {
      for (const variable of declaration.declarations) bindings[variable.id.name] = variable.init;
    }
    const before = index < 3 ? originalReturns[index].consequent.body[0].argument
      : originalApp.body.body.findLast(node => node.type === 'ReturnStatement').argument;
    const after = component.body.body.findLast(node => node.type === 'ReturnStatement').argument;
    assert.deepEqual(canonical(after, bindings), canonical(before));
  });
}

test('App preserves blocked-app/result/active/setup screen priority', () => {
  const app = parse(read('src/App.jsx')).body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  const branches = app.body.body.filter(node => node.type === 'IfStatement');
  assert.equal(branches.length, 3);
  const removeExamPrefix = node => {
    if (node?.type === 'MemberExpression' && node.object.name === 'exam') return node.property;
    if (Array.isArray(node)) return node.map(removeExamPrefix);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, removeExamPrefix(v)]));
    return node;
  };
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(canonical(removeExamPrefix(branches[i].test)), canonical(originalReturns[i].test));
    assert.equal(branches[i].consequent.body[0].argument.openingElement.name.name, screens[i]);
  }
  assert.equal(app.body.body.findLast(node => node.type === 'ReturnStatement').argument.openingElement.name.name, 'SetupScreen');
});

test('all extracted frontend files parse as JavaScript/JSX', () => {
  for (const dir of ['src/hooks', 'src/screens', 'src/services', 'src/utils']) {
    for (const file of fs.readdirSync(dir)) assert.doesNotThrow(() => parse(read(`${dir}/${file}`)), file);
  }
  assert.doesNotThrow(() => parse(read('src/App.jsx')));
});

for (const options of [{}, { blank: true }, { cameraOff: true }, { cameraOff: true, cameraDenied: true },
  { backendRejected: true }, { networkFailure: true }, { browser: true }]) {
  test(`start action preserves validation, request payload and UI/IPC ordering: ${JSON.stringify(options)}`, async () => {
    async function run(source, body) {
      const trace = [];
      const cameraEnabled = !options.cameraOff;
      const requestCameraAccess = async () => { trace.push(['camera']); return !options.cameraDenied; };
      const fetch = async (url, request) => {
        trace.push(['fetch', url, JSON.parse(request.body)]);
        if (options.networkFailure) throw new Error('network unavailable');
        return { ok: !options.backendRejected, json: async () => ({ sessionId: 'test-session', message: 'Test rejection' }) };
      };
      const context = {
        studentName: options.blank ? ' ' : ' Test ', studentId: ' test-id ', cameraEnabled, requestCameraAccess,
        camera: { cameraEnabled, requestCameraAccess }, isElectron: !options.browser,
        enterFullscreenUniversal: async () => { trace.push(['fullscreen']); return true; }, fetch,
        startExamSession: params => fetch('http://localhost:3000/exam/start', { body: JSON.stringify(params) }),
        sessionIdRef: { current: null }, alert: message => trace.push(['alert', message]),
        console: { error: (message, error) => trace.push(['error', message, error.message]) },
        window: { athena: { startExamSession: async params => trace.push(['IPC.start', params]) } },
      };
      for (const name of ['setIsFullscreenActive', 'setSessionId', 'setExamState']) context[name] = value => trace.push([name, value]);
      const fn = findFunction(body, 'handleStartExam');
      const start = vm.runInNewContext(`(${source.slice(fn.start, fn.end)})`, context);
      await start({ preventDefault: () => trace.push(['preventDefault']) });
      return normalize({ trace, sessionId: context.sessionIdRef.current });
    }
    assert.deepEqual(await run(sessionSource, sessionHook.body.body), await run(original, originalApp.body.body));
  });
}

for (const name of ['handleResetNewExam', 'handleRestoreFullscreen']) {
  test(`${name} preserves state updates and fullscreen calls`, async () => {
    async function run(source, body) {
      const trace = [];
      const context = {
        enterFullscreenUniversal: async () => trace.push(['enterFullscreen']),
        exitFullscreenUniversal: async () => trace.push(['exitFullscreen']),
      };
      for (const setter of ['setExamResults', 'setSessionId', 'setStudentName', 'setStudentId', 'setExamState', 'setExamLocked',
        'setTimerDisplay', 'setFullscreenViolation', 'setIsFullscreenActive']) context[setter] = value => trace.push([setter, value]);
      const fn = findFunction(body, name);
      await vm.runInNewContext(`(${source.slice(fn.start, fn.end)})`, context)();
      return normalize(trace);
    }
    assert.deepEqual(await run(sessionSource, sessionHook.body.body), await run(original, originalApp.body.body));
  });
}
