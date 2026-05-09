/**
 * Query Module Entry Point
 *
 * This is the main entry point for the query system. It provides the public API
 * and handles cross-cutting concerns like tracing and autonomy lifecycle.
 *
 * The core loop logic is delegated to query/loop.ts for better modularity.
 */
import type {
  AssistantMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  ToolUseSummaryMessage,
  TombstoneMessage,
} from './types/message.js'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from './hooks/useCanUseTool.js'
import type { ToolUseContext } from './Tool.js'
import type { SystemPrompt } from './utils/systemPromptType.js'
import type { QuerySource } from './constants/querySource.js'
import type { QueuedCommand } from './types/textInputTypes.js'
import { createUserMessage } from './utils/messages.js'
import { logError } from './utils/log.js'
import { logForDebugging } from './utils/debug.js'
import {
  finalizeAutonomyCommandsForTurn,
  type AutonomyTurnOutcome,
} from './utils/autonomyQueueLifecycle.js'
import { enqueue } from './utils/messageQueueManager.js'
import {
  createTrace,
  endTrace,
  flushLangfuse,
  isLangfuseEnabled,
} from './services/langfuse/index.js'
import { getSessionId } from './bootstrap/state.js'
import { getAPIProvider } from './utils/model/providers.js'
import type { QueryDeps } from './query/deps.js'
import { productionDeps } from './query/deps.js'
import { queryLoop, type QueryLoopParams, type QueryLoopResult } from './query/loop.js'
import type { Terminal } from './query/transitions.js'

// Re-export types for external use
export type { QueryLoopParams, QueryLoopResult }
export { queryLoop }

// Query loop state type (re-exported for convenience)
export type { QueryLoopState } from './query/types.js'

/**
 * Query parameters for the public API
 */
export interface QueryParams {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: Record<string, string>
  systemContext: Record<string, string>
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
  taskBudget?: { total: number }
  deps?: QueryDeps
}

/**
 * Yield missing tool result blocks when an error occurs mid-stream.
 * This ensures each tool_use has a corresponding tool_result.
 */
function* yieldMissingToolResultBlocks(
  assistantMessages: AssistantMessage[],
  errorMessage: string,
): Generator<Message> {
  for (const assistantMessage of assistantMessages) {
    const toolUseBlocks = (
      Array.isArray(assistantMessage.message?.content)
        ? assistantMessage.message.content
        : []
    ).filter(
      (content: { type: string }) => content.type === 'tool_use',
    ) as ToolUseBlock[]

    for (const toolUse of toolUseBlocks) {
      yield createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: errorMessage,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: errorMessage,
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
  }
}

/**
 * Get the autonomy turn outcome from terminal state
 */
function getAutonomyTurnOutcome(params: {
  terminal?: Terminal
  thrownError?: unknown
}): AutonomyTurnOutcome {
  if (params.thrownError !== undefined) {
    return { type: 'failed', error: params.thrownError }
  }

  const terminal = params.terminal
  const reason = terminal?.reason
  switch (reason) {
    case 'completed':
      return { type: 'completed' }
    case undefined:
    case 'aborted_streaming':
    case 'aborted_tools':
      return { type: 'cancelled' }
    case 'model_error':
      return { type: 'failed', error: terminal.error }
    default:
      return {
        type: 'failed',
        message: `query ended without successful completion: ${reason}`,
      }
  }
}

/**
 * The main query function - public API entry point.
 *
 * This function handles cross-cutting concerns:
 * - Langfuse tracing
 * - Autonomy command lifecycle
 * - Performance buffer cleanup
 *
 * The actual query loop logic is delegated to queryLoop().
 */
export async function* query(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  Terminal
> {
  const consumedCommandUuids: string[] = []
  const consumedAutonomyCommands: QueuedCommand[] = []

  // Get deps for query-level functions
  const { logError: logErrorFn, notifyCommandLifecycle: notifyCommandLifecycleFn } = params.deps ?? productionDeps()

  // Create Langfuse trace for this query turn (no-op if not configured)
  const ownsTrace = !params.toolUseContext.langfuseTrace
  logForDebugging(
    `[query] ownsTrace=${ownsTrace} incoming langfuseTrace=${params.toolUseContext.langfuseTrace ? 'present' : 'null/undefined'} isLangfuseEnabled=${isLangfuseEnabled()}`,
  )
  const langfuseTrace =
    params.toolUseContext.langfuseTrace ??
    (isLangfuseEnabled()
      ? createTrace({
          sessionId: getSessionId(),
          model: params.toolUseContext.options.mainLoopModel,
          provider: getAPIProvider(),
          input: params.messages,
          querySource: params.querySource,
        })
      : null)

  // Attach trace to toolUseContext
  const paramsWithTrace: QueryParams = langfuseTrace
    ? { ...params, toolUseContext: { ...params.toolUseContext, langfuseTrace } }
    : params

  let terminal: Terminal | undefined
  let didThrow = false
  let thrownError: unknown

  try {
    // Delegate to queryLoop
    const loopResult = yield* queryLoop(
      paramsWithTrace,
      consumedCommandUuids,
      consumedAutonomyCommands,
    )
    terminal = { reason: loopResult.reason, error: loopResult.error, turnCount: loopResult.turnCount } as Terminal
  } catch (error) {
    didThrow = true
    thrownError = error
    throw error
  } finally {
    // Finalize autonomy commands
    await finalizeAutonomyCommandsForTurn({
      commands: consumedAutonomyCommands,
      outcome: getAutonomyTurnOutcome({ terminal, ...(didThrow ? { thrownError } : {}) }),
      priority: 'later',
    })
      .then(nextCommands => {
        for (const command of nextCommands) {
          enqueue(command)
        }
      })
      .catch(logErrorFn)

    // End Langfuse trace
    if (ownsTrace && langfuseTrace) {
      const isAborted =
        terminal?.reason === 'aborted_streaming' ||
        terminal?.reason === 'aborted_tools'
      endTrace(langfuseTrace, undefined, isAborted ? 'interrupted' : undefined)
      await flushLangfuse()
    }

    // Break closure chain
    if (paramsWithTrace !== params) {
      paramsWithTrace.toolUseContext.langfuseTrace = null
      paramsWithTrace.toolUseContext.langfuseRootTrace = null
      paramsWithTrace.toolUseContext.langfuseBatchSpan = null
    }

    // Clear performance buffers
    const gPerf = globalThis.performance
    if (gPerf && typeof gPerf.clearMarks === 'function') {
      try {
        gPerf.clearMarks()
        gPerf.clearMeasures?.()
        gPerf.clearResourceTimings?.()
      } catch {
        // Non-critical
      }
    }
  }

  // Notify command completion
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycleFn(uuid, 'completed')
  }

  return terminal!
}
