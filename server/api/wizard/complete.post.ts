import { settingsManager } from '~~/server/services/settings/settingsManager'
import { requireWizardAccess } from '~~/server/utils/wizard-guard'

export default eventHandler(async (event) => {
  await requireWizardAccess(event)

  // Set firstLaunch to false
  // Pass true as the last argument (sudo) to bypass readonly check
  await settingsManager.set('system', 'firstLaunch', false, undefined, true)

  return { success: true }
})
