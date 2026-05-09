/**
 * Query loop streaming phase
 *
 * Handles API streaming, message processing, and tool use block collection.
 */
import { feature } from 'bun:bundle'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
} from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { QueryDeps } from '../deps.js'
import type { QueryLoopContext } from '../types.js'
import { findToolByName } from '../../Tool.js'
import { StreamingToolExecutor } from '../../services/tools/StreamingToolExecutor.js'
import { normalizeMessagesForAPI } from '../../utils/messages.js'

export interface StreamingInput {
  messagesForQuery: Message[]
  toolUseContext: ToolUseContext
  currentModel: string
  fallbackModel?: string
  maxOutputTokensOverride: number | undefined
  fullSystemPrompt: ReturnType<typeof import('../../utils/systemPromptType.js').asSystemPrompt>
  dumpPromptsFetch?: ReturnType<QueryDeps['createDumpPromptsFetch']>
  config: {
    gates: {
      isAnt: boolean
      fastModeEnabled: boolean
    }
    sessionId: string
  }
  appState: ReturnType<ToolUseContext['getAppState']>
  queryTracking: {
    chainId: string
    depth: number
  }
  queryChainIdForAnalytics: string
  streamingToolExecutor: StreamingToolExecutor | null
  taskBudget?: { total: number; remaining?: number }
}

export interface StreamingOutput {
  assistantMessages: AssistantMessage[]
  toolResults: Message[]
  toolUseBlocks: ToolUseBlock[]
  needsFollowUp: boolean
  streamingToolExecutor: StreamingToolExecutor | null
  streamingFallbackOccured: boolean
}

export interface StreamingCallbacks {
  onMessage: (message: StreamEvent | AssistantMessage) => void
  onToolResult: (message: Message) => void
}

/**
 * Stream messages from the model and collect tool use blocks
 */
export async function* streamModelResponse(
  input: StreamingInput,
  context: QueryLoopContext,
  callbacks: StreamingCallbacks,
): AsyncGenerator<StreamEvent | AssistantMessage> {
  const { deps } = context
  const {
    prependUserContext: prependUserContextFn,
  } = deps

  const {
    messagesForQuery,
    toolUseContext,
    currentModel,
    fallbackModel,
    maxOutputTokensOverride,
    fullSystemPrompt,
    dumpPromptsFetch,
    config,
    appState,
    queryTracking,
    queryChainIdForAnalytics,
    streamingToolExecutor: initialExecutor,
    taskBudget,
  } = input

  let streamingFallbackOccured = false
  let streamingToolExecutor = initialExecutor

  const assistantMessages: AssistantMessage[] = []
  const toolResults: Message[] = []
  const toolUseBlocks: ToolUseBlock[] = []
  let needsFollowUp = false

  for await (const message of deps.callModel({
    messages: prependUserContextFn(messagesForQuery, context.userContext),
    systemPrompt: fullSystemPrompt,
    thinkingConfig: toolUseContext.options.thinkingConfig,
    tools: toolUseContext.options.tools,
    signal: toolUseContext.abortController.signal,
    options: {
      async getToolPermissionContext() {
        const state = toolUseContext.getAppState()
        return state.toolPermissionContext
      },
      model: currentModel,
      ...(config.gates.fastModeEnabled && {
        fastMode: appState.fastMode,
      }),
      toolChoice: undefined,
      isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
      fallbackModel,
      onStreamingFallback: () => {
        streamingFallbackOccured = true
      },
      querySource: context.querySource,
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
      skipCacheWrite: context.skipCacheWrite,
      agentId: toolUseContext.agentId,
      addNotification: toolUseContext.addNotification,
      ...(taskBudget && {
        taskBudget: {
          total: taskBudget.total,
          ...(taskBudget.remaining !== undefined && {
            remaining: taskBudget.remaining,
          }),
        },
      }),
      langfuseTrace: toolUseContext.langfuseTrace,
    },
  })) {
    callbacks.onMessage(message)

    if (streamingFallbackOccured) {
      for (const msg of assistantMessages) {
        yield { type: 'tombstone' as const, message: msg }
      }
      assistantMessages.length = 0
      toolResults.length = 0
      toolUseBlocks.length = 0
      needsFollowUp = false

      if (streamingToolExecutor) {
        streamingToolExecutor.discard()
        streamingToolExecutor = new StreamingToolExecutor(
          toolUseContext.options.tools,
          context.canUseTool,
          toolUseContext,
        )
      }
    }

    let yieldMessage: typeof message = message
    if (message.type === 'assistant') {
      const assistantMsg = message as AssistantMessage
      const contentArr = Array.isArray(assistantMsg.message?.content)
        ? (assistantMsg.message.content as unknown as Array<{
            type: string
            input?: unknown
            name?: string
            [key: string]: unknown
          }>)
        : []
      let clonedContent: typeof contentArr | undefined
      for (let i = 0; i < contentArr.length; i++) {
        const block = contentArr[i]!
        if (
          block.type === 'tool_use' &&
          typeof block.input === 'object' &&
          block.input !== null
        ) {
          const tool = findToolByName(
            toolUseContext.options.tools,
            block.name as string,
          )
          if (tool?.backfillObservableInput) {
            const originalInput = block.input as Record<string, unknown>
            const inputCopy = { ...originalInput }
            tool.backfillObservableInput(inputCopy)
            const addedFields = Object.keys(inputCopy).some(
              k => !(k in originalInput),
            )
            if (addedFields) {
              clonedContent ??= [...contentArr]
              clonedContent[i] = { ...block, input: inputCopy }
            }
          }
        }
      }
      if (clonedContent) {
        yieldMessage = {
          ...message,
          message: {
            ...(assistantMsg.message ?? {}),
            content: clonedContent,
          },
        } as typeof message
      }
    }

    yield yieldMessage

    if (message.type === 'assistant') {
      const assistantMessage = message as AssistantMessage
      assistantMessages.push(assistantMessage)

      const msgToolUseBlocks = (
        Array.isArray(assistantMessage.message?.content)
          ? assistantMessage.message.content
          : []
      ).filter(
        (content: { type: string }) => content.type === 'tool_use',
      ) as ToolUseBlock[]
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
          callbacks.onToolResult(result.message)
          toolResults.push(
            ...normalizeMessagesForAPI(
              [result.message],
              toolUseContext.options.tools,
            ).filter(_ => _.type === 'user'),
          )
        }
      }
    }
  }

  return {
    assistantMessages,
    toolResults,
    toolUseBlocks,
    needsFollowUp,
    streamingToolExecutor,
    streamingFallbackOccured,
  }
}
