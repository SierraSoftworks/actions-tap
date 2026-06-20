import { describe, it, expect } from '@jest/globals'
import { versionFromTag, versionSeries } from '../src/version'

describe('versionFromTag', () => {
  it('strips a leading v', () => {
    expect(versionFromTag('v3.11.4')).toBe('3.11.4')
    expect(versionFromTag('3.11.4')).toBe('3.11.4')
  })
})

describe('versionSeries', () => {
  it('derives major and minor from a full version', () => {
    expect(versionSeries('3.11.4')).toEqual({ major: '3', minor: '3.11' })
  })

  it('handles a two-segment version', () => {
    expect(versionSeries('3.11')).toEqual({ major: '3', minor: '3.11' })
  })

  it('omits minor when there is only a major', () => {
    expect(versionSeries('3')).toEqual({ major: '3', minor: undefined })
  })
})
