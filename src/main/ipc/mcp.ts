import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { MCPServerInput } from '../../shared/types'
import * as mcp from '../mcp/manager'

export function registerMcpHandlers(): void {
  ipcMain.handle('mcp:listServers', () => mcp.getServerInfos())

  ipcMain.handle('mcp:addServer', (_, input: MCPServerInput) => mcp.addServer(input))

  ipcMain.handle('mcp:updateServer', (_, id: string, input: MCPServerInput) =>
    mcp.updateServer(id, input)
  )

  ipcMain.handle('mcp:deleteServer', (_, id: string) => mcp.deleteServer(id))

  ipcMain.handle('mcp:setEnabled', (_, id: string, enabled: boolean) => mcp.setEnabled(id, enabled))

  ipcMain.handle('mcp:reconnect', (_, id: string) => mcp.reconnect(id))

  ipcMain.handle('mcp:listTools', (_, serverId: string) => mcp.listServerTools(serverId))

  ipcMain.handle('mcp:pickDirectory', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'multiSelections', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths
  })
}
