/**
 * Transitions Type Tests
 *
 * Tests the Terminal and Continue union types to ensure
 * all cases are properly typed and handled.
 */
import { describe, expect, test } from 'bun:test'
import type { Terminal, Continue } from '../../transitions'

describe('transitions', () => {
  describe('Terminal union type', () => {
    test('completed terminal has correct shape', () => {
      const terminal: Terminal = { reason: 'completed' }
      expect(terminal.reason).toBe('completed')
    })

    test('blocking_limit terminal has correct shape', () => {
      const terminal: Terminal = { reason: 'blocking_limit' }
      expect(terminal.reason).toBe('blocking_limit')
    })

    test('image_error terminal has correct shape', () => {
      const terminal: Terminal = { reason: 'image_error' }
      expect(terminal.reason).toBe('image_error')
    })

    test('model_error terminal with error has correct shape', () => {
      const error = new Error('API failed')
      const terminal: Terminal = { reason: 'model_error', error }
      expect(terminal.reason).toBe('model_error')
      expect(terminal.error).toBe(error)
    })

    test('model_error terminal without error has correct shape', () => {
      const terminal: Terminal = { reason: 'model_error' }
      expect(terminal.reason).toBe('model_error')
      expect('error' in terminal).toBe(false)
    })

    test('aborted_streaming terminal has correct shape', () => {
      const terminal: Terminal = { reason: 'aborted_streaming' }
      expect(terminal.reason).toBe('aborted_streaming')
    })

    test('aborted_tools terminal has correct shape', () => {
      const terminal: Terminal = { reason: 'aborted_tools' }
      expect(terminal.reason).toBe('aborted_tools')
    })

    test('prompt_too_long terminal has correct shape', () => {
      const terminal: Terminal = { reason: 'prompt_too_long' }
      expect(terminal.reason).toBe('prompt_too_long')
    })

    test('stop_hook_prevented terminal has correct shape', () => {
      const terminal: Terminal = { reason: 'stop_hook_prevented' }
      expect(terminal.reason).toBe('stop_hook_prevented')
    })

    test('hook_stopped terminal has correct shape', () => {
      const terminal: Terminal = { reason: 'hook_stopped' }
      expect(terminal.reason).toBe('hook_stopped')
    })

    test('max_turns terminal has correct shape', () => {
      const terminal: Terminal = { reason: 'max_turns', turnCount: 10 }
      expect(terminal.reason).toBe('max_turns')
      expect(terminal.turnCount).toBe(10)
    })

    test('all terminal reasons are exhaustively covered', () => {
      const terminals: Terminal[] = [
        { reason: 'completed' },
        { reason: 'blocking_limit' },
        { reason: 'image_error' },
        { reason: 'model_error' },
        { reason: 'aborted_streaming' },
        { reason: 'aborted_tools' },
        { reason: 'prompt_too_long' },
        { reason: 'stop_hook_prevented' },
        { reason: 'hook_stopped' },
        { reason: 'max_turns', turnCount: 5 },
      ]
      expect(terminals.length).toBe(10)
    })
  })

  describe('Continue union type', () => {
    test('collapse_drain_retry has correct shape', () => {
      const cont: Continue = { reason: 'collapse_drain_retry', committed: 3 }
      expect(cont.reason).toBe('collapse_drain_retry')
      expect(cont.committed).toBe(3)
    })

    test('reactive_compact_retry has correct shape', () => {
      const cont: Continue = { reason: 'reactive_compact_retry' }
      expect(cont.reason).toBe('reactive_compact_retry')
    })

    test('max_output_tokens_escalate has correct shape', () => {
      const cont: Continue = { reason: 'max_output_tokens_escalate' }
      expect(cont.reason).toBe('max_output_tokens_escalate')
    })

    test('max_output_tokens_recovery has correct shape', () => {
      const cont: Continue = { reason: 'max_output_tokens_recovery', attempt: 2 }
      expect(cont.reason).toBe('max_output_tokens_recovery')
      expect(cont.attempt).toBe(2)
    })

    test('stop_hook_blocking has correct shape', () => {
      const cont: Continue = { reason: 'stop_hook_blocking' }
      expect(cont.reason).toBe('stop_hook_blocking')
    })

    test('token_budget_continuation has correct shape', () => {
      const cont: Continue = { reason: 'token_budget_continuation' }
      expect(cont.reason).toBe('token_budget_continuation')
    })

    test('next_turn has correct shape', () => {
      const cont: Continue = { reason: 'next_turn' }
      expect(cont.reason).toBe('next_turn')
    })

    test('all continue reasons are exhaustively covered', () => {
      const continues: Continue[] = [
        { reason: 'collapse_drain_retry', committed: 1 },
        { reason: 'reactive_compact_retry' },
        { reason: 'max_output_tokens_escalate' },
        { reason: 'max_output_tokens_recovery', attempt: 1 },
        { reason: 'stop_hook_blocking' },
        { reason: 'token_budget_continuation' },
        { reason: 'next_turn' },
      ]
      expect(continues.length).toBe(7)
    })
  })

  describe('type narrowing', () => {
    test('Terminal can be narrowed by reason', () => {
      function getTerminalMessage(terminal: Terminal): string {
        switch (terminal.reason) {
          case 'completed':
            return 'Query completed successfully'
          case 'model_error':
            return terminal.error ? 'Model error occurred' : 'Model error without details'
          case 'max_turns':
            return `Max turns reached: ${terminal.turnCount}`
          default:
            return `Query ended with: ${terminal.reason}`
        }
      }

      expect(getTerminalMessage({ reason: 'completed' })).toBe('Query completed successfully')
      expect(getTerminalMessage({ reason: 'model_error', error: new Error('test') })).toBe('Model error occurred')
      expect(getTerminalMessage({ reason: 'max_turns', turnCount: 5 })).toBe('Max turns reached: 5')
      expect(getTerminalMessage({ reason: 'aborted_streaming' })).toBe('Query ended with: aborted_streaming')
    })

    test('Continue can be narrowed by reason', () => {
      function getContinueAction(cont: Continue): string {
        switch (cont.reason) {
          case 'collapse_drain_retry':
            return `Draining ${cont.committed} collapsed messages`
          case 'reactive_compact_retry':
            return 'Running reactive compaction'
          case 'max_output_tokens_recovery':
            return `Recovery attempt ${cont.attempt}`
          case 'next_turn':
            return 'Proceeding to next turn'
          default:
            return `Continuing: ${cont.reason}`
        }
      }

      expect(getContinueAction({ reason: 'collapse_drain_retry', committed: 5 })).toBe('Draining 5 collapsed messages')
      expect(getContinueAction({ reason: 'reactive_compact_retry' })).toBe('Running reactive compaction')
      expect(getContinueAction({ reason: 'max_output_tokens_recovery', attempt: 3 })).toBe('Recovery attempt 3')
      expect(getContinueAction({ reason: 'next_turn' })).toBe('Proceeding to next turn')
    })
  })
})