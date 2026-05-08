import { randomUUID } from 'crypto'
import { queryModelWithStreaming } from '../services/api/claude.js'
import { autoCompactIfNeeded } from '../services/compact/autoCompact.js'
import { microcompactMessages } from '../services/compact/microCompact.js'
import { runTools } from '../services/tools/toolOrchestration.js'
import { generateToolUseSummary } from '../services/toolUseSummary/toolUseSummaryGenerator.js'
import { applyToolResultBudget } from '../utils/toolResultStorage.js'
import { prependUserContext, appendSystemContext } from '../utils/api.js'
import { createDumpPromptsFetch } from '../services/api/dumpPrompts.js'
import { notifyCommandLifecycle } from '../utils/commandLifecycle.js'
import { headlessProfilerCheckpoint } from '../utils/headlessProfiler.js'
import { queryCheckpoint } from '../utils/queryProfiler.js'
import { recordContentReplacement } from '../utils/sessionStorage.js'
import type { ToolUseContext } from '../Tool.js'
import type { AssistantMessage, Message, ToolUseSummaryMessage } from '../types/message.js'
import type { SystemPrompt } from '../utils/systemPromptType.js'
import type { QuerySource } from '../constants/querySource.js'

// -- types

export type StopHookResult = {
  blockingErrors: Message[]
  preventContinuation: boolean
}

// Tool use summary generation result
export type ToolUseSummaryResult = {
  name: string
  input: Record<string, unknown>
  output: unknown
}

// -- deps

// I/O dependencies for query(). Passing a `deps` override into QueryParams
// lets tests inject fakes directly instead of spyOn-per-module — the most
// common mocks (callModel, autocompact) are each spied in 6-8 test files
// today with module-import-and-spy boilerplate.
//
// Using `typeof fn` keeps signatures in sync with the real implementations
// automatically. This file imports the real functions for both typing and
// the production factory — tests that import this file for typing are
// already importing query.ts (which imports everything), so there's no
// new module-graph cost.
export type QueryDeps = {
  // -- model
  callModel: typeof queryModelWithStreaming

  // -- compaction
  microcompact: typeof microcompactMessages
  autocompact: typeof autoCompactIfNeeded

  // -- platform
  uuid: () => string

  // -- tool execution
  runTools: typeof runTools

  // -- tool summary
  generateToolUseSummary: typeof generateToolUseSummary

  // -- tool result budget
  applyToolResultBudget: typeof applyToolResultBudget

  // -- context
  prependUserContext: typeof prependUserContext
  appendSystemContext: typeof appendSystemContext

  // -- dump prompts
  createDumpPromptsFetch: typeof createDumpPromptsFetch

  // -- command lifecycle
  notifyCommandLifecycle: typeof notifyCommandLifecycle

  // -- profiling
  headlessProfilerCheckpoint: typeof headlessProfilerCheckpoint
  queryCheckpoint: typeof queryCheckpoint

  // -- session storage
  recordContentReplacement: typeof recordContentReplacement

  // -- hooks
  handleStopHooks: (
    messages: Message[],
    assistantMessages: AssistantMessage[],
    systemPrompt: SystemPrompt,
    userContext: Record<string, string>,
    systemContext: Record<string, string>,
    toolUseContext: ToolUseContext,
    querySource: QuerySource,
    stopHookActive: boolean | undefined,
  ) => AsyncGenerator<
    | import('../types/message.js').StreamEvent
    | import('../types/message.js').RequestStartEvent
    | import('../types/message.js').Message
    | import('../types/message.js').TombstoneMessage
    | import('../types/message.js').ToolUseSummaryMessage,
    StopHookResult
  >

  executeStopFailureHooks: (
    message: AssistantMessage,
    toolUseContext: ToolUseContext,
  ) => Promise<void>

  executePostSamplingHooks: (
    messages: Message[],
    systemPrompt: SystemPrompt,
    userContext: Record<string, string>,
    systemContext: Record<string, string>,
    toolUseContext: ToolUseContext,
    querySource: QuerySource,
  ) => Promise<void>

  // -- logging
  logEvent: (
    event: string,
    data?: Record<string, unknown>,
  ) => void

  logError: (error: unknown) => void
}

export function productionDeps(): QueryDeps {
  // Lazy imports to avoid circular dependencies
  const { handleStopHooks } = require('./stopHooks.js')
  const { executeStopFailureHooks } = require('./hooks.js')
  const { executePostSamplingHooks } = require('./utils/hooks/postSamplingHooks.js')
  const { logEvent } = require('../services/analytics/index.js')
  const { logError } = require('../utils/log.js')

  return {
    callModel: queryModelWithStreaming,
    microcompact: microcompactMessages,
    autocompact: autoCompactIfNeeded,
    uuid: randomUUID,
    runTools,
    generateToolUseSummary,
    applyToolResultBudget,
    prependUserContext,
    appendSystemContext,
    createDumpPromptsFetch,
    notifyCommandLifecycle,
    headlessProfilerCheckpoint,
    queryCheckpoint,
    recordContentReplacement,
    handleStopHooks,
    executeStopFailureHooks,
    executePostSamplingHooks,
    logEvent,
    logError,
  }
}
