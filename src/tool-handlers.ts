import { AxiosInstance } from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  TestCaseArgs,
  UpdateBddArgs,
  FolderArgs,
  TestRunArgs,
  SearchTestCasesArgs,
  AddTestCasesToRunArgs,
  JiraConfig
} from './types.js';
import { convertToGherkin, customPriorityMapping, priorityMapping } from './utils.js';

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
      throw new McpError(ErrorCode.InternalError, `Failed to get test case: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createTestCase(args: TestCaseArgs) {
    const {
      project_key,
      name,
      test_script,
      folder,
      status,
      priority,
      precondition,
      objective,
      component,
      owner,
      estimated_time,
      labels,
      issue_links,
      custom_fields,
      parameters
    } = args;

    // Build the basic payload
    const payload: any = {
      projectKey: project_key,
      name: name
    };

    // Add optional fields
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

    // Handle test script
    if (test_script) {
      payload.testScript = {
        type: test_script.type
      };

      if (test_script.type === 'STEP_BY_STEP' && test_script.steps) {
        payload.testScript.steps = test_script.steps.map((step: any) => {
          const stepObj: any = {};
          if (step.description) stepObj.description = step.description;
          if (step.testData) stepObj.testData = step.testData;
          if (step.expectedResult) stepObj.expectedResult = step.expectedResult;
          if (step.testCaseKey) stepObj.testCaseKey = step.testCaseKey;
          return stepObj;
        });
      } else if ((test_script.type === 'PLAIN_TEXT' || test_script.type === 'BDD') && test_script.text) {
        if (test_script.type === 'BDD') {
          const gherkinContent = convertToGherkin(test_script.text);
          payload.testScript.text = gherkinContent || test_script.text;
        } else {
          payload.testScript.text = test_script.text;
        }
      }
    }

    // Always set status to Draft for new test cases
    payload.status = 'Draft';

    try {
      const response = await this.axiosInstance.post(this.jiraConfig.apiEndpoints.testcase, payload);

      if (response.status === 201) {
        const testKey = response.data.key || 'Unknown';
        return {
          content: [
            {
              type: 'text',
              text: `✅ Test case created successfully: ${testKey}\n${JSON.stringify({
                key: testKey,
                type: test_script?.type || 'none',
                hasSteps: test_script?.type === 'STEP_BY_STEP' ? test_script.steps?.length || 0 : undefined,
                hasText: (test_script?.type === 'PLAIN_TEXT' || test_script?.type === 'BDD') ? !!test_script.text : undefined
              }, null, 2)}`,
            },
          ],
        };
      } else {
        throw new Error(`Unexpected status code: ${response.status}`);
      }
    } catch (error) {
      let errorMessage = 'Unknown error';
      if (error instanceof Error && 'response' in error) {
        const axiosError = error as any;
        errorMessage = `Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create test case: ${errorMessage}`
      );
    }
  }

  async updateTestCaseBdd(args: UpdateBddArgs) {
    const { test_case_key, bdd_content } = args;

    try {
      // First, get the existing test case data
      const getResponse = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`);
      const testCaseData = getResponse.data;
      // Convert incoming BDD markdown (fallback to raw content if conversion returns empty)
      const converted = convertToGherkin(bdd_content);
      const finalText = converted && converted.trim().length > 0 ? converted : bdd_content;

      // Build a payload aligned with Zephyr Scale Server's update schema.
      // Only include fields that exist to avoid accidental nulling; required fields must be present.
      const payload: any = {};

      // Required base fields (schema requires these on Server/Data Center). If missing, throw.
      const requiredFields: Array<[string, any]> = [
        ['projectKey', testCaseData.projectKey],
        ['name', testCaseData.name],
        ['status', testCaseData.status],
        ['priority', testCaseData.priority]
      ];

      for (const [field, value] of requiredFields) {
        if (value === undefined || value === null || value === '') {
          throw new McpError(ErrorCode.InternalError, `Existing test case is missing required field '${field}' needed for update.`);
        }
        payload[field] = value;
      }

      // Optional simple scalar/string fields
      const optionalScalarFields = [
        'objective',
        'precondition',
        'folder',
        'component',
        'owner',
        'estimatedTime'
      ];
      for (const field of optionalScalarFields) {
        if (testCaseData[field] !== undefined) payload[field] = testCaseData[field];
      }

      // Arrays / objects
      if (Array.isArray(testCaseData.labels)) payload.labels = testCaseData.labels;
      if (testCaseData.customFields) payload.customFields = testCaseData.customFields;
      if (testCaseData.parameters) payload.parameters = testCaseData.parameters;
      // issueLinks preferred; map deprecated issueKey if present and issueLinks absent
      if (Array.isArray(testCaseData.issueLinks)) {
        payload.issueLinks = testCaseData.issueLinks;
      } else if (testCaseData.issueKey) {
        payload.issueLinks = [testCaseData.issueKey];
      }

      // Build testScript. Force type to BDD when performing a BDD update.
      payload.testScript = {
        type: 'BDD',
        text: finalText
      };

      // PUT update
      const updateResponse = await this.axiosInstance.put(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`, payload);

      if (updateResponse.status === 200) {
        return {
          content: [
            {
              type: 'text',
              text: `✅ Updated ${test_case_key} with BDD content successfully\nPayload summary: ${JSON.stringify({ textLength: finalText.length, projectKey: payload.projectKey, preservedLabels: payload.labels?.length || 0 }, null, 2)}`,
            },
          ],
        };
      }

      throw new Error(`Failed to update ${test_case_key}: ${updateResponse.status}`);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update test case BDD: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async createFolder(args: FolderArgs) {
    const { project_key, name, folder_type = 'TEST_CASE' } = args;

    // According to Zephyr Scale API documentation:
    // - projectKey: Project key (required)
    // - name: Full folder path including parent folders (e.g., "/folder/subfolder")
    // - type: Folder type (TEST_CASE, TEST_PLAN, or TEST_RUN)
    const payload: any = {
      projectKey: project_key,
      name: name,
      type: folder_type
    };

    try {
      const response = await this.axiosInstance.post(this.jiraConfig.apiEndpoints.folder, payload);

      if (response.status === 201 || response.status === 200) {
        return {
          content: [
            {
              type: 'text',
              text: `✅ Folder created successfully: ${response.data.name || name} (ID: ${response.data.id || 'N/A'})\n${JSON.stringify(response.data, null, 2)}`,
            },
          ],
        };
      } else {
        throw new Error(`Unexpected status code: ${response.status}`);
      }
    } catch (error) {
      let errorMessage = 'Unknown error';
      if (error instanceof Error && 'response' in error) {
        const axiosError = error as any;
        errorMessage = `Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}, Payload sent: ${JSON.stringify(payload)}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create folder: ${errorMessage}`
      );
    }
  }

  async getTestRunCases(args: any) {
    const { test_run_key } = args;
    try {
      const response = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`);
      const testCases = response.data.items?.map((item: any) => item.testCaseKey) || [];
      return {
        content: [{ type: 'text', text: JSON.stringify(testCases, null, 2) }],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get test run cases: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteTestCase(args: any) {
    const { test_case_key } = args;
    try {
      const response = await this.axiosInstance.delete(`${this.jiraConfig.apiEndpoints.testcase}/${test_case_key}`);
      if (response.status === 204) {
        return {
          content: [{ type: 'text', text: `Test case ${test_case_key} deleted successfully.` }],
        };
      } else {
        return {
          content: [{ type: 'text', text: `Failed to delete test case. Status: ${response.status}` }],
          isError: true,
        };
      }
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to delete test case: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createTestRun(args: TestRunArgs) {
    const {
      project_key,
      name,
      test_case_keys,
      test_plan_key,
      folder,
      planned_start_date,
      planned_end_date,
      description,
      owner,
      environment,
      custom_fields
    } = args;

    // Build the basic payload
    const payload: any = {
      projectKey: project_key,
      name: name,
    };

    // Add optional fields
    if (test_case_keys && test_case_keys.length > 0) {
      payload.items = test_case_keys.map((testCaseKey: string) => ({
        testCaseKey: testCaseKey
      }));
    }
    if (folder) payload.folder = folder;
    if (planned_start_date) payload.plannedStartDate = planned_start_date;
    if (planned_end_date) payload.plannedEndDate = planned_end_date;
    if (description) payload.description = description;
    if (owner) payload.owner = owner;
    if (environment) payload.environment = environment;
    if (custom_fields) payload.customFields = custom_fields;
    if (test_plan_key) payload.testPlanKey = test_plan_key;

    try {
      const response = await this.axiosInstance.post(this.jiraConfig.apiEndpoints.testrun, payload);

      if (response.status === 201) {
        const testRunKey = response.data.key || 'Unknown';
        return {
          content: [
            {
              type: 'text',
              text: `✅ Test run created successfully: ${testRunKey}\n${JSON.stringify({
                key: testRunKey,
                name: name,
                testCaseCount: test_case_keys?.length || 0,
                environment: environment || 'Not specified'
              }, null, 2)}`,
            },
          ],
        };
      } else {
        throw new Error(`Unexpected status code: ${response.status}`);
      }
    } catch (error) {
      let errorMessage = 'Unknown error';
      if (error instanceof Error && 'response' in error) {
        const axiosError = error as any;
        errorMessage = `Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create test run: ${errorMessage}`
      );
    }
  }

  async getTestRun(args: any) {
    const { test_run_key } = args;
    try {
      const response = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      let errorMessage = 'Unknown error';
      if (error instanceof Error && 'response' in error) {
        const axiosError = error as any;
        if (axiosError.response?.status === 404) {
          errorMessage = `Test run ${test_run_key} not found`;
        } else {
          errorMessage = `Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get test run: ${errorMessage}`
      );
    }
  }

  async getTestExecution(args: any) {
    const { execution_id, test_run_keys } = args;

    // Require users to specify test runs to search - fail immediately if not provided
    if (!test_run_keys || !Array.isArray(test_run_keys) || test_run_keys.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'test_run_keys is required. Please provide an array of test run keys to search in (e.g., ["PROJ-C152", "PROJ-C161"]). Use get_test_run_cases to find test runs if needed.'
      );
    }

    try {
      const testRunsToTry = test_run_keys;

      const searchResults: any[] = [];

      for (const testRunKey of testRunsToTry) {
        try {
          const response = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testrun}/${testRunKey}/testresults`);

          if (response.status === 200 && response.data) {
            // Look for the specific execution_id in the results
            const results = Array.isArray(response.data) ? response.data : [response.data];
            const matchingExecution = results.find((result: any) =>
              result.id && result.id.toString() === execution_id
            );

            if (matchingExecution) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `✅ Test execution ${execution_id} found in ${testRunKey}:\n${JSON.stringify(matchingExecution, null, 2)}`,
                  },
                ],
              };
            }

            // Store search info for debugging
            searchResults.push({
              testRunKey,
              executionCount: results.length,
              executionIds: results.map((r: any) => r.id).slice(0, 5) // Show first 5 IDs
            });
          }
        } catch (runError) {
          // Store error info for debugging
          searchResults.push({
            testRunKey,
            error: runError instanceof Error ? runError.message : String(runError)
          });
          continue;
        }
      }

      // If not found, provide helpful debugging info
      throw new Error(`Test execution ${execution_id} not found in any of the ${testRunsToTry.length} test runs searched. Search results: ${JSON.stringify(searchResults, null, 2)}`);
    } catch (error) {
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get test execution: ${errorMessage}`
      );
    }
  }

  async searchTestCasesByFolder(args: SearchTestCasesArgs) {
    const { project_key, folder_path, max_results = 100 } = args;
    
    // Build JQL-style query for Zephyr Scale API
    // Escape double quotes in folder path
    const escapedFolderPath = folder_path.replace(/"/g, '\\"');
    const query = `projectKey = "${project_key}" AND folder = "${escapedFolderPath}"`;
    
    const params = {
      query: query,
      maxResults: max_results,
    };

    try {
      const response = await this.axiosInstance.get(this.jiraConfig.apiEndpoints.search, { params });
      
      // Handle different response structures
      let testCases = [];
      if (Array.isArray(response.data)) {
        testCases = response.data;
      } else if (response.data.values && Array.isArray(response.data.values)) {
        testCases = response.data.values;
      } else if (response.data.results && Array.isArray(response.data.results)) {
        testCases = response.data.results;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `✅ Found ${testCases.length} test cases in folder "${folder_path}":\n${JSON.stringify({
              folder: folder_path,
              query: query,
              testCaseKeys: testCases.map((tc: any) => tc.key),
              totalCount: testCases.length
            }, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      let errorMessage = 'Unknown error';
      if (error instanceof Error && 'response' in error) {
        const axiosError = error as any;
        if (axiosError.response?.status === 404) {
          errorMessage = `Folder "${folder_path}" not found or no test cases found`;
        } else {
          errorMessage = `Status: ${axiosError.response?.status}, Data: ${JSON.stringify(axiosError.response?.data)}`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search test cases by folder: ${errorMessage}`
      );
    }
  }

  async addTestCasesToRun(args: AddTestCasesToRunArgs) {
    const { test_run_key, test_case_keys } = args;

    try {
      // For Data Center, we need to get the current items and then update
      if (this.jiraConfig.type === 'datacenter') {
        const getResponse = await this.axiosInstance.get(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`);
        const existingItems = getResponse.data.items || [];
        const existingKeys = new Set(existingItems.map((item: any) => item.testCaseKey));

        const newItems = test_case_keys
          .filter(key => !existingKeys.has(key))
          .map(key => ({ testCaseKey: key, testResultStatus: 'Not Executed' }));

        if (newItems.length > 0) {
          let response;
          if (this.jiraConfig.type === 'datacenter') {
            const minimalPayload = {
              items: [...existingItems, ...newItems]
            };
            response = await this.axiosInstance.put(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`, minimalPayload);
          } else {
            const postPayload = { items: newItems.map(item => item.testCaseKey) };
            response = await this.axiosInstance.post(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}/testcases`, postPayload);
          }

          if (response.status === 200 || response.status === 201 || response.status === 204) {
            return {
              content: [{ type: 'text', text: `Added ${newItems.length} new test cases to test run ${test_run_key}.` }],
            };
          }
        } else {
          return {
            content: [{ type: 'text', text: 'All specified test cases are already in the test run.' }],
          };
        }
      } else {
        // For Cloud, we can just post the new test case keys
        const fullPayload = { items: test_case_keys };
        const response = await this.axiosInstance.put(`${this.jiraConfig.apiEndpoints.testrun}/${test_run_key}`, fullPayload);

        if (response.status === 200 || response.status === 204) {
          return {
            content: [{ type: 'text', text: `Successfully updated test cases for test run ${test_run_key}.` }],
          };
        }
      }
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to add test cases: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      content: [{ type: 'text', text: 'An unexpected error occurred.' }],
      isError: true,
    };
  }
}