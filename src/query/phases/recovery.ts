/**
 * Query loop recovery phase
 *
 * Handles error recovery, prompt-too-long recovery, and max_output_tokens recovery.
 */
import { feature } from 'bun:bundle'
import type { Message, StreamEvent } from '../../types/message.js'
import type { AssistantMessage } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { QueryDeps } from '../deps.js'
import type { QueryLoopContext, QueryLoopState } from '../types.js'
import { isPromptTooLongMessage } from '../../services/api/errors.js'
import { buildPostCompactMessages } from '../../services/compact/compact.js'
import { createUserMessage } from '../../utils/messages.js'
import { ESCALATED_MAX_TOKENS } from '../../utils/context.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { AutoCompactTrackingState } from '../../services/compact/autoCompact.js'

export interface RecoveryInput {
  messagesForQuery: Message[]
  assistantMessages: AssistantMessage[]
  toolUseContext: ToolUseContext
  tracking: AutoCompactTrackingState | undefined
  maxOutputTokensOverride: number | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  pendingToolUseSummary: Promise<unknown> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  taskBudgetRemaining: number | undefined
  taskBudget?: { total: number }
  state: QueryLoopState
}

export type RecoveryAction =
  | { type: 'continue'; state: QueryLoopState }
  | { type: 'return'; terminal: { reason: string; error?: unknown } }
  | { type: 'none' }

export interface RecoveryContext {
  deps: QueryDeps
  context: QueryLoopContext
  mediaRecoveryEnabled: boolean
}

/**
 * Check for withheld errors and attempt recovery
 */
export function checkWithheldErrors(
  lastMessage: AssistantMessage | undefined,
  _input: RecoveryInput,
  context: RecoveryContext,
): { isWithheld413: boolean; isWithheldMedia: boolean } {
  const { mediaRecoveryEnabled } = context

  const isWithheld413 = Boolean(
    lastMessage?.type === 'assistant' &&
    lastMessage.isApiErrorMessage &&
    isPromptTooLongMessage(lastMessage),
  )

  const isWithheldMedia = Boolean(mediaRecoveryEnabled)

  return { isWithheld413, isWithheldMedia }
}

/**
 * Attempt recovery from max_output_tokens error
 */
export function attemptMaxTokensRecovery(
  lastMessage: AssistantMessage | undefined,
  input: RecoveryInput,
  context: RecoveryContext,
): RecoveryAction {
  const {
    messagesForQuery,
    assistantMessages,
    toolUseContext,
    tracking,
    maxOutputTokensOverride,
    maxOutputTokensRecoveryCount,
    hasAttemptedReactiveCompact,
    pendingToolUseSummary,
    stopHookActive,
    turnCount,
    state,
  } = input

  if (!isWithheldMaxOutputTokens(lastMessage)) {
    return { type: 'none' }
  }

  const capEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_otk_slot_v1',
    false,
  )

  if (
    capEnabled &&
    maxOutputTokensOverride === undefined &&
    !process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
  ) {
    const { logEvent: logEventFn } = context.deps
    logEventFn('tengu_max_tokens_escalate', {
      escalatedTo: ESCALATED_MAX_TOKENS,
    })

    return {
      type: 'continue',
      state: {
        messages: messagesForQuery,
        toolUseContext,
        autoCompactTracking: tracking,
        maxOutputTokensRecoveryCount,
        hasAttemptedReactiveCompact,
        maxOutputTokensOverride: ESCALATED_MAX_TOKENS,
        pendingToolUseSummary: pendingToolUseSummary as QueryLoopState['pendingToolUseSummary'],
        stopHookActive,
        turnCount,
        transition: { reason: 'max_output_tokens_escalate' },
      },
    }
  }

  const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3
  if (maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
    const recoveryMessage = createUserMessage({
      content:
        `Output token limit hit. Resume directly — no apology, no recap of what you were doing. ` +
        `Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.`,
      isMeta: true,
    })

    return {
      type: 'continue',
      state: {
        messages: [...messagesForQuery, ...assistantMessages, recoveryMessage],
        toolUseContext,
        autoCompactTracking: tracking,
        maxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1,
        hasAttemptedReactiveCompact,
        maxOutputTokensOverride: undefined,
        pendingToolUseSummary: pendingToolUseSummary as QueryLoopState['pendingToolUseSummary'],
        stopHookActive,
        turnCount,
        transition: {
          reason: 'max_output_tokens_recovery',
          attempt: maxOutputTokensRecoveryCount + 1,
        },
      },
    }
  }

  return { type: 'none' }
}

/**
 * Check if a message is a withheld max_output_tokens error
 */
function isWithheldMaxOutputTokens(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return msg?.type === 'assistant' && (msg as AssistantMessage).apiError === 'max_output_tokens'
}
