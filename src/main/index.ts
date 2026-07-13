import { app, shell, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, protocol, net } from 'electron'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllIpcHandlers } from './ipc'
import { initDatabase } from './db'
import { getDb } from './db'
import { getAttachmentsDir } from './attachments'
import { seedAgentsIfNeeded } from './agentStore'
import { initMcpManager, shutdownMcpManager } from './mcp/manager'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// Serves stored attachments to the renderer as <img src="elrond-attachment://<id>">
protocol.registerSchemesAsPrivileged([{ scheme: 'elrond-attachment', privileges: { stream: true } }])

function registerAttachmentProtocol(): void {
  protocol.handle('elrond-attachment', (request) => {
    const id = new URL(request.url).hostname
    const row = getDb().prepare('SELECT path FROM attachments WHERE id = ?').get(id) as
      | { path: string }
      | undefined
    if (!row) return new Response('Not found', { status: 404 })

    const resolved = resolve(row.path)
    if (!resolved.startsWith(getAttachmentsDir())) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(resolved).toString())
  })
}

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

function buildAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.elrond.app')

  // Packaged builds get the icon from the bundle; dev runs need it set manually
  if (is.dev) {
    const devIcon = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
    if (!devIcon.isEmpty()) app.dock?.setIcon(devIcon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  buildAppMenu()
  initDatabase()
  // Must run before the renderer loads: it reads agents on startup (keytar is
  // async, so this can't live inside the synchronous DB migrations)
  await seedAgentsIfNeeded()
  registerAttachmentProtocol()
  registerAllIpcHandlers()
  initMcpManager()
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
  shutdownMcpManager()
})

export { mainWindow }
