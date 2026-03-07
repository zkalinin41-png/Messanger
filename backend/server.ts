import 'dotenv/config'
import express, { type Request, type Response } from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cors from 'cors'
import { dbExec, dbGet, dbAll, dbRun, dbColumnExists } from './database.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import multer from 'multer'
import { AccessToken } from 'livekit-server-sdk'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join, extname } from 'path'
import { existsSync, mkdirSync } from 'fs'
import type {
  UserRow, GroupRow, GroupMemberRow, GroupMessageRow, DMMessageRow,
  ReactionRow, PinnedMessageRow, BlockedUserRow,
  WsClient, ChatMessage, AggregatedReaction, AuthPayload, WsIncomingMessage,
} from './types.js'

process.on('uncaughtException', (err: unknown) => console.error('Uncaught exception:', err))
process.on('unhandledRejection', (err: unknown) => console.error('Unhandled rejection:', err))

const __dirname: string = dirname(fileURLToPath(import.meta.url))
const JWT_SECRET: string = process.env.JWT_SECRET || 'change-this-secret-in-production'

// ── File uploads ─────────────────────────────────────────────────────────────
const uploadsDir = join(__dirname, 'uploads')
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir)

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req: any, _file: any, cb: any) => cb(null, uploadsDir),
    filename: (_req: any, file: any, cb: any) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
})
// APP_URL is determined from the request Origin header at runtime so it works
// regardless of which port Vite picks. Falls back to env var or localhost:5173.
const APP_URL_FALLBACK: string = process.env.APP_URL || 'http://localhost:5173'

function getAppUrl(req: Request): string {
  const origin = req.headers.origin
  if (origin && origin.startsWith('http://localhost')) return origin
  return APP_URL_FALLBACK
}

function getAuth(req: Request): AuthPayload | null {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return null
  try { return jwt.verify(h.slice(7), JWT_SECRET) as AuthPayload } catch { return null }
}

const COLORS: string[] = [
  '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f59e0b', '#10b981', '#3b82f6', '#f97316',
]

function usernameColor(username: string): string {
  let h = 0
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) & 0xffff
  return COLORS[h % COLORS.length]
}

// isOnline references `clients` which is initialized in the WebSocket section
// before any HTTP request can arrive, so this is safe at call time.
function isOnline(username: string): boolean {
  for (const [, c] of clients) {
    if (c.username === username) return true
  }
  return false
}

// --- Database setup (PostgreSQL) ---
async function initDb() {
  await dbExec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      email TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_token TEXT,
      verification_expires BIGINT,
      reset_token TEXT,
      reset_expires BIGINT,
      last_seen_at BIGINT,
      avatar_url TEXT
    )
  `)
  await dbExec(`
    CREATE TABLE IF NOT EXISTS chat_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      creator TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `)
  await dbExec(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      last_seen_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (group_id, username)
    )
  `)
  await dbExec(`
    CREATE TABLE IF NOT EXISTS group_messages (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp BIGINT NOT NULL,
      reply_to_id INTEGER,
      reply_to_text TEXT,
      reply_to_username TEXT,
      file_url TEXT,
      file_name TEXT,
      file_type TEXT,
      file_size INTEGER,
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    )
  `)
  await dbExec(`
    CREATE TABLE IF NOT EXISTS dm_messages (
      id SERIAL PRIMARY KEY,
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      timestamp BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      reply_to_id INTEGER,
      reply_to_text TEXT,
      reply_to_username TEXT,
      file_url TEXT,
      file_name TEXT,
      file_type TEXT,
      file_size INTEGER,
      edited INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    )
  `)
  await dbExec('CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages (from_user, to_user, timestamp)')
  await dbExec('CREATE INDEX IF NOT EXISTS idx_dm_to ON dm_messages (to_user, status)')
  await dbExec(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL,
      message_type TEXT NOT NULL,
      username TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE(message_id, message_type, username, emoji)
    )
  `)
  await dbExec('CREATE INDEX IF NOT EXISTS idx_reactions ON message_reactions (message_id, message_type)')
  await dbExec(`
    CREATE TABLE IF NOT EXISTS pinned_messages (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      pinned_by TEXT NOT NULL,
      pinned_at BIGINT NOT NULL,
      UNIQUE(group_id, message_id)
    )
  `)
  await dbExec(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      id SERIAL PRIMARY KEY,
      blocker TEXT NOT NULL,
      blocked TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE(blocker, blocked)
    )
  `)
}

// --- Email (Gmail SMTP) ---
const GMAIL_USER = process.env.GMAIL_USER || 'e.kalinin135@gmail.com'
const gmailTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS
  family: 4,     // force IPv4 (Railway blocks IPv6 SMTP)
  auth: {
    user: GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD || '',
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
})

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Email send timed out')), 15000))
  await Promise.race([
    gmailTransporter.sendMail({
      from: `"Chat App" <${GMAIL_USER}>`,
      to,
      subject,
      html,
    }),
    timeout,
  ])
  console.log(`📨 Email sent to ${to}`)
}

function verificationEmailHtml(username: string, verifyUrl: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="margin:0 0 8px">Welcome, ${username}!</h2>
      <p style="color:#555;margin:0 0 24px">
        Click the button below to verify your email address and activate your account.
      </p>
      <a href="${verifyUrl}"
         style="display:inline-block;padding:12px 28px;background:#000;color:#fff;
                border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
        Verify Email
      </a>
      <p style="color:#999;font-size:13px;margin-top:24px">
        This link expires in 24 hours. If you didn't create this account, ignore this email.
      </p>
    </div>
  `
}

function resetEmailHtml(username: string, resetUrl: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="margin:0 0 8px">Password reset</h2>
      <p style="color:#555;margin:0 0 24px">
        Hi ${username}, click below to choose a new password for your account.
      </p>
      <a href="${resetUrl}"
         style="display:inline-block;padding:12px 28px;background:#000;color:#fff;
                border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
        Reset Password
      </a>
      <p style="color:#999;font-size:13px;margin-top:24px">
        This link expires in 1 hour. If you didn't request this, ignore this email.
      </p>
    </div>
  `
}

function simpleHtmlPage(title: string, heading: string, body: string, appUrl: string = APP_URL_FALLBACK): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f1f5f9; }
    .box { background: #fff; border-radius: 16px; padding: 48px 40px;
           text-align: center; max-width: 400px; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p  { margin: 0 0 28px; color: #555; }
    a  { display: inline-block; padding: 11px 26px; background: #000; color: #fff;
         border-radius: 8px; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="box">
    <h1>${heading}</h1>
    <p>${body}</p>
    <a href="${appUrl}">Go to Chat →</a>
  </div>
</body>
</html>`
}

// --- Express setup ---
const app = express()
app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(uploadsDir))

// ── Serve built frontend in production ───────────────────────────────────────
const distDir = join(__dirname, '../frontend/dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
}

// Register
app.post('/api/register', async (req: Request, res: Response) => {
  const { username, email, password } = req.body

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' })
  }

  const name = String(username).trim()
  const mail = String(email).trim().toLowerCase()
  const pass = String(password)

  if (name.length < 2 || name.length > 24) {
    return res.status(400).json({ error: 'Username must be 2–24 characters' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return res.status(400).json({ error: 'Invalid email address' })
  }
  if (pass.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }

  // Clean up legacy accounts (pre-email, unverified, same username)
  const stale = await dbGet('SELECT id FROM users WHERE username = ? AND email IS NULL AND email_verified = 0', name) as any
  if (stale) await dbRun('DELETE FROM users WHERE id = ?', stale.id)

  // Check username uniqueness
  if (await dbGet('SELECT id FROM users WHERE username = ?', name) as any) {
    return res.status(409).json({ error: 'Username already taken' })
  }

  // Check email uniqueness
  if (await dbGet('SELECT id FROM users WHERE email = ?', mail) as any) {
    return res.status(409).json({ error: 'Email already registered' })
  }

  const hash = bcrypt.hashSync(pass, 10)

  try {
    await dbRun(`
      INSERT INTO users (username, email, password_hash, email_verified)
      VALUES (?, ?, ?, 1)
    `, name, mail, hash)
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' })
    }
    return res.status(500).json({ error: 'Server error' })
  }

  const jwtToken = jwt.sign({ username: name }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ message: 'Account created!', email: mail, token: jwtToken, username: name })
})

// Verify email (link from email)
app.get('/api/verify-email', async (req: Request, res: Response) => {
  const { token } = req.query
  const appUrl = getAppUrl(req)
  if (!token) return res.send(simpleHtmlPage('Error', 'Invalid link', 'This verification link is not valid.', appUrl))

  const user = await dbGet('SELECT * FROM users WHERE verification_token = ?', token) as any

  if (!user) {
    return res.send(simpleHtmlPage('Error', 'Link not found', 'This link is invalid or was already used.', appUrl))
  }
  if (user.verification_expires < Date.now()) {
    return res.send(simpleHtmlPage('Link expired', 'Link expired', 'This verification link has expired. Please request a new one from the app.', appUrl))
  }

  await dbRun('UPDATE users SET email_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?', user.id)

  res.send(simpleHtmlPage('Email verified!', '✓ Email verified!', 'Your account is now active. You can close this tab and sign in.', appUrl))
})

// Resend verification email
app.post('/api/resend-verification', async (req: Request, res: Response) => {
  const mail = String(req.body.email || '').trim().toLowerCase()
  if (!mail) return res.status(400).json({ error: 'Email is required' })

  const user = await dbGet('SELECT * FROM users WHERE email = ?', mail) as any
  if (!user) return res.status(404).json({ error: 'No account found with that email' })
  if (user.email_verified) return res.status(400).json({ error: 'Email is already verified' })

  const token = randomUUID()
  const expires = Date.now() + 24 * 60 * 60 * 1000
  await dbRun('UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?', token, expires, user.id)

  const verifyUrl = `${req.protocol}://${req.get('host')}/api/verify-email?token=${token}`
  try {
    await sendMail(mail, 'Verify your email address', verificationEmailHtml(user.username, verifyUrl))
  } catch (e: any) {
    console.error('Email send failed:', e.message)
  }

  res.json({ message: 'Verification email sent' })
})

// Forgot password
app.post('/api/forgot-password', async (req: Request, res: Response) => {
  const mail = String(req.body.email || '').trim().toLowerCase()
  // Always return same message to avoid leaking which emails exist
  const generic = { message: 'If that email is registered, a reset link is on its way.' }

  if (!mail) return res.json(generic)

  const user = await dbGet('SELECT * FROM users WHERE email = ?', mail) as any
  if (!user) return res.json(generic)

  const token = randomUUID()
  const expires = Date.now() + 60 * 60 * 1000 // 1 hour
  await dbRun('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', token, expires, user.id)

  const resetUrl = `${getAppUrl(req)}?reset_token=${token}`
  try {
    await sendMail(mail, 'Reset your password', resetEmailHtml(user.username, resetUrl))
  } catch (e: any) {
    console.error('Email send failed:', e.message)
  }

  res.json(generic)
})

// Reset password
app.post('/api/reset-password', async (req: Request, res: Response) => {
  const { token, newPassword } = req.body
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' })
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }

  const user = await dbGet('SELECT * FROM users WHERE reset_token = ?', token) as any
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' })
  if (user.reset_expires < Date.now()) return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' })

  const hash = bcrypt.hashSync(String(newPassword), 10)
  await dbRun('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', hash, user.id)

  res.json({ message: 'Password updated. You can now sign in.' })
})

// Change password
app.post('/api/change-password', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  let payload
  try { payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as any } catch {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }

  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both passwords are required' })
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' })
  }

  const user = await dbGet('SELECT * FROM users WHERE username = ?', payload.username) as any
  if (!user || !bcrypt.compareSync(String(currentPassword), user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' })
  }

  const hash = bcrypt.hashSync(String(newPassword), 10)
  await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id)
  res.json({ message: 'Password updated successfully' })
})

// Video call token
app.post('/api/video/token', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const partner = String(req.body.partner || '').trim()
  if (!partner) return res.status(400).json({ error: 'partner required' })
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
    return res.status(503).json({ error: 'Video calls not configured on this server' })
  }
  const roomName = [auth.username, partner].sort().join('__')
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: auth.username,
    ttl: '10m',
  })
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true })
  res.json({ token: await at.toJwt(), room: roomName, url: process.env.LIVEKIT_URL })
})

// File upload
app.post('/api/upload', upload.single('file'), async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  if (!req.file) return res.status(400).json({ error: 'No file provided' })
  res.json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    type: req.file.mimetype,
    size: req.file.size,
  })
})

// Login
app.get('/api/check-username', async (req: Request, res: Response) => {
  const name = String(req.query.u || '').trim()
  if (name.length < 2) return res.json({ available: false })
  const exists = await dbGet('SELECT id FROM users WHERE username = ?', name) as any
  res.json({ available: !exists })
})

app.post('/api/login', async (req: Request, res: Response) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' })
  }

  const input = String(username).trim()
  let user: any
  try {
    user = input.includes('@')
      ? await dbGet('SELECT * FROM users WHERE email = ?', input.toLowerCase())
      : await dbGet('SELECT * FROM users WHERE username = ?', input)
  } catch (err: any) {
    console.error('Login DB error:', err.message)
    return res.status(500).json({ error: 'Server error' })
  }
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' })
  }
  if (!user.email_verified) {
    return res.status(403).json({
      error: 'Please verify your email before signing in.',
      needsVerification: true,
      email: user.email,
    })
  }

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, username: user.username })
})

// ── Group REST API ──

app.get('/api/groups', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const rows = await dbAll(`
    SELECT g.id, g.name, g.description, g.creator, gm.role,
      (SELECT COUNT(*) FROM group_messages
       WHERE group_id = g.id AND timestamp > gm.last_seen_at AND username != ?) AS unread_count,
      (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
    FROM group_members gm
    JOIN chat_groups g ON g.id = gm.group_id
    WHERE gm.username = ?
    ORDER BY g.created_at DESC
  `, auth.username, auth.username)
  res.json({ groups: rows })
})

app.post('/api/groups', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const name = String(req.body.name || '').trim()
  const description = String(req.body.description || '').trim()
  if (!name) return res.status(400).json({ error: 'Group name is required' })
  if (name.length > 64) return res.status(400).json({ error: 'Name too long (max 64 chars)' })
  const now = Date.now()
  const result = await dbRun(
    'INSERT INTO chat_groups (name, description, creator, created_at) VALUES (?, ?, ?, ?)',
    name, description, auth.username, now
  )
  const groupId = result.lastInsertRowid
  await dbRun('INSERT INTO group_members (group_id, username, role) VALUES (?, ?, ?)', groupId, auth.username, 'admin')
  res.json({ group: { id: groupId, name, description, creator: auth.username, role: 'admin', unread_count: 0, member_count: 1, created_at: now } })
})

app.get('/api/groups/:id', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const membership = await dbGet('SELECT role FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any
  if (!membership) return res.status(403).json({ error: 'Not a member' })
  const group = await dbGet('SELECT * FROM chat_groups WHERE id = ?', groupId) as any
  if (!group) return res.status(404).json({ error: 'Group not found' })
  const members = await dbAll(
    'SELECT username, role FROM group_members WHERE group_id = ? ORDER BY role DESC, username ASC',
    groupId
  )
  res.json({ group: { ...group, role: membership.role }, members })
})

app.put('/api/groups/:id', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const membership = await dbGet('SELECT role FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any
  if (!membership) return res.status(403).json({ error: 'Not a member' })
  if (membership.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const name = String(req.body.name || '').trim()
  const description = String(req.body.description || '').trim()
  if (!name) return res.status(400).json({ error: 'Group name is required' })
  await dbRun('UPDATE chat_groups SET name = ?, description = ? WHERE id = ?', name, description, groupId)
  await broadcastToGroup(groupId, { type: 'group_updated', groupId, name, description })
  res.json({ message: 'Updated' })
})

app.delete('/api/groups/:id', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const group = await dbGet('SELECT creator FROM chat_groups WHERE id = ?', groupId) as any
  if (!group) return res.status(404).json({ error: 'Group not found' })
  if (group.creator !== auth.username) return res.status(403).json({ error: 'Only the creator can delete this group' })
  const members = await dbAll('SELECT username FROM group_members WHERE group_id = ?', groupId) as any[]
  await dbRun('DELETE FROM chat_groups WHERE id = ?', groupId)
  for (const m of members) sendToUser(m.username, { type: 'group_deleted', groupId })
  res.json({ message: 'Group deleted' })
})

app.get('/api/groups/:id/messages', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const membership = await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any
  if (!membership) return res.status(403).json({ error: 'Not a member' })
  const msgs = await dbAll('SELECT * FROM group_messages WHERE group_id = ? ORDER BY timestamp ASC', groupId) as any[]
  await dbRun('UPDATE group_members SET last_seen_at = ? WHERE group_id = ? AND username = ?', Date.now(), groupId, auth.username)
  const messagesWithReactions = await Promise.all(msgs.map(async (m: any) => ({ ...m, color: usernameColor(m.username), reactions: await getReactions(m.id, 'group') })))
  res.json({ messages: messagesWithReactions })
})

app.post('/api/groups/:id/members', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const membership = await dbGet('SELECT role FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any
  if (!membership) return res.status(403).json({ error: 'Not a member' })
  if (membership.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const targetName = String(req.body.username || '').trim()
  if (!targetName) return res.status(400).json({ error: 'Username is required' })
  const target = await dbGet('SELECT username FROM users WHERE username = ? AND email_verified = 1', targetName) as any
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, target.username) as any) {
    return res.status(409).json({ error: 'User is already a member' })
  }
  await dbRun('INSERT INTO group_members (group_id, username, role) VALUES (?, ?, ?)', groupId, target.username, 'member')
  sendToUser(target.username, { type: 'groups_refresh' })
  await broadcastToGroup(groupId, { type: 'group_member_update', groupId })
  res.json({ message: `${target.username} added` })
})

app.delete('/api/groups/:id/members/:username', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const targetName = String(req.params.username)
  const membership = await dbGet('SELECT role FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any
  if (!membership) return res.status(403).json({ error: 'Not a member' })
  if (membership.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const group = await dbGet('SELECT creator FROM chat_groups WHERE id = ?', groupId) as any
  if (group?.creator === targetName) return res.status(403).json({ error: "Can't remove the group creator" })
  if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, targetName) as any) {
    return res.status(404).json({ error: 'Member not found' })
  }
  await dbRun('DELETE FROM group_members WHERE group_id = ? AND username = ?', groupId, targetName)
  sendToUser(targetName, { type: 'group_deleted', groupId })
  await broadcastToGroup(groupId, { type: 'group_member_update', groupId })
  res.json({ message: `${targetName} removed` })
})

app.delete('/api/groups/:id/leave', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const group = await dbGet('SELECT creator FROM chat_groups WHERE id = ?', groupId) as any
  if (!group) return res.status(404).json({ error: 'Group not found' })
  if (group.creator === auth.username) return res.status(403).json({ error: 'Creator cannot leave — delete the group instead' })
  await dbRun('DELETE FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username)
  await broadcastToGroup(groupId, { type: 'group_member_update', groupId })
  res.json({ message: 'You left the group' })
})

app.put('/api/groups/:id/members/:username/role', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const targetName = String(req.params.username)
  const group = await dbGet('SELECT creator FROM chat_groups WHERE id = ?', groupId) as any
  if (!group) return res.status(404).json({ error: 'Group not found' })
  if (group.creator !== auth.username) return res.status(403).json({ error: 'Only the creator can change roles' })
  if (targetName === auth.username) return res.status(400).json({ error: "Can't change your own role" })
  const role = req.body.role
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Role must be admin or member' })
  if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, targetName) as any) {
    return res.status(404).json({ error: 'Member not found' })
  }
  await dbRun('UPDATE group_members SET role = ? WHERE group_id = ? AND username = ?', role, groupId, targetName)
  await broadcastToGroup(groupId, { type: 'group_member_update', groupId })
  res.json({ message: 'Role updated' })
})

// ── DM REST API ──

app.get('/api/users/search', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ users: [] })
  const users = (await dbAll(`
    SELECT username FROM users
    WHERE username LIKE ? AND username != ? AND email_verified = 1
    LIMIT 10
  `, `%${q}%`, auth.username)).map((u: any) => ({
    username: u.username,
    color: usernameColor(u.username),
    online: isOnline(u.username),
  }))
  res.json({ users })
})

app.get('/api/dms', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const partners = (await dbAll(`
    SELECT DISTINCT CASE WHEN from_user = ? THEN to_user ELSE from_user END AS partner
    FROM dm_messages WHERE from_user = ? OR to_user = ?
  `, auth.username, auth.username, auth.username)).map((r: any) => r.partner)
  const conversations = []
  for (const partner of partners) {
    const last = await dbGet(`
      SELECT text, timestamp FROM dm_messages
      WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
      ORDER BY timestamp DESC LIMIT 1
    `, auth.username, partner, partner, auth.username) as any
    const unread = (await dbGet(
      "SELECT COUNT(*) as n FROM dm_messages WHERE from_user = ? AND to_user = ? AND status != 'read'",
      partner, auth.username
    ) as any)?.n ?? 0
    const user = await dbGet('SELECT last_seen_at FROM users WHERE username = ?', partner) as any
    conversations.push({
      partner,
      color: usernameColor(partner),
      last_text: last?.text ?? '',
      last_timestamp: last?.timestamp ?? 0,
      unread_count: unread,
      online: isOnline(partner),
      last_seen_at: user?.last_seen_at ?? null,
    })
  }
  conversations.sort((a: any, b: any) => b.last_timestamp - a.last_timestamp)
  res.json({ conversations })
})

app.get('/api/dms/:username', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const partner = String(req.params.username)
  const target = await dbGet('SELECT username, last_seen_at FROM users WHERE username = ?', partner) as any
  if (!target) return res.status(404).json({ error: 'User not found' })
  const msgs = await dbAll(`
    SELECT * FROM dm_messages
    WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
    ORDER BY timestamp ASC
  `, auth.username, partner, partner, auth.username)
  // Mark partner's unread messages to me as read
  const unreadIds = msgs.filter((m: any) => m.from_user === partner && m.status !== 'read').map((m: any) => m.id)
  if (unreadIds.length > 0) {
    await dbRun(`UPDATE dm_messages SET status = 'read' WHERE id IN (${unreadIds.map(() => '?').join(',')})`, ...unreadIds)
    sendToUser(partner, { type: 'dm_read', byUser: auth.username })
  }
  const messagesWithReactions = await Promise.all(msgs.map(async (m: any) => ({ ...m, color: usernameColor(m.from_user), reactions: await getReactions(m.id, 'dm') })))
  res.json({
    messages: messagesWithReactions,
    partner_online: isOnline(partner),
    partner_last_seen: target.last_seen_at,
  })
})

app.post('/api/dms/:username', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const partner = String(req.params.username)
  if (partner === auth.username) return res.status(400).json({ error: "Can't DM yourself" })
  const target = await dbGet('SELECT username FROM users WHERE username = ? AND email_verified = 1', partner) as any
  if (!target) return res.status(404).json({ error: 'User not found' })
  const text = String(req.body.text || '').trim().slice(0, 2000)
  const fileUrl = req.body.file_url ? String(req.body.file_url) : null
  const fileName = fileUrl ? String(req.body.file_name || 'file') : null
  const fileType = fileUrl ? String(req.body.file_type || 'application/octet-stream') : null
  const fileSize = fileUrl ? (Number(req.body.file_size) || 0) : null
  if (!text && !fileUrl) return res.status(400).json({ error: 'Message text or file is required' })
  const replyToId = req.body.reply_to_id ? Number(req.body.reply_to_id) : null
  const replyToText = replyToId ? String(req.body.reply_to_text || '').slice(0, 200) : null
  const replyToUsername = replyToId ? String(req.body.reply_to_username || '') : null
  const ts = Date.now()
  const online = isOnline(partner)
  const status = online ? 'delivered' : 'sent'
  const result = await dbRun(`
    INSERT INTO dm_messages (from_user, to_user, text, timestamp, status, reply_to_id, reply_to_text, reply_to_username, file_url, file_name, file_type, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, auth.username, partner, text, ts, status, replyToId, replyToText, replyToUsername, fileUrl, fileName, fileType, fileSize)
  const data = {
    id: result.lastInsertRowid,
    from_user: auth.username,
    to_user: partner,
    text,
    timestamp: ts,
    status,
    reply_to_id: replyToId,
    reply_to_text: replyToText,
    reply_to_username: replyToUsername,
    file_url: fileUrl,
    file_name: fileName,
    file_type: fileType,
    file_size: fileSize,
    color: usernameColor(auth.username),
  }
  sendToUser(partner, { type: 'dm_message', data })
  sendToUser(auth.username, { type: 'dm_message', data })
  res.json({ message: data })
})

// ── User Profile & Avatar ─────────────────────────────────────────────────────

app.get('/api/users/:username', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const user = await dbGet('SELECT username, avatar_url, last_seen_at, created_at FROM users WHERE username = ?', req.params.username) as any
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user: { ...user, online: isOnline(user.username) } })
})

app.post('/api/avatar', upload.single('avatar'), async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  if (!req.file) return res.status(400).json({ error: 'No file' })
  const url = `/uploads/${req.file.filename}`
  await dbRun('UPDATE users SET avatar_url = ? WHERE username = ?', url, auth.username)
  res.json({ avatar_url: url })
})

// ── Message Search ────────────────────────────────────────────────────────────

app.get('/api/search/messages', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const q = String(req.query.q || '').trim()
  if (!q || q.length < 2) return res.json({ results: [] })
  const like = `%${q}%`
  // Search DMs
  const dmResults = (await dbAll(`
    SELECT id, from_user, to_user, text, timestamp, 'dm' as source_type
    FROM dm_messages
    WHERE deleted = 0 AND text LIKE ? AND (from_user = ? OR to_user = ?)
    ORDER BY timestamp DESC LIMIT 20
  `, like, auth.username, auth.username)).map((r: any) => ({
    ...r,
    partner: r.from_user === auth.username ? r.to_user : r.from_user,
    color: usernameColor(r.from_user),
  }))
  // Search group messages
  const myGroups = (await dbAll('SELECT group_id FROM group_members WHERE username = ?', auth.username) as any[]).map((r: any) => r.group_id)
  let groupResults: any[] = []
  if (myGroups.length > 0) {
    groupResults = (await dbAll(`
      SELECT gm.id, gm.username as from_user, gm.text, gm.timestamp, gm.group_id,
             cg.name as group_name, 'group' as source_type
      FROM group_messages gm
      JOIN chat_groups cg ON cg.id = gm.group_id
      WHERE gm.deleted = 0 AND gm.text LIKE ? AND gm.group_id IN (${myGroups.map(() => '?').join(',')})
      ORDER BY gm.timestamp DESC LIMIT 20
    `, like, ...myGroups)).map((r: any) => ({
      ...r,
      color: usernameColor(r.from_user),
    }))
  }
  res.json({ results: [...dmResults, ...groupResults].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30) })
})
// ── Conversation Clear ──────────────────────────────────────────────────────

app.delete('/api/dm/:partner', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const partner = String(req.params.partner)
  // Soft-delete all messages in the conversation
  await dbRun(`UPDATE dm_messages SET deleted = 1 WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)`, auth.username, partner, partner, auth.username)
  res.json({ message: 'Conversation cleared' })
})

// ── Media Gallery ───────────────────────────────────────────────────────────

app.get('/api/media/dm/:partner', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const partner = String(req.params.partner)
  const files = await dbAll(`
    SELECT id, from_user, file_url, file_name, file_type, file_size, timestamp
    FROM dm_messages
    WHERE deleted = 0 AND file_url IS NOT NULL
      AND ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))
    ORDER BY timestamp DESC LIMIT 50
  `, auth.username, partner, partner, auth.username)
  res.json({ files })
})

app.get('/api/media/group/:id', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any) {
    return res.status(403).json({ error: 'Not a member' })
  }
  const files = await dbAll(`
    SELECT id, username as from_user, file_url, file_name, file_type, file_size, timestamp
    FROM group_messages
    WHERE deleted = 0 AND file_url IS NOT NULL AND group_id = ?
    ORDER BY timestamp DESC LIMIT 50
  `, groupId)
  res.json({ files })
})

// ── Pinned Messages API ─────────────────────────────────────────────────────

app.post('/api/groups/:id/pins/:msgId', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const msgId = Number(req.params.msgId)
  if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any) {
    return res.status(403).json({ error: 'Not a member' })
  }
  const msg = await dbGet('SELECT * FROM group_messages WHERE id = ? AND group_id = ?', msgId, groupId) as any
  if (!msg || msg.deleted) return res.status(404).json({ error: 'Message not found' })
  await dbRun('INSERT INTO pinned_messages (group_id, message_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', groupId, msgId, auth.username, Date.now())
  await broadcastToGroup(groupId, { type: 'pins_updated', groupId })
  res.json({ message: 'Pinned' })
})

app.delete('/api/groups/:id/pins/:msgId', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const msgId = Number(req.params.msgId)
  if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any) {
    return res.status(403).json({ error: 'Not a member' })
  }
  await dbRun('DELETE FROM pinned_messages WHERE group_id = ? AND message_id = ?', groupId, msgId)
  await broadcastToGroup(groupId, { type: 'pins_updated', groupId })
  res.json({ message: 'Unpinned' })
})

app.get('/api/groups/:id/pins', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any) {
    return res.status(403).json({ error: 'Not a member' })
  }
  const pins = (await dbAll(`
    SELECT pm.*, gm.text, gm.username, gm.timestamp as msg_timestamp, gm.file_url, gm.file_name
    FROM pinned_messages pm
    JOIN group_messages gm ON gm.id = pm.message_id
    WHERE pm.group_id = ? AND gm.deleted = 0
    ORDER BY pm.pinned_at DESC
  `, groupId)).map((p: any) => ({ ...p, color: usernameColor(p.username) }))
  res.json({ pins })
})

// ── Contact Blocking API ────────────────────────────────────────────────────

app.post('/api/block/:username', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const blocked = req.params.username
  if (blocked === auth.username) return res.status(400).json({ error: 'Cannot block yourself' })
  await dbRun('INSERT INTO blocked_users (blocker, blocked, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', auth.username, blocked, Date.now())
  res.json({ message: 'Blocked' })
})

app.delete('/api/block/:username', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  await dbRun('DELETE FROM blocked_users WHERE blocker = ? AND blocked = ?', auth.username, req.params.username)
  res.json({ message: 'Unblocked' })
})

app.get('/api/blocked', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const blocked = await dbAll('SELECT blocked, created_at FROM blocked_users WHERE blocker = ?', auth.username) as any[]
  res.json({ blocked })
})

// ── Message Forwarding API ──────────────────────────────────────────────────

app.post('/api/forward', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { messageId, messageType, toPartner, toGroupId } = req.body
  if (!messageId || !messageType) return res.status(400).json({ error: 'Missing fields' })

  // Get original message
  let originalText = ''
  let originalFile = null
  let originalFrom = ''
  if (messageType === 'dm') {
    const msg = await dbGet('SELECT * FROM dm_messages WHERE id = ?', messageId) as any
    if (!msg || msg.deleted) return res.status(404).json({ error: 'Message not found' })
    originalText = msg.text
    originalFrom = msg.from_user
    if (msg.file_url) originalFile = { url: msg.file_url, name: msg.file_name, type: msg.file_type, size: msg.file_size }
  } else if (messageType === 'group') {
    const msg = await dbGet('SELECT * FROM group_messages WHERE id = ?', messageId) as any
    if (!msg || msg.deleted) return res.status(404).json({ error: 'Message not found' })
    originalText = msg.text
    originalFrom = msg.username
    if (msg.file_url) originalFile = { url: msg.file_url, name: msg.file_name, type: msg.file_type, size: msg.file_size }
  }

  const fwdText = originalText ? `Fwd from ${originalFrom}: ${originalText}` : `Fwd from ${originalFrom}`

  // Forward to DM
  if (toPartner) {
    const ts = Date.now()
    const row = await dbRun(`INSERT INTO dm_messages (from_user, to_user, text, timestamp, file_url, file_name, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      auth.username, toPartner, fwdText, ts,
      originalFile?.url ?? null, originalFile?.name ?? null, originalFile?.type ?? null, originalFile?.size ?? null
    )
    const newMsg = await dbGet('SELECT * FROM dm_messages WHERE id = ?', row.lastInsertRowid) as any
    const payload = { type: 'dm_message', message: { ...newMsg, color: usernameColor(newMsg.from_user) } }
    sendToUser(auth.username, payload)
    sendToUser(toPartner, payload)
  }

  // Forward to group
  if (toGroupId) {
    const gid = Number(toGroupId)
    if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', gid, auth.username) as any) {
      return res.status(403).json({ error: 'Not a member of target group' })
    }
    const ts = Date.now()
    await dbRun(`INSERT INTO group_messages (group_id, username, text, timestamp, file_url, file_name, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      gid, auth.username, fwdText, ts,
      originalFile?.url ?? null, originalFile?.name ?? null, originalFile?.type ?? null, originalFile?.size ?? null
    )
    const newMsg = await dbGet('SELECT * FROM group_messages ORDER BY id DESC LIMIT 1',) as any
    await broadcastToGroup(gid, {
      type: 'group_message', groupId: gid,
      message: { ...newMsg, color: usernameColor(newMsg.username) }
    })
  }

  res.json({ message: 'Forwarded' })
})

// ── Message Edit / Delete / Reactions API ─────────────────────────────────────

// Helper: get reactions for a message
async function getReactions(messageId: number, messageType: string): Promise<AggregatedReaction[]> {
  const sql = "SELECT emoji, STRING_AGG(username, ',') as users FROM message_reactions WHERE message_id = ? AND message_type = ? GROUP BY emoji"
  return (await dbAll(sql, messageId, messageType)).map((r: any) => ({ emoji: r.emoji, users: r.users ? r.users.split(',') : [] }))
}

// Edit DM message
app.put('/api/dms/:partner/messages/:id', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const msgId = Number(req.params.id)
  const text = String(req.body.text || '').trim().slice(0, 2000)
  if (!text) return res.status(400).json({ error: 'Text is required' })
  const msg = await dbGet('SELECT * FROM dm_messages WHERE id = ?', msgId) as any
  if (!msg) return res.status(404).json({ error: 'Message not found' })
  if (msg.from_user !== auth.username) return res.status(403).json({ error: 'Can only edit your own messages' })
  if (msg.deleted) return res.status(400).json({ error: 'Message is deleted' })
  await dbRun('UPDATE dm_messages SET text = ?, edited = 1 WHERE id = ?', text, msgId)
  const partner = msg.from_user === auth.username ? msg.to_user : msg.from_user
  const update = { type: 'dm_edited', messageId: msgId, text, partner }
  sendToUser(auth.username, update)
  sendToUser(partner, update)
  res.json({ message: 'Updated' })
})

// Delete DM message
app.delete('/api/dms/:partner/messages/:id', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const msgId = Number(req.params.id)
  const msg = await dbGet('SELECT * FROM dm_messages WHERE id = ?', msgId) as any
  if (!msg) return res.status(404).json({ error: 'Message not found' })
  if (msg.from_user !== auth.username) return res.status(403).json({ error: 'Can only delete your own messages' })
  await dbRun("UPDATE dm_messages SET deleted = 1, text = '' WHERE id = ?", msgId)
  const partner = msg.from_user === auth.username ? msg.to_user : msg.from_user
  const update = { type: 'dm_deleted', messageId: msgId, partner }
  sendToUser(auth.username, update)
  sendToUser(partner, update)
  res.json({ message: 'Deleted' })
})

// Edit group message
app.put('/api/groups/:id/messages/:msgId', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const msgId = Number(req.params.msgId)
  const text = String(req.body.text || '').trim().slice(0, 2000)
  if (!text) return res.status(400).json({ error: 'Text is required' })
  if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any) {
    return res.status(403).json({ error: 'Not a member' })
  }
  const msg = await dbGet('SELECT * FROM group_messages WHERE id = ? AND group_id = ?', msgId, groupId) as any
  if (!msg) return res.status(404).json({ error: 'Message not found' })
  if (msg.username !== auth.username) return res.status(403).json({ error: 'Can only edit your own messages' })
  if (msg.deleted) return res.status(400).json({ error: 'Message is deleted' })
  await dbRun('UPDATE group_messages SET text = ?, edited = 1 WHERE id = ?', text, msgId)
  await broadcastToGroup(groupId, { type: 'group_msg_edited', groupId, messageId: msgId, text })
  res.json({ message: 'Updated' })
})

// Delete group message
app.delete('/api/groups/:id/messages/:msgId', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const groupId = Number(req.params.id)
  const msgId = Number(req.params.msgId)
  if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any) {
    return res.status(403).json({ error: 'Not a member' })
  }
  const msg = await dbGet('SELECT * FROM group_messages WHERE id = ? AND group_id = ?', msgId, groupId) as any
  if (!msg) return res.status(404).json({ error: 'Message not found' })
  // Allow message author or group admins to delete
  const membership = await dbGet('SELECT role FROM group_members WHERE group_id = ? AND username = ?', groupId, auth.username) as any
  if (msg.username !== auth.username && membership?.role !== 'admin') {
    return res.status(403).json({ error: 'Only the author or admins can delete messages' })
  }
  await dbRun("UPDATE group_messages SET deleted = 1, text = '' WHERE id = ?", msgId)
  await broadcastToGroup(groupId, { type: 'group_msg_deleted', groupId, messageId: msgId })
  res.json({ message: 'Deleted' })
})

// Add/toggle reaction
app.post('/api/reactions', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const { messageId, messageType, emoji } = req.body
  if (!messageId || !messageType || !emoji) return res.status(400).json({ error: 'Missing fields' })
  if (!['dm', 'group', 'channel'].includes(messageType)) return res.status(400).json({ error: 'Invalid message type' })
  // Toggle: remove if already exists, add if not
  const existing = await dbGet('SELECT id FROM message_reactions WHERE message_id = ? AND message_type = ? AND username = ? AND emoji = ?', messageId, messageType, auth.username, emoji) as any
  if (existing) {
    await dbRun('DELETE FROM message_reactions WHERE id = ?', existing.id)
  } else {
    await dbRun('INSERT INTO message_reactions (message_id, message_type, username, emoji, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', messageId, messageType, auth.username, emoji, Date.now())
  }
  const reactions = await getReactions(messageId, messageType)
  // Broadcast reaction update
  if (messageType === 'dm') {
    const msg = await dbGet('SELECT from_user, to_user FROM dm_messages WHERE id = ?', messageId) as any
    if (msg) {
      const update = { type: 'reaction_update', messageId, messageType, reactions }
      sendToUser(msg.from_user, update)
      sendToUser(msg.to_user, update)
    }
  } else if (messageType === 'group') {
    const msg = await dbGet('SELECT group_id FROM group_messages WHERE id = ?', messageId) as any
    if (msg) broadcastToGroup(msg.group_id, { type: 'reaction_update', messageId, messageType, reactions })
  }
  res.json({ reactions })
})

// Get reactions for a message
app.get('/api/reactions/:messageType/:messageId', async (req: Request, res: Response) => {
  const auth = getAuth(req)
  if (!auth) return res.status(401).json({ error: 'Unauthorized' })
  const reactions = await getReactions(Number(req.params.messageId), String(req.params.messageType))
  res.json({ reactions })
})

// --- WebSocket server ---
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const messages: ChatMessage[] = []
const clients = new Map<WebSocket, WsClient>()

let colorIndex = 0

function broadcastAll(data: Record<string, unknown>): void {
  const json = JSON.stringify(data)
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json)
  }
}

function sendToUser(username: string, data: Record<string, unknown>): void {
  const json = JSON.stringify(data)
  for (const [ws, client] of clients) {
    if (client.username === username && ws.readyState === WebSocket.OPEN) ws.send(json)
  }
}

async function broadcastToGroup(groupId: number, data: Record<string, unknown>): Promise<void> {
  const members = new Set(
    (await dbAll('SELECT username FROM group_members WHERE group_id = ?', groupId) as any[]).map((m: any) => m.username)
  )
  const json = JSON.stringify(data)
  for (const [ws, client] of clients) {
    if (members.has(client.username) && ws.readyState === WebSocket.OPEN) ws.send(json)
  }
}

function getOnlineUsers(): { username: string; color: string }[] {
  return [...clients.values()].map(c => ({ username: c.username, color: c.color }))
}

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw: Buffer) => {
    let msg: WsIncomingMessage
    try { msg = JSON.parse(raw.toString()) } catch { return }
    handleWsMessage(ws, msg).catch((err: any) => console.error('WS handler error:', err))
  })

  ws.on('close', async () => {
    try {
      const client = clients.get(ws)
      if (client) {
        clients.delete(ws)
        const now = Date.now()
        await dbRun('UPDATE users SET last_seen_at = ? WHERE username = ?', now, client.username)
        const leaveEvent = { type: 'system', message: `${client.username} left`, timestamp: now }
        messages.push(leaveEvent)
        broadcastAll({ type: 'system_message', data: leaveEvent })
        broadcastAll({ type: 'users', users: getOnlineUsers() })
        broadcastAll({ type: 'online_status', username: client.username, online: false, lastSeen: now })
      }
    } catch (err) {
      console.error('WS close handler error:', err)
    }
  })
})

async function handleWsMessage(ws: WebSocket, msg: WsIncomingMessage) {

  if (msg.type === 'join') {
    let payload
    try {
      payload = jwt.verify(String(msg.token), JWT_SECRET) as any
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired session. Please log in again.' }))
      ws.close()
      return
    }

    const username = payload.username

    const color = COLORS[colorIndex % COLORS.length]
    colorIndex++
    clients.set(ws, { username, color })

    ws.send(JSON.stringify({ type: 'history', messages }))

    const joinEvent = { type: 'system', message: `${username} joined`, timestamp: Date.now() }
    messages.push(joinEvent)
    broadcastAll({ type: 'system_message', data: joinEvent })
    broadcastAll({ type: 'users', users: getOnlineUsers() })

    // Promote any pending DMs to 'delivered' now that the user is online
    const senders = await dbAll(
      "SELECT DISTINCT from_user FROM dm_messages WHERE to_user = ? AND status = 'sent'",
      username
    )
    for (const { from_user } of senders as { from_user: string }[]) {
      const ids = (await dbAll(
        "SELECT id FROM dm_messages WHERE from_user = ? AND to_user = ? AND status = 'sent'",
        from_user, username
      )).map((r: any) => r.id)
      if (ids.length) {
        await dbRun(`UPDATE dm_messages SET status = 'delivered' WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
        sendToUser(from_user, { type: 'dm_delivered', byUser: username, ids })
      }
    }

    // Broadcast online presence to everyone
    broadcastAll({ type: 'online_status', username, online: true })
  }

  if (msg.type === 'typing') {
    const client = clients.get(ws)
    if (!client) return
    const isTyping = msg.isTyping !== false
    const json = JSON.stringify({ type: 'typing', username: client.username, isTyping })
    for (const [clientWs] of clients) {
      if (clientWs !== ws && clientWs.readyState === 1) clientWs.send(json)
    }
  }

  if (msg.type === 'message') {
    const client = clients.get(ws)
    if (!client) return

    const text = String(msg.text).trim().slice(0, 1000)
    if (!text) return

    const message = {
      id: Date.now() + Math.random(),
      username: client.username,
      color: client.color,
      text,
      timestamp: Date.now()
    }
    messages.push(message)
    if (messages.length > 200) messages.splice(0, messages.length - 200)

    broadcastAll({ type: 'message', data: message })
  }

  if (msg.type === 'group_message') {
    const client = clients.get(ws)
    if (!client) return
    const groupId = Number(msg.groupId)
    const text = String(msg.text || '').trim().slice(0, 2000)
    const fileUrl = msg.file_url ? String(msg.file_url) : null
    const fileName = fileUrl ? String(msg.file_name || 'file') : null
    const fileType = fileUrl ? String(msg.file_type || 'application/octet-stream') : null
    const fileSize = fileUrl ? (Number(msg.file_size) || 0) : null
    if (!groupId || (!text && !fileUrl)) return
    if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, client.username) as any) return
    const replyToId = msg.reply_to_id ? Number(msg.reply_to_id) : null
    const replyToText = replyToId ? String(msg.reply_to_text || '').slice(0, 200) : null
    const replyToUsername = replyToId ? String(msg.reply_to_username || '') : null
    const ts = Date.now()
    const result = await dbRun(
      'INSERT INTO group_messages (group_id, username, text, timestamp, reply_to_id, reply_to_text, reply_to_username, file_url, file_name, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      groupId, client.username, text, ts, replyToId, replyToText, replyToUsername, fileUrl, fileName, fileType, fileSize
    )
    await dbRun('UPDATE group_members SET last_seen_at = ? WHERE group_id = ? AND username = ?', ts, groupId, client.username)
    await broadcastToGroup(groupId, {
      type: 'group_message',
      groupId,
      data: {
        id: result.lastInsertRowid, group_id: groupId, username: client.username,
        color: usernameColor(client.username), text, timestamp: ts,
        reply_to_id: replyToId, reply_to_text: replyToText, reply_to_username: replyToUsername,
        file_url: fileUrl, file_name: fileName, file_type: fileType, file_size: fileSize,
      },
    })
  }

  if (['call_invite', 'call_accept', 'call_reject', 'call_end'].includes(msg.type)) {
    const client = clients.get(ws)
    if (!client || !(msg as any).toUser) return
    sendToUser((msg as any).toUser, { type: msg.type, fromUser: client.username, callMode: (msg as any).callMode })
  }

  if (msg.type === 'dm_typing') {
    const client = clients.get(ws)
    if (!client || !msg.toUser) return
    sendToUser(msg.toUser, { type: 'dm_typing', fromUser: client.username, isTyping: msg.isTyping !== false })
  }

  if (msg.type === 'group_typing') {
    const client = clients.get(ws)
    if (!client) return
    const groupId = Number(msg.groupId)
    if (!groupId) return
    if (!await dbGet('SELECT 1 FROM group_members WHERE group_id = ? AND username = ?', groupId, client.username) as any) return
    const members = new Set((await dbAll('SELECT username FROM group_members WHERE group_id = ?', groupId) as any[]).map((m: any) => m.username))
    const json = JSON.stringify({ type: 'group_typing', groupId, username: client.username, isTyping: msg.isTyping !== false })
    for (const [cws, cclient] of clients) {
      if (cclient.username !== client.username && members.has(cclient.username) && cws.readyState === 1) cws.send(json)
    }
  }
}

// SPA fallback — must come after all API routes
if (existsSync(distDir)) {
  app.get('*', (_: Request, res: Response) => res.sendFile(join(distDir, 'index.html')))
}

const PORT = process.env.PORT || 3001

initDb().then(() => {
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`)
  })
}).catch(err => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})
