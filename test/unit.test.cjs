'use strict';

/**
 * Unit tests for the functions modified by the BDD + security fixes:
 *   - convertToGherkin  (src/utils.ts)
 *   - createTestCase    (src/tool-handlers.ts) — Cloud BDD path + JSON.parse fallback
 *   - updateTestCaseBdd (src/tool-handlers.ts) — Cloud POST/lowercase, DC projectKey fallback
 *
 * Runs against the compiled build/ artefacts; run `npm run build` first.
 */

const path = require('path');

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

function makeTestHarness() {
  const results = [];
  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, status: 'PASSED' });
      console.log(`  ✅ ${name}`);
    } catch (err) {
      results.push({ name, status: 'FAILED', error: err.message });
      console.log(`  ❌ ${name}: ${err.message}`);
    }
  }
  return { test, results };
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Load compiled modules (ES module output — must use dynamic import)
// ---------------------------------------------------------------------------

let convertToGherkin, ZephyrToolHandlers;

// ---------------------------------------------------------------------------
// Helper: build a mock axios instance and jiraConfig
// ---------------------------------------------------------------------------

function makeHandlers(type, axiosMock) {
  const jiraConfig = {
    type,
    baseUrl: type === 'cloud' ? 'https://api.zephyrscale.smartbear.com/v2' : 'https://jira.example.com',
    authHeaders: {},
    apiEndpoints: type === 'cloud'
      ? { testcase: '/testcases', testrun: '/testruns', folder: '/folders', search: '/testcases/search' }
      : { testcase: '/rest/atm/1.0/testcase', testrun: '/rest/atm/1.0/testrun', folder: '/rest/atm/1.0/folder', search: '/rest/atm/1.0/testcase/search' },
  };
  return new ZephyrToolHandlers(axiosMock, jiraConfig);
}

// ===========================================================================
// Main
// ===========================================================================

async function runUnitTests() {
  const { test, results } = makeTestHarness();

  // Dynamic import required because the build emits ES modules (Node16 module format)
  try {
    ({ convertToGherkin } = await import('../build/utils.js'));
    ({ ZephyrToolHandlers } = await import('../build/tool-handlers.js'));
  } catch (e) {
    console.error(`Could not load build artefacts — run 'npm run build' first.\n${e.message}`);
    return false;
  }


// ===========================================================================
// SUITE 1 — convertToGherkin
// ===========================================================================

console.log('\n📋 convertToGherkin');

await test('strips Feature: header', async () => {
  const input = 'Feature: Login\nGiven I am on the login page\nWhen I enter credentials\nThen I am logged in';
  const out = convertToGherkin(input);
  assert(!out.includes('Feature:'), 'Feature: should be stripped');
  assert(out.includes('Given I am on the login page'), 'Given step preserved');
});

await test('strips Scenario: header', async () => {
  const input = 'Scenario: Happy path\nGiven a user\nWhen they act\nThen result';
  const out = convertToGherkin(input);
  assert(!out.includes('Scenario:'), 'Scenario: should be stripped');
});

await test('strips Scenario Outline:', async () => {
  const input = 'Scenario Outline: parameterised\nGiven a <thing>\nWhen I do something\nThen outcome';
  const out = convertToGherkin(input);
  assert(!out.includes('Scenario Outline:'), 'Scenario Outline: should be stripped');
});

await test('strips Background:', async () => {
  const input = 'Background:\nGiven I am logged in';
  const out = convertToGherkin(input);
  assert(!out.includes('Background:'), 'Background: should be stripped');
  assert(out.includes('Given I am logged in'), 'Given step preserved after Background strip');
});

await test('strips Examples:', async () => {
  const input = 'Examples:\n| col |\n| val |';
  const out = convertToGherkin(input);
  assert(!out.includes('Examples:'), 'Examples: should be stripped');
  assert(out.includes('| col |'), 'table row preserved');
});

await test('passes through Given/When/Then/And/But steps', async () => {
  const input = 'Given step 1\nWhen step 2\nThen step 3\nAnd step 4\nBut step 5';
  const out = convertToGherkin(input);
  assertEqual(out, input, 'all step lines unchanged');
});

await test('converts **Bold** markdown steps', async () => {
  const input = '**Given** I am on the page\n**When** I click submit\n**Then** I see success';
  const out = convertToGherkin(input);
  assert(out.includes('Given I am on the page'), '**Given** converted');
  assert(out.includes('When I click submit'), '**When** converted');
  assert(out.includes('Then I see success'), '**Then** converted');
  assert(!out.includes('**'), 'no asterisks remain');
});

await test('passes through table rows', async () => {
  const input = '| header1 | header2 |\n| val1    | val2    |';
  const out = convertToGherkin(input);
  assertEqual(out, input, 'table rows unchanged');
});

await test('skips blank lines and --- separators', async () => {
  const input = 'Given step 1\n\n---\nGiven step 2';
  const out = convertToGherkin(input);
  assertEqual(out, 'Given step 1\nGiven step 2', 'blank lines and --- stripped');
});

await test('ignores unrecognised prose lines', async () => {
  const input = 'This is a comment\nGiven step 1';
  const out = convertToGherkin(input);
  assert(!out.includes('This is a comment'), 'prose line stripped');
  assert(out.includes('Given step 1'), 'step preserved');
});

await test('returns empty string for input with only structural keywords', async () => {
  const input = 'Feature: X\nScenario: Y\nBackground:\nExamples:';
  const out = convertToGherkin(input);
  assertEqual(out, '', 'all lines stripped, empty result');
});

// ===========================================================================
// SUITE 2 — createTestCase (Cloud BDD)
// ===========================================================================

console.log('\n📋 createTestCase — Cloud BDD');

await test('makes second POST to /testscript after creation', async () => {
  const calls = [];
  const axiosMock = {
    post: async (url, data) => {
      calls.push({ url, data });
      if (url === '/testcases') return { status: 201, data: { key: 'PROJ-T1' } };
      if (url.endsWith('/testscript')) return { status: 201, data: {} };
      throw new Error(`Unexpected POST to ${url}`);
    },
  };
  const handlers = makeHandlers('cloud', axiosMock);
  await handlers.createTestCase({
    project_key: 'PROJ',
    name: 'My BDD test',
    test_script: { type: 'BDD', text: 'Given I am here\nWhen I act\nThen it works' },
  });
  const scriptCall = calls.find(c => c.url === '/testcases/PROJ-T1/testscript');
  assert(scriptCall, 'second POST to /testscript must be made');
  assertEqual(scriptCall.data.type, 'bdd', 'type must be lowercase bdd');
  assert(scriptCall.data.text.length > 0, 'text must be non-empty');
});

await test('removes testScript from initial POST payload on Cloud BDD', async () => {
  const calls = [];
  const axiosMock = {
    post: async (url, data) => {
      calls.push({ url, data });
      if (url === '/testcases') return { status: 201, data: { key: 'PROJ-T2' } };
      return { status: 201, data: {} };
    },
  };
  const handlers = makeHandlers('cloud', axiosMock);
  await handlers.createTestCase({
    project_key: 'PROJ',
    name: 'BDD test 2',
    test_script: { type: 'BDD', text: 'Given step' },
  });
  const createCall = calls.find(c => c.url === '/testcases');
  assert(createCall, 'POST /testcases must be called');
  assert(!createCall.data.testScript, 'testScript must NOT be in initial POST for Cloud BDD');
});

await test('parses test_script when passed as JSON string (MCP client workaround)', async () => {
  const calls = [];
  const axiosMock = {
    post: async (url, data) => {
      calls.push({ url, data });
      if (url === '/testcases') return { status: 201, data: { key: 'PROJ-T3' } };
      return { status: 201, data: {} };
    },
  };
  const handlers = makeHandlers('cloud', axiosMock);
  await handlers.createTestCase({
    project_key: 'PROJ',
    name: 'String script test',
    test_script: JSON.stringify({ type: 'BDD', text: 'Given I am here' }),
  });
  const scriptCall = calls.find(c => c.url && c.url.endsWith('/testscript'));
  assert(scriptCall, 'testscript POST must be made even when test_script arrived as string');
  assertEqual(scriptCall.data.type, 'bdd', 'type must be lowercase bdd');
});

await test('does NOT make testscript call for Cloud PLAIN_TEXT', async () => {
  const calls = [];
  const axiosMock = {
    post: async (url, data) => {
      calls.push({ url, data });
      if (url === '/testcases') return { status: 201, data: { key: 'PROJ-T4' } };
      return { status: 201, data: {} };
    },
  };
  const handlers = makeHandlers('cloud', axiosMock);
  await handlers.createTestCase({
    project_key: 'PROJ',
    name: 'Plain text test',
    test_script: { type: 'PLAIN_TEXT', text: 'Just some text' },
  });
  const scriptCall = calls.find(c => c.url && c.url.endsWith('/testscript'));
  assert(!scriptCall, 'no testscript POST for PLAIN_TEXT type');
});

await test('does NOT make testscript call for Data Center BDD', async () => {
  const calls = [];
  const axiosMock = {
    post: async (url, data) => {
      calls.push({ url, data });
      return { status: 201, data: { key: 'PROJ-T5' } };
    },
  };
  const handlers = makeHandlers('datacenter', axiosMock);
  await handlers.createTestCase({
    project_key: 'PROJ',
    name: 'DC BDD test',
    test_script: { type: 'BDD', text: 'Given something' },
  });
  const scriptCall = calls.find(c => c.url && c.url.endsWith('/testscript'));
  assert(!scriptCall, 'no separate testscript call for Data Center');
  const createCall = calls.find(c => c.url === '/rest/atm/1.0/testcase');
  assert(createCall.data.testScript, 'testScript included in DC payload');
});

// ===========================================================================
// SUITE 3 — updateTestCaseBdd
// ===========================================================================

console.log('\n📋 updateTestCaseBdd');

await test('Cloud: uses POST (not PUT) to /testscript', async () => {
  const calls = [];
  const axiosMock = {
    post: async (url, data) => {
      calls.push({ method: 'POST', url, data });
      return { status: 201, data: {} };
    },
    put: async (url, data) => {
      calls.push({ method: 'PUT', url, data });
      return { status: 200, data: {} };
    },
    get: async (url) => ({ status: 200, data: { key: 'PROJ-T10', projectKey: 'PROJ', name: 'Old name', status: 'Draft', priority: 'Normal' } }),
  };
  const handlers = makeHandlers('cloud', axiosMock);
  await handlers.updateTestCaseBdd({ test_case_key: 'PROJ-T10', bdd_content: 'Given a step' });
  const postToScript = calls.find(c => c.method === 'POST' && c.url.endsWith('/testscript'));
  assert(postToScript, 'must POST to /testscript');
  assert(!calls.find(c => c.method === 'PUT' && c.url.endsWith('/testscript')), 'must NOT PUT to /testscript');
});

await test('Cloud: sends lowercase type bdd', async () => {
  const calls = [];
  const axiosMock = {
    post: async (url, data) => {
      calls.push({ url, data });
      return { status: 201, data: {} };
    },
    get: async () => ({ status: 200, data: { key: 'PROJ-T11', projectKey: 'PROJ', name: 'X', status: 'Draft', priority: 'Normal' } }),
  };
  const handlers = makeHandlers('cloud', axiosMock);
  await handlers.updateTestCaseBdd({ test_case_key: 'PROJ-T11', bdd_content: 'Given step' });
  const scriptCall = calls.find(c => c.url.endsWith('/testscript'));
  assertEqual(scriptCall.data.type, 'bdd', 'type must be lowercase bdd');
});

await test('Cloud: derives projectKey from key when API omits it', async () => {
  const calls = [];
  const axiosMock = {
    post: async (url, data) => {
      calls.push({ url, data });
      return { status: 201, data: {} };
    },
    put: async (url, data) => {
      calls.push({ url, data });
      return { status: 200, data: {} };
    },
    // API returns no flat projectKey field
    get: async () => ({ status: 200, data: { key: 'MYPROJ-T99', name: 'Test', status: 'Draft', priority: 'Normal' } }),
  };
  const handlers = makeHandlers('cloud', axiosMock);
  // Pass a name so the PUT name-update path is exercised
  await handlers.updateTestCaseBdd({ test_case_key: 'MYPROJ-T99', bdd_content: 'Given step', name: 'New name' });
  const putCall = calls.find(c => c.url && c.url.includes('MYPROJ-T99') && !c.url.endsWith('/testscript'));
  assert(putCall, 'PUT for name update must be called');
  assertEqual(putCall.data.projectKey, 'MYPROJ', 'projectKey derived from key as MYPROJ');
});

await test('Data Center: uses PUT with full payload', async () => {
  const calls = [];
  const axiosMock = {
    get: async () => ({ status: 200, data: { key: 'PROJ-T20', projectKey: 'PROJ', name: 'DC test', status: 'Active', priority: 'High' } }),
    put: async (url, data) => {
      calls.push({ url, data });
      return { status: 200, data: {} };
    },
  };
  const handlers = makeHandlers('datacenter', axiosMock);
  await handlers.updateTestCaseBdd({ test_case_key: 'PROJ-T20', bdd_content: 'Given a DC step' });
  const putCall = calls.find(c => c.url.includes('PROJ-T20'));
  assert(putCall, 'PUT must be called for Data Center');
  assertEqual(putCall.data.testScript.type, 'BDD', 'DC uses uppercase BDD');
  assert(putCall.data.testScript.text.includes('Given'), 'step text included');
});

await test('Data Center: derives projectKey from key when API omits it', async () => {
  const calls = [];
  const axiosMock = {
    // No projectKey in response
    get: async () => ({ status: 200, data: { key: 'DCPROJ-T5', name: 'DC test', status: 'Active', priority: 'High' } }),
    put: async (url, data) => {
      calls.push({ url, data });
      return { status: 200, data: {} };
    },
  };
  const handlers = makeHandlers('datacenter', axiosMock);
  await handlers.updateTestCaseBdd({ test_case_key: 'DCPROJ-T5', bdd_content: 'Given step' });
  const putCall = calls[0];
  assertEqual(putCall.data.projectKey, 'DCPROJ', 'projectKey derived as DCPROJ');
});

// ===========================================================================
// Summary
// ===========================================================================

const passed = results.filter(r => r.status === 'PASSED').length;
const failed = results.filter(r => r.status === 'FAILED').length;

console.log(`\n${'='.repeat(60)}`);
console.log(`📊 Unit test summary: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailed tests:');
  results.filter(r => r.status === 'FAILED').forEach(r => console.log(`  - ${r.name}: ${r.error}`));
}
console.log('='.repeat(60));

  return failed === 0;

} // end runUnitTests

if (require.main === module) {
  runUnitTests().then(ok => process.exit(ok ? 0 : 1)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { runUnitTests };
