import { ipcMain, globalShortcut, BrowserWindow } from 'electron'
import { getDb } from '../db'

export function registerShortcutHandlers(): void {
  ipcMain.handle('shortcut:get', () => {
    const db = getDb()
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('globalShortcut') as
      | { value: string }
      | undefined
    return row?.value || 'CommandOrControl+Shift+Space'
  })

  ipcMain.handle('shortcut:set', (_, shortcut: string) => {
    const db = getDb()

    globalShortcut.unregisterAll()

    const registered = globalShortcut.register(shortcut, () => {
      const windows = BrowserWindow.getAllWindows()
      const win = windows[0]
      if (win) {
        if (win.isVisible()) {
          win.focus()
        } else {
          win.show()
          win.focus()
        }
      }
    })

    if (registered) {
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run('globalShortcut', shortcut)
      return true
    }

    return false
  })
}
