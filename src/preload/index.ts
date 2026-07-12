import { contextBridge, ipcRenderer } from 'electron'
import type {
  ElrondAPI,
  ModeratorVerdictEvent,
  PhaseChange,
  StreamDone,
  StreamError,
  StreamToken
} from '../shared/types'

const api: ElrondAPI = {
  // Keychain
  getApiKey: (provider) => ipcRenderer.invoke('keys:get', provider),
  setApiKey: (provider, key) => ipcRenderer.invoke('keys:set', provider, key),
  deleteApiKey: (provider) => ipcRenderer.invoke('keys:delete', provider),
  testApiKey: (provider, key) => ipcRenderer.invoke('keys:test', provider, key),

  // Sessions
  getSessions: () => ipcRenderer.invoke('sessions:list'),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  createSession: (title?) => ipcRenderer.invoke('sessions:create', title),
  updateSession: (id, updates) => ipcRenderer.invoke('sessions:update', id, updates),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  searchSessions: (query) => ipcRenderer.invoke('sessions:search', query),

  // Messages
  getMessages: (sessionId) => ipcRenderer.invoke('messages:list', sessionId),
  addMessage: (message) => ipcRenderer.invoke('messages:add', message),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:all'),

  // Deliberation
  startDeliberation: (request) => ipcRenderer.invoke('deliberation:start', request),
  cancelDeliberation: () => ipcRenderer.invoke('deliberation:cancel'),

  // Events
  onStreamToken: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, token: StreamToken) => callback(token)
    ipcRenderer.on('stream:token', handler)
    return () => ipcRenderer.removeListener('stream:token', handler)
  },
  onStreamDone: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, done: StreamDone) => callback(done)
    ipcRenderer.on('stream:done', handler)
    return () => ipcRenderer.removeListener('stream:done', handler)
  },
  onStreamError: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, error: StreamError) => callback(error)
    ipcRenderer.on('stream:error', handler)
    return () => ipcRenderer.removeListener('stream:error', handler)
  },
  onPhaseChange: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, phase: PhaseChange) => callback(phase)
    ipcRenderer.on('stream:phase', handler)
    return () => ipcRenderer.removeListener('stream:phase', handler)
  },
  onModeratorVerdict: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, verdict: ModeratorVerdictEvent) => callback(verdict)
    ipcRenderer.on('stream:moderator', handler)
    return () => ipcRenderer.removeListener('stream:moderator', handler)
  },

  // Models
  listModels: (provider, apiKey) => ipcRenderer.invoke('models:list', provider, apiKey),

  // Export
  exportSession: (sessionId, format) => ipcRenderer.invoke('sessions:export', sessionId, format),

  // GitHub
  getGitHubToken: () => ipcRenderer.invoke('github:getToken'),
  setGitHubToken: (token) => ipcRenderer.invoke('github:setToken', token),
  deleteGitHubToken: () => ipcRenderer.invoke('github:deleteToken'),
  testGitHubToken: (token) => ipcRenderer.invoke('github:testToken', token),
  listGitHubRepos: () => ipcRenderer.invoke('github:listRepos'),
  getIndexedRepos: () => ipcRenderer.invoke('github:getIndexedRepos'),
  indexRepo: (repo) => ipcRenderer.invoke('github:indexRepo', repo),
  deleteIndexedRepo: (repoId) => ipcRenderer.invoke('github:deleteIndexedRepo', repoId),
  searchRepoCode: (repoId, query) => ipcRenderer.invoke('github:searchCode', repoId, query),
  createRepoSession: (repoId, title?) => ipcRenderer.invoke('github:createRepoSession', repoId, title),

  // Window
  setGlobalShortcut: (shortcut) => ipcRenderer.invoke('shortcut:set', shortcut),
  getGlobalShortcut: () => ipcRenderer.invoke('shortcut:get')
}

contextBridge.exposeInMainWorld('elrond', api)
