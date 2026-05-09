/**
 * Unit tests for phases/index.ts - re-exports
 */
import { describe, test, expect } from 'bun:test'
import * as phases from '../../../phases/index.js'

describe('phases index exports', () => {
  test('exports initQueryLoop', () => {
    expect(phases.initQueryLoop).toBeDefined()
    expect(typeof phases.initQueryLoop).toBe('function')
  })

  test('exports preprocessMessages', () => {
    expect(phases.preprocessMessages).toBeDefined()
    expect(typeof phases.preprocessMessages).toBe('function')
  })

  test('exports streamModelResponse', () => {
    expect(phases.streamModelResponse).toBeDefined()
    expect(typeof phases.streamModelResponse).toBe('function')
  })

  test('exports executeTools', () => {
    expect(phases.executeTools).toBeDefined()
    expect(typeof phases.executeTools).toBe('function')
  })

  test('exports checkWithheldErrors', () => {
    expect(phases.checkWithheldErrors).toBeDefined()
    expect(typeof phases.checkWithheldErrors).toBe('function')
  })

  test('exports attemptMaxTokensRecovery', () => {
    expect(phases.attemptMaxTokensRecovery).toBeDefined()
    expect(typeof phases.attemptMaxTokensRecovery).toBe('function')
  })

  test('exports runAutocompact', () => {
    expect(phases.runAutocompact).toBeDefined()
    expect(typeof phases.runAutocompact).toBe('function')
  })

  test('exports processAttachments', () => {
    expect(phases.processAttachments).toBeDefined()
    expect(typeof phases.processAttachments).toBe('function')
  })
})
