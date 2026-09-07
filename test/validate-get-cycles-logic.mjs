// Handler-level validation for getTestCyclesForIssue: verifies the exact HTTP
// requests it issues (issuelink lookup + optional cycle-id resolution), using a fake axios.
import { ZephyrToolHandlers } from '../build/tool-handlers.js';

let passed = 0, failed = 0;
const ok = (n) => { passed++; console.log(`✅ ${n}`); };
const bad = (n, d) => { failed++; console.log(`❌ ${n}\n     ${d}`); };
const eq = (n, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? ok(n) : bad(n, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));

const CLOUD = { type: 'cloud', baseUrl: '', jiraBaseUrl: '', authHeaders: {},
  apiEndpoints: { testcase: '/testcases', testrun: '/testcycles', folder: '/folders', search: '/testcases/search' } };
const DC = { ...CLOUD, type: 'datacenter' };

// Fake axios that records GET calls and dispatches responses by URL.
function fakeAxios(getResponder) {
  const calls = { get: [] };
  return {
    calls,
    async get(url, cfg) { calls.get.push({ url, cfg }); return getResponder ? getResponder(url, cfg) : { data: {} }; },
  };
}
const textOf = (res) => res.content.map((c) => c.text).join('\n');

async function main() {
  // ---- A. resolve_keys default true: issuelink lookup + one /testcycles GET per id ----
  {
    const ax = fakeAxios((url) => {
      if (url === '/issuelinks/DDCN-6752/testcycles') return { data: [
        { id: 110702963, self: 'https://x/testcycles/110702963' },
        { id: 110702999, self: 'https://x/testcycles/110702999' },
      ] };
      if (url === '/testcycles/110702963') return { data: { key: 'DDCN-R467', name: 'MRR cycle' } };
      if (url === '/testcycles/110702999') return { data: { key: 'DDCN-R468', name: 'Other cycle' } };
      return { data: {} };
    });
    const h = new ZephyrToolHandlers(ax, CLOUD);
    const res = await h.getTestCyclesForIssue({ issue_key: 'DDCN-6752' });
    eq('A: issuelink lookup URL', ax.calls.get[0]?.url, '/issuelinks/DDCN-6752/testcycles');
    eq('A: resolves each cycle id', ax.calls.get.slice(1).map((c) => c.url), ['/testcycles/110702963', '/testcycles/110702999']);
    /"key": "DDCN-R467"/.test(textOf(res)) && /"name": "MRR cycle"/.test(textOf(res))
      ? ok('A: reports resolved key + name') : bad('A: resolved output', textOf(res));
    /"totalCount": 2/.test(textOf(res)) ? ok('A: totalCount 2') : bad('A: totalCount', textOf(res));
  }

  // ---- B. resolve_keys=false: only the issuelink lookup, no /testcycles calls ----
  {
    const ax = fakeAxios((url) => {
      if (url === '/issuelinks/DDCN-6752/testcycles') return { data: [{ id: 110702963, self: 'https://x/testcycles/110702963' }] };
      return { data: {} };
    });
    const h = new ZephyrToolHandlers(ax, CLOUD);
    const res = await h.getTestCyclesForIssue({ issue_key: 'DDCN-6752', resolve_keys: false });
    eq('B: only one GET (no id resolution)', ax.calls.get.length, 1);
    /"id": "110702963"/.test(textOf(res)) ? ok('B: returns raw id') : bad('B: raw id', textOf(res));
  }

  // ---- C. id absent, extracted from self URL ----
  {
    const ax = fakeAxios((url) => {
      if (url === '/issuelinks/DDCN-6752/testcycles') return { data: { values: [{ self: 'https://x/testcycles/555' }] } };
      if (url === '/testcycles/555') return { data: { key: 'DDCN-R9', name: 'X' } };
      return { data: {} };
    });
    const h = new ZephyrToolHandlers(ax, CLOUD);
    await h.getTestCyclesForIssue({ issue_key: 'DDCN-6752' });
    eq('C: id parsed from self → /testcycles/555', ax.calls.get[1]?.url, '/testcycles/555');
  }

  // ---- D. empty result set → totalCount 0, no resolution calls ----
  {
    const ax = fakeAxios(() => ({ data: [] }));
    const h = new ZephyrToolHandlers(ax, CLOUD);
    const res = await h.getTestCyclesForIssue({ issue_key: 'DDCN-1' });
    eq('D: single GET only', ax.calls.get.length, 1);
    /"totalCount": 0/.test(textOf(res)) ? ok('D: totalCount 0') : bad('D: totalCount', textOf(res));
  }

  // ---- E. one cycle-id resolution fails → surfaced per-entry, call still succeeds ----
  {
    const ax = fakeAxios((url) => {
      if (url === '/issuelinks/DDCN-6752/testcycles') return { data: [{ id: 1 }, { id: 2 }] };
      if (url === '/testcycles/1') return { data: { key: 'DDCN-R1', name: 'ok' } };
      throw new Error('boom');
    });
    const h = new ZephyrToolHandlers(ax, CLOUD);
    const res = await h.getTestCyclesForIssue({ issue_key: 'DDCN-6752' });
    /"key": "DDCN-R1"/.test(textOf(res)) ? ok('E: good cycle resolved') : bad('E: good cycle', textOf(res));
    /"error"/.test(textOf(res)) ? ok('E: failed cycle carries error field') : bad('E: error field', textOf(res));
  }

  // ---- F. Data Center → Cloud-only error ----
  {
    const ax = fakeAxios();
    const h = new ZephyrToolHandlers(ax, DC);
    try {
      await h.getTestCyclesForIssue({ issue_key: 'DDCN-6752' });
      bad('F: rejects Data Center', 'no error thrown');
    } catch (e) {
      /only supported on Zephyr Scale Cloud/.test(e.message) ? ok('F: rejects Data Center') : bad('F', e.message);
    }
    eq('F: no HTTP call attempted', ax.calls.get.length, 0);
  }

  // ---- G. missing issue_key → InvalidParams ----
  {
    const ax = fakeAxios();
    const h = new ZephyrToolHandlers(ax, CLOUD);
    try {
      await h.getTestCyclesForIssue({});
      bad('G: rejects missing issue_key', 'no error thrown');
    } catch (e) {
      /issue_key is required/.test(e.message) ? ok('G: rejects missing issue_key') : bad('G', e.message);
    }
  }

  console.log(`\n${failed === 0 ? '🎉' : '⚠️'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
