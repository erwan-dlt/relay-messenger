const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { transaction } = require('./db')
const { hashPassword, verifyPassword, newSession, currentUser, cookie } = require('./security')

class HttpError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const fail = (code, message) => { throw new HttpError(code, message) }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_BODY = 16 * 1024

function send(res, code, value, extra = {}) {
  const json = JSON.stringify(value)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
  res.end(json)
}

async function parseBody(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, 'Corps JSON requis.')
  const chunks = []
  let totalBytes = 0
  for await (const chunk of req) {
    totalBytes += chunk.length
    if (totalBytes > MAX_BODY) fail(413, 'Requête trop volumineuse.')
    chunks.push(chunk)
  }
  const content = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(content)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail(400, 'Objet JSON attendu.')
    return parsed
  } catch (error) {
    if (error instanceof HttpError) throw error
    fail(400, 'JSON invalide.')
  }
}

function requireText(value, field, max) {
  if (typeof value !== 'string') fail(400, `Champ « ${field} » invalide.`)
  const result = value.trim()
  if (!result || result.length > max) fail(400, `Champ « ${field} » : entre 1 et ${max} caractères.`)
  return result
}

function memberOf(db, groupId, userId, ownerOnly = false) {
  const membership = db.prepare('SELECT role FROM memberships WHERE group_id = ? AND user_id = ?').get(groupId, userId)
  if (!membership) fail(403, 'Accès refusé à ce groupe.')
  if (ownerOnly && membership.role !== 'owner') fail(403, 'Action réservée au propriétaire du groupe.')
  return membership
}

const publicUser = user => ({ id: user.id, name: user.name, email: user.email })
const numberId = raw => (/^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw))) ? Number(raw) : fail(400, 'Identifiant invalide.')

const hits = new Map()
function limitAuth(ip) {
  const now = Date.now()
  const entry = hits.get(ip)
  if (!entry || now > entry.expires) { hits.set(ip, { count: 1, expires: now + 900000 }); return }
  if (entry.count >= 25) fail(429, 'Trop de tentatives. Réessayez dans 15 minutes.')
  entry.count++
  if (hits.size > 10000) for (const [key, value] of hits) if (value.expires < now) hits.delete(key)
}

function serveFile(res, urlPath, staticDir) {
  if (!staticDir || !fs.existsSync(path.join(staticDir, 'index.html'))) return false
  const safePath = urlPath.startsWith('/assets/') && /^\/assets\/[\w.-]+$/.test(urlPath)
    ? path.join(staticDir, urlPath.slice(1)) : path.join(staticDir, 'index.html')
  if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) return false
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon' }
  res.writeHead(200, { 'Content-Type': mime[path.extname(safePath)] || 'application/octet-stream', 'Cache-Control': safePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
  fs.createReadStream(safePath).pipe(res)
  return true
}

function createHandler(db, { staticDir = path.resolve(__dirname, '../../frontend/dist'), secureCookies = process.env.NODE_ENV === 'production', events = {} } = {}) {
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws://${req.headers.host} wss://${req.headers.host}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`)
    try {
      const url = new URL(req.url, 'http://localhost')
      const pathname = url.pathname
      const method = req.method
      if (method === 'GET' && pathname === '/api/health') return send(res, 200, { status: 'ok' })
      if (!pathname.startsWith('/api/')) {
        if (method === 'GET' && serveFile(res, pathname, staticDir)) return
        return fail(404, 'Page introuvable.')
      }
      // Same-origin mutation requests only (defense against cross-site requests).
      if (!['GET', 'HEAD'].includes(method)) {
        const origin = req.headers.origin
        const forwardedProto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
        const expected = `${forwardedProto}://${req.headers.host}`
        if (origin && origin !== expected) fail(403, 'Origine non autorisée.')
      }
      if (method === 'POST' && (pathname === '/api/auth/register' || pathname === '/api/auth/login')) {
        limitAuth(req.socket.remoteAddress || 'unknown')
        const body = await parseBody(req)
        const email = requireText(body.email, 'email', 254).toLowerCase()
        if (!EMAIL.test(email)) fail(400, 'Adresse e-mail invalide.')
        const password = body.password
        if (typeof password !== 'string') fail(400, 'Mot de passe manquant.')
        let user
        if (pathname.endsWith('/register')) {
          const name = requireText(body.name, 'nom', 70)
          if (name.length < 2) fail(400, 'Le nom doit contenir au moins 2 caractères.')
          if (password.length < 10 || password.length > 128) fail(400, 'Le mot de passe doit contenir entre 10 et 128 caractères.')
          if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'Cette adresse e-mail est déjà utilisée.')
          const hashed = await hashPassword(password)
          const created = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hashed)
          user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(created.lastInsertRowid)
        } else {
          user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
          if (!user || !(await verifyPassword(password, user.password_hash))) fail(401, 'Identifiants incorrects.')
        }
        const session = newSession(db, user.id)
        return send(res, pathname.endsWith('/register') ? 201 : 200, { user: publicUser(user) }, { 'Set-Cookie': cookie(session.token, secureCookies) })
      }
      const user = currentUser(db, req.headers.cookie)
      if (!user) fail(401, 'Veuillez vous connecter.')
      if (pathname === '/api/auth/me' && method === 'GET') return send(res, 200, { user: publicUser(user) })
      if (pathname === '/api/auth/logout' && method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(user.token_hash)
        events.logout?.(user.token_hash)
        return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', secureCookies, 0) })
      }
      if (pathname === '/api/groups') {
        if (method === 'GET') {
          const groups = db.prepare(`SELECT g.id, g.name, g.created_at AS createdAt, m.role,
            (SELECT COUNT(*) FROM memberships mx WHERE mx.group_id = g.id) AS memberCount,
            (SELECT body FROM messages msg WHERE msg.group_id = g.id ORDER BY msg.id DESC LIMIT 1) AS lastMessage
            FROM groups g JOIN memberships m ON m.group_id = g.id WHERE m.user_id = ?
            ORDER BY COALESCE((SELECT MAX(id) FROM messages WHERE group_id = g.id), 0) DESC, g.id DESC`).all(user.id)
          return send(res, 200, { groups })
        }
        if (method === 'POST') {
          const body = await parseBody(req)
          const name = requireText(body.name, 'nom du groupe', 70)
          const groupId = transaction(db, () => {
            const created = db.prepare('INSERT INTO groups (name, creator_id) VALUES (?, ?)').run(name, user.id)
            db.prepare("INSERT INTO memberships (group_id, user_id, role) VALUES (?, ?, 'owner')").run(created.lastInsertRowid, user.id)
            return Number(created.lastInsertRowid)
          })
          events.groupCreated?.(groupId, user.id)
          return send(res, 201, { group: { id: groupId, name, role: 'owner', memberCount: 1 } })
        }
      }
      const groupRoute = pathname.match(/^\/api\/groups\/([0-9]+)$/)
      if (groupRoute) {
        const gid = numberId(groupRoute[1])
        if (method === 'GET') {
          memberOf(db, gid, user.id)
          const group = db.prepare('SELECT id, name, creator_id AS creatorId, created_at AS createdAt FROM groups WHERE id = ?').get(gid)
          const members = db.prepare(`SELECT u.id, u.name, u.email, m.role FROM memberships m
            JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY (m.role = 'owner') DESC, u.name`).all(gid)
          return send(res, 200, { group, members })
        }
        if (method === 'DELETE') {
          memberOf(db, gid, user.id, true)
          db.prepare('DELETE FROM groups WHERE id = ?').run(gid)
          events.groupDeleted?.(gid)
          return send(res, 200, { ok: true })
        }
      }
      const membersRoute = pathname.match(/^\/api\/groups\/([0-9]+)\/members$/)
      if (membersRoute && method === 'POST') {
        const gid = numberId(membersRoute[1])
        memberOf(db, gid, user.id, true)
        const body = await parseBody(req)
        const email = requireText(body.email, 'email', 254).toLowerCase()
        const invited = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email)
        if (!invited) fail(404, 'Aucun compte ne correspond à cette adresse.')
        const exists = db.prepare('SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?').get(gid, invited.id)
        if (exists) fail(409, 'Cette personne fait déjà partie du groupe.')
        db.prepare("INSERT INTO memberships (group_id, user_id, role) VALUES (?, ?, 'member')").run(gid, invited.id)
        events.memberAdded?.(gid, invited.id)
        return send(res, 201, { member: { ...invited, role: 'member' } })
      }
      const memberRoute = pathname.match(/^\/api\/groups\/([0-9]+)\/members\/([0-9]+)$/)
      if (memberRoute && method === 'DELETE') {
        const gid = numberId(memberRoute[1])
        const uid = numberId(memberRoute[2])
        const membership = memberOf(db, gid, user.id)
        if (uid !== user.id && membership.role !== 'owner') fail(403, 'Action réservée au propriétaire.')
        const target = db.prepare('SELECT role FROM memberships WHERE group_id = ? AND user_id = ?').get(gid, uid)
        if (!target) fail(404, 'Membre introuvable.')
        if (target.role === 'owner') fail(403, 'Le propriétaire ne peut pas quitter son groupe. Supprimez plutôt le groupe.')
        db.prepare('DELETE FROM memberships WHERE group_id = ? AND user_id = ?').run(gid, uid)
        events.memberRemoved?.(gid, uid)
        return send(res, 200, { ok: true })
      }
      const messagesRoute = pathname.match(/^\/api\/groups\/([0-9]+)\/messages$/)
      if (messagesRoute) {
        const gid = numberId(messagesRoute[1])
        memberOf(db, gid, user.id)
        if (method === 'GET') {
          const beforeParam = url.searchParams.get('before')
          const before = beforeParam ? numberId(beforeParam) : Number.MAX_SAFE_INTEGER
          const rows = db.prepare(`SELECT msg.id, msg.body, msg.created_at AS createdAt, u.id AS authorId, u.name AS authorName
            FROM messages msg JOIN users u ON u.id = msg.author_id
            WHERE msg.group_id = ? AND msg.id < ? ORDER BY msg.id DESC LIMIT 51`).all(gid, before)
          const hasMore = rows.length > 50
          const messages = rows.slice(0, 50).reverse()
          return send(res, 200, { messages, hasMore, nextBefore: hasMore ? messages[0]?.id : null })
        }
        if (method === 'POST') {
          const body = await parseBody(req)
          const text = requireText(body.body, 'message', 2000)
          const created = db.prepare('INSERT INTO messages (group_id, author_id, body) VALUES (?, ?, ?)').run(gid, user.id, text)
          const message = db.prepare(`SELECT msg.id, msg.body, msg.created_at AS createdAt,
            u.id AS authorId, u.name AS authorName FROM messages msg JOIN users u ON u.id = msg.author_id WHERE msg.id = ?`)
            .get(created.lastInsertRowid)
          events.message?.(gid, message)
          return send(res, 201, { message })
        }
      }
      fail(404, 'Endpoint introuvable.')
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('API error:', error)
      if (res.headersSent) { res.destroy(); return }
      send(res, error instanceof HttpError ? error.code : 500,
        { error: error instanceof HttpError ? error.message : 'Erreur interne du serveur.' })
    }
  }
}

function createServer(db, opts = {}) {
  const events = opts.events || {}
  const server = http.createServer(createHandler(db, { ...opts, events }))
  if (opts.realtime !== false) {
    const { attachRealtime } = require('./realtime')
    Object.assign(events, attachRealtime(server, db))
  }
  return server
}
module.exports = { createServer }
