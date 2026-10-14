const { openDatabase, transaction } = require('./db')
const { hashPassword } = require('./security')
const path = require('node:path')

;(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('La démo ne peut pas être initialisée en production.')
  const db = openDatabase(process.env.DB_PATH || path.resolve(__dirname, '../data/relay.sqlite'))
  const password = await hashPassword('Demo1234!X')
  const names = [
    ['Alice Martin', 'alice@example.test'],
    ['Bob Laurent', 'bob@example.test'],
    ['Charlie Moreau', 'charlie@example.test']
  ]
  for (const [name, email] of names) {
    db.prepare('INSERT OR IGNORE INTO users(name,email,password_hash) VALUES(?,?,?)').run(name, email, password)
  }
  const people = Object.fromEntries(names.map(([_, email]) => [email, db.prepare('SELECT id FROM users WHERE email=?').get(email).id]))
  // Idempotent seed: add sample data only once.
  const exists = db.prepare("SELECT id FROM groups WHERE name='Projet Web — équipe démo' AND creator_id=?").get(people['alice@example.test'])
  if (!exists) {
    transaction(db, () => {
      const gid = db.prepare('INSERT INTO groups (name,creator_id) VALUES (?,?)').run('Projet Web — équipe démo', people['alice@example.test']).lastInsertRowid
      for (const [email, role] of [['alice@example.test', 'owner'], ['bob@example.test', 'member'], ['charlie@example.test', 'member']]) {
        db.prepare('INSERT INTO memberships (group_id,user_id,role) VALUES (?,?,?)').run(gid, people[email], role)
      }
      for (const [email, body] of [
        ['alice@example.test', 'Bienvenue sur Relay ! 👋'],
        ['bob@example.test', 'On peut enfin échanger dans notre espace de projet.'],
        ['charlie@example.test', 'La messagerie est prête à être testée 🚀'],
        ['alice@example.test', 'Essayez de créer un autre groupe depuis la barre latérale.']
      ]) db.prepare('INSERT INTO messages (group_id,author_id,body) VALUES (?,?,?)').run(gid, people[email], body)
    })
  }
  db.close()
  console.log('Demo prête : alice@example.test, bob@example.test, charlie@example.test / Demo1234!X')
})().catch(error => { console.error(error); process.exitCode = 1 })
