import type { H3Event } from 'h3'
import { settingsManager } from '~~/server/services/settings/settingsManager'
import { canAccessWizard, isFirstLaunch } from './wizard-access'

/**
 * Call at the top of every mutating `/api/wizard/*` handler. Throws 403 once
 * setup has completed unless the caller is an admin.
 */
export const requireWizardAccess = async (event: H3Event): Promise<void> => {
  const raw = await settingsManager.get('system', 'firstLaunch', true)
  const firstLaunch = isFirstLaunch(raw)

  const session = firstLaunch ? null : await getUserSession(event)
  const isAdmin = !!session?.user?.isAdmin

  if (!canAccessWizard({ firstLaunch, isAdmin })) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Setup is already complete; admin privileges required',
    })
  }
}
