/**
 * Unit tests for phases/init.ts
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import { mock, type Mock } from 'bun:test'
import type { QueryParams } from '../../../types.js'

// Mock productionDeps to avoid circular dependency issues
mock.module('../../../deps.js', () => ({
  productionDeps: () => ({
    callModel: async function* () {},
    microcompact: async (messages: any[]) => ({ messages }),
    autocompact: async () => ({ wasCompacted: false, compactionResult: undefined, consecutiveFailures: 0 }),
    uuid: () => 'test-uuid',
    runTools: async function* () {},
    generateToolUseSummary: async () => null,
    applyToolResultBudget: async (messages: any[]) => messages,
    prependUserContext: (messages: any[]) => messages,
    appendSystemContext: (systemPrompt: any) => systemPrompt,
    createDumpPromptsFetch: () => undefined,
    notifyCommandLifecycle: () => {},
    headlessProfilerCheckpoint: () => {},
    queryCheckpoint: () => {},
    recordContentReplacement: async () => {},
    handleStopHooks: async function* () {
      return { blockingErrors: [], preventContinuation: false }
    } as any,
    executeStopFailureHooks: async () => {},
    executePostSamplingHooks: async () => {},
    logEvent: () => {},
    logError: () => {},
  }),
}))

describe('initQueryLoop', () => {
  const baseParams: QueryParams = {
    messages: [],
    systemPrompt: [] as any,
    userContext: {},
    systemContext: {},
    canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: undefined }),
    toolUseContext: {
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
      readFileState: { cache: new Map(), max: 100, maxSize: 0, calculatedSize: 0 } as any,
      getAppState: () => ({
        toolPermissionContext: { mode: 'bypass' as const, toolPermissions: new Map() },
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
    },
    querySource: 'sdk',
  }

  test('creates initial state with correct turnCount', async () => {
    const { initQueryLoop } = await import('../../../phases/init.js')
    const result = initQueryLoop(baseParams)
    expect(result.state.turnCount).toBe(1)
  })

  test('creates initial state with undefined autoCompactTracking', async () => {
    const { initQueryLoop } = await import('../../../phases/init.js')
    const result = initQueryLoop(baseParams)
    expect(result.state.autoCompactTracking).toBeUndefined()
  })

  test('creates initial state with zero maxOutputTokensRecoveryCount', async () => {
    const { initQueryLoop } = await import('../../../phases/init.js')
    const result = initQueryLoop(baseParams)
    expect(result.state.maxOutputTokensRecoveryCount).toBe(0)
  })

  test('creates initial state with undefined pendingToolUseSummary', async () => {
    const { initQueryLoop } = await import('../../../phases/init.js')
    const result = initQueryLoop(baseParams)
    expect(result.state.pendingToolUseSummary).toBeUndefined()
  })

  test('creates context with correct params', async () => {
    const { initQueryLoop } = await import('../../../phases/init.js')
    const result = initQueryLoop(baseParams)
    expect(result.context.systemPrompt).toEqual(baseParams.systemPrompt)
    expect(result.context.userContext).toEqual(baseParams.userContext)
    expect(result.context.querySource).toBe('sdk')
  })

  test('creates config with buildQueryConfig', async () => {
    const { initQueryLoop } = await import('../../../phases/init.js')
    const result = initQueryLoop(baseParams)
    expect(result.config).toBeDefined()
  })

  test('sets maxOutputTokensOverride from params', async () => {
    const { initQueryLoop } = await import('../../../phases/init.js')
    const paramsWithOverride = { ...baseParams, maxOutputTokensOverride: 64000 }
    const result = initQueryLoop(paramsWithOverride)
    expect(result.state.maxOutputTokensOverride).toBe(64000)
  })

  test('sets maxTurns in context', async () => {
    const { initQueryLoop } = await import('../../../phases/init.js')
    const paramsWithMaxTurns = { ...baseParams, maxTurns: 10 }
    const result = initQueryLoop(paramsWithMaxTurns)
    expect(result.context.maxTurns).toBe(10)
  })
})
