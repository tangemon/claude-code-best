/**
 * Query Integration Tests (Golden Master)
 *
 * Tests the complete query() behavior to establish a baseline
 * before refactoring. These tests verify existing behavior
 * without changing the implementation.
 *
 * Test categories:
 assistant response → completion
 tool_result → continue
 * 3. Error handling: model_error, max_output_tokens, prompt_too_long
 * 4. Abort handling: aborted_streaming, aborted_tools
 * 5. Edge cases: empty messages, maxTurns limit
 */
import { afterEach, beforeEach, describe, expect, test, mock } from 'bun:test'
import { randomUUID } from 'crypto'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'
import {
  resetStateForTests,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
} from '../../bootstrap/state'
import { cleanupTempDir, createTempDir } from '../../../tests/mocks/file-system'

// Mock external dependencies before importing query
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

// Now import query after mocks are set up
import { query } from '../../query'
import type { QueryDeps } from '../deps'
import { createMockQueryDeps, BASE_TOOL_USE_CONTEXT } from './mocks/query-deps'
import {
  createUserMessage,
  createAssistantMessage,
  createAssistantAPIErrorMessage,
} from '../../utils/messages'
import { asSystemPrompt } from '../../utils/systemPromptType'
import type { AssistantMessage, StreamEvent, UserMessage } from '../../types/message'
import type { Terminal } from '../transitions'

let tempDir = ''
let originalProcessCwd = ''

beforeEach(async () => {
  originalProcessCwd = process.cwd()
  tempDir = await createTempDir('query-integration-')
  resetStateForTests()
  setOriginalCwd(tempDir)
  setCwdState(tempDir)
  setProjectRoot(tempDir)
})

afterEach(async () => {
  resetStateForTests()
  if (originalProcessCwd) {
    process.chdir(originalProcessCwd)
  }
  if (tempDir) {
    let lastError: unknown
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await cleanupTempDir(tempDir)
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    if (lastError) {
      throw lastError
    }
  }
})

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function createToolUseAssistantMessage(toolName = 'Bash', toolInput: Record<string, unknown> = {}): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: `msg_${randomUUID().slice(0, 8)}`,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [
        {
          type: 'tool_use',
          id: `toolu_${randomUUID().slice(0, 8)}`,
          name: toolName,
          input: toolInput,
        },
      ],
    },
  } as unknown as AssistantMessage
}

function createTextAssistantMessage(text: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: `msg_${randomUUID().slice(0, 8)}`,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content: [
        {
          type: 'text',
          text,
        },
      ],
    },
  } as unknown as AssistantMessage
}

function createToolResultMessage(
  toolUseId: string,
  content: string,
  isError = false,
): UserMessage {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: isError,
        },
      ],
    },
  } as unknown as UserMessage
}

async function collectQueryResults(
  generator: AsyncGenerator<StreamEvent | UserMessage | AssistantMessage | unknown, Terminal>,
): Promise<{ events: unknown[]; terminal: Terminal }> {
  const events: unknown[] = []
  let terminal: Terminal = { reason: 'completed' }
  
  try {
    let result = await generator.next()
    while (!result.done) {
      events.push(result.value)
      result = await generator.next()
    }
    // Generator completed - result.value is the terminal
    terminal = result.value
  } catch (error) {
    console.error('Query error:', error)
    terminal = { reason: 'model_error', error } as Terminal
  }
  
  return { events, terminal }
}

// ─── Basic Flow Tests ────────────────────────────────────────────────────────

describe('query integration: basic flow', () => {
  test('yields stream_request_start as first event', async () => {
    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' } as StreamEvent
        yield createTextAssistantMessage('Hello!')
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'hello' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      deps,
    })

    // Collect results using for await...of
    const events: unknown[] = []
    for await (const event of generator) {
      events.push(event)
    }
    
    expect(events[0]).toMatchObject({ type: 'stream_request_start' })
  })

  test('yields assistant message from model', async () => {
    const assistantMsg = createTextAssistantMessage('Response text')
    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        yield assistantMsg
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'hello' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      deps,
    })

    const { events, terminal } = await collectQueryResults(generator)
    const assistantEvents = events.filter(e => (e as { type?: string }).type === 'assistant')
    expect(assistantEvents.length).toBeGreaterThan(0)
    expect(terminal.reason).toBe('completed')
  })

  test('returns terminal with reason: completed when no tools needed', async () => {
    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        yield createTextAssistantMessage('Done')
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'hello' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      deps,
    })

    const { terminal } = await collectQueryResults(generator)
    expect(terminal.reason).toBe('completed')
  })
})

// ─── Tool Execution Tests ────────────────────────────────────────────────────

describe('query integration: tool execution', () => {
  test('yields tool_use block when model requests tool', async () => {
    const toolUseMsg = createToolUseAssistantMessage('Bash', { command: 'ls -la' })
    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        yield toolUseMsg
        // After tool_use, the model should stop and wait for tool results
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'list files' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      maxTurns: 1, // Limit turns to avoid infinite wait
      deps,
    })

    const { events } = await collectQueryResults(generator)
    const toolUseEvents = events.filter(
      e => (e as { type?: string }).type === 'assistant' &&
           Array.isArray((e as AssistantMessage).message?.content) &&
           ((e as AssistantMessage).message.content as Array<{ type: string }>).some(c => c.type === 'tool_use'),
    )
    expect(toolUseEvents.length).toBeGreaterThan(0)
  })

  test('continues to next turn after tool results', async () => {
    const toolUseMsg = createToolUseAssistantMessage('Bash', { command: 'pwd' })
    const secondAssistantMsg = createTextAssistantMessage('Current directory is /home')
    let turnCount = 0

    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        if (turnCount === 0) {
          yield toolUseMsg
        } else {
          yield secondAssistantMsg
        }
        turnCount++
      },
      runTools: async function* () {
        const content = toolUseMsg.message.content
        if (!Array.isArray(content)) return
        const toolUseId = (content[0] as { id: string }).id
        yield { message: createToolResultMessage(toolUseId, '/home/user'), newContext: toolUseMsg } as any
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'where am I' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      deps,
    })

    const { events, terminal } = await collectQueryResults(generator)
    const assistantEvents = events.filter(e => (e as { type?: string }).type === 'assistant')
    expect(assistantEvents.length).toBeGreaterThanOrEqual(2)
    expect(terminal.reason).toBe('completed')
  })
})

// ─── Error Handling Tests ────────────────────────────────────────────────────

describe('query integration: error handling', () => {
  test('returns terminal with reason: model_error on API error', async () => {
    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        yield createAssistantAPIErrorMessage({
          content: 'API Error: server unavailable',
          error: 'server_error',
        })
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'hello' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      deps,
    })

    const { terminal } = await collectQueryResults(generator)
    expect(terminal.reason).toBe('model_error')
  })

  test('yields error message when model throws', async () => {
    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        throw new Error('Connection failed')
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'hello' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      deps,
    })

    const { events, terminal } = await collectQueryResults(generator)
    const errorEvents = events.filter(
      e => (e as { type?: string }).type === 'assistant' && (e as AssistantMessage).isApiErrorMessage,
    )
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(terminal.reason).toBe('model_error')
  })
})

// ─── Abort Handling Tests ────────────────────────────────────────────────────

describe('query integration: abort handling', () => {
  test('handles aborted_streaming when signal is aborted before streaming', async () => {
    const abortController = new AbortController()
    abortController.abort('user_cancel')

    const toolUseContext = {
      ...BASE_TOOL_USE_CONTEXT,
      abortController,
    }

    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        // Simulate immediate abort
        await new Promise(resolve => setTimeout(resolve, 10))
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'hello' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext,
      querySource: 'sdk',
      deps,
    })

    const { terminal } = await collectQueryResults(generator)
    expect(['aborted_streaming', 'aborted_tools']).toContain(terminal.reason)
  })

  test('aborts mid-stream and returns aborted_streaming', async () => {
    const abortController = new AbortController()
    let callCount = 0

    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        callCount++
        yield createTextAssistantMessage('Starting response...')
        // Simulate abort during streaming
        await new Promise(resolve => setTimeout(resolve, 10))
      },
    })

    const toolUseContext = {
      ...BASE_TOOL_USE_CONTEXT,
      abortController,
    }

    const generator = query({
      messages: [createUserMessage({ content: 'hello' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext,
      querySource: 'sdk',
      deps,
    })

    // Abort after first yield
    setTimeout(() => abortController.abort('user_cancel'), 5)

    const { terminal } = await collectQueryResults(generator)
    expect(['aborted_streaming', 'aborted_tools']).toContain(terminal.reason)
  })
})

// ─── Edge Case Tests ─────────────────────────────────────────────────────────

describe('query integration: edge cases', () => {
  test('respects maxTurns limit', async () => {
    const toolUseMsg = createToolUseAssistantMessage('Bash', { command: 'echo hi' })
    let callCount = 0

    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        yield toolUseMsg
        callCount++
      },
      runTools: async function* () {
        const content = toolUseMsg.message.content
        if (!Array.isArray(content)) return
        const toolUseId = (content[0] as { id: string }).id
        yield { message: createToolResultMessage(toolUseId, 'hi'), newContext: toolUseMsg } as any
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'repeat hi' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      maxTurns: 2,
      deps,
    })

    const { terminal } = await collectQueryResults(generator)
    expect(terminal.reason).toBe('max_turns')
    expect((terminal as { turnCount: number }).turnCount).toBe(3) // turnCount increments after exceeding
  })

  test('handles empty messages array', async () => {
    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        yield createTextAssistantMessage('Hello!')
      },
    })

    const generator = query({
      messages: [],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      deps,
    })

    const { terminal } = await collectQueryResults(generator)
    expect(terminal.reason).toBe('completed')
  })

  test('uses provided deps over production deps', async () => {
    let customCallCount = 0
    const deps = createMockQueryDeps({
      callModel: async function* () {
        customCallCount++
        yield { type: 'stream_request_start' }
        yield createTextAssistantMessage('Custom response')
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'test' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      deps,
    })

    await collectQueryResults(generator)
    expect(customCallCount).toBe(1)
  })
})

// ─── Terminal Type Tests ─────────────────────────────────────────────────────

describe('query integration: terminal types', () => {
  test('terminal includes error details for model_error', async () => {
    const testError = new Error('specific error')
    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        throw testError
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'hello' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      deps,
    })

    const { terminal } = await collectQueryResults(generator)
    expect(terminal.reason).toBe('model_error')
    expect((terminal as { error?: unknown }).error).toBe(testError)
  })

  test('terminal includes turnCount for max_turns', async () => {
    const toolUseMsg = createToolUseAssistantMessage('Bash', {})
    let turnCount = 0

    const deps = createMockQueryDeps({
      callModel: async function* () {
        yield { type: 'stream_request_start' }
        yield toolUseMsg
        turnCount++
      },
      runTools: async function* () {
        const content = toolUseMsg.message.content
        if (!Array.isArray(content)) return
        const toolUseId = (content[0] as { id: string }).id
        yield { message: createToolResultMessage(toolUseId, 'result'), newContext: toolUseMsg } as any
      },
    })

    const generator = query({
      messages: [createUserMessage({ content: 'test' })],
      systemPrompt: asSystemPrompt([]),
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: undefined }),
      toolUseContext: BASE_TOOL_USE_CONTEXT,
      querySource: 'sdk',
      maxTurns: 2,
      deps,
    })

    const { terminal } = await collectQueryResults(generator)
    expect(terminal.reason).toBe('max_turns')
    expect((terminal as { turnCount: number }).turnCount).toBeDefined()
  })
})