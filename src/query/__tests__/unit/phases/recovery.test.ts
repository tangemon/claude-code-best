/**
 * Unit tests for phases/recovery.ts
 */
import { describe, test, expect, vi } from 'vitest'
import { checkWithheldErrors, attemptMaxTokensRecovery } from '../../../phases/recovery.js'
import type { RecoveryInput, RecoveryContext } from '../../../phases/recovery.js'
import type { QueryDeps } from '../../../deps.js'
import type { AssistantMessage } from '../../../../types/message.js'

describe('checkWithheldErrors', () => {
  const createMockContext = (): RecoveryContext => ({
    deps: {} as QueryDeps,
    context: {} as any,
    mediaRecoveryEnabled: false,
  })

  test('returns isWithheld413 false for non-error message', () => {
    const lastMessage: AssistantMessage = {
      type: 'assistant',
      id: 'test',
      message: { role: 'assistant', content: [] },
      timestamp: Date.now(),
    } as AssistantMessage

    const input: RecoveryInput = {
      messagesForQuery: [],
      assistantMessages: [],
      toolUseContext: {} as any,
      tracking: undefined,
      maxOutputTokensOverride: undefined,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedReactiveCompact: false,
      pendingToolUseSummary: undefined,
      stopHookActive: undefined,
      turnCount: 1,
      taskBudgetRemaining: undefined,
      taskBudget: undefined,
      state: { turnCount: 1, maxOutputTokensRecoveryCount: 0 },
    }

    const context = createMockContext()
    const result = checkWithheldErrors(lastMessage, input, context)

    expect(result.isWithheld413).toBe(false)
  })

  test('returns isWithheldMedia based on context', () => {
    const lastMessage: AssistantMessage = {
      type: 'assistant',
      id: 'test',
      message: { role: 'assistant', content: [] },
      timestamp: Date.now(),
    } as AssistantMessage

    const input: RecoveryInput = {
      messagesForQuery: [],
      assistantMessages: [],
      toolUseContext: {} as any,
      tracking: undefined,
      maxOutputTokensOverride: undefined,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedReactiveCompact: false,
      pendingToolUseSummary: undefined,
      stopHookActive: undefined,
      turnCount: 1,
      taskBudgetRemaining: undefined,
      taskBudget: undefined,
      state: { turnCount: 1, maxOutputTokensRecoveryCount: 0 },
    }

    const contextDisabled = createMockContext()
    contextDisabled.mediaRecoveryEnabled = false
    const resultDisabled = checkWithheldErrors(lastMessage, input, contextDisabled)
    expect(resultDisabled.isWithheldMedia).toBe(false)

    const contextEnabled = createMockContext()
    contextEnabled.mediaRecoveryEnabled = true
    const resultEnabled = checkWithheldErrors(lastMessage, input, contextEnabled)
    expect(resultEnabled.isWithheldMedia).toBe(true)
  })

  test('returns isWithheld413 false when lastMessage is undefined', () => {
    const input: RecoveryInput = {
      messagesForQuery: [],
      assistantMessages: [],
      toolUseContext: {} as any,
      tracking: undefined,
      maxOutputTokensOverride: undefined,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedReactiveCompact: false,
      pendingToolUseSummary: undefined,
      stopHookActive: undefined,
      turnCount: 1,
      taskBudgetRemaining: undefined,
      taskBudget: undefined,
      state: { turnCount: 1, maxOutputTokensRecoveryCount: 0 },
    }

    const context = createMockContext()
    const result = checkWithheldErrors(undefined, input, context)

    expect(result.isWithheld413).toBe(false)
  })
})

describe('attemptMaxTokensRecovery', () => {
  const createMockContext = (): RecoveryContext => ({
    deps: {} as QueryDeps,
    context: {} as any,
    mediaRecoveryEnabled: false,
  })

  const createInput = (): RecoveryInput => ({
    messagesForQuery: [],
    assistantMessages: [],
    toolUseContext: {} as any,
    tracking: undefined,
    maxOutputTokensOverride: undefined,
    maxOutputTokensRecoveryCount: 0,
    hasAttemptedReactiveCompact: false,
    pendingToolUseSummary: undefined,
    stopHookActive: undefined,
    turnCount: 1,
    taskBudgetRemaining: undefined,
    taskBudget: undefined,
    state: { turnCount: 1, maxOutputTokensRecoveryCount: 0 },
  })

  test('returns type none when lastMessage is undefined', () => {
    const input = createInput()
    const context = createMockContext()

    const result = attemptMaxTokensRecovery(undefined, input, context)

    expect(result.type).toBe('none')
  })

  test('returns type none for non-max-tokens error message', () => {
    const lastMessage: AssistantMessage = {
      type: 'assistant',
      id: 'test',
      message: { role: 'assistant', content: [] },
      timestamp: Date.now(),
    } as AssistantMessage

    const input = createInput()
    const context = createMockContext()

    const result = attemptMaxTokensRecovery(lastMessage, input, context)

    expect(result.type).toBe('none')
  })

  test('returns type continue when maxOutputTokensRecoveryCount is less than 3', () => {
    const lastMessage: AssistantMessage = {
      type: 'assistant',
      id: 'test',
      message: { role: 'assistant', content: [] },
      timestamp: Date.now(),
      apiError: 'max_output_tokens',
    } as AssistantMessage

    const input = createInput()
    input.maxOutputTokensRecoveryCount = 1
    const context = createMockContext()

    const result = attemptMaxTokensRecovery(lastMessage, input, context)

    expect(result.type).toBe('continue')
  })
})
