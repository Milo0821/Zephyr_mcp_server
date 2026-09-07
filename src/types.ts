export interface TestStep {
  description?: string;
  testData?: string;
  expectedResult?: string;
  testCaseKey?: string;
}

export interface TestScript {
  type: 'STEP_BY_STEP' | 'PLAIN_TEXT' | 'BDD';
  steps?: TestStep[];
  text?: string;
}

export interface TestParameter {
  name: string;
  type: 'FREE_TEXT' | 'DATA_SET';
  dataSet?: string;
}

export interface TestParameters {
  variables: TestParameter[];
  entries: Record<string, any>[];
}

export interface TestCaseArgs {
  project_key: string;
  name: string;
  test_script?: TestScript;
  folder?: string;
  status?: 'Draft' | 'Approved' | 'Deprecated';
  priority?: 'High' | 'Normal' | 'Low';
  precondition?: string;
  objective?: string;
  component?: string;       // Data Center: component name
  owner?: string;           // Data Center: owner name
  component_id?: number;    // Cloud: Jira component ID (integer)
  owner_id?: string;        // Cloud: Jira Account ID
  estimated_time?: number;
  labels?: string[];
  issue_links?: string[];
  custom_fields?: Record<string, any>;
  parameters?: TestParameters;
}

export interface UpdateBddArgs {
  test_case_key: string;
  bdd_content: string;
  name?: string;
}

export interface FolderArgs {
  project_key: string;
  name: string; // Full folder path including parent folders (e.g., "/folder/subfolder")
  folder_type?: 'TEST_CASE' | 'TEST_PLAN' | 'TEST_CYCLE';
}

export interface TestRunArgs {
  project_key: string;
  name: string;
  test_case_keys?: string[];
  test_plan_key?: string;
  folder?: string;
  planned_start_date?: string;
  planned_end_date?: string;
  description?: string;
  owner?: string;
  environment?: string;        // Cloud: mapped to environmentName on each TestExecutionInput; DC: cycle-level field
  jira_project_version?: number; // Cloud only: Jira project version/release ID (integer)
  issue_key?: string;
  issue_links?: string[];
  custom_fields?: Record<string, any>;
}

export interface SearchTestCasesArgs {
  project_key: string;
  folder_path: string;
  max_results?: number;
}

export interface AddTestCasesToRunArgs {
  test_run_key: string;
  test_case_keys: string[];
}

export interface GetTestExecutionArgs {
  execution_id: string;
  /** Required for Data Center. Optional for Cloud (direct fetch by ID/key). */
  test_run_keys?: string[];
}

export interface SearchTestRunsArgs {
  project_key?: string;
  folder?: string;
  folder_id?: number;
  max_results?: number;
  fields?: string;
}

export interface ListExecutionsByCycleArgs {
  test_cycle_key: string;
  project_key: string;
  max_results?: number;
}

export interface UpdateTestExecutionArgs {
  /** Direct execution key/ID (e.g. "PROJ-E123" or 5805255). Takes precedence over cycle+case lookup. */
  execution_id?: string;
  /** Test cycle key (e.g. "PROJ-R123") — used with test_case_key to locate the execution. */
  test_cycle_key?: string;
  /** Test case key (e.g. "PROJ-T456") — used with test_cycle_key to locate the execution. */
  test_case_key?: string;
  /** Project key for the cycle lookup. Derived from test_cycle_key when omitted. */
  project_key?: string;
  /** New execution status name (e.g. "Pass", "Fail", "In Progress", "Blocked", "Not Executed"). */
  status?: string;
  comment?: string;
  environment?: string;
  execution_time?: number;
  actual_end_date?: string;
  executed_by_id?: string;
  assigned_to_id?: string;
  /** Jira issue keys to link to the execution as bugs (e.g. ["PROJ-789"]). Resolved to numeric IDs via the Jira REST API. */
  bug_keys?: string[];
}

export interface GetTestCyclesForIssueArgs {
  /** Jira issue key whose linked test cycles to fetch (e.g. "PROJ-123"). */
  issue_key: string;
  /** When true (default), resolve each cycle ID to its key + name via GET /testcycles/{id}. */
  resolve_keys?: boolean;
}

export type JiraType = 'cloud' | 'datacenter';

export interface ApiEndpoints {
  testcase: string;
  testrun: string;
  folder: string;
  search: string;
}

export interface JiraConfig {
  type: JiraType;
  baseUrl: string;
  jiraBaseUrl: string;
  authHeaders: Record<string, string>;
  apiEndpoints: ApiEndpoints;
}