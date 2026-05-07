import { AxiosInstance } from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TestCaseArgs,
  UpdateBddArgs,
  FolderArgs,
  TestRunArgs,
  SearchTestCasesArgs,
  AddTestCasesToRunArgs,
  SearchTestRunsArgs,
  GetTestExecutionArgs,
  JiraConfig
} from './types.js';
import { convertToGherkin, resolveFolderIdByPath } from './utils.js';

export class ZephyrToolHandlers {
  constructor(
    private axiosInstance: AxiosInstance,
    private jiraConfig: JiraConfig
  ) {}

  async getTestCase(args: any) {
    const { test_case_key } = args;
    try {
      const response = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get test case: ${this.formatError(error)}`);
    }
  }

  async createTestCase(args: TestCaseArgs) {
    // Some MCP clients (e.g. Claude Code) pass nested object parameters as JSON strings.
    // Parse test_script if it arrived as a string.
    if (typeof (args as any).test_script === 'string') {
      try { (args as any).test_script = JSON.parse((args as any).test_script); } catch {}
    }
    if (this.jiraConfig.type === 'cloud') {
      return this.createTestCaseCloud(args);
    }
    return this.createTestCaseDC(args);
  }

  private async createTestCaseCloud(args: TestCaseArgs) {
    const {
      project_key, name, test_script, folder, priority, precondition,
      objective, estimated_time, labels, custom_fields,
    } = args;

    const payload: any = { projectKey: project_key, name };
    // Cloud v2 uses statusName/priorityName (strings), folderId (integer)
    payload.statusName = 'Draft';
    if (priority) payload.priorityName = priority;
    if (precondition) payload.precondition = precondition;
    if (objective) payload.objective = objective;
    if (estimated_time) payload.estimatedTime = estimated_time;
    if (labels && labels.length > 0) payload.labels = labels;
    if (custom_fields) payload.customFields = custom_fields;

    // Resolve folder path → folderId
    if (folder) {
      const folderId = await resolveFolderIdByPath(
        this.axiosInstance, project_key, folder, 'TEST_CASE'
      );
      if (folderId !== null) payload.folderId = folderId;
    }

    try {
      const response = await this.axiosInstance.post(this.jiraConfig.apiEndpoints.testcase, payload);
      if (response.status !== 201) {
        throw new Error(`Unexpected status code: ${response.status}`);
      }
      const testKey = response.data.key || 'Unknown';

      // Step 2: add test script via dedicated endpoint
      if (test_script) {
        await this.upsertTestScriptCloud(testKey, test_script);
      }

      return {
        content: [{
          type: 'text',
          text: `✅ Test case created successfully: ${testKey}\n${JSON.stringify({ key: testKey, type: test_script?.type || 'none' }, null, 2)}`,
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to create test case: ${this.formatError(error)}`);
    }
  }

  private async upsertTestScriptCloud(testKey: string, test_script: TestCaseArgs['test_script']) {
    if (!test_script) return;

    if (test_script.type === 'STEP_BY_STEP' && test_script.steps && test_script.steps.length > 0) {
      const items = test_script.steps.map((step: any) => ({
        inline: {
          description: step.description || '',
          testData: step.testData || null,
          expectedResult: step.expectedResult || null,
        },
      }));
      await this.axiosInstance.post(
        `${this.jiraConfig.apiEndpoints.testcase}/${testKey}/teststeps`,
        { mode: 'OVERWRITE', items }
      );
    } else if (test_script.type === 'BDD' && test_script.text) {
      const gherkin = convertToGherkin(test_script.text) || test_script.text;
      await this.axiosInstance.post(
        `${this.jiraConfig.apiEndpoints.testcase}/${testKey}/testscript`,
        { type: 'bdd', text: gherkin }
      );
    } else if (test_script.type === 'PLAIN_TEXT' && test_script.text) {
      await this.axiosInstance.post(
        `${this.jiraConfig.apiEndpoints.testcase}/${testKey}/testscript`,
        { type: 'plain', text: test_script.text }
      );
    }
  }

  private async createTestCaseDC(args: TestCaseArgs) {
    const {
      project_key, name, test_script, folder, status, priority, precondition,
      objective, component, owner, estimated_time, labels, issue_links,
      custom_fields, parameters
    } = args;

    const payload: any = { projectKey: project_key, name };

    if (folder) payload.folder = folder;
    if (status) payload.status = status;
    if (priority) payload.priority = priority;
    if (precondition) payload.precondition = precondition;
    if (objective) payload.objective = objective;
    if (component) payload.component = component;
    if (owner) payload.owner = owner;
    if (estimated_time) payload.estimatedTime = estimated_time;
    if (labels && labels.length > 0) payload.labels = labels;
    if (issue_links && issue_links.length > 0) payload.issueLinks = issue_links;
    if (custom_fields) payload.customFields = custom_fields;
    if (parameters) payload.parameters = parameters;

    if (test_script) {
      payload.testScript = { type: test_script.type };
      if (test_script.type === 'STEP_BY_STEP' && test_script.steps) {
        payload.testScript.steps = test_script.steps.map((step: any) => {
          const s: any = {};
          if (step.description) s.description = step.description;
          if (step.testData) s.testData = step.testData;
          if (step.expectedResult) s.expectedResult = step.expectedResult;
          if (step.testCaseKey) s.testCaseKey = step.testCaseKey;
          return s;
        });
      } else if ((test_script.type === 'PLAIN_TEXT' || test_script.type === 'BDD') && test_script.text) {
        if (test_script.type === 'BDD') {
          const gherkin = convertToGherkin(test_script.text);
          payload.testScript.text = gherkin || test_script.text;
        } else {
          payload.testScript.text = test_script.text;
        }
      }
    }

    // Always Draft for new test cases
    payload.status = 'Draft';

    try {
      const response = await this.axiosInstance.post(this.jiraConfig.apiEndpoints.testcase, payload);
      if (response.status !== 201) throw new Error(`Unexpected status code: ${response.status}`);
      const testKey = response.data.key || 'Unknown';
      return {
        content: [{
          type: 'text',
          text: `✅ Test case created successfully: ${testKey}\n${JSON.stringify({ key: testKey, type: test_script?.type || 'none' }, null, 2)}`,
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to create test case: ${this.formatError(error)}`);
    }
  }

  async updateTestCaseBdd(args: UpdateBddArgs) {
    if (this.jiraConfig.type === 'cloud') {
      return this.updateTestCaseBddCloud(args);
    }
    return this.updateTestCaseBddDC(args);
  }

  private async updateTestCaseBddCloud(args: UpdateBddArgs) {
    const { test_case_key, bdd_content, name } = args;

    try {
      // Step 1: GET existing test case to extract required fields for PUT
      const getResponse = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`);
      const tc = getResponse.data;

      // Cloud v2 PUT requires: id, key, name, project, priority, status
      const requiredFields = ['id', 'key', 'name', 'project', 'priority', 'status'];
      for (const field of requiredFields) {
        if (tc[field] === undefined || tc[field] === null) {
          throw new McpError(ErrorCode.InternalError,
            `Existing test case is missing required field '${field}' needed for Cloud v2 update.`);
        }
      }

      const putPayload: any = {
        id: tc.id,
        key: tc.key,
        name: typeof name === 'string' && name.trim().length > 0 ? name : tc.name,
        project: tc.project,
        priority: tc.priority,
        status: tc.status,
      };

      // Preserve optional fields
      for (const field of ['objective', 'precondition', 'estimatedTime', 'folder', 'component', 'owner']) {
        if (tc[field] !== undefined) putPayload[field] = tc[field];
      }
      if (Array.isArray(tc.labels)) putPayload.labels = tc.labels;
      if (tc.customFields) putPayload.customFields = tc.customFields;

      // Step 2: PUT to update metadata
      await this.axiosInstance.put(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`, putPayload);

      // Step 3: POST testscript with BDD content
      const converted = convertToGherkin(bdd_content);
      const finalText = converted && converted.trim().length > 0 ? converted : bdd_content;
      await this.axiosInstance.post(
        `${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}/testscript`,
        { type: 'bdd', text: finalText }
      );

      return {
        content: [{
          type: 'text',
          text: `✅ Updated ${test_case_key} with BDD content successfully (Cloud v2)`,
        }],
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to update test case BDD: ${this.formatError(error)}`);
    }
  }

  private async updateTestCaseBddDC(args: UpdateBddArgs) {
    const { test_case_key, bdd_content, name } = args;

    try {
      const getResponse = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`);
      const testCaseData = getResponse.data;

      const converted = convertToGherkin(bdd_content);
      const finalText = converted && converted.trim().length > 0 ? converted : bdd_content;

      const payload: any = {};
      const projectKey = testCaseData.projectKey ?? test_case_key.replace(/-T\d+$/, '');
      const requiredFields: Array<[string, any]> = [
        ['projectKey', projectKey],
        ['name', testCaseData.name],
        ['status', testCaseData.status],
        ['priority', testCaseData.priority]
      ];
      for (const [field, value] of requiredFields) {
        if (value === undefined || value === null || value === '') {
          throw new McpError(ErrorCode.InternalError,
            `Existing test case is missing required field '${field}' needed for update.`);
        }
        payload[field] = value;
      }

      if (typeof name === 'string' && name.trim().length > 0) payload.name = name;

      for (const field of ['objective', 'precondition', 'folder', 'component', 'owner', 'estimatedTime']) {
        if (testCaseData[field] !== undefined) payload[field] = testCaseData[field];
      }
      if (Array.isArray(testCaseData.labels)) payload.labels = testCaseData.labels;
      if (testCaseData.customFields) payload.customFields = testCaseData.customFields;
      if (testCaseData.parameters) payload.parameters = testCaseData.parameters;
      if (Array.isArray(testCaseData.issueLinks)) {
        payload.issueLinks = testCaseData.issueLinks;
      } else if (testCaseData.issueKey) {
        payload.issueLinks = [testCaseData.issueKey];
      }

      payload.testScript = { type: 'BDD', text: finalText };

      const updateResponse = await this.axiosInstance.put(
        `${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`, payload
      );

      if (updateResponse.status !== 200) {
        throw new Error(`Failed to update ${test_case_key}: ${updateResponse.status}`);
      }

      return {
        content: [{
          type: 'text',
          text: `✅ Updated ${test_case_key} with BDD content successfully\nPayload summary: ${JSON.stringify({ textLength: finalText.length, projectKey: payload.projectKey, name: payload.name, preservedLabels: payload.labels?.length || 0 }, null, 2)}`,
        }],
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to update test case BDD: ${this.formatError(error)}`);
    }
  }

  async createFolder(args: FolderArgs) {
    if (this.jiraConfig.type === 'cloud') {
      return this.createFolderCloud(args);
    }
    return this.createFolderDC(args);
  }

  private async createFolderCloud(args: FolderArgs) {
    const { project_key, name: folderPath, folder_type = 'TEST_CASE' } = args;

    // Cloud v2 uses folderType (not type) and parentId integer
    // Map TEST_RUN → TEST_CYCLE for Cloud v2
    const cloudFolderType = folder_type === 'TEST_RUN' ? 'TEST_CYCLE' : folder_type;

    const segments = folderPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (segments.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'folder name/path cannot be empty');
    }

    const leafName = segments[segments.length - 1];
    let parentId: number | null = null;

    // Resolve parent if nested path
    if (segments.length > 1) {
      const parentPath = '/' + segments.slice(0, -1).join('/');
      parentId = await resolveFolderIdByPath(
        this.axiosInstance, project_key, parentPath, cloudFolderType
      );
      if (parentId === null) {
        throw new McpError(ErrorCode.InternalError,
          `Parent folder not found for path: ${parentPath}. Create parent folders first.`);
      }
    }

    const payload: any = {
      projectKey: project_key,
      name: leafName,
      folderType: cloudFolderType,
    };
    if (parentId !== null) payload.parentId = parentId;

    try {
      const response = await this.axiosInstance.post(this.jiraConfig.apiEndpoints.folder, payload);
      if (response.status === 201 || response.status === 200) {
        return {
          content: [{
            type: 'text',
            text: `✅ Folder created successfully: ${leafName} (ID: ${response.data.id || 'N/A'})\n${JSON.stringify(response.data, null, 2)}`,
          }],
        };
      }
      throw new Error(`Unexpected status code: ${response.status}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to create folder: ${this.formatError(error)}`);
    }
  }

  private async createFolderDC(args: FolderArgs) {
    const { project_key, name, folder_type = 'TEST_CASE' } = args;

    const payload: any = {
      projectKey: project_key,
      name: name,
      type: folder_type
    };

    try {
      const response = await this.axiosInstance.post(this.jiraConfig.apiEndpoints.folder, payload);
      if (response.status === 201 || response.status === 200) {
        return {
          content: [{
            type: 'text',
            text: `✅ Folder created successfully: ${response.data.name || name} (ID: ${response.data.id || 'N/A'})\n${JSON.stringify(response.data, null, 2)}`,
          }],
        };
      }
      throw new Error(`Unexpected status code: ${response.status}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to create folder: ${this.formatError(error)}`);
    }
  }

  async getTestRunCases(args: any) {
    const { test_run_key } = args;

    if (this.jiraConfig.type === 'cloud') {
      try {
        // Cloud: test cases are retrieved via executions associated with the cycle
        const response = await this.axiosInstance.get('/testexecutions', {
          params: { testCycle: test_run_key, maxResults: 1000 },
        });

        const executions = Array.isArray(response.data)
          ? response.data
          : response.data?.values ?? [];

        // Deduplicate by test case key
        const seen = new Set<string>();
        const testCaseKeys: string[] = [];
        for (const exec of executions) {
          const key = exec.testCase?.key
            ?? exec.testCase?.self?.match(/testcases\/([^/]+)/)?.[1];
          if (key && !seen.has(key)) {
            seen.add(key);
            testCaseKeys.push(key);
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(testCaseKeys, null, 2) }],
        };
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to get test run cases: ${this.formatError(error)}`);
      }
    }

    // Data Center: items[] in the run response
    try {
      const response = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`);
      const testCases = response.data.items?.map((item: any) => item.testCaseKey) || [];
      return {
        content: [{ type: 'text', text: JSON.stringify(testCases, null, 2) }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get test run cases: ${this.formatError(error)}`);
    }
  }

  async deleteTestCase(args: any) {
    if (this.jiraConfig.type === 'cloud') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'delete_test_case is not supported by the Zephyr Scale Cloud v2 API.'
      );
    }

    const { test_case_key } = args;
    try {
      const response = await this.axiosInstance.delete(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`);
      if (response.status === 204) {
        return { content: [{ type: 'text', text: `Test case ${test_case_key} deleted successfully.` }] };
      }
      return {
        content: [{ type: 'text', text: `Failed to delete test case. Status: ${response.status}` }],
        isError: true,
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to delete test case: ${this.formatError(error)}`);
    }
  }

  async deleteTestRun(args: any) {
    if (this.jiraConfig.type === 'cloud') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'delete_test_run is not supported by the Zephyr Scale Cloud v2 API.'
      );
    }

    const { test_run_key } = args;
    try {
      const response = await this.axiosInstance.delete(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`);
      if (response.status === 204) {
        return { content: [{ type: 'text', text: `Test run ${test_run_key} deleted successfully.` }] };
      }
      return {
        content: [{ type: 'text', text: `Failed to delete test run. Status: ${response.status}` }],
        isError: true,
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to delete test run: ${this.formatError(error)}`);
    }
  }

  async createTestRun(args: TestRunArgs) {
    if (this.jiraConfig.type === 'cloud') {
      return this.createTestRunCloud(args);
    }
    return this.createTestRunDC(args);
  }

  private async createTestRunCloud(args: TestRunArgs) {
    const {
      project_key, name, test_case_keys, folder,
      planned_start_date, planned_end_date, description,
      owner, environment, custom_fields,
    } = args;

    // Cloud v2 TestCycleInput: projectKey, name, description, plannedStartDate,
    // plannedEndDate, statusName, folderId, ownerId, customFields
    const payload: any = { projectKey: project_key, name };

    if (description) payload.description = description;
    if (planned_start_date) payload.plannedStartDate = planned_start_date;
    if (planned_end_date) payload.plannedEndDate = planned_end_date;
    if (custom_fields) payload.customFields = custom_fields;

    // Resolve folder path → folderId
    if (folder) {
      const folderId = await resolveFolderIdByPath(
        this.axiosInstance, project_key, folder, 'TEST_CYCLE'
      );
      if (folderId !== null) payload.folderId = folderId;
    }

    // Note: environment and owner (by account ID) not mapped here — Cloud requires IDs

    try {
      const response = await this.axiosInstance.post(this.jiraConfig.apiEndpoints.testrun, payload);
      if (response.status !== 201) throw new Error(`Unexpected status code: ${response.status}`);

      const cycleKey = response.data.key || 'Unknown';

      // Step 2: add test cases via test executions (Cloud v2 has no /testcycles/{key}/testcases)
      if (test_case_keys && test_case_keys.length > 0) {
        for (const testCaseKey of test_case_keys) {
          await this.axiosInstance.post('/testexecutions', {
            projectKey: project_key,
            testCaseKey,
            testCycleKey: cycleKey,
            statusName: 'Not Executed',
          });
        }
      }

      return {
        content: [{
          type: 'text',
          text: `✅ Test run (cycle) created successfully: ${cycleKey}\n${JSON.stringify({
            key: cycleKey,
            name,
            testCaseCount: test_case_keys?.length || 0,
          }, null, 2)}`,
        }],
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to create test run: ${this.formatError(error)}`);
    }
  }

  private async createTestRunDC(args: TestRunArgs) {
    const {
      project_key, name, test_case_keys, test_plan_key, folder,
      planned_start_date, planned_end_date, description,
      owner, environment, issue_key, issue_links, custom_fields
    } = args;

    const payload: any = { projectKey: project_key, name };

    if (test_case_keys && test_case_keys.length > 0) {
      payload.items = test_case_keys.map((testCaseKey: string) => ({ testCaseKey }));
    }
    if (folder) payload.folder = folder;
    if (planned_start_date) payload.plannedStartDate = planned_start_date;
    if (planned_end_date) payload.plannedEndDate = planned_end_date;
    if (description) payload.description = description;
    if (owner) payload.owner = owner;
    if (environment) payload.environment = environment;
    if (issue_key) payload.issueKey = issue_key;
    if (issue_links && issue_links.length > 0) payload.issueLinks = issue_links;
    if (custom_fields) payload.customFields = custom_fields;
    if (test_plan_key) payload.testPlanKey = test_plan_key;

    try {
      const response = await this.axiosInstance.post(this.jiraConfig.apiEndpoints.testrun, payload);
      if (response.status !== 201) throw new Error(`Unexpected status code: ${response.status}`);
      const testRunKey = response.data.key || 'Unknown';
      return {
        content: [{
          type: 'text',
          text: `✅ Test run created successfully: ${testRunKey}\n${JSON.stringify({
            key: testRunKey, name, testCaseCount: test_case_keys?.length || 0,
            environment: environment || 'Not specified'
          }, null, 2)}`,
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to create test run: ${this.formatError(error)}`);
    }
  }

  async getTestRun(args: any) {
    const { test_run_key } = args;
    // Both Cloud (/testcycles/{key}) and DC (/rest/atm/1.0/testrun/{key}) handled
    // via apiEndpoints.testrun which now correctly maps to /testcycles for Cloud
    try {
      const response = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get test run: ${this.formatError(error)}`);
    }
  }

  async getTestExecution(args: GetTestExecutionArgs) {
    const { execution_id, test_run_keys } = args;

    if (this.jiraConfig.type === 'cloud') {
      // Cloud v2: direct fetch by ID or key (e.g. PROJ-E123)
      try {
        const response = await this.axiosInstance.get(`/testexecutions/${execution_id}`);
        return {
          content: [{
            type: 'text',
            text: `✅ Test execution ${execution_id} found:\n${JSON.stringify(response.data, null, 2)}`,
          }],
        };
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to get test execution: ${this.formatError(error)}`);
      }
    }

    // Data Center: iterate test runs searching testresults
    if (!test_run_keys || !Array.isArray(test_run_keys) || test_run_keys.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'test_run_keys is required for Data Center. Provide an array of test run keys to search in.'
      );
    }

    try {
      const searchResults: any[] = [];

      for (const testRunKey of test_run_keys) {
        try {
          const response = await this.axiosInstance.get(
            `${this.jiraConfig.apiEndpoints.testrun}/${testRunKey}/testresults`
          );

          if (response.status === 200 && response.data) {
            const results = Array.isArray(response.data) ? response.data : [response.data];
            const match = results.find((r: any) => r.id && r.id.toString() === execution_id);
            if (match) {
              return {
                content: [{
                  type: 'text',
                  text: `✅ Test execution ${execution_id} found in ${testRunKey}:\n${JSON.stringify(match, null, 2)}`,
                }],
              };
            }
            searchResults.push({ testRunKey, executionCount: results.length, executionIds: results.map((r: any) => r.id).slice(0, 5) });
          }
        } catch (runError) {
          searchResults.push({ testRunKey, error: runError instanceof Error ? runError.message : String(runError) });
        }
      }

      throw new Error(`Test execution ${execution_id} not found in any of the ${test_run_keys.length} test runs. Search results: ${JSON.stringify(searchResults, null, 2)}`);
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to get test execution: ${this.formatError(error)}`);
    }
  }

  async searchTestCasesByFolder(args: SearchTestCasesArgs) {
    const { project_key, folder_path, max_results = 100 } = args;

    if (this.jiraConfig.type === 'cloud') {
      try {
        // Cloud v2: GET /testcases?projectKey=X&folderId=Y
        const folderId = await resolveFolderIdByPath(
          this.axiosInstance, project_key, folder_path, 'TEST_CASE'
        );

        if (folderId === null) {
          return {
            content: [{
              type: 'text',
              text: `⚠️ Folder not found: "${folder_path}" in project ${project_key}. No test cases returned.`,
            }],
          };
        }

        const response = await this.axiosInstance.get(this.jiraConfig.apiEndpoints.testcase, {
          params: { projectKey: project_key, folderId, maxResults: max_results },
        });

        const testCases = Array.isArray(response.data)
          ? response.data
          : response.data?.values ?? [];

        return {
          content: [{
            type: 'text',
            text: `✅ Found ${testCases.length} test cases in folder "${folder_path}" (folderId: ${folderId}):\n${JSON.stringify({
              folder: folder_path, folderId, testCaseKeys: testCases.map((tc: any) => tc.key), totalCount: testCases.length,
            }, null, 2)}`,
          }],
        };
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to search test cases by folder: ${this.formatError(error)}`);
      }
    }

    // Data Center: query-based search
    try {
      const escapedFolderPath = folder_path.replace(/"/g, '\\"');
      const query = `projectKey = "${project_key}" AND folder = "${escapedFolderPath}"`;
      const response = await this.axiosInstance.get(this.jiraConfig.apiEndpoints.search, {
        params: { query, maxResults: max_results },
      });

      let testCases = [];
      if (Array.isArray(response.data)) {
        testCases = response.data;
      } else if (response.data.values && Array.isArray(response.data.values)) {
        testCases = response.data.values;
      } else if (response.data.results && Array.isArray(response.data.results)) {
        testCases = response.data.results;
      }

      return {
        content: [{
          type: 'text',
          text: `✅ Found ${testCases.length} test cases in folder "${folder_path}":\n${JSON.stringify({
            folder: folder_path, query, testCaseKeys: testCases.map((tc: any) => tc.key), totalCount: testCases.length,
          }, null, 2)}`,
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to search test cases by folder: ${this.formatError(error)}`);
    }
  }

  async searchTestRuns(args: SearchTestRunsArgs) {
    const { project_key, folder, max_results = 200, fields } = args;

    if (!project_key && !folder) {
      throw new McpError(ErrorCode.InvalidParams, 'At least one of project_key or folder must be provided.');
    }

    if (this.jiraConfig.type === 'cloud') {
      try {
        // Cloud v2: GET /testcycles?projectKey=X&folderId=Y
        const params: Record<string, any> = { maxResults: max_results };
        if (project_key) params.projectKey = project_key;

        if (folder && project_key) {
          const folderId = await resolveFolderIdByPath(
            this.axiosInstance, project_key, folder, 'TEST_CYCLE'
          );
          if (folderId !== null) params.folderId = folderId;
        }

        const response = await this.axiosInstance.get(this.jiraConfig.apiEndpoints.testrun, { params });

        const testRuns = Array.isArray(response.data)
          ? response.data
          : response.data?.values ?? [];

        return {
          content: [{
            type: 'text',
            text: `✅ Found ${testRuns.length} test run(s):\n${JSON.stringify({
              totalCount: testRuns.length,
              testRuns: testRuns.map((tr: any) => ({
                key: tr.key, name: tr.name, status: tr.status?.name, folder: tr.folder?.name,
              })),
            }, null, 2)}`,
          }],
        };
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to search test runs: ${this.formatError(error)}`);
      }
    }

    // Data Center: query-based search
    try {
      const queryParts: string[] = [];
      if (project_key) queryParts.push(`projectKey = "${project_key}"`);
      if (folder) queryParts.push(`folder = "${folder}"`);
      const query = queryParts.join(' AND ');

      const searchEndpoint = '/rest/atm/1.0/testrun/search';
      const params: Record<string, any> = { query, maxResults: max_results };
      if (fields) params.fields = fields;

      const response = await this.axiosInstance.get(searchEndpoint, { params });

      let testRuns: any[] = [];
      if (Array.isArray(response.data)) {
        testRuns = response.data;
      } else if (response.data.values && Array.isArray(response.data.values)) {
        testRuns = response.data.values;
      } else if (response.data.results && Array.isArray(response.data.results)) {
        testRuns = response.data.results;
      }

      return {
        content: [{
          type: 'text',
          text: `✅ Found ${testRuns.length} test run(s) matching query "${query}":\n${JSON.stringify({
            query, totalCount: testRuns.length,
            testRuns: testRuns.map((tr: any) => ({
              key: tr.key, name: tr.name, status: tr.status, folder: tr.folder,
              testCaseCount: tr.testCaseCount, issueKey: tr.issueKey,
            })),
          }, null, 2)}`,
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to search test runs: ${this.formatError(error)}`);
    }
  }

  async addTestCasesToRun(args: AddTestCasesToRunArgs) {
    if (this.jiraConfig.type === 'datacenter') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'add_test_cases_to_run is only supported on Zephyr Scale Cloud. The Data Center API (v1) does not provide an endpoint to modify test runs after creation.'
      );
    }

    const { test_run_key, test_case_keys } = args;

    // Derive project key from the test run key (e.g. PROJ-R123 → PROJ)
    const project_key = test_run_key.split('-')[0];

    try {
      for (const testCaseKey of test_case_keys) {
        await this.axiosInstance.post('/testexecutions', {
          projectKey: project_key,
          testCaseKey,
          testCycleKey: test_run_key,
          statusName: 'Not Executed',
        });
      }
      return {
        content: [{ type: 'text', text: `Added ${test_case_keys.length} test case(s) to test run ${test_run_key}.` }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to add test cases: ${this.formatError(error)}`);
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && 'response' in error) {
      const axiosError = error as any;
      return `Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
