import { AxiosInstance } from 'axios';

export async function resolveFolderIdByPath(
  axiosInstance: AxiosInstance,
  projectKey: string,
  folderPath: string,
  folderType: string
): Promise<number | null> {
  // Normalise: strip leading/trailing slashes, split into segments
  const segments = folderPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (segments.length === 0) return null;

  try {
    // Fetch all folders for the project + type (up to 1000)
    const response = await axiosInstance.get('/folders', {
      params: { projectKey, folderType, maxResults: 1000 },
    });

    const folders: Array<{ id: number; parentId: number | null; name: string }> =
      Array.isArray(response.data)
        ? response.data
        : response.data?.values ?? [];

    // Walk segments top-down, matching by name under the correct parent
    let parentId: number | null = null;
    let matchedId: number | null = null;

    for (const segment of segments) {
      const match = folders.find(
        (f) => f.name === segment && (f.parentId ?? null) === parentId
      );
      if (!match) return null;
      matchedId = match.id;
      parentId = match.id;
    }

    return matchedId;
  } catch {
    return null;
  }
}

export function convertToGherkin(bddContent: string): string {
  const bddLines: string[] = [];
  const lines = bddContent.split('\n');

  // Bold-markdown step keywords (e.g. **Given**, **When**, etc.)
  const boldStepKeywords = ['Given', 'When', 'Then', 'And', 'But'];
  // Plain step keyword prefixes
  const stepKeywords = ['Given ', 'When ', 'Then ', 'And ', 'But '];
  // Zephyr Scale Cloud only accepts steps and table rows — Feature:/Scenario: wrappers
  // cause a 400 "Invalid Gherkin script" error and must be stripped.
  const strippedPrefixes = [
    'Feature:',
    'Background:',
    'Scenario Outline:',
    'Scenario:',
    'Examples:',
  ];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('---')) continue;

    // Strip structural Gherkin keywords — not accepted by the Zephyr Scale Cloud testscript API
    if (strippedPrefixes.some(p => trimmedLine.startsWith(p))) continue;

    // Convert **Keyword** markdown bold to plain Gherkin keyword
    let matchedBold = false;
    for (const kw of boldStepKeywords) {
      if (trimmedLine.startsWith(`**${kw}**`)) {
        bddLines.push(`${kw} ${trimmedLine.replace(`**${kw}**`, '').trim()}`);
        matchedBold = true;
        break;
      }
    }
    if (matchedBold) continue;

    // Plain step keywords — pass through unchanged
    if (stepKeywords.some(k => trimmedLine.startsWith(k))) {
      bddLines.push(trimmedLine);
      continue;
    }

    // Table rows — pass through unchanged
    if (trimmedLine.startsWith('|')) {
      bddLines.push(trimmedLine);
    }
  }

  return bddLines.join('\n');
}
export const customPriorityMapping: { [key: string]: string } = {
  'High': 'P0',
  'Normal': 'P1',
  'Low': 'P2'
};

export const priorityMapping: { [key: string]: string } = {
  'High': 'High',
  'Medium': 'High',
  'Low': 'High'
};

/**
 * Detects whether the Jira instance is Cloud or Data Center based on the base URL.
 */
export function detectJiraType(baseUrl: string): 'cloud' | 'datacenter' {
  if (baseUrl.includes('.atlassian.net')) {
    return 'cloud';
  }
  const jiraType = process.env.JIRA_TYPE?.toLowerCase();
  if (jiraType === 'cloud' || jiraType === 'datacenter') {
    return jiraType;
  }
  return 'datacenter';
}

/**
 * Returns the correct API endpoints based on the Jira type.
 */
export function getApiEndpoints(jiraType: 'cloud' | 'datacenter') {
  if (jiraType === 'cloud') {
    return {
      testcase: '/testcases',
      testrun: '/testcycles',
      folder: '/folders',
      search: '/testcases/search',
    };
  } else {
    return {
      testcase: '/rest/atm/1.0/testcase',
      testrun: '/rest/atm/1.0/testrun',
      folder: '/rest/atm/1.0/folder',
      search: '/rest/atm/1.0/testcase/search',
    };
  }
}

/**
 * Creates the complete Jira configuration object.
 */
export function createJiraConfig() {
  const jiraBaseUrl = process.env.ZEPHYR_BASE_URL;
  const apiKey = process.env.ZEPHYR_API_KEY;

  if (!jiraBaseUrl) {
    throw new Error('ZEPHYR_BASE_URL environment variable is required');
  }
  if (!apiKey) {
    throw new Error('ZEPHYR_API_KEY environment variable is required for both Cloud and Data Center authentication');
  }

  const type = detectJiraType(jiraBaseUrl);
  const apiEndpoints = getApiEndpoints(type);

  // Cloud: use ZEPHYR_API_BASE_URL if set (e.g. for EU: https://eu.api.zephyrscale.smartbear.com/v2), else default US
  const defaultCloudBaseUrl = 'https://api.zephyrscale.smartbear.com/v2';
  const cloudBaseUrl = process.env.ZEPHYR_API_BASE_URL?.trim();
  const baseUrl = type === 'cloud'
    ? (cloudBaseUrl || defaultCloudBaseUrl)
    : jiraBaseUrl;

  const authHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  return {
    type,
    baseUrl,
    jiraBaseUrl,
    authHeaders,
    apiEndpoints,
  };
}
