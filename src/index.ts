#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { toolSchemas } from './tool-schemas.js';
import { ZephyrToolHandlers } from './tool-handlers.js';
import { resourceList, readResource, setAxiosInstance } from './resources.js';
import { createJiraConfig } from './utils.js';

class ZephyrServer {
  private server: Server;
  private toolHandlers: ZephyrToolHandlers;

  constructor() {
    const jiraConfig = createJiraConfig();

    this.server = new Server(
      {
        name: 'zephyr-server',
        version: '0.2.9',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    const axiosInstance = axios.create({
      baseURL: jiraConfig.baseUrl,
      headers: jiraConfig.authHeaders,
    });
    
    setAxiosInstance(axiosInstance);

    this.toolHandlers = new ZephyrToolHandlers(axiosInstance, jiraConfig);
    this.setupToolHandlers();
    this.setupResourceHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolSchemas,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const args = request.params.arguments || {};
        
        switch (request.params.name) {
          case 'get_test_case':
            return await this.toolHandlers.getTestCase(args);
          case 'create_test_case':
            return await this.toolHandlers.createTestCase(args as any);
          case 'update_test_case_bdd':
            return await this.toolHandlers.updateTestCaseBdd(args as any);
          case 'create_folder':
            return await this.toolHandlers.createFolder(args as any);
          case 'get_test_run_cases':
            return await this.toolHandlers.getTestRunCases(args);
          case 'delete_test_case':
            return await this.toolHandlers.deleteTestCase(args);
          case 'create_test_run':
            return await this.toolHandlers.createTestRun(args as any);
          case 'get_test_run':
            return await this.toolHandlers.getTestRun(args);
          case 'get_test_execution':
            return await this.toolHandlers.getTestExecution(args);
          case 'search_test_cases_by_folder':
            return await this.toolHandlers.searchTestCasesByFolder(args as any);
          case 'add_test_cases_to_run':
            return await this.toolHandlers.addTestCasesToRun(args as any);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        return {
          content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    });
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: resourceList,
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return await readResource(request.params.uri);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Zephyr MCP server running on stdio');
  }
}

const server = new ZephyrServer();
server.run().catch(console.error);
