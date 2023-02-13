const net = require('net')
const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
// const RAM = require('random-access-memory')
const Hyperswarm = require('hyperswarm')
// const crypto = require('hypercore-crypto')
const HypercoreId = require('hypercore-id-encoding')
const minimist = require('minimist')
const { Packet } = require('dns2')
const sameData = require('same-data')
const goodbye = require('graceful-goodbye')
const psl = require('psl')
const { sanitizeDomain, validateDomain } = require('./lib/domain.js')
const { getNameserversFromAuthorities } = require('./lib/dns.js')

const TYPES = new Map()
for (const k in Packet.TYPE) TYPES.set(Packet.TYPE[k], k)

const argv = minimist(process.argv.slice(2))

if (!argv.name) errorAndExit('--name is required (domain)')
if (!argv.type) errorAndExit('--type is required (A, CNAME, MX, TXT, SRV, NS, etc)')
if (!argv.value) errorAndExit('--value is required (Type A requires a IP Address, etc)')

main()

async function main () {
  // const seed = argv.seed ? Buffer.from(argv.seed, 'hex') : crypto.randomBytes(32)
  // const keyPair = crypto.keyPair(seed)

  const core = new Hypercore('./hypercore-registry') // , { keyPair })
  await core.ready()
  console.log('Core id:', core.id)
  // if (!argv.seed) console.log('Seed key:', seed.toString('hex'))

  if (!core.writable) throw new Error('Core is not writable')

  const swarm = new Hyperswarm({ keyPair: core.keyPair })
  swarm.on('connection', onsocket.bind(null, swarm, core))
  const discovery = swarm.join(core.discoveryKey)
  discovery.flushed().then(() => {
    console.log('(Swarm) Fully announced')
  })

  goodbye(() => swarm.destroy(), 1)
  goodbye(() => core.close(), 2)

  // + should improve validation so it's more reusable
  const name = sanitizeDomain(argv.name)
  validateDomain(name)

  if (Packet.TYPE[argv.type] === undefined) errorAndExit('Invalid type')

  if (argv.type === 'A') {
    if (!net.isIPv4(argv.value)) errorAndExit('Invalid value')
  } else {
    errorAndExit('Type ' + argv.type + ' not supported yet')
  }

  const bee = new Hyperbee(core, { keyEncoding: 'utf-8' })
  await bee.ready()

  // simple check for now
  const nameservers = await getNameserversFromAuthorities(name)
  if (nameservers.indexOf('ns.leet.ar') === -1 && nameservers.indexOf('ns1.leet.ar') === -1 && nameservers.indexOf('ns2.leet.ar') === -1) {
    errorAndExit('Domain nameservers are not configured yet', nameservers)
  }

  const parsed = psl.parse(name)
  const domain = bee.sub(parsed.domain, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  const record = domain.sub(argv.type, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  // A, CNAME, MX, TXT, SRV, NS

  /* const isReady = await domain.get('ready')
  if (!isReady) {} */

  // + should somehow parse it to avoid repeating the base domain
  // + '@' should mean root like 'example.com'
  // + could be an object with settings like TTL

  console.log('Record', { type: argv.type, name, value: argv.value })
  await record.put(name, argv.value, { cas })
  console.log('Record saved')

  // + ensure availability
}

function cas (prev, next) {
  return !sameData(prev.value, next.value)
}

function onsocket (swarm, core, socket, peerInfo) {
  const remote = socket.rawStream.remoteHost + ':' + socket.rawStream.remotePort
  const pk = HypercoreId.encode(peerInfo.publicKey)

  console.log('(Swarm) Peer opened (' + swarm.connections.size + ')', remote, pk)
  socket.on('close', () => console.log('(Swarm) Peer closed (' + swarm.connections.size + ')', remote, pk))
  socket.on('error', (err) => console.error('(Swarm) Peer error', err, pk))

  core.replicate(socket)
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
