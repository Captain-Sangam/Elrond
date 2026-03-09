import { app, shell, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from './ipc'
import { initDatabase } from './db'
import { getDb } from './db'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'sidebar',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerGlobalShortcut(): void {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('globalShortcut') as
    | { value: string }
    | undefined
  const shortcut = row?.value || 'CommandOrControl+Shift+Space'

  globalShortcut.unregisterAll()

  const registered = globalShortcut.register(shortcut, () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    } else {
      createWindow()
    }
  })

  if (!registered) {
    console.error(`Failed to register global shortcut: ${shortcut}`)
  }
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAsTAAALEwEAmpwYAAABE0lEQVQ4y62UMQ6DMBAE5/4/6VJQUCBRICEhoqCgoKCgoKCgoKCgoKBIkSJFihQpUqRI8e8vHmODOZKcZKXV+ry+9Z4N8AO0QA+MwAKswA7cADdMAO8vYEGKAi5AgwIuQIsCLkCHAi5AjwIuwIACLsCAAt6AB58TLmCJAmb8XUC2Wlk3sMUXF9BUdguYcAUaFHABWhRwAToUcAF6FHABBhRwAQYU8PQBerwr4NLlX8AJaFDABWhQwAVoUcAF6FDAB/AA8OFV/gVsyL+AC9igP+ACdCjgAvQo4AIMKOACDCjgAowo4AKMKOD0AXq8K+DS5V/ACWhQwAVoUMAFaFHABehQwAXoUcAHpI5s4+4D85k/M/wBM1xhX//h9sAAAAASUVORK5CYII='
  )
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Elrond')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Elrond',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createWindow()
        }
      }
    },
    {
      label: 'New Session',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
          mainWindow.webContents.send('new-session')
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Elrond',
      click: () => app.quit()
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.elrond.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDatabase()
  registerAllIpcHandlers()
  createWindow()
  createTray()
  registerGlobalShortcut()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

export { mainWindow }
