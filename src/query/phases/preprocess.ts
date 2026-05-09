/**
 * Query loop preprocessing phase
 *
 * Handles message preprocessing, budget enforcement, and context preparation.
 */
import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { QueryDeps } from '../deps.js'
import type { QueryLoopContext } from '../types.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import type { AutoCompactTrackingState } from '../../services/compact/autoCompact.js'

export interface PreprocessResult {
  messagesForQuery: Message[]
  toolUseContext: ToolUseContext
  tracking: AutoCompactTrackingState | undefined
  snipTokensFreed: number
}

/**
 * Preprocess messages before API call
 *
 * - Clears toolUseResult payloads from previous turns
 * - Applies tool result budget enforcement
 * - Handles snip compact if enabled
 */
export async function preprocessMessages(
  messages: Message[],
  toolUseContext: ToolUseContext,
  autoCompactTracking: AutoCompactTrackingState | undefined,
  querySource: string,
  deps: QueryDeps,
): Promise<PreprocessResult> {
  const {
    applyToolResultBudget: applyToolResultBudgetFn,
    recordContentReplacement: recordContentReplacementFn,
    logError: logErrorFn,
  } = deps

  let messagesForQuery = getMessagesAfterCompactBoundary(messages)

  // Release toolUseResult payloads from previous turns
  for (const msg of messagesForQuery) {
    if (
      msg.type === 'user' &&
      'toolUseResult' in msg &&
      msg.toolUseResult !== undefined
    ) {
      delete (msg as Message & { toolUseResult?: unknown }).toolUseResult
    }
  }

  let tracking = autoCompactTracking

  // Enforce per-message budget on aggregate tool result size
  const persistReplacements =
    querySource.startsWith('agent:') ||
    querySource.startsWith('repl_main_thread')

  messagesForQuery = await applyToolResultBudgetFn(
    messagesForQuery,
    toolUseContext.contentReplacementState,
    persistReplacements
      ? records =>
          void recordContentReplacementFn(
            records,
            toolUseContext.agentId,
          ).catch(logErrorFn)
      : undefined,
    new Set(
      toolUseContext.options.tools
        .filter(t => !Number.isFinite(t.maxResultSizeChars))
        .map(t => t.name),
    ),
  )

  return {
    messagesForQuery,
    toolUseContext,
    tracking,
    snipTokensFreed: 0,
  }
}
