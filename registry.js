#!/usr/bin/env node

const os = require('os')
const path = require('path')
const net = require('net')

const minimist = require('minimist')
const { Packet } = require('dns2')
const psl = require('psl')
const sameData = require('same-data')
const goodbye = require('graceful-goodbye')

const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
const Hyperswarm = require('hyperswarm')
const crypto = require('hypercore-crypto')
const HypercoreId = require('hypercore-id-encoding')

const { sanitizeDomain, validateDomain } = require('./lib/domain.js')
const { getNameserversFromAuthorities } = require('./lib/dns.js')

const argv = minimist(process.argv.slice(2))

if (!argv.name) errorAndExit('--name is required (domain)')
if (!argv.type) errorAndExit('--type is required (A, CNAME, MX, TXT, SRV, NS, etc)')
if (!argv.value) errorAndExit('--value is required (Type A requires a IP Address, etc)')

const TYPES = new Map()
for (const k in Packet.TYPE) TYPES.set(Packet.TYPE[k], k)

const REGISTRYDIR = argv.storage || path.join(os.homedir(), '.hyper-nameserver', 'registry')

main().catch(err => {
  console.error(err)
  process.exit(1)
})

async function main () {
  let keyPair = null

  if (argv.seed) {
    const seed = Buffer.from(argv.seed, 'hex')
    keyPair = crypto.keyPair(seed)
  }

  const core = new Hypercore(REGISTRYDIR, { keyPair })
  const db = new Hyperbee(core, { keyEncoding: 'utf-8' })

  await db.ready()

  console.log('Registry core key:', db.id)

  const swarm = new Hyperswarm({ keyPair: db.core.keyPair })
  swarm.on('connection', onsocket.bind(null, swarm, db))
  swarm.join(db.discoveryKey)

  goodbye(() => swarm.destroy(), 1)
  goodbye(() => db.close(), 2)

  const name = sanitizeDomain(argv.name)
  validateDomain(name)

  if (Packet.TYPE[argv.type] === undefined) errorAndExit('Invalid type')

  if (argv.type === 'A') {
    if (!net.isIPv4(argv.value)) errorAndExit('Invalid value')
  } else {
    errorAndExit('Type ' + argv.type + ' not supported yet')
  }

  // Check if domain has proper DNS configured to our ns1/ns2
  if (argv.ns) {
    const ns = typeof argv.ns === 'string' ? [argv.ns] : argv.ns
    const nameservers = await getNameserversFromAuthorities(name)
    let found = false

    for (const nameserver of nameservers) {
      if (ns.includes(nameserver)) {
        found = true
        break
      }
    }

    if (!found) errorAndExit('Domain nameservers are not configured yet', nameservers)
  }

  // TODO: Use sub-encoder
  const parsed = psl.parse(name)
  const domain = db.sub(parsed.domain, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  const record = domain.sub(argv.type, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  // A, CNAME, MX, TXT, SRV, NS

  /* const isReady = await domain.get('ready')
  if (!isReady) {} */

  // TODO: Should somehow parse it to avoid repeating the base domain
  // '@' should mean root like 'example.com'
  // Could be an object with settings like TTL

  console.log('Record', { type: argv.type, name, value: argv.value })
  await record.put(name, argv.value, { cas })
  console.log('Record saved')

  // TODO: Ensure availability
}

function cas (prev, next) {
  return !sameData(prev.value, next.value)
}

function onsocket (swarm, db, socket, peerInfo) {
  const remote = socket.rawStream.remoteHost + ':' + socket.rawStream.remotePort
  const pk = HypercoreId.encode(peerInfo.publicKey)

  console.log('(Swarm) Peer opened (' + swarm.connections.size + ')', remote, pk)
  socket.on('close', () => console.log('(Swarm) Peer closed (' + swarm.connections.size + ')', remote, pk))
  socket.on('error', (err) => console.error('(Swarm) Peer error', err, pk))

  db.replicate(socket)
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
