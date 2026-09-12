import { describe, expect, it } from 'vitest'
import {
  cleanExifAnnotation,
  formatFujiDynamicRange,
  formatFujiFilmMode,
} from '~/utils/fuji-recipe'

describe('cleanExifAnnotation', () => {
  it('strips trailing parenthetical annotations', () => {
    expect(cleanExifAnnotation('+2 (hard)')).toBe('+2')
    expect(cleanExifAnnotation('-1 (medium soft)')).toBe('-1')
  })

  it('keeps values without annotations', () => {
    expect(cleanExifAnnotation('Normal')).toBe('Normal')
    expect(cleanExifAnnotation('Red +1, Blue -1')).toBe('Red +1, Blue -1')
  })
})

describe('formatFujiFilmMode', () => {
  it('extracts the short name from parenthesized long names', () => {
    expect(formatFujiFilmMode('F0/Standard (Provia)')).toBe('Provia')
    expect(formatFujiFilmMode(
      'F1b/Studio Portrait Smooth Skin Tone (Astia)',
    )).toBe('Astia')
    expect(formatFujiFilmMode('F2/Fujichrome (Velvia)')).toBe('Velvia')
    expect(formatFujiFilmMode('F4/Velvia')).toBe('Velvia')
  })

  it('strips the F#// prefix when there is no parenthesis', () => {
    expect(formatFujiFilmMode(
      'F1a/Studio Portrait Enhanced Saturation',
    )).toBe('Studio Portrait Enhanced Saturation')
  })

  it('passes plain names through untouched', () => {
    expect(formatFujiFilmMode('Classic Chrome')).toBe('Classic Chrome')
    expect(formatFujiFilmMode('Classic Negative')).toBe('Classic Negative')
    expect(formatFujiFilmMode('Pro Neg. Std')).toBe('Pro Neg. Std')
    expect(formatFujiFilmMode('ACROS')).toBe('ACROS')
    expect(formatFujiFilmMode('Reala ACE')).toBe('Reala ACE')
  })
})

describe('formatFujiDynamicRange', () => {
  it('builds DR value from manual setting', () => {
    expect(formatFujiDynamicRange('Manual', 400)).toBe('DR400')
    expect(formatFujiDynamicRange('Manual', '200')).toBe('DR200')
  })

  it('maps Standard to DR100', () => {
    expect(formatFujiDynamicRange('Standard', undefined)).toBe('DR100')
  })

  it('falls back to Auto for anything else', () => {
    expect(formatFujiDynamicRange('Auto', undefined)).toBe('Auto')
    expect(formatFujiDynamicRange(undefined, undefined)).toBe('Auto')
    expect(formatFujiDynamicRange('Manual', undefined)).toBe('Auto')
  })
})
