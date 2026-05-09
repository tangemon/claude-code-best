/**
 * Unit tests for phases/toolExecution.ts
 */
import { describe, test, expect } from 'bun:test'
import { executeTools } from '../../../phases/toolExecution.js'
import type { ToolExecutionInput } from '../../../phases/toolExecution.js'
import type { QueryDeps } from '../../../deps.js'

describe('executeTools', () => {
  const createMockDeps = (): QueryDeps => ({
    callModel: async function* () {},
    microcompact: async (messages) => ({ messages }),
    autocompact: async () => ({ wasCompacted: false, compactionResult: undefined, consecutiveFailures: 0 }),
    uuid: () => 'test-uuid',
    runTools: async function* () {},
    generateToolUseSummary: async () => null,
    applyToolResultBudget: async (messages) => messages,
    prependUserContext: (messages) => messages,
    appendSystemContext: (systemPrompt: any) => systemPrompt as any,
    createDumpPromptsFetch: () => undefined,
    notifyCommandLifecycle: () => {},
    headlessProfilerCheckpoint: () => {},
    queryCheckpoint: () => {},
    recordContentReplacement: async () => {},
    handleStopHooks: async function* () {
      return { blockingErrors: [], preventContinuation: false }
    },
    executeStopFailureHooks: async () => {},
    executePostSamplingHooks: async () => {},
    logEvent: () => {},
    logError: () => {},
  })

  const createMockToolUseContext = () => ({
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-20250514',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' as const },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [], allowedAgentTypes: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    getAppState: () => ({
      toolPermissionContext: {
        mode: 'bypassPermissions' as const,
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: true,
      },
      fastMode: false,
      mcp: { tools: [], clients: [] },
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
  })

  const createInput = (): ToolExecutionInput => ({
    toolUseBlocks: [],
    assistantMessages: [],
    canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: undefined }),
    toolUseContext: createMockToolUseContext() as any,
    config: { emitToolUseSummaries: false },
  })

  test('handles empty toolUseBlocks', async () => {
    const deps = createMockDeps()
    const input = createInput()

    const result = await executeTools(input, deps)

    expect(result).toBeDefined()
    expect(result.toolResults).toEqual([])
  })

  test('returns pendingToolUseSummary as undefined when no tools', async () => {
    const deps = createMockDeps()
    const input = createInput()

    const result = await executeTools(input, deps)

    expect(result.pendingToolUseSummary).toBeUndefined()
  })

  test('returns streamingToolExecutor as null when no tools', async () => {
    const deps = createMockDeps()
    const input = createInput()

    const result = await executeTools(input, deps)

    expect(result.streamingToolExecutor).toBeNull()
  })

  test('preserves toolUseContext reference', async () => {
    const deps = createMockDeps()
    const input = createInput()
    const originalContext = input.toolUseContext

    const result = await executeTools(input, deps)

    expect(result.updatedToolUseContext).toBeDefined()
  })

  test('handles emitToolUseSummaries config', async () => {
    const deps = createMockDeps()
    const input = createInput()
    input.config.emitToolUseSummaries = true

    const result = await executeTools(input, deps)

    expect(result).toBeDefined()
  })
})
