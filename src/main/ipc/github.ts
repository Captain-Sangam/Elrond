import { ipcMain } from 'electron'
import { getApiKey, setApiKey, deleteApiKey } from '../keychain'
import {
  testGitHubToken,
  listGitHubRepos,
  indexRepo,
  getIndexedRepos,
  deleteIndexedRepo,
  searchRepoCode
} from '../github'
import { getDb } from '../db'
import { v4 as uuidv4 } from 'uuid'
import type { GitHubRepo, Session } from '../../shared/types'

export function registerGitHubHandlers(): void {
  ipcMain.handle('github:getToken', async () => {
    const token = await getApiKey('github')
    return token ? true : false
  })

  ipcMain.handle('github:setToken', async (_, token: string) => {
    await setApiKey('github', token)
  })

  ipcMain.handle('github:deleteToken', async () => {
    await deleteApiKey('github')
  })

  ipcMain.handle('github:testToken', async (_, token: string) => {
    return testGitHubToken(token)
  })

  ipcMain.handle('github:listRepos', async () => {
    return listGitHubRepos()
  })

  ipcMain.handle('github:indexRepo', async (_, repo: GitHubRepo) => {
    return indexRepo(repo)
  })

  ipcMain.handle('github:getIndexedRepos', () => {
    return getIndexedRepos()
  })

  ipcMain.handle('github:deleteIndexedRepo', (_, repoId: string) => {
    deleteIndexedRepo(repoId)
  })

  ipcMain.handle('github:searchCode', (_, repoId: string, query: string) => {
    return searchRepoCode(repoId, query)
  })

  ipcMain.handle('github:createRepoSession', (_, repoId: string, title?: string) => {
    const db = getDb()
    const id = uuidv4()
    const sessionTitle = title || 'Repo Session'

    const repo = db.prepare('SELECT full_name FROM indexed_repos WHERE id = ?').get(repoId) as
      | { full_name: string }
      | undefined

    const finalTitle = sessionTitle === 'Repo Session' && repo ? repo.full_name : sessionTitle

    db.prepare('INSERT INTO sessions (id, title, repo_id) VALUES (?, ?, ?)').run(id, finalTitle, repoId)
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session
  })
}
