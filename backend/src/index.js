const { openDatabase } = require('./db')
const { createServer } = require('./app')
const path = require('node:path')

const port = Number(process.env.PORT || 3000)
const databasePath = process.env.DB_PATH || path.resolve(__dirname, '../data/relay.sqlite')
const db = openDatabase(databasePath)
const server = createServer(db)
server.listen(port, () => console.log(`Relay API: http://localhost:${port}`))

function shutdown() { server.close(() => { db.close(); process.exit(0) }) }
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
