import { describe, expect, it } from 'vitest'
import { heroReducer } from '~/composables/heroReducer'

describe('heroReducer', () => {
  it('opens from idle', () => {
    expect(heroReducer('idle', 'OPEN')).toBe('entering')
  })
  it('settles after entering', () => {
    expect(heroReducer('entering', 'ENTER_DONE')).toBe('settled')
  })
  it('reverses immediately when closed mid-enter', () => {
    expect(heroReducer('entering', 'CLOSE')).toBe('exiting')
  })
  it('drops overlay to settled when swiped away mid-enter', () => {
    expect(heroReducer('entering', 'SWIPE_AWAY')).toBe('settled')
  })
  it('re-targets on OPEN while still entering', () => {
    expect(heroReducer('entering', 'OPEN')).toBe('entering')
  })
  it('closes from settled', () => {
    expect(heroReducer('settled', 'CLOSE')).toBe('exiting')
  })
  it('finishes exit to idle', () => {
    expect(heroReducer('exiting', 'EXIT_DONE')).toBe('idle')
  })
  it('re-opens mid-exit', () => {
    expect(heroReducer('exiting', 'OPEN')).toBe('entering')
  })
  it('RESET always returns idle', () => {
    expect(heroReducer('exiting', 'RESET')).toBe('idle')
    expect(heroReducer('entering', 'RESET')).toBe('idle')
  })
  it('ignores nonsensical transitions', () => {
    expect(heroReducer('idle', 'ENTER_DONE')).toBe('idle')
    expect(heroReducer('settled', 'ENTER_DONE')).toBe('settled')
  })
})
