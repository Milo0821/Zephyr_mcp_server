# Zephyr Scale MCP Server - Test Suite

This directory contains comprehensive tests for the Zephyr Scale MCP Server.

## Test Structure

```
test/
├── README.md                    # This file
├── run-tests.cjs               # Main test runner
├── zephyr-server.test.cjs      # Unit tests
└── integration.test.cjs        # Integration tests
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

## Test Categories

### 1. Unit Tests (`zephyr-server.test.cjs`)
- **Package Configuration**: Validates package.json structure
- **Build Artifacts**: Checks if all build files exist and are executable
- **Environment Configuration**: Validates required environment variables
- **Server Startup**: Tests MCP server initialization
- **Tools List**: Verifies all MCP tools are properly registered

### 2. Integration Tests (`integration.test.cjs`)
- **API Connectivity**: Tests connection to Zephyr Scale API
- **Get Test Case Tool**: Validates test case retrieval functionality
- **Folder Search**: Tests folder-based test case search
- **BDD Content Handling**: Validates BDD format processing

## Environment Setup for Full Testing

The test suite includes an integration check that requires `ZEPHYR_BASE_URL` to be set.
For live server startup / tools list checks, you also need valid authentication.

To run the full test suite successfully, set at least:

```bash
export ZEPHYR_BASE_URL="https://your-jira-instance.atlassian.net"
```

For live API/server checks, also set credentials (one of the following):

**Jira Cloud:**

```bash
export JIRA_USERNAME="your-email@example.com"
export JIRA_API_TOKEN="your-api-token"
```

**Jira Data Center:**

```bash
export ZEPHYR_API_KEY="your-zephyr-scale-api-token"
```

## Expected Test Results

### Without Any Environment Variables
- ✅ Package Configuration: PASSED
- ✅ Build Artifacts: PASSED
- ✅ Environment Configuration: PASSED (no vars set)
- ✅ Server Startup: SKIPPED
- ✅ Tools List: SKIPPED
- ❌ API Connectivity: FAILED (`ZEPHYR_BASE_URL` not configured)

If you want tests to pass without configuring Jira, run unit tests only:

```bash
npm run test:unit
```

### With `ZEPHYR_BASE_URL` Set
- ✅ All unit tests should pass
- ✅ Integration tests should pass

### With Full Valid API Credentials
- ✅ All unit tests should pass
- ✅ Server startup and tools list checks should run (not skipped)
- ✅ Integration tests should pass

## Test Output Example

```
🧪 Zephyr Scale MCP Server - Complete Test Suite
======================================================================
Started at: 2025-07-03T06:16:44.250Z
======================================================================

📋 PHASE 1: Unit Tests
----------------------------------------
✅ Package Configuration - PASSED (0ms)
✅ Build Artifacts - PASSED (1ms)
❌ Environment Configuration - FAILED: Missing required environment variables
❌ Server Startup - FAILED: ZEPHYR_API_KEY environment variable is required
❌ Tools List - FAILED: Expected tools not found in output

🔗 PHASE 2: Integration Tests
----------------------------------------
(Skipped due to unit test failures)

======================================================================
🏁 FINAL TEST RESULTS
======================================================================
❌ Test Status: FAILED
🔧 Please fix the failing tests before using the server.
======================================================================
```

## Adding New Tests

### Unit Tests
Add new test methods to the `ZephyrServerTest` class in `zephyr-server.test.cjs`:

```javascript
async testNewFeature() {
  // Your test logic here
  console.log('Testing new feature...');
  // Throw error if test fails
}

// Add to runAllTests():
await this.runTest('New Feature', () => this.testNewFeature());
```

### Integration Tests
Add new test methods to the `ZephyrIntegrationTest` class in `integration.test.cjs`:

```javascript
async testNewAPIFeature() {
  // Your integration test logic here
  console.log('Testing new API feature...');
}

// Add to runIntegrationTests():
await this.runTest('New API Feature', () => this.testNewAPIFeature());
```

## Troubleshooting

### CommonJS vs ES Modules
The test files use `.cjs` extension to ensure they run as CommonJS modules, while the main server uses ES modules (`.js` with `"type": "module"` in package.json).

### Test Timeouts
Server startup and tools list tests have 2-second timeouts. Increase if needed for slower systems:

```javascript
setTimeout(() => {
  // Test logic
}, 5000); // Increased to 5 seconds
```

### API Rate Limits
Integration tests may hit API rate limits. Add delays between tests if needed:

```javascript
await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
