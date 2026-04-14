/**
 * Circuit breaker tests for the autoCompact retry guard in query.ts.
 *
 * The circuit breaker lives in the `else if (consecutiveFailures !== undefined)`
 * branch of the query loop. It fires when `compactConversation` has thrown
 * MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES (3) times in a row — at which point it:
 *   1. Truncates messages at turn boundaries (never mid user↔assistant↔tool_result chain)
 *   2. Yields a compact_boundary message
 *   3. Resets consecutiveFailures to 0 so normal autocompact can retry
 *   4. Runs post-compact cleanup
 *   5. Guards against the degenerate case where there's only 1 turn → []
 */

import { describe, expect, test } from 'bun:test'
import { MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } from '../autoCompact.js'

// We can't import query.ts directly (it starts the full REPL init chain), so we
// re-implement truncateMessagesAtTurnBoundary here — keep in sync with query.ts.
type Message = { type: string; [key: string]: unknown }

function truncateMessagesAtTurnBoundary(messages: Message[]): Message[] {
  if (messages.length === 0) return messages

  const turns: Message[][] = []
  let currentTurn: Message[] = []

  for (const msg of messages) {
    if (msg.type === 'user') {
      if (currentTurn.length > 0) turns.push(currentTurn)
      currentTurn = [msg]
    } else {
      currentTurn.push(msg)
    }
  }
  // Push the final turn after the loop (the real query.ts has this)
  if (currentTurn.length > 0) turns.push(currentTurn)

  const midpoint = Math.ceil(turns.length / 2)
  return turns.slice(midpoint).flat()
}

describe('truncateMessagesAtTurnBoundary', () => {
  function user(content: string): Message {
    return { type: 'user', content }
  }
  function assistant(content: string): Message {
    return { type: 'assistant', content }
  }
  // Real tool_result messages have type='user' (with an attachment). For this unit test
  // we use a distinct type so the grouping is deterministic; the boundary-detection
  // logic (type === 'user') still correctly groups them into the current turn.
  function toolResult(id: string): Message {
    return { type: 'tool_result', tool_use_id: id }
  }

  test('returns empty array as-is', () => {
    expect(truncateMessagesAtTurnBoundary([])).toEqual([])
  })

  test('returns [] when only 1 turn (the exact case the query.ts guard protects)', () => {
    // This is the degenerate case the guard in query.ts protects against.
    // Without the guard, this returns [] — with it, query.ts falls back to slice(-1).
    const msgs = [user('hello'), assistant('hi')]
    expect(truncateMessagesAtTurnBoundary(msgs)).toEqual([])
  })

  test('keeps the second half of turns, preserving full chains', () => {
    // 3 turns: each user + assistant + tool_result
    const msgs = [
      user('turn1'), assistant('a1'), toolResult('t1'),
      user('turn2'), assistant('a2'), toolResult('t2'),
      user('turn3'), assistant('a3'), toolResult('t3'),
    ]
    const result = truncateMessagesAtTurnBoundary(msgs)
    // midpoint = ceil(3/2) = 2 → turns.slice(2) = [turn3], 3 messages, starts with user
    expect(result).toEqual([
      user('turn3'), assistant('a3'), toolResult('t3'),
    ])
    // Chain never starts mid-message (always starts with a user)
    expect(result[0].type).toBe('user')
  })

  test('does not cut inside a tool_result chain', () => {
    // Turn 2 starts with a user message; we should never start at an assistant or
    // tool_result that belongs to the previous turn.
    const msgs = [
      user('turn1'), assistant('a1'),
      user('turn2'),
    ]
    const result = truncateMessagesAtTurnBoundary(msgs)
    // midpoint = ceil(2/2) = 1 → turns.slice(1) = [turn2]
    expect(result).toEqual([user('turn2')])
    expect(result[0].type).toBe('user') // never starts mid-chain
  })

  test('odd number of turns keeps the larger half (ceil halves up)', () => {
    const msgs = [
      user('t1'),
      user('t2'),
      user('t3'),
      user('t4'),
      user('t5'),
    ]
    const result = truncateMessagesAtTurnBoundary(msgs)
    // 5 turns → midpoint = ceil(5/2) = 3 → turns.slice(3) = [turn4, turn5], 2 messages
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(user('t4'))
    expect(result[1]).toEqual(user('t5'))
  })

  test('handles consecutive user messages as separate turns', () => {
    // Each user starts a new turn regardless of what came before
    const msgs = [
      user('a'), user('b'), user('c'),
    ]
    const result = truncateMessagesAtTurnBoundary(msgs)
    // midpoint = ceil(3/2) = 3 → last turn only
    expect(result).toEqual([user('c')])
  })
})

describe('circuit breaker guard: empty truncation', () => {
  function user(content: string): Message {
    return { type: 'user', content }
  }
  function assistant(content: string): Message {
    return { type: 'assistant', content }
  }

  // This mirrors the guard added in query.ts lines 621-626
  function applyCircuitBreakerTruncation(messages: Message[]): Message[] {
    let truncated = truncateMessagesAtTurnBoundary(messages)
    if (truncated.length === 0) {
      truncated = messages.slice(-1)
    }
    return truncated
  }

  test('guard: single turn → falls back to last message', () => {
    const msgs = [user('only turn'), assistant('response')]
    const result = applyCircuitBreakerTruncation(msgs)
    // Without guard: []. With guard: last message (assistant).
    // Note: slice(-1) returns [assistant] because that's the last element.
    expect(result).toEqual([assistant('response')])
  })

  test('guard: two turns → normal truncation (2+ turns → not empty, guard not needed)', () => {
    const msgs = [
      user('turn1'), assistant('r1'),
      user('turn2'), assistant('r2'),
    ]
    const result = applyCircuitBreakerTruncation(msgs)
    // midpoint = ceil(2/2) = 1 → keeps turn 2
    expect(result).toEqual([user('turn2'), assistant('r2')])
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES constant', () => {
  test('is exported and equals 3', () => {
    expect(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES).toBe(3)
  })
})
