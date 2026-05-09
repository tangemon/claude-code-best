/**
 * Query loop initialization phase
 *
 * Sets up the initial state and context for the query loop.
 */
import { feature } from 'bun:bundle'
import type { QueryLoopContext, QueryLoopState } from '../types.js'
import type { QueryDeps } from '../deps.js'
import type { QueryParams } from '../types.js'
import { createBudgetTracker } from '../tokenBudget.js'
import { buildQueryConfig } from '../config.js'
import { productionDeps } from '../deps.js'
import { startRelevantMemoryPrefetch } from '../../utils/attachments.js'
import type { ToolUseContext } from '../../Tool.js'

export interface InitResult {
  context: QueryLoopContext
  state: QueryLoopState
  budgetTracker: ReturnType<typeof createBudgetTracker> | null
  config: ReturnType<typeof buildQueryConfig>
  pendingMemoryPrefetch: ReturnType<typeof startRelevantMemoryPrefetch> | null
  taskBudgetRemaining: number | undefined
}

/**
 * Initialize the query loop state and context
 */
export function initQueryLoop(
  params: QueryParams,
): InitResult {
  const deps = params.deps ?? productionDeps()

  // Build immutable context from params
  const context: QueryLoopContext = {
    systemPrompt: params.systemPrompt,
    userContext: params.userContext,
    systemContext: params.systemContext,
    canUseTool: params.canUseTool,
    fallbackModel: params.fallbackModel,
    querySource: params.querySource,
    maxTurns: params.maxTurns,
    skipCacheWrite: params.skipCacheWrite,
    deps,
  }

  // Initialize mutable state
  const state: QueryLoopState = {
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

  // Create budget tracker if feature is enabled
  const budgetTracker = feature('TOKEN_BUDGET') ? createBudgetTracker() : null

  // Snapshot immutable env/statsig/session state
  const config = buildQueryConfig()

  // Start memory prefetch (fires once per user turn)
  const pendingMemoryPrefetch = startRelevantMemoryPrefetch(
    state.messages,
    state.toolUseContext,
  )

  // task_budget.remaining tracking (undefined until first compact)
  const taskBudgetRemaining: number | undefined = undefined

  return {
    context,
    state,
    budgetTracker,
    config,
    pendingMemoryPrefetch,
    taskBudgetRemaining,
  }
}
