const { randomBytes, scrypt: scryptCallback, createHash, timingSafeEqual } = require('node:crypto')
const { promisify } = require('node:util')
const scrypt = promisify(scryptCallback)
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(password, salt, 64)
  return `scrypt:${salt}:${hash.toString('hex')}`
}

async function verifyPassword(password, stored) {
  const [type, salt, hex] = (stored || '').split(':')
  if (type !== 'scrypt' || !salt || !hex) return false
  const expected = Buffer.from(hex, 'hex')
  if (expected.length !== 64) return false
  const actual = await scrypt(password, salt, expected.length)
  return timingSafeEqual(actual, expected)
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function newSession(db, userId) {
  const token = randomBytes(32).toString('base64url')
  const expires = Date.now() + SESSION_TTL
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), userId, expires)
  return { token, expires }
}

function currentUser(db, cookieHeader) {
  const raw = (cookieHeader || '').split(';').map(v => v.trim()).find(v => v.startsWith('relay_session='))
  const token = raw ? raw.slice('relay_session='.length) : ''
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null
  return db.prepare(`SELECT u.id, u.name, u.email, s.token_hash FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .get(tokenHash(token), Date.now()) || null
}

function cookie(token, secure = false, maxAge = 604800) {
  return `relay_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

module.exports = { hashPassword, verifyPassword, tokenHash, newSession, currentUser, cookie }
