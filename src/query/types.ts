/**
 * Query loop types
 *
 * Centralized type definitions for the query loop state machine.
 */
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  ToolUseSummaryMessage,
  TombstoneMessage,
} from '../types/message.js'
import type { ToolUseContext } from '../Tool.js'
import type { SystemPrompt } from '../utils/systemPromptType.js'
import type { QuerySource } from '../constants/querySource.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { AutoCompactTrackingState } from '../services/compact/autoCompact.js'
import type { Terminal, Continue } from './transitions.js'
import type { QueryDeps } from './deps.js'

// -- QueryParams

export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
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

// -- State

export type QueryLoopState = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined
}

// -- Loop context (immutable params + deps)

export type QueryLoopContext = {
  systemPrompt: SystemPrompt
  userContext: Record<string, string>
  systemContext: Record<string, string>
  canUseTool: CanUseToolFn
  fallbackModel?: string
  querySource: QuerySource
  maxTurns?: number
  skipCacheWrite?: boolean
  deps: QueryDeps
}

// -- Yield types

export type QueryYield =
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage

// -- Tool execution result

export type ToolExecutionResult = {
  assistantMessages: AssistantMessage[]
  toolResults: (UserMessage | AttachmentMessage)[]
  updatedToolUseContext: ToolUseContext
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
}

// Helper type for UserMessage (avoid circular import)
type UserMessage = Message & { type: 'user' }
