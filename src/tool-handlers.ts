import { AxiosInstance } from 'axios';
import axios from 'axios';
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
  ListExecutionsByCycleArgs,
  UpdateTestExecutionArgs,
  GetTestCyclesForIssueArgs,
  JiraConfig
} from './types.js';
import { convertToGherkin, resolveFolderIdByPath, getAccountIdFromApiKey } from './utils.js';

export class ZephyrToolHandlers {
  constructor(
    private axiosInstance: AxiosInstance,
    private jiraConfig: JiraConfig
  ) {}

  async getTestCase(args: any) {
    const { test_case_key } = args;
    try {
      const response = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`);
      const testCase = response.data;

      // Fetch the test script content and embed it inline.
      // The base GET /testcases/{key} only returns a link to the script, not the content.
      try {
        const scriptResponse = await this.axiosInstance.get(
          `${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}/testscript`
        );
        testCase.testScript = scriptResponse.data;
      } catch {
        // Script fetch failed (e.g. no script yet) — leave testScript as the link object
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(testCase, null, 2) }],
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
      objective, estimated_time, labels, custom_fields, issue_links,
      owner_id, component_id,
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
    // Default ownerId to the account ID embedded in the Zephyr API key JWT
    const resolvedOwner = owner_id ?? getAccountIdFromApiKey();
    if (resolvedOwner) payload.ownerId = resolvedOwner;
    if (component_id) payload.componentId = component_id;

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

      // Step 3: link Jira issues via POST /testcases/{key}/links/issues
      // IssueLinkInput requires a numeric issueId — resolve each key via Jira REST API
      const linkWarnings: string[] = [];
      if (issue_links && issue_links.length > 0) {
        for (const issueKey of issue_links) {
          try {
            const issueId = await this.resolveJiraIssueId(issueKey);
            await this.axiosInstance.post(
              `${this.jiraConfig.apiEndpoints.testcase}/${testKey}/links/issues`,
              { issueId }
            );
          } catch (e) {
            linkWarnings.push(`${issueKey}: ${this.formatError(e)}`);
          }
        }
      }

      const missingCreds = !process.env.JIRA_USERNAME || !process.env.JIRA_API_TOKEN;
      const credHint = missingCreds
        ? '\n💡 Tip: Set JIRA_USERNAME and JIRA_API_TOKEN env vars to enable issue linking on Cloud.'
        : '';
      const warningText = linkWarnings.length > 0
        ? `\n⚠️ Some issue links failed:\n${linkWarnings.map(w => `  - ${w}`).join('\n')}${credHint}`
        : '';

      return {
        content: [{
          type: 'text',
          text: `✅ Test case created successfully: ${testKey}\n${JSON.stringify({ key: testKey, type: test_script?.type || 'none', linkedIssues: (issue_links ?? []).length - linkWarnings.length }, null, 2)}${warningText}`,
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to create test case: ${this.formatError(error)}`);
    }
  }

  private async upsertTestScriptCloud(testKey: string, test_script: TestCaseArgs['test_script']) {
    if (!test_script) return;

    if (test_script.type === 'STEP_BY_STEP' && test_script.steps && test_script.steps.length > 0) {
      const items = test_script.steps.map((step: any) => {
        // If step is a call-to-test (testCaseKey), use the testCase variant
        if (step.testCaseKey) {
          return { testCase: { testCaseKey: step.testCaseKey } };
        }
        return {
          inline: {
            description: step.description || '',
            testData: step.testData || null,
            expectedResult: step.expectedResult || null,
          },
        };
      });
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

    const converted = convertToGherkin(bdd_content);
    const finalText = converted && converted.trim().length > 0 ? converted : bdd_content;

    // Fetch the test case first to get the numeric ID.
    // After a DC→Cloud migration, the project key prefix in the test case key (e.g. "CNIDS")
    // may no longer match an active Cloud project, causing key-based write endpoints to return 404.
    // Falling back to the numeric ID bypasses that project-key validation.
    let tc: any = null;
    try {
      const getResponse = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`);
      tc = getResponse.data;
    } catch {
      // GET failed — proceed with key only; write will surface the real error
    }

    try {
      // Primary path: POST to dedicated testscript endpoint using the key
      let scriptUpdateError: any = null;
      try {
        await this.axiosInstance.post(
          `${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}/testscript`,
          { type: 'bdd', text: finalText }
        );
      } catch (err: any) {
        scriptUpdateError = err;
      }

      // Fallback: if testscript POST failed (e.g. migrated project key), try PUT on the full
      // test case record with the testScript field embedded — some Cloud instances accept this
      // for migrated test cases where the project is deactivated.
      if (scriptUpdateError) {
        if (!tc) {
          throw scriptUpdateError; // no test case data to build PUT payload, surface original error
        }

        // Fetch the existing test script to get its ID — required for the PUT to update in place
        let existingScriptId: number | undefined;
        try {
          const scriptRes = await this.axiosInstance.get(
            `${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}/testscript`
          );
          existingScriptId = scriptRes.data?.id;
        } catch {
          // no existing script — proceed without id
        }

        const testScriptPayload: any = { type: 'bdd', text: finalText };
        if (existingScriptId) testScriptPayload.id = existingScriptId;

        const putPayload: any = {
          id: tc.id,
          key: test_case_key,
          name: (typeof name === 'string' && name.trim().length > 0) ? name : tc.name,
          status: tc.status,
          priority: tc.priority,
          project: tc.project,
          testScript: testScriptPayload,
        };
        for (const field of ['objective', 'precondition', 'estimatedTime', 'component', 'owner', 'folder']) {
          if (tc[field] !== undefined && tc[field] !== null) putPayload[field] = tc[field];
        }
        if (Array.isArray(tc.labels) && tc.labels.length > 0) putPayload.labels = tc.labels;
        if (tc.customFields && Object.keys(tc.customFields).length > 0) putPayload.customFields = tc.customFields;

        await this.axiosInstance.put(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`, putPayload);

        // Note: the Zephyr Scale Cloud API's UpdateTestCaseInput does not include a testScript field,
        // so the testScript embedded in the PUT payload is silently ignored.
        // The only endpoint that updates script content (POST /testscript) requires the project to be active.
        // For test cases migrated from Data Center to Cloud, the original project key may be deactivated,
        // blocking script updates at the API level. Contact your Zephyr Scale admin to re-enable the project.
        throw new McpError(
          ErrorCode.InternalError,
          `Cannot update test script for ${test_case_key}: the project "${test_case_key.replace(/-T\d+$/, '')}" is deactivated in Zephyr Scale Cloud. ` +
          `This test case was likely migrated from Data Center and retains its original project key prefix. ` +
          `POST /testcases/{key}/testscript requires an active project. ` +
          `Please ask your Zephyr Scale admin to re-enable the project, or recreate this test case under an active Cloud project.`
        );
      }

      // Primary path succeeded — optionally rename
      if (typeof name === 'string' && name.trim().length > 0) {
        if (!tc) {
          const getResponse = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`);
          tc = getResponse.data;
        }
        const putPayload: any = {
          id: tc.id,
          key: test_case_key,
          name,
          status: tc.status,
          priority: tc.priority,
          project: tc.project,
        };
        for (const field of ['objective', 'precondition', 'estimatedTime', 'component', 'owner', 'folder']) {
          if (tc[field] !== undefined && tc[field] !== null) putPayload[field] = tc[field];
        }
        if (Array.isArray(tc.labels) && tc.labels.length > 0) putPayload.labels = tc.labels;
        if (tc.customFields && Object.keys(tc.customFields).length > 0) putPayload.customFields = tc.customFields;
        await this.axiosInstance.put(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`, putPayload);
      }

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
    const cloudFolderType = folder_type;

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

  async updateTestRun(args: any) {
    const { test_run_key, owner, name, description, planned_start_date, planned_end_date, status_id } = args;

    if (this.jiraConfig.type !== 'cloud') {
      throw new McpError(ErrorCode.InvalidRequest, 'update_test_run is only supported on Zephyr Scale Cloud.');
    }

    try {
      // Fetch current cycle to preserve required fields
      const getResponse = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`);
      const current = getResponse.data;

      const payload: any = {
        id: current.id,
        key: test_run_key,
        name: name ?? current.name,
        project: current.project,
        status: status_id ? { id: status_id } : current.status,
      };

      if (description !== undefined) payload.description = description;
      else if (current.description) payload.description = current.description;

      if (planned_start_date !== undefined) payload.plannedStartDate = planned_start_date;
      else if (current.plannedStartDate) payload.plannedStartDate = current.plannedStartDate;

      if (planned_end_date !== undefined) payload.plannedEndDate = planned_end_date;
      else if (current.plannedEndDate) payload.plannedEndDate = current.plannedEndDate;

      if (owner !== undefined) payload.owner = { accountId: owner };
      else if (current.owner) payload.owner = current.owner;

      if (current.jiraProjectVersion) payload.jiraProjectVersion = current.jiraProjectVersion;
      if (current.folder) payload.folder = current.folder;
      if (current.customFields && Object.keys(current.customFields).length > 0) {
        payload.customFields = current.customFields;
      }

      await this.axiosInstance.put(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`, payload);

      // Resolve status name for the response
      const projectKey = test_run_key.replace(/-R\d+$/, '');
      const statusName = payload.status?.id
        ? await this.resolveStatusName(payload.status.id)
        : null;

      return {
        content: [{
          type: 'text',
          text: `✅ Updated test cycle ${test_run_key} successfully.\n${JSON.stringify({
            key: test_run_key,
            name: payload.name,
            owner: payload.owner ?? null,
            status: statusName ? { id: payload.status?.id, name: statusName } : payload.status,
          }, null, 2)}`,
        }],
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to update test run: ${this.formatError(error)}`);
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
      owner, environment, custom_fields, issue_links, issue_key,
      jira_project_version,
    } = args;

    // Cloud v2 TestCycleInput: projectKey, name, description, plannedStartDate,
    // plannedEndDate, statusName, folderId, ownerId, jiraProjectVersion, customFields
    // Note: environment is NOT a TestCycleInput field on Cloud — it belongs on TestExecutionInput
    const payload: any = { projectKey: project_key, name };

    if (description) payload.description = description;
    if (planned_start_date) payload.plannedStartDate = planned_start_date;
    if (planned_end_date) payload.plannedEndDate = planned_end_date;
    if (custom_fields) payload.customFields = custom_fields;
    // Default ownerId to the account ID embedded in the Zephyr API key JWT
    const resolvedOwner = owner ?? getAccountIdFromApiKey();
    if (resolvedOwner) payload.ownerId = resolvedOwner;
    // Link to a Jira project version/release (integer ID)
    if (jira_project_version) payload.jiraProjectVersion = jira_project_version;
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
          const execPayload: any = {
            projectKey: project_key,
            testCaseKey,
            testCycleKey: cycleKey,
            statusName: 'Not Executed',
          };
          // environment is set at execution level on Cloud, not cycle level
          if (environment) execPayload.environmentName = environment;
          await this.axiosInstance.post('/testexecutions', execPayload);
        }
      }

      // Step 3: link Jira issues via POST /testcycles/{key}/links/issues
      // Merge issue_key (single) and issue_links (array) into one list
      const allIssueLinks = [
        ...(issue_key ? [issue_key] : []),
        ...(issue_links ?? []),
      ];
      const linkWarnings: string[] = [];
      if (allIssueLinks.length > 0) {
        for (const ik of allIssueLinks) {
          try {
            const issueId = await this.resolveJiraIssueId(ik);
            await this.axiosInstance.post(
              `${this.jiraConfig.apiEndpoints.testrun}/${cycleKey}/links/issues`,
              { issueId }
            );
          } catch (e) {
            linkWarnings.push(`${ik}: ${this.formatError(e)}`);
          }
        }
      }

      const missingCreds = !process.env.JIRA_USERNAME || !process.env.JIRA_API_TOKEN;
      const credHint = missingCreds && linkWarnings.length > 0
        ? '\n💡 Tip: Set JIRA_USERNAME and JIRA_API_TOKEN env vars to enable issue linking on Cloud.'
        : '';
      const warningText = linkWarnings.length > 0
        ? `\n⚠️ Some issue links failed:\n${linkWarnings.map(w => `  - ${w}`).join('\n')}${credHint}`
        : '';

      return {
        content: [{
          type: 'text',
          text: `✅ Test run (cycle) created successfully: ${cycleKey}\n${JSON.stringify({
            key: cycleKey,
            name,
            testCaseCount: test_case_keys?.length || 0,
            linkedIssues: allIssueLinks.length - linkWarnings.length,
          }, null, 2)}${warningText}`,
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

  async getFolders(args: any) {
    const { project_key, folder_type, folder_path, max_results } = args;

    try {
      const pageSize = 1000;
      const allFolders: any[] = [];
      let startAt = 0;
      let isLast = false;

      while (!isLast) {
        const params: Record<string, any> = { maxResults: pageSize, startAt };
        if (project_key) params.projectKey = project_key;
        if (folder_type) params.folderType = folder_type;

        const response = await this.axiosInstance.get('/folders', { params });

        const page: any[] = Array.isArray(response.data)
          ? response.data
          : response.data?.values ?? [];

        allFolders.push(...page);

        isLast = response.data?.isLast === true || page.length < pageSize;
        startAt += page.length;

        if (max_results && allFolders.length >= max_results) break;
      }

      let results: any[];

      if (folder_path) {
        // Resolve the root folder ID from the path, then collect full subtree via BFS
        const rootId = await resolveFolderIdByPath(
          this.axiosInstance, project_key, folder_path, folder_type ?? 'TEST_CASE'
        );

        if (rootId === null) {
          return {
            content: [{
              type: 'text',
              text: `⚠️ Folder not found: "${folder_path}" in project ${project_key}.`,
            }],
          };
        }

        // BFS over the already-fetched flat list — no extra API calls
        const subtreeIds = new Set<number>([rootId]);
        const queue = [rootId];
        while (queue.length > 0) {
          const current = queue.shift()!;
          for (const f of allFolders) {
            if ((f.parentId ?? null) === current && !subtreeIds.has(f.id)) {
              subtreeIds.add(f.id);
              queue.push(f.id);
            }
          }
        }

        results = allFolders.filter(f => subtreeIds.has(f.id));
      } else {
        results = allFolders;
      }

      if (max_results) results = results.slice(0, max_results);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            totalCount: results.length,
            folders: results.map((f: any) => ({
              id: f.id,
              name: f.name,
              parentId: f.parentId ?? null,
              folderType: f.folderType,
            })),
          }, null, 2),
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get folders: ${this.formatError(error)}`);
    }
  }

  private async resolveStatusName(statusId: number): Promise<string | null> {
    try {
      const response = await this.axiosInstance.get(`/statuses/${statusId}`);
      return response.data?.name ?? null;
    } catch {
      return null;
    }
  }

  async getTestRun(args: any) {
    const { test_run_key } = args;
    try {
      const response = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`);
      const data = response.data;

      // Resolve status name — extract project key from the cycle key (e.g. DDCN-R377 → DDCN)
      if (data?.status?.id) {
        const statusName = await this.resolveStatusName(data.status.id);
        if (statusName) data.status.name = statusName;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
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

        // Paginate through all results — the API returns up to 1000 per page
        const pageSize = Math.min(max_results, 1000);
        const allTestCases: any[] = [];
        let startAt = 0;
        let isLast = false;

        while (!isLast && allTestCases.length < max_results) {
          const response = await this.axiosInstance.get(this.jiraConfig.apiEndpoints.testcase, {
            params: { projectKey: project_key, folderId, maxResults: pageSize, startAt },
          });

          const page = Array.isArray(response.data)
            ? response.data
            : response.data?.values ?? [];

          allTestCases.push(...page);

          // Stop if the API signals last page, or we got fewer results than requested
          isLast = response.data?.isLast === true || page.length < pageSize;
          startAt += page.length;

          // Safety: never exceed max_results
          if (allTestCases.length >= max_results) break;
        }

        const testCases = allTestCases.slice(0, max_results);

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
    const { project_key, folder, folder_id, max_results = 200, fields } = args;

    if (!project_key && !folder && !folder_id) {
      throw new McpError(ErrorCode.InvalidParams, 'At least one of project_key, folder, or folder_id must be provided.');
    }

    if (this.jiraConfig.type === 'cloud') {
      try {
        // Cloud v2: GET /testcycles?projectKey=X&folderId=Y
        const params: Record<string, any> = { maxResults: max_results };
        if (project_key) params.projectKey = project_key;

        // folder_id takes precedence over folder path
        if (folder_id) {
          params.folderId = folder_id;
        } else if (folder && project_key) {
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
                key: tr.key, name: tr.name, status: tr.status?.id, folder: tr.folder?.name,
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

  async listExecutionsByCycle(args: ListExecutionsByCycleArgs) {
    const { test_cycle_key, project_key, max_results = 100 } = args;

    if (this.jiraConfig.type === 'cloud') {
      try {
        // Cloud v2: GET /testexecutions?projectKey=X&testCycle=Y
        const params: Record<string, any> = {
          projectKey: project_key,
          testCycle: test_cycle_key,
          maxResults: max_results,
        };

        const response = await this.axiosInstance.get('/testexecutions', { params });

        const executions = Array.isArray(response.data)
          ? response.data
          : response.data?.values ?? [];

        const summary = executions.map((ex: any) => ({
          key: ex.key,
          testCaseKey: ex.testCase?.self?.match(/testcases\/(.+?)\/versions/)?.[1] || ex.testCase?.id,
          status: ex.testExecutionStatus?.id,
          statusName: ex.testExecutionStatus?.name,
          executedById: ex.executedById,
          assignedToId: ex.assignedToId,
          actualEndDate: ex.actualEndDate,
          automated: ex.automated,
          comment: ex.comment,
        }));

        // Count statuses
        const statusCounts: Record<string, number> = {};
        for (const ex of executions) {
          const statusId = ex.testExecutionStatus?.id?.toString() || 'unknown';
          statusCounts[statusId] = (statusCounts[statusId] || 0) + 1;
        }

        return {
          content: [{
            type: 'text',
            text: `✅ Found ${executions.length} execution(s) for cycle ${test_cycle_key}:\n${JSON.stringify({
              cycleKey: test_cycle_key,
              totalExecutions: executions.length,
              statusCounts,
              executions: summary,
            }, null, 2)}`,
          }],
        };
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to list executions: ${this.formatError(error)}`);
      }
    }

    // Data Center: GET /rest/atm/1.0/testrun/{key}/testresults
    try {
      const response = await this.axiosInstance.get(
        `${this.jiraConfig.apiEndpoints.testrun}/${test_cycle_key}/testresults`
      );

      const results = Array.isArray(response.data) ? response.data : [];

      return {
        content: [{
          type: 'text',
          text: `✅ Found ${results.length} execution(s) for cycle ${test_cycle_key}:\n${JSON.stringify({
            cycleKey: test_cycle_key,
            totalExecutions: results.length,
            executions: results.map((r: any) => ({
              id: r.id,
              testCaseKey: r.testCaseKey,
              status: r.status,
              executedBy: r.executedBy,
              executionDate: r.executionDate,
              automated: r.automated,
            })),
          }, null, 2)}`,
        }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to list executions: ${this.formatError(error)}`);
    }
  }

  async updateTestExecution(args: UpdateTestExecutionArgs) {
    if (this.jiraConfig.type !== 'cloud') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'update_test_execution is only supported on Zephyr Scale Cloud. The Data Center API (v1) uses a different test-result model.'
      );
    }

    const {
      execution_id, test_cycle_key, test_case_key, project_key,
      status, comment, environment, execution_time, actual_end_date,
      executed_by_id, assigned_to_id, bug_keys,
    } = args;

    // Resolve which execution to update: explicit execution_id wins, otherwise cycle + test case.
    let execKey = execution_id;
    if (!execKey) {
      if (!test_cycle_key || !test_case_key) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Provide either execution_id, or both test_cycle_key and test_case_key to identify the execution.'
        );
      }
      execKey = await this.resolveExecutionByCycleAndCase(test_cycle_key, test_case_key, project_key);
    }

    // Build the update payload — the PUT ignores null/undefined and only touches provided fields.
    const payload: any = {};
    if (status !== undefined) payload.statusName = status;
    if (comment !== undefined) payload.comment = comment;
    if (environment !== undefined) payload.environmentName = environment;
    if (execution_time !== undefined) payload.executionTime = execution_time;
    if (actual_end_date !== undefined) payload.actualEndDate = actual_end_date;
    if (executed_by_id !== undefined) payload.executedById = executed_by_id;
    if (assigned_to_id !== undefined) payload.assignedToId = assigned_to_id;

    const hasBugs = Array.isArray(bug_keys) && bug_keys.length > 0;
    if (Object.keys(payload).length === 0 && !hasBugs) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Nothing to update — provide at least one of: status, comment, environment, execution_time, actual_end_date, executed_by_id, assigned_to_id, or bug_keys.'
      );
    }

    try {
      if (Object.keys(payload).length > 0) {
        await this.axiosInstance.put(`/testexecutions/${execKey}`, payload);
      }

      // Attach bugs / Jira issues. IssueLinkInput requires a numeric issueId, so resolve each
      // key via the Jira REST API (needs JIRA_USERNAME + JIRA_API_TOKEN on Cloud), mirroring create_test_case.
      const linkWarnings: string[] = [];
      let linkedCount = 0;
      if (hasBugs) {
        for (const bugKey of bug_keys!) {
          try {
            const issueId = await this.resolveJiraIssueId(bugKey);
            await this.axiosInstance.post(`/testexecutions/${execKey}/links/issues`, { issueId });
            linkedCount++;
          } catch (e) {
            linkWarnings.push(`${bugKey}: ${this.formatError(e)}`);
          }
        }
      }

      const missingCreds = !process.env.JIRA_USERNAME || !process.env.JIRA_API_TOKEN;
      const credHint = missingCreds && linkWarnings.length > 0
        ? '\n💡 Tip: Set JIRA_USERNAME and JIRA_API_TOKEN env vars to enable bug/issue linking on Cloud.'
        : '';
      const warningText = linkWarnings.length > 0
        ? `\n⚠️ Some bug links failed:\n${linkWarnings.map(w => `  - ${w}`).join('\n')}${credHint}`
        : '';

      return {
        content: [{
          type: 'text',
          text: `✅ Updated test execution ${execKey} successfully.\n${JSON.stringify({
            executionKey: execKey,
            status: status ?? '(unchanged)',
            updatedFields: Object.keys(payload),
            linkedBugs: linkedCount,
          }, null, 2)}${warningText}`,
        }],
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to update test execution: ${this.formatError(error)}`);
    }
  }

  async getTestCyclesForIssue(args: GetTestCyclesForIssueArgs) {
    if (this.jiraConfig.type !== 'cloud') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'get_test_cycles_for_issue is only supported on Zephyr Scale Cloud. The Data Center API (v1) does not expose issue-link lookups.'
      );
    }

    const { issue_key, resolve_keys = true } = args;
    if (!issue_key) {
      throw new McpError(ErrorCode.InvalidParams, 'issue_key is required (e.g. "PROJ-123").');
    }

    try {
      // GET /issuelinks/{issueKey}/testcycles → TestCycleIdList: [{ id, self }, ...]
      const response = await this.axiosInstance.get(`/issuelinks/${issue_key}/testcycles`);
      const raw = Array.isArray(response.data)
        ? response.data
        : response.data?.values ?? [];

      const cycleIds: string[] = raw
        .map((c: any) => c.id ?? c.self?.match(/testcycles\/(\d+)/)?.[1])
        .filter((id: any) => id !== undefined && id !== null)
        .map((id: any) => String(id));

      // Optionally resolve each numeric cycle ID to its human-readable key + name.
      let cycles: any[];
      if (resolve_keys) {
        cycles = [];
        for (const id of cycleIds) {
          try {
            const cyc = await this.axiosInstance.get(`/testcycles/${id}`);
            cycles.push({ id, key: cyc.data?.key ?? null, name: cyc.data?.name ?? null });
          } catch (e) {
            cycles.push({ id, key: null, name: null, error: this.formatError(e) });
          }
        }
      } else {
        cycles = cycleIds.map((id) => ({ id }));
      }

      return {
        content: [{
          type: 'text',
          text: `✅ Found ${cycles.length} test cycle(s) linked to ${issue_key}:\n${JSON.stringify({
            issueKey: issue_key,
            totalCount: cycles.length,
            testCycles: cycles,
          }, null, 2)}`,
        }],
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to get test cycles for issue: ${this.formatError(error)}`);
    }
  }

  /** Find the latest execution key for a test case within a cycle (Cloud). */
  private async resolveExecutionByCycleAndCase(
    cycleKey: string, caseKey: string, projectKey?: string
  ): Promise<string> {
    const derivedProject = projectKey || cycleKey.split('-')[0];
    try {
      const response = await this.axiosInstance.get('/testexecutions', {
        params: {
          projectKey: derivedProject,
          testCycle: cycleKey,
          onlyLastExecutions: true,
          maxResults: 1000,
        },
      });

      const executions = Array.isArray(response.data)
        ? response.data
        : response.data?.values ?? [];

      const match = executions.find((ex: any) => {
        const key = ex.testCase?.self?.match(/testcases\/(.+?)\/versions/)?.[1]
          ?? ex.testCase?.key;
        return key === caseKey;
      });

      if (!match) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `No execution found for test case ${caseKey} in cycle ${cycleKey}. Ensure the test case is part of the cycle.`
        );
      }

      const execKey = match.key ?? (match.id !== undefined ? String(match.id) : undefined);
      if (!execKey) {
        throw new McpError(
          ErrorCode.InternalError,
          `Found a matching execution for ${caseKey} in ${cycleKey} but it has no key or id.`
        );
      }
      return execKey;
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Failed to resolve execution for ${caseKey} in ${cycleKey}: ${this.formatError(error)}`);
    }
  }

  private async resolveJiraIssueId(issueKey: string): Promise<number> {
    // The Zephyr API key is NOT valid for the Jira REST API — Jira Cloud requires
    // Basic Auth: base64(email:api_token) via JIRA_USERNAME + JIRA_API_TOKEN env vars.
    const username = process.env.JIRA_USERNAME;
    const apiToken = process.env.JIRA_API_TOKEN;

    const url = `${this.jiraConfig.jiraBaseUrl}/rest/api/3/issue/${issueKey}?fields=id`;

    let response;
    if (username && apiToken) {
      // Jira Cloud Basic Auth
      response = await axios.get(url, {
        headers: { 'Accept': 'application/json' },
        auth: { username, password: apiToken },
      });
    } else {
      // Fallback: try Bearer token (works for Data Center with PAT)
      response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.ZEPHYR_API_KEY}`,
        },
      });
    }

    const id = parseInt(response.data.id, 10);
    if (!id || isNaN(id)) {
      throw new Error(`Could not resolve numeric ID for Jira issue "${issueKey}"`);
    }
    return id;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && 'response' in error) {
      const axiosError = error as any;
      return `Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
