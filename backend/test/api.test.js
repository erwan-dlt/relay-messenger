const test = require('node:test')
const assert = require('node:assert/strict')
const { openDatabase } = require('../src/db')
const { createServer } = require('../src/app')

async function withServer(run, options = {}) {
  const db = openDatabase(':memory:')
  const server = createServer(db, { staticDir: null, realtime: false, ...options })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (path, { method = 'GET', data, cookie, origin } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
      body: data !== undefined ? JSON.stringify(data) : undefined
    })
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  try { await run(call, db, base) }
  finally { await new Promise(resolve => server.close(resolve)); db.close() }
}

async function register(call, name, email) {
  const result = await call('/api/auth/register', { method: 'POST', data: { name, email, password: 'SuperSecret123!' } })
  assert.equal(result.status, 201, JSON.stringify(result.data))
  return result.cookie
}

async function createGroup(call, cookie, name = 'Projet démo') {
  const response = await call('/api/groups', { method: 'POST', cookie, data: { name } })
  assert.equal(response.status, 201)
  return response.data.group.id
}

test('register, session cookie, refresh, login and logout', async () => withServer(async call => {
  const cookie = await register(call, 'Alice Martin', 'alice@example.test')
  assert.match(cookie, /^relay_session=/)
  assert.equal((await call('/api/auth/me', { cookie })).data.user.name, 'Alice Martin')
  assert.equal((await call('/api/auth/me')).status, 401)
  const logout = await call('/api/auth/logout', { method: 'POST', cookie })
  assert.equal(logout.status, 200)
  assert.equal((await call('/api/auth/me', { cookie })).status, 401)
  assert.equal((await call('/api/auth/login', { method: 'POST', data: { email: 'alice@example.test', password: 'incorrect' } })).status, 401)
  const loggedIn = await call('/api/auth/login', { method: 'POST', data: { email: 'alice@example.test', password: 'SuperSecret123!' } })
  assert.equal(loggedIn.status, 200)
  assert.ok(loggedIn.cookie)
}))

test('owner creates groups, adds registered users, manages memberships', async () => withServer(async call => {
  const owner = await register(call, 'Alice Martin', 'alice@example.test')
  const member = await register(call, 'Bob Laurent', 'bob@example.test')
  const outsider = await register(call, 'Charlie Moreau', 'charlie@example.test')
  const gid = await createGroup(call, owner)
  assert.equal((await call('/api/groups', { cookie: owner })).data.groups.length, 1)
  assert.equal((await call('/api/groups', { cookie: member })).data.groups.length, 0)
  assert.equal((await call(`/api/groups/${gid}`, { cookie: outsider })).status, 403)
  assert.equal((await call(`/api/groups/${gid}/members`, { method: 'POST', cookie: member, data: { email: 'charlie@example.test' } })).status, 403)
  assert.equal((await call(`/api/groups/${gid}/members`, { method: 'POST', cookie: owner, data: { email: 'bob@example.test' } })).status, 201)
  assert.equal((await call(`/api/groups/${gid}`, { cookie: member })).data.members.length, 2)
  assert.equal((await call(`/api/groups/${gid}/members`, { method: 'POST', cookie: owner, data: { email: 'bob@example.test' } })).status, 409)
  assert.equal((await call(`/api/groups/${gid}/members/${1}`, { method: 'DELETE', cookie: owner })).status, 403)
  const bob = (await call(`/api/groups/${gid}`, { cookie: owner })).data.members.find(v => v.name.startsWith('Bob'))
  assert.equal((await call(`/api/groups/${gid}/members/${bob.id}`, { method: 'DELETE', cookie: member })).status, 200)
  assert.equal((await call(`/api/groups/${gid}`, { cookie: member })).status, 403)
  assert.equal((await call(`/api/groups/${gid}`, { method: 'DELETE', cookie: outsider })).status, 403)
  assert.equal((await call(`/api/groups/${gid}`, { method: 'DELETE', cookie: owner })).status, 200)
}))

test('only group members can post and read messages; pagination works', async () => withServer(async call => {
  const owner = await register(call, 'Alice Martin', 'alice@example.test')
  const member = await register(call, 'Bob Laurent', 'bob@example.test')
  const gid = await createGroup(call, owner)
  const endpoint = `/api/groups/${gid}/messages`
  assert.equal((await call(endpoint, { cookie: member })).status, 403)
  assert.equal((await call(endpoint, { method: 'POST', cookie: member, data: { body: 'Hello' } })).status, 403)
  assert.equal((await call(endpoint, { method: 'POST', cookie: owner, data: { body: ' ' } })).status, 400)
  const first = await call(endpoint, { method: 'POST', cookie: owner, data: { body: 'Bonjour 👋' } })
  assert.equal(first.status, 201)
  assert.equal(first.data.message.authorName, 'Alice Martin')
  assert.equal((await call(endpoint, { cookie: owner })).data.messages[0].body, 'Bonjour 👋')
  await call(`/api/groups/${gid}/members`, { method: 'POST', cookie: owner, data: { email: 'bob@example.test' } })
  assert.equal((await call(endpoint, { method: 'POST', cookie: member, data: { body: 'Salut !' } })).status, 201)
  for (let i = 0; i < 52; i++) await call(endpoint, { method: 'POST', cookie: owner, data: { body: `Message ${i}` } })
  const page1 = (await call(endpoint, { cookie: member })).data
  assert.equal(page1.messages.length, 50)
  assert.equal(page1.hasMore, true)
  const page2 = (await call(`${endpoint}?before=${page1.nextBefore}`, { cookie: member })).data
  assert.equal(page2.messages.length, 4)
  assert.equal(page2.hasMore, false)
  assert.ok(page2.messages.at(-1).id < page1.messages[0].id)
}))

test('invalid inputs, origin guard, and duplicate accounts', async () => withServer(async call => {
  assert.equal((await call('/api/auth/register', { method: 'POST', data: { name: 'A', email: 'bad', password: 'xx' } })).status, 400)
  await register(call, 'Alice Martin', 'alice@example.test')
  assert.equal((await call('/api/auth/register', { method: 'POST', data: { name: 'Alice', email: 'alice@example.test', password: 'SuperSecret123!' } })).status, 409)
  assert.equal((await call('/api/auth/login', { method: 'POST', origin: 'https://evil.example', data: { email: 'alice@example.test', password: 'SuperSecret123!' } })).status, 403)
  assert.equal((await call('/api/does-not-exist')).status, 401)
}))

test('deleting a group cascades to members and messages', async () => withServer(async (call, db) => {
  const owner = await register(call, 'Alice Martin', 'alice@example.test')
  const gid = await createGroup(call, owner)
  await call(`/api/groups/${gid}/messages`, { method: 'POST', cookie: owner, data: { body: 'Test' } })
  await call(`/api/groups/${gid}`, { method: 'DELETE', cookie: owner })
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM memberships').get().count, 0)
}))

// Regression test: running the backend again must never wipe real conversations.
test('database and messages survive reopening the same file', async () => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'))
  const dbFile = path.join(dir, 'relay.sqlite')
  try {
    const first = openDatabase(dbFile)
    first.prepare('INSERT INTO users(name,email,password_hash) VALUES (?,?,?)').run('Alice', 'persist@example.test', 'dummy-hash')
    first.close()
    const reopened = openDatabase(dbFile)
    assert.equal(reopened.prepare('SELECT name FROM users WHERE email=?').get('persist@example.test').name, 'Alice')
    reopened.close()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// Confirm the HTTP handlers notify the real-time layer *after* successful writes.
test('REST mutations publish the expected real-time events', async () => {
  const emitted = []
  const events = Object.fromEntries(['message', 'groupCreated', 'memberAdded', 'memberRemoved', 'groupDeleted', 'logout']
    .map(name => [name, (...args) => emitted.push({ name, args })]))
  await withServer(async call => {
    const alice = await register(call, 'Alice Martin', 'alice@example.test')
    const bob = await register(call, 'Bob Laurent', 'bob@example.test')
    const gid = await createGroup(call, alice)
    assert.equal(emitted.at(-1).name, 'groupCreated')
    assert.equal(emitted.at(-1).args[0], gid)
    await call(`/api/groups/${gid}/members`, { method: 'POST', cookie: alice, data: { email: 'bob@example.test' } })
    assert.equal(emitted.at(-1).name, 'memberAdded')
    const sent = await call(`/api/groups/${gid}/messages`, { method: 'POST', cookie: bob, data: { body: 'Salut !' } })
    assert.equal(sent.status, 201)
    assert.equal(emitted.at(-1).name, 'message')
    assert.equal(emitted.at(-1).args[0], gid)
    assert.equal(emitted.at(-1).args[1].id, sent.data.message.id)
    const before = emitted.length
    assert.equal((await call(`/api/groups/${gid}/messages`, { method: 'POST', cookie: bob, data: { body: '' } })).status, 400)
    assert.equal(emitted.length, before)
    const bobId = (await call(`/api/groups/${gid}`, { cookie: alice })).data.members.find(m => m.email === 'bob@example.test').id
    await call(`/api/groups/${gid}/members/${bobId}`, { method: 'DELETE', cookie: alice })
    assert.equal(emitted.at(-1).name, 'memberRemoved')
    await call(`/api/groups/${gid}`, { method: 'DELETE', cookie: alice })
    assert.equal(emitted.at(-1).name, 'groupDeleted')
    await call('/api/auth/logout', { method: 'POST', cookie: alice })
    assert.equal(emitted.at(-1).name, 'logout')
  }, { events })
})
