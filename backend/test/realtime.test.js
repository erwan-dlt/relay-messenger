'use strict'

// Run after `npm install` in backend. These are real Socket.IO integration tests.
const test = require('node:test')
const assert = require('node:assert/strict')
const { io } = require('socket.io-client')
const { openDatabase } = require('../src/db')
const { createServer } = require('../src/app')

function waitForEvent(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`Missing ${event}`)) }, timeoutMs)
    function onEvent(data) { clearTimeout(timer); resolve(data) }
    socket.once(event, onEvent)
  })
}

async function withServer(run) {
  const db = openDatabase(':memory:')
  const server = createServer(db, { staticDir: null })
  const sockets = []
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  async function call(path, { method = 'GET', cookie, data } = {}) {
    const response = await fetch(base + path, { method, headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {})
    }, body: data ? JSON.stringify(data) : undefined })
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  async function connect(cookie, origin = base) {
    const socket = io(base, {
      autoConnect: false, reconnection: false, transports: ['websocket'],
      extraHeaders: { ...(cookie ? { Cookie: cookie } : {}), Origin: origin }
    })
    sockets.push(socket)
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(null, new Error('Socket connection timed out')), 3000)
      function finish(outcome, error) {
        clearTimeout(timer)
        socket.off('connect', onConnect)
        socket.off('connect_error', onError)
        if (error) reject(error)
        else resolve(outcome)
      }
      function onConnect() { finish({ ok: true }) }
      function onError(error) { finish({ ok: false, error }) }
      socket.once('connect', onConnect)
      socket.once('connect_error', onError)
    })
    socket.connect()
    return { socket, ...(await result) }
  }
  async function register(name, email) {
    const result = await call('/api/auth/register', { method: 'POST', data: { name, email, password: 'SuperSecret123!' } })
    assert.equal(result.status, 201)
    return result.cookie
  }
  try { await run({ call, connect, register, base }) }
  finally {
    for (const socket of sockets) socket.disconnect()
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
}

test('new messages are pushed only to members; joins and removals update live rooms', async () => withServer(async ({ call, connect, register }) => {
  const alice = await register('Alice Martin', 'alice@example.test')
  const bob = await register('Bob Laurent', 'bob@example.test')
  const charlie = await register('Charlie Moreau', 'charlie@example.test')
  const created = await call('/api/groups', { method: 'POST', cookie: alice, data: { name: 'Équipe' } })
  const gid = created.data.group.id

  const a = await connect(alice)
  const b = await connect(bob)
  const c = await connect(charlie)
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.equal(c.ok, true)

  const bobJoined = waitForEvent(b.socket, 'groups:changed')
  assert.equal((await call(`/api/groups/${gid}/members`, { method: 'POST', cookie: alice, data: { email: 'bob@example.test' } })).status, 201)
  await bobJoined

  const aliceReceived = waitForEvent(a.socket, 'message:new')
  const bobReceived = waitForEvent(b.socket, 'message:new')
  let outsiderReceived = false
  c.socket.on('message:new', () => { outsiderReceived = true })
  const sent = await call(`/api/groups/${gid}/messages`, { method: 'POST', cookie: alice, data: { body: 'Bonjour en direct' } })
  assert.equal(sent.status, 201)
  const [aEvent, bEvent] = await Promise.all([aliceReceived, bobReceived])
  assert.equal(aEvent.groupId, gid)
  assert.equal(bEvent.message.id, sent.data.message.id)
  assert.equal(bEvent.message.body, 'Bonjour en direct')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(outsiderReceived, false)

  const removed = waitForEvent(b.socket, 'group:removed')
  const bobId = (await call(`/api/groups/${gid}`, { cookie: alice })).data.members.find(user => user.email === 'bob@example.test').id
  assert.equal((await call(`/api/groups/${gid}/members/${bobId}`, { method: 'DELETE', cookie: alice })).status, 200)
  assert.equal((await removed).groupId, gid)
  const next = waitForEvent(a.socket, 'message:new')
  let removedReceived = false
  b.socket.on('message:new', () => { removedReceived = true })
  await call(`/api/groups/${gid}/messages`, { method: 'POST', cookie: alice, data: { body: 'Privé' } })
  await next
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(removedReceived, false)
  assert.equal((await call(`/api/groups/${gid}/messages`, { cookie: bob })).status, 403)
}))

test('forbidden origins and missing cookies cannot open a live connection', async () => withServer(async ({ connect, register }) => {
  const alice = await register('Alice', 'alice@example.test')
  const missing = await connect(undefined)
  assert.equal(missing.ok, false)
  const crossSite = await connect(alice, 'https://attacker.invalid')
  assert.equal(crossSite.ok, false)
  const valid = await connect(alice)
  assert.equal(valid.ok, true)
}))

test('logging out invalidates the active socket session', async () => withServer(async ({ call, connect, register }) => {
  const alice = await register('Alice', 'alice@example.test')
  const connected = await connect(alice)
  assert.equal(connected.ok, true)
  const disconnected = waitForEvent(connected.socket, 'disconnect')
  assert.equal((await call('/api/auth/logout', { method: 'POST', cookie: alice })).status, 200)
  await disconnected
  const invalid = await connect(alice)
  assert.equal(invalid.ok, false)
}))

test('missed messages remain accessible over REST after reconnecting', async () => withServer(async ({ call, connect, register }) => {
  const alice = await register('Alice', 'alice@example.test')
  const bob = await register('Bob', 'bob@example.test')
  const gid = (await call('/api/groups', { method: 'POST', cookie: alice, data: { name: 'Équipe' } })).data.group.id
  await call(`/api/groups/${gid}/members`, { method: 'POST', cookie: alice, data: { email: 'bob@example.test' } })
  const initial = await connect(bob)
  assert.equal(initial.ok, true)
  initial.socket.disconnect()
  const sent = await call(`/api/groups/${gid}/messages`, { method: 'POST', cookie: alice, data: { body: 'Message pendant la coupure' } })
  assert.equal(sent.status, 201)
  const again = await connect(bob)
  assert.equal(again.ok, true)
  const history = await call(`/api/groups/${gid}/messages`, { cookie: bob })
  assert.ok(history.data.messages.some(message => message.id === sent.data.message.id))
}))

test('a group created after connection is immediately subscribed, and deletion is broadcast', async () => withServer(async ({ call, connect, register }) => {
  const alice = await register('Alice', 'alice@example.test')
  const client = await connect(alice)
  assert.equal(client.ok, true)
  const changed = waitForEvent(client.socket, 'groups:changed')
  const created = await call('/api/groups', { method: 'POST', cookie: alice, data: { name: 'Nouveau groupe' } })
  assert.equal(created.status, 201)
  await changed
  const gid = created.data.group.id
  const received = waitForEvent(client.socket, 'message:new')
  const sent = await call(`/api/groups/${gid}/messages`, { method: 'POST', cookie: alice, data: { body: 'Premier message' } })
  assert.equal(sent.status, 201)
  assert.equal((await received).message.id, sent.data.message.id)
  const removed = waitForEvent(client.socket, 'group:removed')
  assert.equal((await call(`/api/groups/${gid}`, { method: 'DELETE', cookie: alice })).status, 200)
  assert.equal((await removed).groupId, gid)
}))
