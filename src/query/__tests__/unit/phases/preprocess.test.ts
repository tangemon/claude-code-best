/**
 * Unit tests for phases/preprocess.ts
 */
import { describe, test, expect, vi } from 'vitest'
import { preprocessMessages } from '../../../phases/preprocess.js'
import type { Message } from '../../../../types/message.js'
import type { QueryDeps } from '../../../deps.js'

describe('preprocessMessages', () => {
  const createMockDeps = (): QueryDeps => ({
    callModel: async function* () {},
    microcompact: async (messages) => ({ messages }),
    autocompact: async () => ({ compactionResult: undefined, consecutiveFailures: 0 }),
    uuid: () => 'test-uuid',
    runTools: async function* () {},
    generateToolUseSummary: async () => null,
    applyToolResultBudget: async (messages) => messages,
    prependUserContext: (messages) => messages,
    appendSystemContext: (systemPrompt) => ({ system: [] }),
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
      agentDefinitions: { activeAgents: [], allowedAgentTypes: [] },
    },
    abortController: new AbortController(),
    readFileState: new Map(),
    contentReplacementState: undefined,
    getAppState: () => ({
      toolPermissionContext: { mode: 'bypass' as const, toolPermissions: new Map() },
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

  test('clears toolUseResult from previous turns', async () => {
    const messages: (Message & { toolUseResult?: string })[] = [
      {
        type: 'user',
        id: '1',
        message: { role: 'user', content: [] },
        timestamp: Date.now(),
        toolUseResult: 'some result',
      } as Message & { toolUseResult?: string },
    ]

    const deps = createMockDeps()
    const toolUseContext = createMockToolUseContext()

    const result = await preprocessMessages(
      messages,
      toolUseContext,
      undefined,
      'sdk',
      deps,
    )

    expect(result.messagesForQuery[0]).not.toHaveProperty('toolUseResult')
  })

  test('applies tool result budget via deps', async () => {
    const applyToolResultBudgetMock = vi.fn((messages) => messages)
    const deps = createMockDeps()
    deps.applyToolResultBudget = applyToolResultBudgetMock
    const toolUseContext = createMockToolUseContext()

    await preprocessMessages([], toolUseContext, undefined, 'sdk', deps)

    expect(applyToolResultBudgetMock).toHaveBeenCalled()
  })

  test('returns messagesForQuery from getMessagesAfterCompactBoundary', async () => {
    const deps = createMockDeps()
    const toolUseContext = createMockToolUseContext()

    const result = await preprocessMessages([], toolUseContext, undefined, 'sdk', deps)

    expect(result.messagesForQuery).toEqual([])
  })

  test('returns tracking unchanged when not provided', async () => {
    const deps = createMockDeps()
    const toolUseContext = createMockToolUseContext()

    const result = await preprocessMessages([], toolUseContext, undefined, 'sdk', deps)

    expect(result.tracking).toBeUndefined()
  })

  test('returns snipTokensFreed as 0', async () => {
    const deps = createMockDeps()
    const toolUseContext = createMockToolUseContext()

    const result = await preprocessMessages([], toolUseContext, undefined, 'sdk', deps)

    expect(result.snipTokensFreed).toBe(0)
  })

  test('preserves toolUseContext reference', async () => {
    const deps = createMockDeps()
    const toolUseContext = createMockToolUseContext()

    const result = await preprocessMessages([], toolUseContext, undefined, 'sdk', deps)

    expect(result.toolUseContext).toBe(toolUseContext)
  })
})
