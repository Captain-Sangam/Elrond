import { create } from 'zustand'
import type { MCPServerInfo, MCPServerInput, MCPStatusEvent } from '@shared/types'

// MCP server configs + live connection state. A single global listener in
// App.tsx feeds handleStatusChanged so status stays current even while the
// settings dialog is closed.
interface MCPState {
  servers: MCPServerInfo[]
  loaded: boolean
  loadServers: () => Promise<void>
  addServer: (input: MCPServerInput) => Promise<void>
  updateServer: (id: string, input: MCPServerInput) => Promise<void>
  deleteServer: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  reconnect: (id: string) => Promise<void>
  handleStatusChanged: (event: MCPStatusEvent) => void
}

export const useMcpStore = create<MCPState>((set) => ({
  servers: [],
  loaded: false,

  loadServers: async () => {
    const servers = await window.elrond.listMcpServers()
    set({ servers, loaded: true })
  },

  addServer: async (input) => {
    const server = await window.elrond.addMcpServer(input)
    set((state) => ({ servers: [...state.servers, server] }))
  },

  updateServer: async (id, input) => {
    const server = await window.elrond.updateMcpServer(id, input)
    set((state) => ({ servers: state.servers.map((s) => (s.id === id ? server : s)) }))
  },

  deleteServer: async (id) => {
    await window.elrond.deleteMcpServer(id)
    set((state) => ({ servers: state.servers.filter((s) => s.id !== id) }))
  },

  setEnabled: async (id, enabled) => {
    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? { ...s, enabled } : s))
    }))
    await window.elrond.setMcpServerEnabled(id, enabled)
  },

  reconnect: async (id) => {
    await window.elrond.reconnectMcpServer(id)
  },

  handleStatusChanged: (event) => {
    set((state) => ({
      servers: state.servers.map((s) =>
        s.id === event.serverId
          ? {
              ...s,
              status: event.status,
              toolCount: event.toolCount ?? s.toolCount,
              lastError: event.error
            }
          : s
      )
    }))
  }
}))
