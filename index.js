#!/usr/bin/env node

const os = require('os')
const path = require('path')

const minimist = require('minimist')
const dns2 = require('dns2')
const { Packet } = require('dns2')
const psl = require('psl')
const goodbye = require('graceful-goodbye')

const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
const Hyperswarm = require('hyperswarm')
const HypercoreId = require('hypercore-id-encoding')

const { sanitizeDomain, validateDomain } = require('./lib/domain.js')
const { getNameserversFromAuthorities } = require('./lib/dns.js')
const NameserverError = require('./lib/errors.js')

const argv = minimist(process.argv.slice(2))

if (!argv._[0]) errorAndExit('Usage example: hyper-nameserver <key> [--option <value>]')

const server = dns2.createServer({
  udp: true,
  tcp: true
  // TODO: DoH
})

const SERVERDIR = argv.storage || path.join(os.homedir(), '.hyper-nameserver', 'server')

const core = new Hypercore(SERVERDIR, HypercoreId.decode(argv._[0]))
const db = new Hyperbee(core, { keyEncoding: 'utf-8' })

const TYPES = new Map()
for (const k in Packet.TYPE) TYPES.set(Packet.TYPE[k], k)

main().catch(err => {
  console.error(err)
  process.exit(1)
})

async function main () {
  await db.ready()

  if (db.writable) throw new Error('Core should be readable only')

  const swarm = new Hyperswarm()
  const done = db.core.findingPeers()
  swarm.on('connection', onsocket.bind(null, swarm, db))
  swarm.join(db.discoveryKey)
  swarm.flush().then(done, done)

  db.core.download()

  core.on('download', function (index, byteLength, from) {
    const remote = from.stream.rawStream.remoteHost + ':' + from.stream.rawStream.remotePort
    console.log('Downloaded block #' + index, 'from', remote)
  })

  server.on('request', async function (request, send, from) {
    const response = Packet.createResponseFromRequest(request)

    try {
      await onrequest(request, response, send, from)
    } catch (error) {
      console.log(error, simplerReq(request), 'from', from.address + ':' + from.port + ' (' + from.family + ')')

      // We always reply on errors for now
      send(response)

      // if (error.name === 'NameserverError') return
      // if (error.name === 'HypercoreError' && error.code === 'REQUEST_TIMEOUT') return
    }
  })

  server.listen({
    udp: { port: argv.port || 53, address: '0.0.0.0', type: 'udp4' },
    tcp: { port: argv.port || 53, address: '0.0.0.0' } // TODO: Is TCP actually needed?
  })

  goodbye(() => server.close(), 1)
  goodbye(() => swarm.destroy(), 2)
}

async function onrequest (request, response, send, from) {
  const remoteInfo = from.address + ':' + from.port + ' (' + from.family + ') (size: ' + from.size + ')'

  if (!request.questions.length) throw new NameserverError('No questions', 'NO_QUESTIONS')
  if (request.questions.length >= 2) console.log('Notice: more than two questions', simplerReq(request))

  const question = request.questions[0]

  const name = sanitizeDomain(question.name) // TODO: Improve domain name validation
  validateDomain(name)

  const TYPE = TYPES.get(question.type)
  if (TYPE === undefined) throw new NameserverError('Type not supported (' + question.type + ')', 'TYPE_NOT_SUPPORTED')

  // TODO: Class 1 IN?

  // Query directly for now
  if (TYPE === 'NS') {
    const nameservers = await getNameserversFromAuthorities(name)
    console.log('DNS request (response)', [name, TYPE, nameservers], remoteInfo, simplerReq(request))

    for (const nameserver of nameservers) {
      response.answers.push({
        name,
        type: Packet.TYPE[TYPE],
        class: Packet.CLASS.IN,
        ttl: 1, // TODO: Should set a better ttl
        ns: nameserver
      })
    }

    send(response)
    return
  }

  // TODO: Sometimes parsed.domain is undefined, still don't know the original input
  const parsed = psl.parse(name) // TODO: Could `psl.parse` throw?
  const domain = db.sub(parsed.domain, { keyEncoding: 'utf-8', valueEncoding: 'json' }) // TODO: Use sub-encoder
  const record = domain.sub(TYPE, { keyEncoding: 'utf-8', valueEncoding: 'json' }) // A, CNAME, MX, TXT, SRV, NS
  const address = await record.get(name, { timeout: 15000 })

  if (address === null) {
    console.log('DNS request (not found)', [name, TYPE], remoteInfo, simplerReq(request))
    send(response)
    return
  }

  console.log('DNS request (response)', [name, TYPE, address.value], remoteInfo, simplerReq(request))

  // TODO: Allow array of addresses for simple load-balancing

  response.answers.push({
    name,
    type: Packet.TYPE[TYPE],
    class: Packet.CLASS.IN,
    ttl: 1, // TODO: Should set a better ttl
    address: address.value
  })

  send(response)

  // TODO: Probably add some optional analytics, store important info about requests, responses, etc
}

server.on('requestError', function (error) {
  console.log('Client sent an invalid request', error)
})

server.on('listening', function () {
  console.log('Server listening', server.addresses())
})

server.on('close', function () {
  console.log('Server closed')
})

function onsocket (swarm, db, socket, peerInfo) {
  const remote = socket.rawStream.remoteHost + ':' + socket.rawStream.remotePort
  const pk = HypercoreId.encode(peerInfo.publicKey)

  console.log('(Swarm) Peer opened (' + swarm.connections.size + ')', remote, pk)
  socket.on('close', () => console.log('(Swarm) Peer closed (' + swarm.connections.size + ')', remote, pk))
  socket.on('error', (err) => console.error('(Swarm) Peer error', err, pk))

  db.replicate(socket)
}

function simplerReq (request) {
  const req = JSON.parse(JSON.stringify(request)) // Just to make sure, as this is temp
  return Object.assign({}, req, { header: null, headerId: req.header.id })
}

function errorAndExit (message) {
  console.error('Error:', message)
  process.exit(1)
}
