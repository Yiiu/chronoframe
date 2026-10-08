import { describe, expect, it } from 'vitest'
import { canAccessWizard, isFirstLaunch } from '~~/server/utils/wizard-access'

describe('isFirstLaunch', () => {
  it('treats a missing setting as first launch (fresh install)', () => {
    expect(isFirstLaunch(null)).toBe(true)
    expect(isFirstLaunch(undefined)).toBe(true)
  })

  it('accepts the boolean and the stored-string forms', () => {
    expect(isFirstLaunch(true)).toBe(true)
    expect(isFirstLaunch('true')).toBe(true)
    expect(isFirstLaunch(false)).toBe(false)
    expect(isFirstLaunch('false')).toBe(false)
  })
})

describe('canAccessWizard', () => {
  it('allows anyone while the site is still being set up', () => {
    expect(canAccessWizard({ firstLaunch: true, isAdmin: false })).toBe(true)
  })

  it('allows an admin after setup (re-running the wizard)', () => {
    expect(canAccessWizard({ firstLaunch: false, isAdmin: true })).toBe(true)
  })

  it('rejects anonymous and non-admin callers after setup', () => {
    expect(canAccessWizard({ firstLaunch: false, isAdmin: false })).toBe(false)
  })
})
