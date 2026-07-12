import { ipcMain } from 'electron'
import { testBraveKey } from '../websearch'

export function registerWebSearchHandlers(): void {
  ipcMain.handle('websearch:test', async (_, key: string) => {
    return testBraveKey(key)
  })
}
