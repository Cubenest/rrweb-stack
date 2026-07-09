import { describe, expect, it } from 'vitest'
import { isBugMode } from './bugMode'

describe('isBugMode', () => {
  it('is true only when bug=1 is present', () => {
    expect(isBugMode('?bug=1')).toBe(true)
    expect(isBugMode('bug=1')).toBe(true)
    expect(isBugMode('?bug=1&x=2')).toBe(true)
  })

  it('is false by default / for other values', () => {
    expect(isBugMode('')).toBe(false)
    expect(isBugMode('?bug=0')).toBe(false)
    expect(isBugMode('?other=1')).toBe(false)
  })
})
