// Handler-level validation for updateTestExecution: verifies the exact HTTP
// requests (endpoints + payloads) it issues, using a fake axios instance.
import { ZephyrToolHandlers } from '../build/tool-handlers.js';

let passed = 0, failed = 0;
const ok = (n) => { passed++; console.log(`✅ ${n}`); };
const bad = (n, d) => { failed++; console.log(`❌ ${n}\n     ${d}`); };
const eq = (n, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? ok(n) : bad(n, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));

const CLOUD = { type: 'cloud', baseUrl: '', jiraBaseUrl: '', authHeaders: {},
  apiEndpoints: { testcase: '/testcases', testrun: '/testcycles', folder: '/folders', search: '/testcases/search' } };

// Fake axios that records calls and returns queued responses.
function fakeAxios(getResponder) {
  const calls = { get: [], put: [], post: [] };
  return {
    calls,
    async get(url, cfg) { calls.get.push({ url, cfg }); return getResponder ? getResponder(url, cfg) : { data: {} }; },
    async put(url, body) { calls.put.push({ url, body }); return { status: 200, data: {} }; },
    async post(url, body) { calls.post.push({ url, body }); return { status: 201, data: {} }; },
  };
}
const textOf = (res) => res.content.map((c) => c.text).join('\n');

async function main() {
  // ---- A. Update by execution_id: PUT endpoint + full payload mapping ----
  {
    const ax = fakeAxios();
    const h = new ZephyrToolHandlers(ax, CLOUD);
    await h.updateTestExecution({
      execution_id: 'PROJ-E1', status: 'Fail', comment: 'boom', environment: 'Chrome',
      execution_time: 1000, actual_end_date: '2024-05-20T13:15:13Z',
      executed_by_id: 'u1', assigned_to_id: 'u2',
    });
    eq('A: single PUT issued', ax.calls.put.length, 1);
    eq('A: PUT url', ax.calls.put[0]?.url, '/testexecutions/PROJ-E1');
    eq('A: PUT payload field-mapping', ax.calls.put[0]?.body, {
      statusName: 'Fail', comment: 'boom', environmentName: 'Chrome',
      executionTime: 1000, actualEndDate: '2024-05-20T13:15:13Z',
      executedById: 'u1', assignedToId: 'u2',
    });
    eq('A: no GET when execution_id given', ax.calls.get.length, 0);
  }

  // ---- B. Resolve by cycle + test case: GET params + correct exec key selected ----
  {
    const ax = fakeAxios((url) => {
      if (url === '/testexecutions') return { data: { values: [
        { key: 'PROJ-E9', testCase: { self: 'https://x/testcases/PROJ-T5/versions/1' } },
        { key: 'PROJ-E10', testCase: { self: 'https://x/testcases/PROJ-T6/versions/2' } },
      ] } };
      return { data: {} };
    });
    const h = new ZephyrToolHandlers(ax, CLOUD);
    await h.updateTestExecution({ test_cycle_key: 'PROJ-R2', test_case_key: 'PROJ-T6', status: 'Pass' });
    eq('B: lookup GET params', ax.calls.get[0]?.cfg?.params, {
      projectKey: 'PROJ', testCycle: 'PROJ-R2', onlyLastExecutions: true, maxResults: 1000,
    });
    eq('B: resolved to matching execution key', ax.calls.put[0]?.url, '/testexecutions/PROJ-E10');
    eq('B: PUT payload', ax.calls.put[0]?.body, { statusName: 'Pass' });
  }

  // ---- C. Explicit project_key overrides the derived one ----
  {
    const ax = fakeAxios(() => ({ data: { values: [
      { key: 'PROJ-E1', testCase: { self: 'https://x/testcases/PROJ-T1/versions/1' } },
    ] } }));
    const h = new ZephyrToolHandlers(ax, CLOUD);
    await h.updateTestExecution({ test_cycle_key: 'PROJ-R2', test_case_key: 'PROJ-T1', project_key: 'OTHER', status: 'Pass' });
    eq('C: explicit project_key used', ax.calls.get[0]?.cfg?.params?.projectKey, 'OTHER');
  }

  // ---- D. Bug linking success: correct endpoint + numeric issueId ----
  {
    const ax = fakeAxios();
    const h = new ZephyrToolHandlers(ax, CLOUD);
    h.resolveJiraIssueId = async (k) => ({ 'PROJ-789': 111, 'PROJ-790': 222 }[k]);
    const res = await h.updateTestExecution({ execution_id: 'PROJ-E1', status: 'Fail', bug_keys: ['PROJ-789', 'PROJ-790'] });
    eq('D: two issue-link POSTs', ax.calls.post.length, 2);
    eq('D: link endpoint', ax.calls.post[0]?.url, '/testexecutions/PROJ-E1/links/issues');
    eq('D: link body uses numeric issueId', ax.calls.post.map((c) => c.body), [{ issueId: 111 }, { issueId: 222 }]);
    /linkedBugs": 2/.test(textOf(res)) ? ok('D: reports linkedBugs: 2') : bad('D: linkedBugs count', textOf(res));
  }

  // ---- E. Bug link failure becomes a warning; status update still succeeds ----
  {
    const ax = fakeAxios();
    const h = new ZephyrToolHandlers(ax, CLOUD);
    h.resolveJiraIssueId = async () => { throw new Error('no jira creds'); };
    const res = await h.updateTestExecution({ execution_id: 'PROJ-E1', status: 'Fail', bug_keys: ['PROJ-789'] });
    eq('E: PUT still issued (status updated)', ax.calls.put.length, 1);
    eq('E: no successful link POST', ax.calls.post.length, 0);
    /⚠️ Some bug links failed/.test(textOf(res)) ? ok('E: surfaces failure warning') : bad('E: warning', textOf(res));
    /linkedBugs": 0/.test(textOf(res)) ? ok('E: reports linkedBugs: 0') : bad('E: linkedBugs', textOf(res));
  }

  // ---- F. Bugs only, no status: PUT skipped, link still attempted ----
  {
    const ax = fakeAxios();
    const h = new ZephyrToolHandlers(ax, CLOUD);
    h.resolveJiraIssueId = async () => 111;
    await h.updateTestExecution({ execution_id: 'PROJ-E1', bug_keys: ['PROJ-789'] });
    eq('F: no PUT when only bugs given', ax.calls.put.length, 0);
    eq('F: link POST issued', ax.calls.post.length, 1);
  }

  // ---- G. No matching execution in cycle → error ----
  {
    const ax = fakeAxios(() => ({ data: { values: [] } }));
    const h = new ZephyrToolHandlers(ax, CLOUD);
    try {
      await h.updateTestExecution({ test_cycle_key: 'PROJ-R2', test_case_key: 'PROJ-T99', status: 'Pass' });
      bad('G: errors when execution not found', 'no error thrown');
    } catch (e) {
      /No execution found for test case PROJ-T99/.test(e.message) ? ok('G: errors when execution not found') : bad('G', e.message);
    }
  }

  console.log(`\n${failed === 0 ? '🎉' : '⚠️'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
