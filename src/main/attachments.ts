import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'
import type { Attachment, AttachmentPayload } from '../shared/types'

// The intersection of formats all three providers accept as base64 blocks
export const ACCEPTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf'
] as const

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 5

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf'
}

export function getAttachmentsDir(): string {
  const dir = join(app.getPath('userData'), 'attachments')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function saveAttachments(messageId: string, payloads: AttachmentPayload[]): Attachment[] {
  if (payloads.length === 0) return []
  if (payloads.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`)
  }

  const db = getDb()
  const dir = getAttachmentsDir()
  const insert = db.prepare(
    'INSERT INTO attachments (id, message_id, file_name, mime_type, size, path) VALUES (?, ?, ?, ?, ?, ?)'
  )

  const saved: Attachment[] = []
  for (const payload of payloads) {
    if (!ACCEPTED_MIME_TYPES.includes(payload.mimeType as (typeof ACCEPTED_MIME_TYPES)[number])) {
      throw new Error(`Unsupported attachment type: ${payload.mimeType}`)
    }
    const buffer = Buffer.from(payload.data, 'base64')
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment ${payload.fileName} exceeds the 10 MB limit`)
    }

    const id = uuidv4()
    const path = join(dir, `${id}.${MIME_EXTENSIONS[payload.mimeType]}`)
    writeFileSync(path, buffer)
    insert.run(id, messageId, payload.fileName, payload.mimeType, buffer.byteLength, path)
    saved.push(db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Attachment)
  }
  return saved
}

export function loadAttachmentsForMessages(messageIds: string[]): Map<string, Attachment[]> {
  const result = new Map<string, Attachment[]>()
  if (messageIds.length === 0) return result

  const db = getDb()
  const placeholders = messageIds.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT * FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...messageIds) as Attachment[]

  for (const row of rows) {
    const list = result.get(row.message_id) ?? []
    list.push(row)
    result.set(row.message_id, list)
  }
  return result
}

export function readAttachmentBase64(attachment: Attachment): string | null {
  try {
    return readFileSync(attachment.path).toString('base64')
  } catch {
    return null
  }
}

export function deleteAttachmentFiles(sessionId: string): void {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT path FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)'
    )
    .all(sessionId) as { path: string }[]

  for (const row of rows) {
    try {
      unlinkSync(row.path)
    } catch {
      // Already gone — nothing to clean up
    }
  }
}
