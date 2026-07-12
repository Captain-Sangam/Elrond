import { ipcMain } from 'electron'
import { testWebSearchKey } from '../websearch'

export function registerWebSearchHandlers(): void {
  ipcMain.handle('websearch:test', async (_, key: string) => {
    return testWebSearchKey(key)
  })
}
