# Zephyr Scale MCP Server

Model Context Protocol server for Zephyr Scale test management, supporting both **Jira Cloud and Data Center**. Create, read, and manage test cases through the Atlassian REST API with **official API-compliant schemas**. Access live test case data, example payloads, and file resources through a unified resource system.

## Features

- ✅ **Jira Cloud & Data Center Support**: Seamlessly connects to both Jira Cloud (using API v2) and self-hosted Data Center instances (using API v1) with automatic configuration detection.
- ✅ **Official API-Compliant Schemas**: Tools and data structures match the official Zephyr Scale REST API, ensuring compatibility and reliability.
- ✅ **Unified Test Case Creation**: A single `create_test_case` tool handles all script types (BDD, Step-by-Step, Plain Text) for a simplified workflow.
- ✅ **Full Test Lifecycle Management**: Comprehensive tools to create, read, delete test cases, and manage test runs, executions, and folders.
- ✅ **Execution Reporting & Jira Integration** *(Cloud)*: Report execution results (Pass/Fail/Blocked), attach bugs as Jira issue links, and discover the Zephyr test cycle linked to any Jira story or epic — bridging a Jira ticket straight to its executions.
- ✅ **Live Templating System**: Use real test cases from your Zephyr instance as templates (`zephyr://testcase/KEY`) to ensure consistency and correct project-specific fields.
- ✅ **Unified Resource System**: Access live Zephyr data, local files (`file://`), and built-in examples through a consistent URI-based system.

## Installation and Configuration

You can run the server using `npx` without installation, or install it globally from `npm`.

### Using npx (Recommended)
Configure your MCP client with the following structure.

**Jira Cloud:**
```json
{
  "mcpServers": {
    "zephyr-server": {
      "command": "npx",
      "args": ["zephyr-scale-mcp-server@latest"],
      "env": {
        "ZEPHYR_BASE_URL": "https://your-company.atlassian.net",
        "ZEPHYR_API_KEY": "your-zephyr-api-key",
        "JIRA_USERNAME": "your-email@company.com",
        "JIRA_API_TOKEN": "your-jira-api-token"
      }
    }
  }
}
```
> **Note**: `JIRA_USERNAME` and `JIRA_API_TOKEN` are optional but required if you want to use the `issue_links` field when creating test cases. Without them, issue linking will fail with a 401 warning (the test case is still created). Generate a Jira API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

**Jira Cloud (EU region):**
```json
{
  "mcpServers": {
    "zephyr-server": {
      "command": "npx",
      "args": ["zephyr-scale-mcp-server@latest"],
      "env": {
        "ZEPHYR_BASE_URL": "https://your-company.atlassian.net",
        "ZEPHYR_API_KEY": "your-zephyr-api-key",
        "JIRA_USERNAME": "your-email@company.com",
        "JIRA_API_TOKEN": "your-jira-api-token",
        "ZEPHYR_API_BASE_URL": "https://eu.api.zephyrscale.smartbear.com/v2"
      }
    }
  }
}
```

**Jira Data Center:**
```json
{
  "mcpServers": {
    "zephyr-server": {
      "command": "npx",
      "args": ["zephyr-scale-mcp-server@latest"],
      "env": {
        "ZEPHYR_BASE_URL": "https://your-jira-server.com",
        "ZEPHYR_API_KEY": "your-api-token"
      }
    }
  }
}
```

### Using global npm installation
First install the package globally:
```bash
npm install -g zephyr-scale-mcp-server
```
Then, update the `command` in your MCP configuration to `"command": "zephyr-scale-mcp"`.

## Core Concepts

### Unified API
The latest version features a **unified `create_test_case` tool** that supports all test script types (STEP_BY_STEP, PLAIN_TEXT, and BDD) through a single, consistent interface. This matches the official Zephyr Scale REST API v1 structure exactly, simplifying the test creation process.

### Jira Cloud vs. Data Center
The server automatically detects your Jira environment and uses the appropriate API version:
- **Jira Cloud**: Uses Zephyr Scale API v2.
- **Jira Data Center**: Uses Zephyr Scale API v1.

Some tools are platform-specific. For example, `add_test_cases_to_run` is only available on Cloud, as the Data Center API (v1) does not support modifying test runs after creation.

### Resource System
The server provides access to various resources through URI schemes:
- `zephyr://testcase/YOUR-TEST-CASE-KEY`: Fetch real test case data from your Zephyr instance to use as templates.
- `file:///absolute/path/to/your/file.json`: Read user-provided files.
- `zephyr://examples/...`: Access built-in example payloads.

## Tools Reference

### Test Case Management
- `get_test_case`: Get detailed information about a specific test case.
- `create_test_case`: Create test cases with STEP_BY_STEP, PLAIN_TEXT, or BDD content.
- `delete_test_case`: Delete a specific test case.
- `update_test_case_bdd`: Update an existing test case with BDD content (optionally update the test case name).

### Test Run Management
- `create_test_run`: Create a new test run.
- `get_test_run`: Get detailed information about a specific test run, including resolved status name.
- `update_test_run`: Update an existing test cycle — set owner, name, description, dates, or status. *(Cloud only)*
- `get_test_run_cases`: Get test case keys from a test run.
- `add_test_cases_to_run`: Add test cases to an existing test run. *(Cloud only)*

### Test Execution & Search
- `get_test_execution`: Get detailed individual test execution results.
- `list_executions_by_cycle`: List all test executions for a specific test cycle with status, executor, and date. *(Cloud only)*
- `update_test_execution`: Update a test case execution's status within a cycle (Pass/Fail/etc.), add a comment, and attach bug(s) as Jira issue links. Identify the execution by `execution_id`, or by `test_cycle_key` + `test_case_key`. *(Cloud only)*
- `search_test_cases_by_folder`: Search for test cases in a specific folder. Automatically paginates through all results.
- `search_test_runs`: Search for test runs by project key and/or folder path.
- `get_test_cycles_for_issue`: Get the Zephyr test cycles linked to a Jira issue (story/epic). Resolves each cycle ID to its key (e.g. `PROJ-R123`) and name so you can feed it straight into `list_executions_by_cycle` / `update_test_execution`. *(Cloud only)*

### Organization
- `create_folder`: Create a new folder in Zephyr Scale.
- `get_folders`: List folders, optionally filtered by project, type, and path. When `folder_path` is given, returns the matching folder and its full subtree at every depth.

## Usage Examples

### Create a BDD Test Case with Issue Links
```json
{
  "project_key": "PROJ",
  "name": "User Authentication",
  "test_script": {
    "type": "BDD",
    "text": "Given a user with valid credentials\nWhen the user attempts to log in\nThen the user should be authenticated successfully"
  },
  "issue_links": ["PROJ-123", "PROJ-456"]
}
```
**Note**: `issue_links` requires `JIRA_USERNAME` and `JIRA_API_TOKEN` to be set (Cloud only). Link failures are reported as warnings — the test case is still created.

### Use a Live Test Case as a Template
1. Fetch an existing test case: `zephyr://testcase/PROJ-T123`
2. Copy its structure (especially `customFields` and `folder`).
3. Create a new test case using the same project-specific configuration.

### Create a Test Run
```json
{
  "project_key": "PROJ",
  "name": "Sprint 1 Test Run",
  "test_case_keys": ["PROJ-T123", "PROJ-T124", "PROJ-T125"]
}
```

### Update an Existing BDD Test Case
```json
{
  "test_case_key": "PROJ-T123",
  "name": "Ensure the axial-flow pump is enabled",
  "bdd_content": "Feature: Pump Enablement\n\nScenario: Enable the pump\n  Given the system is powered on\n  When the operator enables the axial-flow pump\n  Then the pump should report as enabled"
}
```
**Note**: The server will convert markdown-style BDD into Gherkin when possible and will preserve all other existing test case fields.

### Mark an Execution as Failed and Attach a Bug
```json
{
  "test_cycle_key": "PROJ-R123",
  "test_case_key": "PROJ-T456",
  "status": "Fail",
  "comment": "Login button unresponsive on submit.",
  "bug_keys": ["PROJ-789"]
}
```
Or target an execution directly by key:
```json
{
  "execution_id": "PROJ-E123",
  "status": "Pass"
}
```
**Note**: `update_test_execution` is Cloud only. `bug_keys` requires `JIRA_USERNAME` and `JIRA_API_TOKEN`; link failures are reported as warnings while the status update still succeeds.

### Find the Test Cycle Linked to a Jira Ticket
```json
{
  "issue_key": "PROJ-6752"
}
```
Returns the linked cycles with resolved keys, e.g. `[{ "id": "110702963", "key": "PROJ-R467", "name": "..." }]`. This is the bridge from a Jira ticket to its Zephyr cycle — the association is stored on the Zephyr side, not in Jira's issue fields. Chain it: `get_test_cycles_for_issue` → `list_executions_by_cycle` → `update_test_execution`. Pass `"resolve_keys": false` to skip the per-cycle key/name lookup and return raw IDs only. **Cloud only.**

## Authentication

### Jira Cloud Configuration

| Variable | Required | Description |
|---|---|---|
| `ZEPHYR_BASE_URL` | ✅ | Your Jira Cloud URL, e.g. `https://your-company.atlassian.net` |
| `ZEPHYR_API_KEY` | ✅ | Zephyr Scale API key (JWT). Generate in Jira: profile picture (bottom left) → **Zephyr API keys** |
| `JIRA_USERNAME` | ⚠️ Optional* | Your Jira account email address |
| `JIRA_API_TOKEN` | ⚠️ Optional* | Jira API token. Generate at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `ZEPHYR_API_BASE_URL` | Optional | Override the Zephyr API base URL (e.g. for EU: `https://eu.api.zephyrscale.smartbear.com/v2`). Defaults to US endpoint. |
| `JIRA_TYPE` | Optional | Force `"cloud"` or `"datacenter"` — overrides auto-detection |

> **\* `JIRA_USERNAME` + `JIRA_API_TOKEN`**: Required only for the `issue_links` feature on Cloud. The Zephyr API key cannot authenticate against the Jira REST API, so a separate Jira credential is needed to resolve issue keys to numeric IDs. Without these, `issue_links` will fail with a 401 warning — the test case is still created successfully.

### Jira Data Center Configuration

| Variable | Required | Description |
|---|---|---|
| `ZEPHYR_BASE_URL` | ✅ | Your Jira server URL, e.g. `https://your-jira-server.com` |
| `ZEPHYR_API_KEY` | ✅ | Zephyr Scale API token from your Jira profile settings |
| `JIRA_TYPE` | Optional | Set to `"datacenter"` to override auto-detection |

### Automatic Detection
The server automatically detects your Jira type based on `ZEPHYR_BASE_URL` — URLs containing `.atlassian.net` are treated as Cloud, everything else as Data Center. Override with `JIRA_TYPE="cloud"` or `JIRA_TYPE="datacenter"`.

## License

MIT
