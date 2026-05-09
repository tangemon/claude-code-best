/**
 * Query loop tool execution phase
 *
 * Handles tool execution and summary generation.
 */
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ToolUseSummaryMessage,
} from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { QueryDeps } from '../deps.js'
import { normalizeMessagesForAPI, createToolUseSummaryMessage } from '../../utils/messages.js'
import { StreamingToolExecutor } from '../../services/tools/StreamingToolExecutor.js'

export interface ToolExecutionInput {
  toolUseBlocks: ToolUseBlock[]
  assistantMessages: AssistantMessage[]
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  config: {
    emitToolUseSummaries: boolean
  }
}

export interface ToolExecutionOutput {
  toolResults: (Message & { type: 'user' })[]
  updatedToolUseContext: ToolUseContext
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  streamingToolExecutor: StreamingToolExecutor | null
}

/**
 * Execute tools and generate summaries
 */
export async function executeTools(
  input: ToolExecutionInput,
  deps: QueryDeps,
): Promise<ToolExecutionOutput> {
  const {
    runTools: runToolsFn,
    generateToolUseSummary: generateToolUseSummaryFn,
  } = deps

  const { toolUseBlocks, assistantMessages, canUseTool, toolUseContext, config } = input

  const toolResults: (Message & { type: 'user' })[] = []
  let updatedToolUseContext = toolUseContext
  let streamingToolExecutor: StreamingToolExecutor | null = null

  // Execute tools
  const toolUpdates = runToolsFn(
    toolUseBlocks,
    assistantMessages,
    canUseTool,
    toolUseContext,
  )

  for await (const update of toolUpdates) {
    if (update.message) {
      toolResults.push(
        ...normalizeMessagesForAPI(
          [update.message],
          toolUseContext.options.tools,
        ).filter(_ => _.type === 'user') as (Message & { type: 'user' })[],
      )
    }
    if (update.newContext) {
      updatedToolUseContext = update.newContext
    }
  }

  // Generate tool use summary
  let pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  if (
    config.emitToolUseSummaries &&
    toolUseBlocks.length > 0 &&
    !toolUseContext.abortController.signal.aborted &&
    !toolUseContext.agentId
  ) {
    const lastAssistantMessage = assistantMessages.at(-1)
    let lastAssistantText: string | undefined
    if (lastAssistantMessage) {
      const textBlocks = (
        Array.isArray(lastAssistantMessage.message?.content)
          ? (lastAssistantMessage.message.content as Array<{
              type: string
              text?: string
            }>)
          : []
      ).filter(block => block.type === 'text')
      if (textBlocks.length > 0) {
        const lastTextBlock = textBlocks.at(-1)
        if (lastTextBlock && 'text' in lastTextBlock) {
          lastAssistantText = lastTextBlock.text
        }
      }
    }

    const toolUseIds = toolUseBlocks.map(block => block.id)
    const toolInfoForSummary = toolUseBlocks.map(block => {
      const toolResult = toolResults.find(
        result =>
          result.message &&
          Array.isArray(result.message.content) &&
          result.message.content.some(
            content =>
              content.type === 'tool_result' &&
              (content as { tool_use_id?: string }).tool_use_id === block.id,
          ),
      )
      const resultContent =
        toolResult?.message && Array.isArray(toolResult.message.content)
          ? toolResult.message.content.find(
              (c): c is ToolResultBlockParam =>
                c.type === 'tool_result' && c.tool_use_id === block.id,
            )
          : undefined
      return {
        name: block.name,
        input: block.input,
        output:
          resultContent && 'content' in resultContent
            ? resultContent.content
            : null,
      }
    })

    pendingToolUseSummary = generateToolUseSummaryFn({
      tools: toolInfoForSummary,
      signal: toolUseContext.abortController.signal,
      isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
      lastAssistantText,
    })
      .then(summary => {
        if (summary) {
          return createToolUseSummaryMessage(summary, toolUseIds)
        }
        return null
      })
      .catch(() => null)
  }

  return {
    toolResults,
    updatedToolUseContext,
    pendingToolUseSummary,
    streamingToolExecutor,
  }
}
