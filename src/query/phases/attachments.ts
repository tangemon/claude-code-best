/**
 * Query loop attachments phase
 *
 * Handles queued commands and attachment processing.
 */
import type { Message, AttachmentMessage } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import type { QueryDeps } from '../deps.js'
import {
  getCommandsByMaxPriority,
  remove as removeFromQueue,
  isSlashCommand,
} from '../../utils/messageQueueManager.js'
import {
  claimConsumableQueuedAutonomyCommands,
} from '../../utils/autonomyQueueLifecycle.js'
import {
  getAttachmentMessages,
  filterDuplicateMemoryAttachments,
  createAttachmentMessage,
} from '../../utils/attachments.js'
import { SLEEP_TOOL_NAME } from '@claude-code-best/builtin-tools/tools/SleepTool/prompt.js'

export interface AttachmentsInput {
  messagesForQuery: Message[]
  assistantMessages: Message[]
  toolResults: Message[]
  toolUseBlocks: Array<{ name: string }>
  toolUseContext: ToolUseContext
  querySource: string
  pendingMemoryPrefetch: {
    promise: Promise<unknown[]>
    settledAt: number | null
    consumedOnIteration: number
  } | null
  turnCount: number
}

export interface AttachmentsOutput {
  toolResults: Message[]
  consumedCommandUuids: string[]
  consumedAutonomyCommands: QueuedCommand[]
}

export interface AttachmentsContext {
  consumedCommandUuids: string[]
  consumedAutonomyCommands: QueuedCommand[]
}

/**
 * Process attachments (queued commands, memory prefetch, skill prefetch)
 */
export async function processAttachments(
  input: AttachmentsInput,
  context: AttachmentsContext,
  deps: QueryDeps,
): Promise<AttachmentsOutput> {
  const { notifyCommandLifecycle: notifyCommandLifecycleFn } = deps

  const {
    messagesForQuery,
    assistantMessages,
    toolResults,
    toolUseBlocks,
    toolUseContext,
    querySource,
    pendingMemoryPrefetch,
    turnCount,
  } = input

  const { consumedCommandUuids, consumedAutonomyCommands } = context

  const toolResultsOut: Message[] = [...toolResults]

  // Get queued commands snapshot
  const sleepRan = toolUseBlocks.some(b => b.name === SLEEP_TOOL_NAME)
  const isMainThread =
    querySource.startsWith('repl_main_thread') || querySource === 'sdk'
  const currentAgentId = toolUseContext.agentId

  const queuedCommandsSnapshot = getCommandsByMaxPriority(
    sleepRan ? 'later' : 'next',
  ).filter(cmd => {
    if (isSlashCommand(cmd)) return false
    if (isMainThread) return cmd.agentId === undefined
    return cmd.mode === 'task-notification' && cmd.agentId === currentAgentId
  })

  const queuedAutonomyClaim = await claimConsumableQueuedAutonomyCommands(
    queuedCommandsSnapshot,
  )

  if (queuedAutonomyClaim.staleCommands.length > 0) {
    removeFromQueue(queuedAutonomyClaim.staleCommands)
  }

  const claimedConsumedCommands = queuedAutonomyClaim.claimedCommands.filter(
    cmd => cmd.mode === 'prompt' || cmd.mode === 'task-notification',
  )

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

  // Process attachment messages
  for await (const attachment of getAttachmentMessages(
    null,
    toolUseContext,
    null,
    queuedAutonomyClaim.attachmentCommands,
    messagesForQuery.concat(assistantMessages as Message[], toolResults as Message[]),
    querySource,
  )) {
    toolResultsOut.push(attachment)
  }

  // Memory prefetch consume
  if (
    pendingMemoryPrefetch &&
    pendingMemoryPrefetch.settledAt !== null &&
    pendingMemoryPrefetch.consumedOnIteration === -1
  ) {
    const memoryAttachments = filterDuplicateMemoryAttachments(
      await pendingMemoryPrefetch.promise as Parameters<typeof filterDuplicateMemoryAttachments>[0],
      toolUseContext.readFileState,
    )
    for (const memAttachment of memoryAttachments) {
      const msg = createAttachmentMessage(memAttachment)
      toolResultsOut.push(msg)
    }
    pendingMemoryPrefetch.consumedOnIteration = turnCount - 1
  }

  // Remove consumed commands
  const claimedCommandSet = new Set(claimedConsumedCommands)
  const consumedCommands = queuedAutonomyClaim.attachmentCommands.filter(
    cmd =>
      (cmd.mode === 'prompt' || cmd.mode === 'task-notification') &&
      !claimedCommandSet.has(cmd),
  )

  if (consumedCommands.length > 0) {
    for (const cmd of consumedCommands) {
      if (cmd.uuid) {
        consumedCommandUuids.push(cmd.uuid)
        notifyCommandLifecycleFn(cmd.uuid, 'started')
      }
    }
    removeFromQueue(consumedCommands)
  }

  return {
    toolResults: toolResultsOut,
    consumedCommandUuids,
    consumedAutonomyCommands,
  }
}
