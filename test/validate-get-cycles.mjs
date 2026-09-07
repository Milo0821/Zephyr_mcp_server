// Protocol-level validation for the get_test_cycles_for_issue tool.
// Drives the built MCP server over stdio; exercises network-free paths only
// (schema registration + input/platform guards).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'build', 'index.js');

let passed = 0, failed = 0;
const ok = (name) => { passed++; console.log(`✅ ${name}`); };
const bad = (name, detail) => { failed++; console.log(`❌ ${name}\n     ${detail}`); };

async function newClient(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, ...env },
  });
  const client = new Client({ name: 'validator', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

const CLOUD = { ZEPHYR_BASE_URL: 'https://example.atlassian.net', ZEPHYR_API_KEY: 'dummy-key' };
const DC = { ZEPHYR_BASE_URL: 'https://jira.example.com', ZEPHYR_API_KEY: 'dummy-key', JIRA_TYPE: 'datacenter' };

async function callTool(client, name, args) {
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
    return { text, isError: res.isError === true };
  } catch (e) {
    return { text: e?.message ?? String(e), isError: true };
  }
}

async function main() {
  // ---- 1. Schema registration (Cloud) ----
  const cloud = await newClient(CLOUD);
  const { tools } = await cloud.listTools();
  const tool = tools.find((t) => t.name === 'get_test_cycles_for_issue');

  if (tool) ok('tool "get_test_cycles_for_issue" is registered');
  else return bad('tool "get_test_cycles_for_issue" is registered', 'not found in tools/list');

  const props = tool.inputSchema?.properties ?? {};
  const expected = ['issue_key', 'resolve_keys'];
  const missing = expected.filter((p) => !(p in props));
  if (missing.length === 0) ok(`schema exposes all ${expected.length} expected properties`);
  else bad('schema property coverage', `missing: ${missing.join(', ')}`);

  if (props.resolve_keys?.type === 'boolean' && props.resolve_keys?.default === true)
    ok('resolve_keys is a boolean defaulting to true');
  else bad('resolve_keys typing/default', JSON.stringify(props.resolve_keys));

  if (Array.isArray(tool.inputSchema.required) && tool.inputSchema.required.join(',') === 'issue_key')
    ok('issue_key is the sole required field');
  else bad('required fields', JSON.stringify(tool.inputSchema.required));

  await cloud.close();

  // ---- 2. Cloud-only guard (Data Center) ----
  const dc = await newClient(DC);
  const r = await callTool(dc, 'get_test_cycles_for_issue', { issue_key: 'PROJ-1' });
  if (r.isError && /only supported on Zephyr Scale Cloud/.test(r.text))
    ok('guard: Data Center is rejected as Cloud-only');
  else bad('guard: Data Center rejection', r.text);
  await dc.close();

  console.log(`\n${failed === 0 ? '🎉' : '⚠️'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
