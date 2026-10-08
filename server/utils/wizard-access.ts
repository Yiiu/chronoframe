// Pure decision logic for the setup wizard endpoints (no Nuxt/DB imports, so
// it is unit-testable). `requireWizardAccess` in wizard-guard.ts wires it to
// the request.

/** A missing `system:firstLaunch` setting means a fresh install. */
export const isFirstLaunch = (raw: unknown): boolean =>
  raw === null || raw === undefined || raw === true || raw === 'true'

/**
 * The wizard is open to everyone only while the site is still being set up.
 * Once `firstLaunch` is false, re-running any wizard step (which can reset the
 * admin password or swap the storage provider) requires an admin session.
 */
export const canAccessWizard = (ctx: {
  firstLaunch: boolean
  isAdmin: boolean
}): boolean => ctx.firstLaunch || ctx.isAdmin
