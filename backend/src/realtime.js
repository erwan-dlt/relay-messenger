'use strict'

const { Server } = require('socket.io')
const { currentUser } = require('./security')

const userRoom = userId => `user:${userId}`
const groupRoom = groupId => `group:${groupId}`

// Socket.IO shares the HTTP server and the existing HttpOnly session cookie.
// All messages are still written through the permission-checked REST API.
function attachRealtime(server, db) {
  const io = new Server(server, {
    path: '/socket.io',
    serveClient: true,
    // WebSocket isn't protected by browser CORS. Reject other web origins explicitly.
    allowRequest(request, callback) {
      const origin = request.headers.origin
      if (!origin) return callback(null, true) // Non-browser clients still need a valid cookie.
      try {
        const parsed = new URL(origin)
        const proto = request.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:'
        const allowed = parsed.host === request.headers.host && parsed.protocol === proto
        return callback(null, allowed)
      } catch {
        return callback(null, false)
      }
    }
  })

  io.use((socket, next) => {
    try {
      const user = currentUser(db, socket.handshake.headers.cookie)
      if (!user) return next(new Error('Session invalide ou expirée.'))
      socket.data.userId = user.id
      socket.data.tokenHash = user.token_hash
      next()
    } catch {
      next(new Error('Impossible de vérifier la session.'))
    }
  })

  io.on('connection', socket => {
    const userId = socket.data.userId
    socket.join(userRoom(userId))
    const groups = db.prepare('SELECT group_id FROM memberships WHERE user_id = ?').all(userId)
    for (const { group_id: groupId } of groups) socket.join(groupRoom(groupId))

    // An already-open connection must not outlive its session's expiration.
    const session = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(socket.data.tokenHash)
    if (!session) { socket.disconnect(true); return }
    const expirationTimer = setTimeout(() => socket.disconnect(true), Math.max(0, session.expires_at - Date.now()))
    expirationTimer.unref?.()
    socket.on('disconnect', () => clearTimeout(expirationTimer))
  })

  return {
    message(groupId, message) {
      io.to(groupRoom(groupId)).emit('message:new', { groupId, message })
    },
    groupCreated(groupId, userId) {
      io.in(userRoom(userId)).socketsJoin(groupRoom(groupId))
      io.to(userRoom(userId)).emit('groups:changed')
    },
    memberAdded(groupId, userId) {
      io.in(userRoom(userId)).socketsJoin(groupRoom(groupId))
      io.to(userRoom(userId)).emit('groups:changed')
      io.to(groupRoom(groupId)).emit('group:members-changed', { groupId })
      io.to(groupRoom(groupId)).emit('groups:changed')
    },
    memberRemoved(groupId, userId) {
      io.in(userRoom(userId)).socketsLeave(groupRoom(groupId))
      io.to(userRoom(userId)).emit('group:removed', { groupId })
      io.to(groupRoom(groupId)).emit('group:members-changed', { groupId })
      io.to(groupRoom(groupId)).emit('groups:changed')
    },
    groupDeleted(groupId) {
      io.to(groupRoom(groupId)).emit('group:removed', { groupId })
      io.in(groupRoom(groupId)).socketsLeave(groupRoom(groupId))
    },
    logout(tokenHash) {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.tokenHash === tokenHash) socket.disconnect(true)
      }
    },
    close() { io.close() }
  }
}

module.exports = { attachRealtime }
