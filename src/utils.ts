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
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('---')) continue;
    
    if (trimmedLine.startsWith('**Given**')) {
      bddLines.push(`Given ${trimmedLine.replace('**Given**', '').trim()}`);
    } else if (trimmedLine.startsWith('**When**')) {
      bddLines.push(`When ${trimmedLine.replace('**When**', '').trim()}`);
    } else if (trimmedLine.startsWith('**Then**')) {
      bddLines.push(`Then ${trimmedLine.replace('**Then**', '').trim()}`);
    } else if (trimmedLine.startsWith('**And**')) {
      bddLines.push(`And ${trimmedLine.replace('**And**', '').trim()}`);
    } else if (trimmedLine.startsWith('Given ') || trimmedLine.startsWith('When ') || 
               trimmedLine.startsWith('Then ') || trimmedLine.startsWith('And ')) {
      bddLines.push(trimmedLine);
    }
  }
  
  return bddLines.length > 0 ? '    ' + bddLines.join('\n    ') : '';
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
  
  const baseUrl = type === 'cloud' 
    ? 'https://api.zephyrscale.smartbear.com/v2' 
    : jiraBaseUrl;

  const authHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  return {
    type,
    baseUrl,
    authHeaders,
    apiEndpoints,
  };
}
