import { describe, it, expect } from 'vitest'
import { toWellFormedString } from '../../src/to-well-formed-string.js'

describe('toWellFormedString', () => {
  it('keeps well-formed strings unchanged', () => {
    expect(toWellFormedString('Browserwright')).toBe('Browserwright')
  })

  it('replaces unpaired surrogates', () => {
    expect(toWellFormedString('\uD83D broken')).toBe('\uFFFD broken')
  })
})
