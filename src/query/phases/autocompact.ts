/**
 * Query loop autocompact phase
 *
 * Handles automatic context compaction when approaching token limits.
 */
import { feature } from 'bun:bundle'
import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import type { QueryDeps } from '../deps.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { buildPostCompactMessages } from '../../services/compact/compact.js'
import type { AutoCompactTrackingState } from '../../services/compact/autoCompact.js'

export interface AutocompactResult {
  messagesForQuery: Message[]
  tracking: AutoCompactTrackingState | undefined
  compactionOccurred: boolean
}

/**
 * Run autocompact if needed
 */
export async function runAutocompact(
  messagesForQuery: Message[],
  toolUseContext: ToolUseContext,
  systemPrompt: SystemPrompt,
  userContext: Record<string, string>,
  systemContext: Record<string, string>,
  querySource: string,
  tracking: AutoCompactTrackingState | undefined,
  snipTokensFreed: number,
  deps: QueryDeps,
): Promise<AutocompactResult> {
  const {
    appendSystemContext: appendSystemContextFn,
    autocompact,
    uuid,
    logEvent: logEventFn,
  } = deps

  const fullSystemPrompt = asSystemPrompt(
    appendSystemContextFn(systemPrompt, systemContext),
  )

  const { compactionResult, consecutiveFailures } = await autocompact(
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

  if (compactionResult) {
    const postCompactMessages = buildPostCompactMessages(compactionResult)

    // Reset tracking after compaction
    tracking = {
      compacted: true,
      turnId: uuid(),
      turnCounter: 0,
      consecutiveFailures: 0,
    }

    return {
      messagesForQuery: postCompactMessages,
      tracking,
      compactionOccurred: true,
    }
  } else if (consecutiveFailures !== undefined) {
    // Autocompact failed — propagate failure count
    tracking = {
      ...(tracking ?? { compacted: false, turnId: '', turnCounter: 0 }),
      consecutiveFailures,
    }
  }

  return {
    messagesForQuery,
    tracking,
    compactionOccurred: false,
  }
}
