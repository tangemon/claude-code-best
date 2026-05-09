/**
 * Query Loop
 *
 * The main query loop implementation. Handles the iterative API call flow,
 * tool execution, compaction, and recovery.
 */
import { feature } from 'bun:bundle'
import type { ToolResultBlockParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  ToolUseSummaryMessage,
  TombstoneMessage,
  UserMessage,
} from '../types/message.js'
import { FallbackTriggeredError } from '../services/api/withRetry.js'
import { findToolByName, type ToolUseContext } from '../Tool.js'
import { asSystemPrompt, type SystemPrompt } from '../utils/systemPromptType.js'
import {
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  isPromptTooLongMessage,
} from '../services/api/errors.js'
import { logAntError, logForDebugging } from '../utils/debug.js'
import {
  createUserMessage,
  createUserInterruptionMessage,
  normalizeMessagesForAPI,
  createSystemMessage,
  createAssistantAPIErrorMessage,
  getMessagesAfterCompactBoundary,
  createToolUseSummaryMessage,
  stripSignatureBlocks,
} from '../utils/messages.js'
import {
  createAttachmentMessage,
  filterDuplicateMemoryAttachments,
  getAttachmentMessages,
  startRelevantMemoryPrefetch,
} from '../utils/attachments.js'
import {
  remove as removeFromQueue,
  getCommandsByMaxPriority,
  isSlashCommand,
} from '../utils/messageQueueManager.js'
import { claimConsumableQueuedAutonomyCommands } from '../utils/autonomyQueueLifecycle.js'
import { getRuntimeMainLoopModel } from '../utils/model/model.js'
import {
  doesMostRecentAssistantMessageExceed200k,
  finalContextTokensFromLastResponse,
  tokenCountWithEstimation,
} from '../utils/tokens.js'
import { ESCALATED_MAX_TOKENS } from '../utils/context.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { SLEEP_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/SleepTool/prompt.js'
import { StreamingToolExecutor } from '../services/tools/StreamingToolExecutor.js'
import { count } from '../utils/array.js'
import {
  calculateTokenWarningState,
  estimateMaxTurnGrowth,
  getEffectiveContextWindowSize,
  isAutoCompactEnabled,
} from '../services/compact/autoCompact.js'
import { buildPostCompactMessages } from '../services/compact/compact.js'
import type { QuerySource } from '../constants/querySource.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import type { QueryDeps } from './deps.js'
import { productionDeps } from './deps.js'
import { buildQueryConfig } from './config.js'
import { createBudgetTracker, checkTokenBudget } from './tokenBudget.js'
import type { Terminal } from './transitions.js'
import type { QueryLoopState } from './types.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const reactiveCompact = feature('REACTIVE_COMPACT')
  ? (require('../services/compact/reactiveCompact.js') as typeof import('../services/compact/reactiveCompact.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

// Re-export types for external use
export type { QueryLoopState }

export interface QueryLoopParams {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: Record<string, string>
  systemContext: Record<string, string>
  canUseTool: Parameters<QueryDeps['runTools']>[2]
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
  taskBudget?: { total: number }
  deps?: QueryDeps
}

export interface QueryLoopResult {
  reason: Terminal['reason']
  error?: unknown
  turnCount?: number
  consumedCommandUuids: string[]
  consumedAutonomyCommands: QueuedCommand[]
}

const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3

/**
 * Is this a max_output_tokens error message? If so, the streaming loop should
 * withhold it from SDK callers until we know whether the recovery loop can
 * continue.
 */
function isWithheldMaxOutputTokens(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return msg?.type === 'assistant' && msg.apiError === 'max_output_tokens'
}

/**
 * The main query loop
 */
export async function* queryLoop(
  params: QueryLoopParams,
  consumedCommandUuids: string[],
  consumedAutonomyCommands: QueuedCommand[],
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  QueryLoopResult
> {
  const {
    systemPrompt,
    userContext,
    systemContext,
    canUseTool,
    fallbackModel,
    querySource,
    maxTurns,
    skipCacheWrite,
  } = params

  const deps = params.deps ?? productionDeps()

  // Destructure deps for convenience
  const {
    runTools: runToolsFn,
    generateToolUseSummary: generateToolUseSummaryFn,
    applyToolResultBudget: applyToolResultBudgetFn,
    prependUserContext: prependUserContextFn,
    appendSystemContext: appendSystemContextFn,
    createDumpPromptsFetch: createDumpPromptsFetchFn,
    notifyCommandLifecycle: notifyCommandLifecycleFn,
    headlessProfilerCheckpoint: headlessProfilerCheckpointFn,
    queryCheckpoint: queryCheckpointFn,
    recordContentReplacement: recordContentReplacementFn,
    handleStopHooks: handleStopHooksFn,
    executeStopFailureHooks: executeStopFailureHooksFn,
    executePostSamplingHooks: executePostSamplingHooksFn,
    logEvent: logEventFn,
    logError: logErrorFn,
  } = deps

  // Mutable cross-iteration state
  let state: QueryLoopState = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    maxOutputTokensOverride: params.maxOutputTokensOverride,
    autoCompactTracking: undefined,
    stopHookActive: undefined,
    maxOutputTokensRecoveryCount: 0,
    hasAttemptedReactiveCompact: false,
    turnCount: 1,
    pendingToolUseSummary: undefined,
    transition: undefined,
  }

  const budgetTracker = feature('TOKEN_BUDGET') ? createBudgetTracker() : null
  let taskBudgetRemaining: number | undefined
  const config = buildQueryConfig()

  // Start memory prefetch
  using pendingMemoryPrefetch = startRelevantMemoryPrefetch(
    state.messages,
    state.toolUseContext,
  )

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let { toolUseContext } = state
    const {
      messages,
      autoCompactTracking,
      maxOutputTokensRecoveryCount,
      hasAttemptedReactiveCompact,
      maxOutputTokensOverride,
      pendingToolUseSummary,
      stopHookActive,
      turnCount,
    } = state

    const pendingSkillPrefetch = null // Feature-gated, simplified for now

    yield { type: 'stream_request_start' }
    queryCheckpointFn('query_fn_entry')

    if (!toolUseContext.agentId) {
      headlessProfilerCheckpointFn('query_started')
    }

    // Initialize query tracking
    const queryTracking = toolUseContext.queryTracking
      ? {
          chainId: toolUseContext.queryTracking.chainId,
          depth: toolUseContext.queryTracking.depth + 1,
        }
      : {
          chainId: deps.uuid(),
          depth: 0,
        }

    const queryChainIdForAnalytics =
      queryTracking.chainId as Parameters<typeof logEventFn>[1] extends infer T ? T extends { queryChainId?: infer Q } ? Q : never : never

    toolUseContext = { ...toolUseContext, queryTracking }

    let messagesForQuery = getMessagesAfterCompactBoundary(messages)

    // Clear toolUseResult payloads
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

    // Apply tool result budget
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

    // Apply snip compact
    let snipTokensFreed = 0
    if (feature('HISTORY_SNIP')) {
      // Simplified - full implementation would call snipModule
    }

    // Apply microcompact
    queryCheckpointFn('query_microcompact_start')
    const microcompactResult = await deps.microcompact(
      messagesForQuery,
      toolUseContext,
      querySource,
    )
    messagesForQuery = microcompactResult.messages
    queryCheckpointFn('query_microcompact_end')

    // Context collapse (feature-gated)
    if (feature('CONTEXT_COLLAPSE')) {
      // Simplified - full implementation would call contextCollapse
    }

    const fullSystemPrompt = asSystemPrompt(
      appendSystemContextFn(systemPrompt, systemContext),
    )

    // Run autocompact
    queryCheckpointFn('query_autocompact_start')
    const { compactionResult, consecutiveFailures } = await deps.autocompact(
      messagesForQuery,
      toolUseContext,
      {
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        forkContextMessages: messagesForQuery,
      },
      querySource,
      tracking,
      snipTokensFreed,
    )
    queryCheckpointFn('query_autocompact_end')

    if (compactionResult) {
      logEventFn('tengu_auto_compact_succeeded', {
        originalMessageCount: messages.length,
        compactedMessageCount:
          compactionResult.summaryMessages.length +
          compactionResult.attachments.length +
          compactionResult.hookResults.length,
        preCompactTokenCount: compactionResult.preCompactTokenCount,
        postCompactTokenCount: compactionResult.postCompactTokenCount,
        truePostCompactTokenCount: compactionResult.truePostCompactTokenCount,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })

      if (params.taskBudget) {
        const preCompactContext = finalContextTokensFromLastResponse(messagesForQuery)
        taskBudgetRemaining = Math.max(
          0,
          (taskBudgetRemaining ?? params.taskBudget.total) - preCompactContext,
        )
      }

      tracking = {
        compacted: true,
        turnId: deps.uuid(),
        turnCounter: 0,
        consecutiveFailures: 0,
      }

      const postCompactMessages = buildPostCompactMessages(compactionResult)
      for (const message of postCompactMessages) {
        yield message
      }
      messagesForQuery = postCompactMessages
    } else if (consecutiveFailures !== undefined) {
      tracking = {
        ...(tracking ?? { compacted: false, turnId: '', turnCounter: 0 }),
        consecutiveFailures,
      }
    }

    toolUseContext = { ...toolUseContext, messages: messagesForQuery }

    const assistantMessages: AssistantMessage[] = []
    const toolResults: (UserMessage | AttachmentMessage)[] = []
    const toolUseBlocks: ToolUseBlock[] = []
    let needsFollowUp = false

    queryCheckpointFn('query_setup_start')
    const useStreamingToolExecution = config.gates.streamingToolExecution
    let streamingToolExecutor = useStreamingToolExecution
      ? new StreamingToolExecutor(
          toolUseContext.options.tools,
          canUseTool,
          toolUseContext,
        )
      : null

    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode
    let currentModel = getRuntimeMainLoopModel({
      permissionMode,
      mainLoopModel: toolUseContext.options.mainLoopModel,
      exceeds200kTokens:
        permissionMode === 'plan' &&
        doesMostRecentAssistantMessageExceed200k(messagesForQuery),
    })
    queryCheckpointFn('query_setup_end')

    // Create dump prompts fetch
    const dumpPromptsFetch = config.gates.isAnt
      ? createDumpPromptsFetchFn(toolUseContext.agentId ?? config.sessionId)
      : undefined

    // Check blocking limit
    let collapseOwnsIt = false
    if (feature('CONTEXT_COLLAPSE')) {
      collapseOwnsIt = false // Simplified
    }

    const mediaRecoveryEnabled = false // Simplified

    if (
      !compactionResult &&
      querySource !== 'compact' &&
      querySource !== 'session_memory' &&
      !(feature('REACTIVE_COMPACT') && isAutoCompactEnabled()) &&
      !collapseOwnsIt
    ) {
      const { isAtBlockingLimit } = calculateTokenWarningState(
        tokenCountWithEstimation(messagesForQuery) - snipTokensFreed,
        toolUseContext.options.mainLoopModel,
      )
      if (isAtBlockingLimit) {
        yield createAssistantAPIErrorMessage({
          content: PROMPT_TOO_LONG_ERROR_MESSAGE,
          error: 'invalid_request',
        })
        return {
          reason: 'blocking_limit',
          consumedCommandUuids,
          consumedAutonomyCommands,
        }
      }
    }

    // Predictive autocompact
    if (!compactionResult && isAutoCompactEnabled()) {
      const model = toolUseContext.options.mainLoopModel
      const currentTokens = tokenCountWithEstimation(messagesForQuery) - snipTokensFreed
      const estimatedGrowth = estimateMaxTurnGrowth(model)
      const predictiveThreshold = getEffectiveContextWindowSize(model) - estimatedGrowth
      if (currentTokens > predictiveThreshold) {
        const predictiveResult = await deps.autocompact(
          messagesForQuery,
          toolUseContext,
          {
            systemPrompt,
            userContext,
            systemContext,
            toolUseContext,
            forkContextMessages: messagesForQuery,
          },
          querySource,
          tracking,
          snipTokensFreed,
        )
        if (predictiveResult.compactionResult) {
          messagesForQuery = buildPostCompactMessages(predictiveResult.compactionResult)
          snipTokensFreed = 0
          tracking = tracking
            ? { ...tracking, compacted: true, consecutiveFailures: predictiveResult.consecutiveFailures ?? 0 }
            : tracking
        }
      }
    }

    let attemptWithFallback = true
    queryCheckpointFn('query_api_loop_start')

    try {
      while (attemptWithFallback) {
        attemptWithFallback = false
        try {
          let streamingFallbackOccured = false
          queryCheckpointFn('query_api_streaming_start')

          for await (const message of deps.callModel({
            messages: prependUserContextFn(messagesForQuery, userContext),
            systemPrompt: fullSystemPrompt,
            thinkingConfig: toolUseContext.options.thinkingConfig,
            tools: toolUseContext.options.tools,
            signal: toolUseContext.abortController.signal,
            options: {
              async getToolPermissionContext() {
                const appSt = toolUseContext.getAppState()
                return appSt.toolPermissionContext
              },
              model: currentModel,
              ...(config.gates.fastModeEnabled && { fastMode: appState.fastMode }),
              toolChoice: undefined,
              isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
              fallbackModel,
              onStreamingFallback: () => { streamingFallbackOccured = true },
              querySource,
              agents: toolUseContext.options.agentDefinitions.activeAgents,
              allowedAgentTypes: toolUseContext.options.agentDefinitions.allowedAgentTypes,
              hasAppendSystemPrompt: !!toolUseContext.options.appendSystemPrompt,
              maxOutputTokensOverride,
              fetchOverride: dumpPromptsFetch,
              mcpTools: appState.mcp.tools,
              hasPendingMcpServers: appState.mcp.clients.some(c => c.type === 'pending'),
              queryTracking,
              effortValue: appState.effortValue,
              advisorModel: appState.advisorModel,
              skipCacheWrite,
              agentId: toolUseContext.agentId,
              addNotification: toolUseContext.addNotification,
              ...(params.taskBudget && {
                taskBudget: {
                  total: params.taskBudget.total,
                  ...(taskBudgetRemaining !== undefined && { remaining: taskBudgetRemaining }),
                },
              }),
              langfuseTrace: toolUseContext.langfuseTrace,
            },
          })) {
            if (streamingFallbackOccured) {
              for (const msg of assistantMessages) {
                yield { type: 'tombstone' as const, message: msg }
              }
              logEventFn('tengu_orphaned_messages_tombstoned', {
                orphanedMessageCount: assistantMessages.length,
                queryChainId: queryChainIdForAnalytics,
                queryDepth: queryTracking.depth,
              })
              assistantMessages.length = 0
              toolResults.length = 0
              toolUseBlocks.length = 0
              needsFollowUp = false

              if (streamingToolExecutor) {
                streamingToolExecutor.discard()
                streamingToolExecutor = new StreamingToolExecutor(
                  toolUseContext.options.tools,
                  canUseTool,
                  toolUseContext,
                )
              }
            }

            // Backfill tool inputs
            let yieldMessage: typeof message = message
            if (message.type === 'assistant') {
              const assistantMsg = message as AssistantMessage
              const contentArr = Array.isArray(assistantMsg.message?.content)
                ? (assistantMsg.message.content as unknown as Array<{ type: string; input?: unknown; name?: string; [key: string]: unknown }>)
                : []
              let clonedContent: typeof contentArr | undefined
              for (let i = 0; i < contentArr.length; i++) {
                const block = contentArr[i]!
                if (block.type === 'tool_use' && typeof block.input === 'object' && block.input !== null) {
                  const tool = findToolByName(toolUseContext.options.tools, block.name as string)
                  if (tool?.backfillObservableInput) {
                    const originalInput = block.input as Record<string, unknown>
                    const inputCopy = { ...originalInput }
                    tool.backfillObservableInput(inputCopy)
                    const addedFields = Object.keys(inputCopy).some(k => !(k in originalInput))
                    if (addedFields) {
                      clonedContent ??= [...contentArr]
                      clonedContent[i] = { ...block, input: inputCopy }
                    }
                  }
                }
              }
              if (clonedContent) {
                yieldMessage = { ...message, message: { ...(assistantMsg.message ?? {}), content: clonedContent } } as typeof message
              }
            }

            // Withhold errors
            let withheld = false
            if (reactiveCompact?.isWithheldPromptTooLong(message as Message)) {
              withheld = true
            }
            if (isWithheldMaxOutputTokens(message)) {
              withheld = true
            }

            if (!withheld) {
              yield yieldMessage
            }

            if (message.type === 'assistant') {
              const assistantMessage = message as AssistantMessage
              assistantMessages.push(assistantMessage)

              const msgToolUseBlocks = (
                Array.isArray(assistantMessage.message?.content)
                  ? assistantMessage.message.content
                  : []
              ).filter((content: { type: string }) => content.type === 'tool_use') as ToolUseBlock[]
              if (msgToolUseBlocks.length > 0) {
                toolUseBlocks.push(...msgToolUseBlocks)
                needsFollowUp = true
              }

              if (streamingToolExecutor && !toolUseContext.abortController.signal.aborted) {
                for (const toolBlock of msgToolUseBlocks) {
                  streamingToolExecutor.addTool(toolBlock, assistantMessage)
                }
              }
            }

            if (streamingToolExecutor && !toolUseContext.abortController.signal.aborted) {
              for (const result of streamingToolExecutor.getCompletedResults()) {
                if (result.message) {
                  yield result.message
                  toolResults.push(...normalizeMessagesForAPI([result.message], toolUseContext.options.tools).filter(_ => _.type === 'user'))
                }
              }
            }
          }
          queryCheckpointFn('query_api_streaming_end')
        } catch (innerError) {
          if (innerError instanceof FallbackTriggeredError && fallbackModel) {
            currentModel = fallbackModel
            attemptWithFallback = true

            for (const msg of assistantMessages) {
              yield createUserMessage({ content: 'Model fallback triggered', toolUseResult: '' })
            }
            assistantMessages.length = 0
            toolResults.length = 0
            toolUseBlocks.length = 0
            needsFollowUp = false

            if (streamingToolExecutor) {
              streamingToolExecutor.discard()
              streamingToolExecutor = new StreamingToolExecutor(toolUseContext.options.tools, canUseTool, toolUseContext)
            }

            toolUseContext.options.mainLoopModel = fallbackModel

            if (process.env.USER_TYPE === 'ant') {
              messagesForQuery = stripSignatureBlocks(messagesForQuery)
            }

            logEventFn('tengu_model_fallback_triggered', {
              original_model: innerError.originalModel as Parameters<typeof logEventFn>[1] extends infer T ? T extends { original_model?: infer O } ? O : never : never,
              fallback_model: fallbackModel as Parameters<typeof logEventFn>[1] extends infer T ? T extends { fallback_model?: infer F } ? F : never : never,
              entrypoint: 'cli' as Parameters<typeof logEventFn>[1] extends infer T ? T extends { entrypoint?: infer E } ? E : never : never,
              queryChainId: queryChainIdForAnalytics,
              queryDepth: queryTracking.depth,
            })

            yield createSystemMessage(`Switched to ${fallbackModel} due to high demand for ${innerError.originalModel}`, 'warning')
            continue
          }
          throw innerError
        }
      }
    } catch (error) {
      logErrorFn(error)
      logEventFn('tengu_query_error', {
        assistantMessages: assistantMessages.length,
        toolUses: assistantMessages.flatMap(_ =>
          (Array.isArray(_.message?.content) ? (_.message.content as Array<{ type: string }>) : [])
            .filter(content => content.type === 'tool_use'),
        ).length,
        queryChainId: queryChainIdForAnalytics,
        queryDepth: queryTracking.depth,
      })

      if (error instanceof Error) {
        yield createAssistantAPIErrorMessage({ content: error.message })
      }
      logAntError('Query error', error)
      return { reason: 'model_error', error, consumedCommandUuids, consumedAutonomyCommands }
    }

    // Post-sampling hooks
    if (assistantMessages.length > 0) {
      void executePostSamplingHooksFn(
        messagesForQuery.concat(assistantMessages),
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        querySource,
      )
    }

    // Handle abort
    if (toolUseContext.abortController.signal.aborted) {
      if (streamingToolExecutor) {
        for await (const update of streamingToolExecutor.getRemainingResults()) {
          if (update.message) yield update.message
        }
      }
      if (toolUseContext.abortController.signal.reason !== 'interrupt') {
        yield createUserInterruptionMessage({ toolUse: !!toolUseBlocks.length })
      }
      return { reason: 'aborted_streaming', consumedCommandUuids, consumedAutonomyCommands }
    }

    // Yield pending tool use summary
    if (pendingToolUseSummary) {
      const summary = await pendingToolUseSummary
      if (summary) yield summary
    }

    if (!needsFollowUp) {
      const lastMessage = assistantMessages.at(-1)

      // Handle withheld errors
      const isWithheld413 = lastMessage?.type === 'assistant' && lastMessage.isApiErrorMessage && isPromptTooLongMessage(lastMessage)
      const isWithheldMedia = mediaRecoveryEnabled && reactiveCompact?.isWithheldMediaSizeError(lastMessage as Message)

      if (isWithheld413 || isWithheldMedia) {
        yield lastMessage!
        void executeStopFailureHooksFn(lastMessage!, toolUseContext)
        return { reason: isWithheldMedia ? 'image_error' : 'prompt_too_long', consumedCommandUuids, consumedAutonomyCommands }
      }

      // Handle max_output_tokens
      if (isWithheldMaxOutputTokens(lastMessage)) {
        const capEnabled = getFeatureValue_CACHED_MAY_BE_STALE('tengu_otk_slot_v1', false)
        if (capEnabled && maxOutputTokensOverride === undefined && !process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS) {
          logEventFn('tengu_max_tokens_escalate', { escalatedTo: ESCALATED_MAX_TOKENS })
          state = { ...state, maxOutputTokensOverride: ESCALATED_MAX_TOKENS, transition: { reason: 'max_output_tokens_escalate' } }
          continue
        }

        if (maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
          const recoveryMessage = createUserMessage({
            content: 'Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.',
            isMeta: true,
          })
          state = {
            messages: [...messagesForQuery, ...assistantMessages, recoveryMessage],
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1,
            hasAttemptedReactiveCompact,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive,
            turnCount,
            transition: { reason: 'max_output_tokens_recovery', attempt: maxOutputTokensRecoveryCount + 1 },
          }
          continue
        }
        yield lastMessage
      }

      // Handle API error
      if (lastMessage?.isApiErrorMessage) {
        void executeStopFailureHooksFn(lastMessage, toolUseContext)
        return { reason: 'model_error', error: lastMessage.error ?? lastMessage.apiError ?? 'api_error', consumedCommandUuids, consumedAutonomyCommands }
      }

      // Stop hooks
      const stopHookResult = yield* handleStopHooksFn(
        messagesForQuery,
        assistantMessages,
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        querySource,
        stopHookActive,
      )

      if (stopHookResult.preventContinuation) {
        return { reason: 'stop_hook_prevented', consumedCommandUuids, consumedAutonomyCommands }
      }

      if (stopHookResult.blockingErrors.length > 0) {
        state = {
          messages: [...messagesForQuery, ...assistantMessages, ...stopHookResult.blockingErrors],
          toolUseContext,
          autoCompactTracking: tracking,
          maxOutputTokensRecoveryCount: 0,
          hasAttemptedReactiveCompact,
          maxOutputTokensOverride: undefined,
          pendingToolUseSummary: undefined,
          stopHookActive: true,
          turnCount,
          transition: { reason: 'stop_hook_blocking' },
        }
        continue
      }

      // Token budget
      if (feature('TOKEN_BUDGET')) {
        const decision = checkTokenBudget(budgetTracker!, toolUseContext.agentId, 0, 0)
        if (decision.action === 'continue') {
          logForDebugging(`Token budget continuation`)
          state = {
            messages: [...messagesForQuery, ...assistantMessages, createUserMessage({ content: decision.nudgeMessage, isMeta: true })],
            toolUseContext,
            autoCompactTracking: tracking,
            maxOutputTokensRecoveryCount: 0,
            hasAttemptedReactiveCompact: false,
            maxOutputTokensOverride: undefined,
            pendingToolUseSummary: undefined,
            stopHookActive: undefined,
            turnCount,
            transition: { reason: 'token_budget_continuation' },
          }
          continue
        }
      }

      return { reason: 'completed', consumedCommandUuids, consumedAutonomyCommands }
    }

    // Tool execution
    let shouldPreventContinuation = false
    let updatedToolUseContext = toolUseContext

    queryCheckpointFn('query_tool_execution_start')

    if (streamingToolExecutor) {
      logEventFn('tengu_streaming_tool_execution_used', { tool_count: toolUseBlocks.length, queryChainId: queryChainIdForAnalytics, queryDepth: queryTracking.depth })
    } else {
      logEventFn('tengu_streaming_tool_execution_not_used', { tool_count: toolUseBlocks.length, queryChainId: queryChainIdForAnalytics, queryDepth: queryTracking.depth })
    }

    const toolUpdates = streamingToolExecutor
      ? streamingToolExecutor.getRemainingResults()
      : runToolsFn(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)

    for await (const update of toolUpdates) {
      if (update.message) {
        yield update.message
        if (update.message.type === 'attachment' && update.message.attachment?.type === 'hook_stopped_continuation') {
          shouldPreventContinuation = true
        }
        toolResults.push(...normalizeMessagesForAPI([update.message], toolUseContext.options.tools).filter(_ => _.type === 'user'))
      }
      if (update.newContext) {
        updatedToolUseContext = { ...update.newContext, queryTracking }
      }
    }
    queryCheckpointFn('query_tool_execution_end')

    // Generate tool use summary
    let nextPendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
    if (config.gates.emitToolUseSummaries && toolUseBlocks.length > 0 && !toolUseContext.abortController.signal.aborted && !toolUseContext.agentId) {
      const lastAssistantMessage = assistantMessages.at(-1)
      let lastAssistantText: string | undefined
      if (lastAssistantMessage) {
        const textBlocks = (Array.isArray(lastAssistantMessage.message?.content) ? (lastAssistantMessage.message.content as Array<{ type: string; text?: string }>) : []).filter(block => block.type === 'text')
        if (textBlocks.length > 0) {
          const lastTextBlock = textBlocks.at(-1)
          if (lastTextBlock && 'text' in lastTextBlock) lastAssistantText = lastTextBlock.text
        }
      }

      const toolUseIds = toolUseBlocks.map(block => block.id)
      const toolInfoForSummary = toolUseBlocks.map(block => {
        const toolResult = toolResults.find(result => result.message && Array.isArray(result.message.content) && result.message.content.some(content => content.type === 'tool_result' && (content as { tool_use_id?: string }).tool_use_id === block.id))
        const resultContent = toolResult?.message && Array.isArray(toolResult.message.content) ? toolResult.message.content.find((c): c is ToolResultBlockParam => c.type === 'tool_result' && c.tool_use_id === block.id) : undefined
        return { name: block.name, input: block.input, output: resultContent && 'content' in resultContent ? resultContent.content : null }
      })

      nextPendingToolUseSummary = generateToolUseSummaryFn({
        tools: toolInfoForSummary,
        signal: toolUseContext.abortController.signal,
        isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
        lastAssistantText,
      }).then(summary => summary ? createToolUseSummaryMessage(summary, toolUseIds) : null).catch(() => null)
    }

    // Handle abort during tools
    if (toolUseContext.abortController.signal.aborted) {
      if (toolUseContext.abortController.signal.reason !== 'interrupt') {
        yield createUserInterruptionMessage({ toolUse: true })
      }
      const nextTurnCountOnAbort = turnCount + 1
      if (maxTurns && nextTurnCountOnAbort > maxTurns) {
        yield createAttachmentMessage({ type: 'max_turns_reached', maxTurns, turnCount: nextTurnCountOnAbort })
      }
      return { reason: 'aborted_tools', consumedCommandUuids, consumedAutonomyCommands }
    }

    if (shouldPreventContinuation) {
      return { reason: 'hook_stopped', consumedCommandUuids, consumedAutonomyCommands }
    }

    if (tracking?.compacted) {
      tracking.turnCounter++
      logEventFn('tengu_post_autocompact_turn', { turnId: tracking.turnId as Parameters<typeof logEventFn>[1] extends infer T ? T extends { turnId?: infer I } ? I : never : never, turnCounter: tracking.turnCounter, queryChainId: queryChainIdForAnalytics, queryDepth: queryTracking.depth })
    }

    // Instrumentation
    logEventFn('tengu_query_before_attachments', {
      messagesForQueryCount: messagesForQuery.length,
      assistantMessagesCount: assistantMessages.length,
      toolResultsCount: toolResults.length,
      queryChainId: queryChainIdForAnalytics,
      queryDepth: queryTracking.depth,
    })

    // Process queued commands
    const sleepRan = toolUseBlocks.some(b => b.name === SLEEP_TOOL_NAME)
    const isMainThread = querySource.startsWith('repl_main_thread') || querySource === 'sdk'
    const currentAgentId = toolUseContext.agentId
    const queuedCommandsSnapshot = getCommandsByMaxPriority(sleepRan ? 'later' : 'next').filter(cmd => {
      if (isSlashCommand(cmd)) return false
      if (isMainThread) return cmd.agentId === undefined
      return cmd.mode === 'task-notification' && cmd.agentId === currentAgentId
    })
    const queuedAutonomyClaim = await claimConsumableQueuedAutonomyCommands(queuedCommandsSnapshot)
    if (queuedAutonomyClaim.staleCommands.length > 0) removeFromQueue(queuedAutonomyClaim.staleCommands)

    const claimedConsumedCommands = queuedAutonomyClaim.claimedCommands.filter(cmd => cmd.mode === 'prompt' || cmd.mode === 'task-notification')
    if (claimedConsumedCommands.length > 0) {
      consumedAutonomyCommands.push(...claimedConsumedCommands)
      for (const cmd of claimedConsumedCommands) {
        if (cmd.uuid) {
          consumedCommandUuids.push(cmd.uuid)
          notifyCommandLifecycleFn(cmd.uuid, 'started')
        }
      }
      removeFromQueue(claimedConsumedCommands)
    }

    // Process attachments
    for await (const attachment of getAttachmentMessages(null, updatedToolUseContext, null, queuedAutonomyClaim.attachmentCommands, messagesForQuery.concat(assistantMessages as Message[], toolResults as Message[]), querySource)) {
      yield attachment
      toolResults.push(attachment)
    }

    // Memory prefetch consume
    if (pendingMemoryPrefetch && pendingMemoryPrefetch.settledAt !== null && pendingMemoryPrefetch.consumedOnIteration === -1) {
      const memoryAttachments = filterDuplicateMemoryAttachments(await pendingMemoryPrefetch.promise as Parameters<typeof filterDuplicateMemoryAttachments>[0], toolUseContext.readFileState)
      for (const memAttachment of memoryAttachments) {
        const msg = createAttachmentMessage(memAttachment)
        yield msg
        toolResults.push(msg)
      }
      pendingMemoryPrefetch.consumedOnIteration = turnCount - 1
    }

    // Remove consumed commands
    const claimedCommandSet = new Set(claimedConsumedCommands)
    const consumedCommands = queuedAutonomyClaim.attachmentCommands.filter(cmd => (cmd.mode === 'prompt' || cmd.mode === 'task-notification') && !claimedCommandSet.has(cmd))
    if (consumedCommands.length > 0) {
      for (const cmd of consumedCommands) {
        if (cmd.uuid) {
          consumedCommandUuids.push(cmd.uuid)
          notifyCommandLifecycleFn(cmd.uuid, 'started')
        }
      }
      removeFromQueue(consumedCommands)
    }

    // File change count
    const fileChangeAttachmentCount = count(toolResults, tr => tr.type === 'attachment' && tr.attachment.type === 'edited_text_file')
    logEventFn('tengu_query_after_attachments', { totalToolResultsCount: toolResults.length, fileChangeAttachmentCount, queryChainId: queryChainIdForAnalytics, queryDepth: queryTracking.depth })

    // Refresh tools
    if (updatedToolUseContext.options.refreshTools) {
      const refreshedTools = updatedToolUseContext.options.refreshTools()
      if (refreshedTools !== updatedToolUseContext.options.tools) {
        updatedToolUseContext = { ...updatedToolUseContext, options: { ...updatedToolUseContext.options, tools: refreshedTools } }
      }
    }

    const toolUseContextWithQueryTracking = { ...updatedToolUseContext, queryTracking }
    const nextTurnCount = turnCount + 1

    // Max turns check
    if (maxTurns && nextTurnCount > maxTurns) {
      yield createAttachmentMessage({ type: 'max_turns_reached', maxTurns, turnCount: nextTurnCount })
      return { reason: 'max_turns', turnCount: nextTurnCount, consumedCommandUuids, consumedAutonomyCommands }
    }

    queryCheckpointFn('query_recursive_call')
    state = {
      messages: messagesForQuery.concat(assistantMessages, toolResults),
      toolUseContext: toolUseContextWithQueryTracking,
      autoCompactTracking: tracking,
      turnCount: nextTurnCount,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedReactiveCompact: false,
      pendingToolUseSummary: nextPendingToolUseSummary,
      maxOutputTokensOverride: undefined,
      stopHookActive,
      transition: { reason: 'next_turn' },
    }
  }
}
