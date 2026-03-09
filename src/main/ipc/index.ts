import { registerKeysHandlers } from './keys'
import { registerSessionsHandlers } from './sessions'
import { registerSettingsHandlers } from './settings'
import { registerAgentsHandlers } from './agents'
import { registerShortcutHandlers } from './shortcut'
import { registerGitHubHandlers } from './github'

export function registerAllIpcHandlers(): void {
  registerKeysHandlers()
  registerSessionsHandlers()
  registerSettingsHandlers()
  registerAgentsHandlers()
  registerShortcutHandlers()
  registerGitHubHandlers()
}
