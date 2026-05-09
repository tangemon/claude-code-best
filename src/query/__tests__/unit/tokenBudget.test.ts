/**
 * Token Budget Unit Tests
 *
 * Tests the token budget tracking and decision logic.
 * These tests cover the checkTokenBudget function and BudgetTracker.
 */
import { describe, expect, test } from 'bun:test'
import {
  createBudgetTracker,
  checkTokenBudget,
  type BudgetTracker,
  type TokenBudgetDecision,
} from '../../tokenBudget'

describe('tokenBudget', () => {
  describe('createBudgetTracker', () => {
    test('creates tracker with initial state', () => {
      const tracker = createBudgetTracker()
      expect(tracker.continuationCount).toBe(0)
      expect(tracker.lastDeltaTokens).toBe(0)
      expect(tracker.lastGlobalTurnTokens).toBe(0)
      expect(tracker.startedAt).toBeGreaterThan(0)
    })

    test('tracker is mutable for tracking state', () => {
      const tracker = createBudgetTracker()
      tracker.continuationCount = 5
      tracker.lastDeltaTokens = 1000
      tracker.lastGlobalTurnTokens = 50000
      expect(tracker.continuationCount).toBe(5)
      expect(tracker.lastDeltaTokens).toBe(1000)
      expect(tracker.lastGlobalTurnTokens).toBe(50000)
    })
  })

  describe('checkTokenBudget', () => {
    test('returns stop when agentId is present', () => {
      const tracker = createBudgetTracker()
      const decision = checkTokenBudget(tracker, 'agent-123', 100000, 50000)
      expect(decision.action).toBe('stop')
      if (decision.action === 'stop') {
        expect(decision.completionEvent).toBeNull()
      }
    })

    test('returns stop when budget is null', () => {
      const tracker = createBudgetTracker()
      const decision = checkTokenBudget(tracker, undefined, null, 50000)
      expect(decision.action).toBe('stop')
      if (decision.action === 'stop') {
        expect(decision.completionEvent).toBeNull()
      }
    })

    test('returns stop when budget is zero', () => {
      const tracker = createBudgetTracker()
      const decision = checkTokenBudget(tracker, undefined, 0, 50000)
      expect(decision.action).toBe('stop')
      if (decision.action === 'stop') {
        expect(decision.completionEvent).toBeNull()
      }
    })

    test('returns stop when budget is negative', () => {
      const tracker = createBudgetTracker()
      const decision = checkTokenBudget(tracker, undefined, -100, 50000)
      expect(decision.action).toBe('stop')
      if (decision.action === 'stop') {
        expect(decision.completionEvent).toBeNull()
      }
    })

    test('returns continue when under 90% threshold', () => {
      const tracker = createBudgetTracker()
      const budget = 100000
      const turnTokens = 50000 // 50%

      const decision = checkTokenBudget(tracker, undefined, budget, turnTokens)

      expect(decision.action).toBe('continue')
      if (decision.action === 'continue') {
        expect(decision.pct).toBe(50)
        expect(decision.turnTokens).toBe(turnTokens)
        expect(decision.budget).toBe(budget)
        expect(decision.continuationCount).toBe(1)
      }
    })

    test('increments continuation count on multiple continues', () => {
      const tracker = createBudgetTracker()
      const budget = 100000

      // First continue
      checkTokenBudget(tracker, undefined, budget, 50000)
      expect(tracker.continuationCount).toBe(1)

      // Second continue
      checkTokenBudget(tracker, undefined, budget, 60000)
      expect(tracker.continuationCount).toBe(2)

      // Third continue
      checkTokenBudget(tracker, undefined, budget, 70000)
      expect(tracker.continuationCount).toBe(3)
    })

    test('returns stop when at or above 90% threshold (first time, no completionEvent)', () => {
      const tracker = createBudgetTracker()
      const budget = 100000
      const turnTokens = 95000 // 95%

      // First time hitting threshold (no prior continuations) returns stop with null completionEvent
      const decision = checkTokenBudget(tracker, undefined, budget, turnTokens)

      expect(decision.action).toBe('stop')
      if (decision.action === 'stop') {
        expect(decision.completionEvent).toBeNull() // No prior continuation, so no completion event
      }
    })

    test('returns stop with completionEvent when at threshold after continuations', () => {
      const tracker = createBudgetTracker()
      const budget = 100000

      // Build up continuation count first
      checkTokenBudget(tracker, undefined, budget, 50000) // count = 1
      checkTokenBudget(tracker, undefined, budget, 60000) // count = 2
      checkTokenBudget(tracker, undefined, budget, 70000) // count = 3

      // Now exceed threshold
      const decision = checkTokenBudget(tracker, undefined, budget, 95000) // 95%

      expect(decision.action).toBe('stop')
      if (decision.action === 'stop' && decision.completionEvent) {
        expect(decision.completionEvent.pct).toBe(95)
        expect(decision.completionEvent.continuationCount).toBe(3)
      }
    })

    test('detects diminishing returns when both deltas are small', () => {
      const tracker = createBudgetTracker()
      const budget = 100000

      // Build up continuation count with small deltas
      // Need lastDeltaTokens < 500, so use delta = 400
      checkTokenBudget(tracker, undefined, budget, 50000) // delta = 50000, count = 1
      checkTokenBudget(tracker, undefined, budget, 50400) // delta = 400, count = 2, lastDelta = 400
      checkTokenBudget(tracker, undefined, budget, 50800) // delta = 400, count = 3, lastDelta = 400

      // Now very small delta (diminishing returns)
      // deltaSinceLastCheck = 51000 - 50800 = 200
      // lastDeltaTokens = 400
      // isDiminishing: count >= 3 (true) AND delta < 500 (true) AND lastDelta < 500 (true)
      const decision = checkTokenBudget(tracker, undefined, budget, 51000)

      expect(decision.action).toBe('stop')
      if (decision.action === 'stop' && decision.completionEvent) {
        expect(decision.completionEvent.diminishingReturns).toBe(true)
      }
    })

    test('includes duration in completion event when stopped after continuations', () => {
      const tracker = createBudgetTracker()
      const before = Date.now()

      // Build up continuation count first
      checkTokenBudget(tracker, undefined, 100000, 50000)
      checkTokenBudget(tracker, undefined, 100000, 60000)
      checkTokenBudget(tracker, undefined, 100000, 70000)

      // Simulate some time passing
      tracker.startedAt = before - 5000 // 5 seconds ago

      // Now exceed threshold to get completionEvent
      const decision = checkTokenBudget(tracker, undefined, 100000, 95000)

      expect(decision.action).toBe('stop')
      if (decision.action === 'stop' && decision.completionEvent) {
        expect(decision.completionEvent.durationMs).toBeGreaterThanOrEqual(5000)
      }
    })

    test('stops after diminishing returns even if under threshold', () => {
      const tracker = createBudgetTracker()
      const budget = 100000

      // Build up continuation count with small deltas (all < 500)
      checkTokenBudget(tracker, undefined, budget, 50000)
      checkTokenBudget(tracker, undefined, budget, 50400) // delta = 400
      checkTokenBudget(tracker, undefined, budget, 50800) // delta = 400

      // Under 90% but with diminishing returns
      // delta = 51000 - 50800 = 200, lastDelta = 400
      const decision = checkTokenBudget(tracker, undefined, budget, 51000)

      expect(decision.action).toBe('stop')
      if (decision.action === 'stop' && decision.completionEvent) {
        expect(decision.completionEvent.diminishingReturns).toBe(true)
      }
    })

    test('preserves continuation count in completion event', () => {
      const tracker = createBudgetTracker()
      const budget = 100000

      // Build up continuation count
      checkTokenBudget(tracker, undefined, budget, 50000)
      checkTokenBudget(tracker, undefined, budget, 60000)
      checkTokenBudget(tracker, undefined, budget, 70000)

      // Now exceed threshold
      const decision = checkTokenBudget(tracker, undefined, budget, 95000)

      expect(decision.action).toBe('stop')
      if (decision.action === 'stop' && decision.completionEvent) {
        expect(decision.completionEvent.continuationCount).toBe(3)
      }
    })

    test('returns nudge message on continue', () => {
      const tracker = createBudgetTracker()
      const budget = 100000
      const turnTokens = 50000

      const decision = checkTokenBudget(tracker, undefined, budget, turnTokens)

      expect(decision.action).toBe('continue')
      expect(typeof (decision as { nudgeMessage: string }).nudgeMessage).toBe('string')
      expect((decision as { nudgeMessage: string }).nudgeMessage.length).toBeGreaterThan(0)
    })

    test('handles large token counts', () => {
      const tracker = createBudgetTracker()
      const budget = 500000 // 500k budget
      const turnTokens = 250000 // 50%

      const decision = checkTokenBudget(tracker, undefined, budget, turnTokens)

      expect(decision.action).toBe('continue')
      if (decision.action === 'continue') {
        expect(decision.pct).toBe(50)
      }
    })

    test('handles very small budgets', () => {
      const tracker = createBudgetTracker()
      const budget = 1000
      const turnTokens = 500 // 50%

      const decision = checkTokenBudget(tracker, undefined, budget, turnTokens)

      expect(decision.action).toBe('continue')
      if (decision.action === 'continue') {
        expect(decision.pct).toBe(50)
      }
    })
  })

  describe('TokenBudgetDecision union type', () => {
    test('ContinueDecision has correct shape', () => {
      const tracker = createBudgetTracker()
      const decision = checkTokenBudget(tracker, undefined, 100000, 50000)

      expect(decision.action).toBe('continue')
      const continueDecision = decision as TokenBudgetDecision & { action: 'continue' }
      expect(continueDecision.nudgeMessage).toBeDefined()
      expect(continueDecision.continuationCount).toBeDefined()
      expect(continueDecision.pct).toBeDefined()
      expect(continueDecision.turnTokens).toBeDefined()
      expect(continueDecision.budget).toBeDefined()
    })

    test('StopDecision has correct shape when stopped after continuations', () => {
      const tracker = createBudgetTracker()

      // Build up continuation count first
      checkTokenBudget(tracker, undefined, 100000, 50000)
      checkTokenBudget(tracker, undefined, 100000, 60000)
      checkTokenBudget(tracker, undefined, 100000, 70000)

      // Now exceed threshold to get completionEvent
      const decision = checkTokenBudget(tracker, undefined, 100000, 95000)

      expect(decision.action).toBe('stop')
      const stopDecision = decision as TokenBudgetDecision & { action: 'stop' }
      expect(stopDecision.completionEvent).not.toBeNull()
      expect(stopDecision.completionEvent!.continuationCount).toBeDefined()
      expect(stopDecision.completionEvent!.pct).toBeDefined()
      expect(stopDecision.completionEvent!.turnTokens).toBeDefined()
      expect(stopDecision.completionEvent!.budget).toBeDefined()
      expect(stopDecision.completionEvent!.diminishingReturns).toBeDefined()
      expect(stopDecision.completionEvent!.durationMs).toBeDefined()
    })
  })
})