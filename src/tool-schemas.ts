export const toolSchemas = [
  {
    name: 'get_test_case',
    description: 'Get detailed information about a specific test case',
    inputSchema: {
      type: 'object',
      properties: {
        test_case_key: {
          type: 'string',
          description: 'Test case key (e.g., PROJ-T123)',
        },
      },
      required: ['test_case_key'],
    },
  },
  {
    name: 'create_test_case',
    description: 'Create a new test case with STEP_BY_STEP, PLAIN_TEXT, or BDD content. To match your project\'s structure, use the zephyr://testcase/EXISTING-KEY resource to fetch a real test case and use its structure as a template, especially for custom_fields.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: {
          type: 'string',
          description: 'Project key (required)',
        },
        name: {
          type: 'string',
          description: 'Test case name (required)',
        },
        test_script: {
          type: 'object',
          description: 'Test script object containing type and content',
          properties: {
            type: {
              type: 'string',
              description: 'Type of test script',
              enum: ['STEP_BY_STEP', 'PLAIN_TEXT', 'BDD'],
            },
            steps: {
              type: 'array',
              description: 'Test steps for STEP_BY_STEP type',
              items: {
                type: 'object',
                properties: {
                  description: { 
                    type: 'string',
                    description: 'Step description'
                  },
                  testData: { 
                    type: 'string',
                    description: 'Test data for the step (optional)'
                  },
                  expectedResult: { 
                    type: 'string',
                    description: 'Expected result for the step (optional)'
                  },
                  testCaseKey: { 
                    type: 'string',
                    description: 'Test case key reference for calling other tests (optional)'
                  }
                }
              }
            },
            text: {
              type: 'string',
              description: 'Text content for PLAIN_TEXT or BDD types. For BDD, use Gherkin syntax with Given/When/Then steps.',
            }
          },
          required: ['type']
        },
        folder: {
          type: 'string',
          description: 'Folder path (optional, e.g., "/Orbiter/Cargo Bay")',
        },
        status: {
          type: 'string',
          description: 'Test case status (optional)',
          enum: ['Draft', 'Approved', 'Deprecated'],
          default: 'Draft',
        },
        priority: {
          type: 'string',
          description: 'Test case priority (optional)',
          enum: ['High', 'Normal', 'Low'],
        },
        precondition: {
          type: 'string',
          description: 'Test precondition (optional)',
        },
        objective: {
          type: 'string',
          description: 'Test objective (optional)',
        },
        component: {
          type: 'string',
          description: 'Component name (optional)',
        },
        owner: {
          type: 'string',
          description: 'Test case owner (optional)',
        },
        estimated_time: {
          type: 'number',
          description: 'Estimated time in milliseconds (optional)',
        },
        labels: {
          type: 'array',
          description: 'Array of labels (optional)',
          items: { type: 'string' }
        },
        issue_links: {
          type: 'array',
          description: 'Array of issue links (optional) - will be mapped to issueLinks in API',
          items: { type: 'string' }
        },
        custom_fields: {
          type: 'object',
          description: 'Custom fields object (optional). Use the zephyr://testcase/EXISTING-KEY resource to fetch a real test case and copy its customFields structure. Common examples: {"Type": "Functional", "Priority": "P2", "Regression": false, "Execution Type": "Manual - To Be Automated", "Risk Control": false}',
          additionalProperties: true
        },
        parameters: {
          type: 'object',
          description: 'Test parameters for data-driven testing (optional)',
          properties: {
            variables: {
              type: 'array',
              description: 'Array of parameter variables',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { 
                    type: 'string',
                    enum: ['FREE_TEXT', 'DATA_SET']
                  },
                  dataSet: { type: 'string' }
                },
                required: ['name', 'type']
              }
            },
            entries: {
              type: 'array',
              description: 'Array of parameter value entries',
              items: {
                type: 'object',
                additionalProperties: true
              }
            }
          }
        }
      },
      required: ['project_key', 'name'],
    },
  },
  {
    name: 'update_test_case_bdd',
    description: 'Update an existing test case with BDD content',
    inputSchema: {
      type: 'object',
      properties: {
        test_case_key: {
          type: 'string',
          description: 'Test case key to update',
        },
        bdd_content: {
          type: 'string',
          description: 'BDD content in markdown format',
        },
      },
      required: ['test_case_key', 'bdd_content'],
    },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder in Zephyr Scale',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: {
          type: 'string',
          description: 'Project key (required)',
        },
        name: {
          type: 'string',
          description: 'Full folder path including parent folders (required). Examples: "/MyFolder" for root folder, "/Parent/Child" for nested folder',
        },
        folder_type: {
          type: 'string',
          description: 'Type of folder',
          enum: ['TEST_CASE', 'TEST_PLAN', 'TEST_RUN'],
          default: 'TEST_CASE',
        },
      },
      required: ['project_key', 'name'],
    },
  },
  {
    name: 'get_test_run_cases',
    description: 'Get test case keys from a test run',
    inputSchema: {
      type: 'object',
      properties: {
        test_run_key: {
          type: 'string',
          description: 'Test run key (e.g., PROJ-C123)',
        },
      },
      required: ['test_run_key'],
    },
  },
  {
    name: 'delete_test_case',
    description: 'Delete a specific test case',
    inputSchema: {
      type: 'object',
      properties: {
        test_case_key: {
          type: 'string',
          description: 'Test case key to delete (e.g., PROJ-T123)',
        },
      },
      required: ['test_case_key'],
    },
  },
  {
    name: 'create_test_run',
    description: 'Create a new test run',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: {
          type: 'string',
          description: 'Project key (required)',
        },
        name: {
          type: 'string',
          description: 'Test run name (required)',
        },
        test_case_keys: {
          type: 'array',
          description: 'Array of test case keys to include in the test run',
          items: { type: 'string' }
        },
        test_plan_key: {
          type: 'string',
          description: 'Test plan key to link this test run to (optional)',
        },
        folder: {
          type: 'string',
          description: 'Folder path (optional)',
        },
        planned_start_date: {
          type: 'string',
          description: 'Planned start date in ISO format (optional)',
        },
        planned_end_date: {
          type: 'string',
          description: 'Planned end date in ISO format (optional)',
        },
        description: {
          type: 'string',
          description: 'Test run description (optional)',
        },
        owner: {
          type: 'string',
          description: 'Test run owner (optional)',
        },
        environment: {
          type: 'string',
          description: 'Test environment (optional)',
        },
        custom_fields: {
          type: 'object',
          description: 'Custom fields object (optional)',
        },
      },
      required: ['project_key', 'name'],
    },
  },
  {
    name: 'get_test_run',
    description: 'Get detailed information about a specific test run',
    inputSchema: {
      type: 'object',
      properties: {
        test_run_key: {
          type: 'string',
          description: 'Test run key (e.g., PROJ-R123)',
        },
      },
      required: ['test_run_key'],
    },
  },
  {
    name: 'get_test_execution',
    description: 'Get detailed information about a specific test execution by run ID',
    inputSchema: {
      type: 'object',
      properties: {
        execution_id: {
          type: 'string',
          description: 'Test execution ID (e.g., 5805255)',
        },
        test_run_keys: {
          type: 'array',
          description: 'Array of test run keys to search in (required, e.g., ["PROJ-C152", "PROJ-C161"])',
          items: { type: 'string' },
          minItems: 1
        },
      },
      required: ['execution_id', 'test_run_keys'],
    },
  },
  {
    name: 'search_test_cases_by_folder',
    description: 'Search for test cases in a specific folder',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: {
          type: 'string',
          description: 'Project key (e.g., PROJ)',
        },
        folder_path: {
          type: 'string',
          description: 'Folder path to search in (e.g., /ProjectName/SubFolder)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (optional, default 100)',
          default: 100,
        },
      },
      required: ['project_key', 'folder_path'],
    },
  },
  {
    name: 'add_test_cases_to_run',
    description: 'Add test cases to an existing test run',
    inputSchema: {
      type: 'object',
      properties: {
        test_run_key: {
          type: 'string',
          description: 'Test run key (e.g., PROJ-C161)',
        },
        test_case_keys: {
          type: 'array',
          description: 'Array of test case keys to add to the test run',
          items: { type: 'string' }
        },
      },
      required: ['test_run_key', 'test_case_keys'],
    },
  },
];