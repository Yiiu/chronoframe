export type HeroState = 'idle' | 'entering' | 'settled' | 'exiting'
export type HeroEvent =
  | 'OPEN'
  | 'ENTER_DONE'
  | 'CLOSE'
  | 'EXIT_DONE'
  | 'SWIPE_AWAY'
  | 'RESET'

const TABLE: Record<HeroState, Partial<Record<HeroEvent, HeroState>>> = {
  idle: { OPEN: 'entering' },
  entering: {
    ENTER_DONE: 'settled',
    OPEN: 'entering',
    CLOSE: 'exiting',
    SWIPE_AWAY: 'settled',
  },
  settled: { CLOSE: 'exiting' },
  exiting: { EXIT_DONE: 'idle', OPEN: 'entering' },
}

export function heroReducer(state: HeroState, event: HeroEvent): HeroState {
  if (event === 'RESET') return 'idle'
  return TABLE[state][event] ?? state
}
