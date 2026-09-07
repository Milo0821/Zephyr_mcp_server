// Ad-hoc validation harness for the update_test_execution tool.
// Drives the built MCP server over stdio using the MCP SDK client.
// Only exercises network-free paths (schema registration + input-guard errors).
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

// Call a tool and return {text, isError} — normalizing both the isError result shape
// and thrown McpError (SDK rejects the promise for protocol-level errors).
async function callTool(client, name, args) {
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content ?? []).map((c) => c.text ?? '').join('\n');
    return { text, isError: res.isError === true, threw: false };
  } catch (e) {
    return { text: e?.message ?? String(e), isError: true, threw: true };
  }
}

async function main() {
  // ---- 1. Schema registration (Cloud) ----
  const cloud = await newClient(CLOUD);
  const { tools } = await cloud.listTools();
  const tool = tools.find((t) => t.name === 'update_test_execution');

  if (tool) ok('tool "update_test_execution" is registered');
  else return bad('tool "update_test_execution" is registered', 'not found in tools/list');

  const props = tool.inputSchema?.properties ?? {};
  const expected = ['execution_id', 'test_cycle_key', 'test_case_key', 'project_key',
    'status', 'comment', 'environment', 'execution_time', 'actual_end_date',
    'executed_by_id', 'assigned_to_id', 'bug_keys'];
  const missing = expected.filter((p) => !(p in props));
  if (missing.length === 0) ok(`schema exposes all ${expected.length} expected properties`);
  else bad('schema property coverage', `missing: ${missing.join(', ')}`);

  if (props.bug_keys?.type === 'array' && props.bug_keys?.items?.type === 'string')
    ok('bug_keys is an array of strings');
  else bad('bug_keys typing', JSON.stringify(props.bug_keys));

  // No required[] — every field is optional (execution identified flexibly)
  if (!tool.inputSchema.required || tool.inputSchema.required.length === 0)
    ok('no hard-required fields (flexible execution identification)');
  else bad('required fields', JSON.stringify(tool.inputSchema.required));

  // ---- 2. "must identify execution" guard (Cloud, no ids) ----
  let r = await callTool(cloud, 'update_test_execution', { status: 'Pass' });
  if (r.isError && /Provide either execution_id/.test(r.text))
    ok('guard: rejects missing execution identifier');
  else bad('guard: missing execution identifier', r.text);

  // ---- 3. "nothing to update" guard (Cloud, id but no fields) ----
  r = await callTool(cloud, 'update_test_execution', { execution_id: 'PROJ-E1' });
  if (r.isError && /Nothing to update/.test(r.text))
    ok('guard: rejects empty update (id but no fields/bugs)');
  else bad('guard: empty update', r.text);

  await cloud.close();

  // ---- 4. Cloud-only guard (Data Center) ----
  const dc = await newClient(DC);
  r = await callTool(dc, 'update_test_execution', { execution_id: 'PROJ-E1', status: 'Fail' });
  if (r.isError && /only supported on Zephyr Scale Cloud/.test(r.text))
    ok('guard: Data Center is rejected as Cloud-only');
  else bad('guard: Data Center rejection', r.text);
  await dc.close();

  console.log(`\n${failed === 0 ? '🎉' : '⚠️'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
