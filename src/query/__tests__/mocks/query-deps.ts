/**
 * Mock factory for QueryDeps
 *
 * Provides sensible defaults for testing query() without mocking
 * individual modules. Override specific deps with partial overrides.
 */
import type { QueryDeps, StopHookResult } from '../../deps'
import type { Message } from '../../../types/message.js'
import type { ToolUseContext } from '../../../Tool.js'

export function createMockQueryDeps(overrides?: Partial<QueryDeps>): QueryDeps {
  return {
    callModel: async function* () {},
    microcompact: async (messages: Message[]) => ({ messages }),
    autocompact: async () => ({
      wasCompacted: false,
      compactionResult: undefined,
      consecutiveFailures: 0,
    }),
    uuid: () => crypto.randomUUID(),
    runTools: async function* () {},
    generateToolUseSummary: async () => null,
    applyToolResultBudget: async (messages: Message[]) => messages,
    prependUserContext: (messages: Message[]) => messages,
    appendSystemContext: (systemPrompt: any) => systemPrompt,
    createDumpPromptsFetch: () => undefined,
    notifyCommandLifecycle: () => {},
    headlessProfilerCheckpoint: () => {},
    queryCheckpoint: () => {},
    recordContentReplacement: async () => {},
    handleStopHooks: async function* () {
      return {
        blockingErrors: [],
        preventContinuation: false,
      } as StopHookResult
    },
    executeStopFailureHooks: async () => {},
    executePostSamplingHooks: async () => {},
    logEvent: () => {},
    logError: () => {},
    // Apply overrides last so test can override defaults
    ...overrides,
  }
}

/**
 * Common test fixtures
 */
export const BASE_TOOL_USE_CONTEXT: ToolUseContext = {
  options: {
    commands: [],
    debug: false,
    mainLoopModel: 'claude-sonnet-4-20250514',
    tools: [],
    verbose: false,
    thinkingConfig: { type: 'disabled' },
    mcpClients: [],
    mcpResources: {},
    isNonInteractiveSession: true,
    agentDefinitions: {
      activeAgents: [],
      allAgents: [],
      allowedAgentTypes: [],
    },
  },
  abortController: new AbortController(),
  readFileState: new Map() as any,
  getAppState: () => ({
    toolPermissionContext: {
      mode: 'bypass' as const,
      toolPermissions: new Map(),
    },
    fastMode: false,
    mcp: { tools: [], clients: [], commands: [], resources: {}, pluginReconnectKey: 0 },
    effortValue: undefined,
    advisorModel: undefined,
    sessionHooks: new Map(),
  }),
  setAppState: () => {},
  setInProgressToolUseIDs: () => {},
  setResponseLength: () => {},
  updateFileHistoryState: () => {},
  updateAttributionState: () => {},
  messages: [],
}

export const BASE_QUERY_PARAMS = {
  messages: [],
  systemPrompt: { system: [] },
  userContext: {},
  systemContext: {},
  canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: undefined }),
  toolUseContext: BASE_TOOL_USE_CONTEXT,
  querySource: 'sdk' as const,
}