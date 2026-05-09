/**
 * Unit tests for phases/attachments.ts
 */
import { describe, test, expect } from 'bun:test'
import { processAttachments } from '../../../phases/attachments.js'
import type { AttachmentsInput, AttachmentsContext } from '../../../phases/attachments.js'
import type { QueryDeps } from '../../../deps.js'

describe('processAttachments', () => {
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
  })

  const createInput = (): AttachmentsInput => ({
    messagesForQuery: [],
    assistantMessages: [],
    toolResults: [],
    toolUseBlocks: [],
    toolUseContext: createMockToolUseContext() as any,
    querySource: 'sdk',
    pendingMemoryPrefetch: null,
    turnCount: 1,
  })

  const createContext = (): AttachmentsContext => ({
    consumedCommandUuids: [],
    consumedAutonomyCommands: [],
  })

  test('returns empty toolResults for empty input', async () => {
    const input = createInput()
    const context = createContext()
    const deps = createMockDeps()

    const result = await processAttachments(input, context, deps)

    expect(result).toBeDefined()
    expect(result.toolResults).toEqual([])
  })

  test('returns consumedCommandUuids in output', async () => {
    const input = createInput()
    const context = createContext()
    const deps = createMockDeps()

    const result = await processAttachments(input, context, deps)

    expect(result.consumedCommandUuids).toEqual([])
  })

  test('returns consumedAutonomyCommands in output', async () => {
    const input = createInput()
    const context = createContext()
    const deps = createMockDeps()

    const result = await processAttachments(input, context, deps)

    expect(result.consumedAutonomyCommands).toEqual([])
  })

  test('processes toolUseBlocks with sleep tool', async () => {
    const input = createInput()
    input.toolUseBlocks = [{ name: 'Sleep' }]
    const context = createContext()
    const deps = createMockDeps()

    const result = await processAttachments(input, context, deps)

    expect(result).toBeDefined()
  })

  test('handles pendingMemoryPrefetch', async () => {
    const input = createInput()
    input.pendingMemoryPrefetch = {
      promise: Promise.resolve([]),
      settledAt: Date.now(),
      consumedOnIteration: -1,
    }
    const context = createContext()
    const deps = createMockDeps()

    const result = await processAttachments(input, context, deps)

    expect(result).toBeDefined()
  })
})
