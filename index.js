const dns2 = require('dns2')
const { Packet } = require('dns2')
const goodbye = require('graceful-goodbye')
const psl = require('psl')
const { sanitizeDomain, validateDomain } = require('./lib/domain.js')
const { getNameserversFromAuthorities } = require('./lib/dns.js')
const NameserverError = require('./lib/errors.js')

const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
// const RAM = require('random-access-memory')
const Hyperswarm = require('hyperswarm')
const HypercoreId = require('hypercore-id-encoding')

const server = dns2.createServer({
  udp: true,
  tcp: true
  // + doh
})

// + should read core key from config or argv
const core = new Hypercore('./hypercore-nameserver', HypercoreId.decode('b8ghiymmtz6ydhu41rqbb713q6p3g43fhtfkc7sk6pjhg9ap7xiy'))
const bee = new Hyperbee(core, { keyEncoding: 'utf-8' })

const TYPES = new Map()
for (const k in Packet.TYPE) TYPES.set(Packet.TYPE[k], k)

// + DNSKEY 48  RFC 4034  DNS Key record  The key record used in DNSSEC. Uses the same format as the KEY record.
// + HTTPS  65  IETF Draft  HTTPS Binding RR that improves performance for clients that need to resolve many resources to access a domain. More info in this IETF Draft by DNSOP Working group and Akamai technologies.

main()

async function main () {
  await core.ready()
  await bee.ready()

  if (core.writable) throw new Error('Core should be readable only')

  const swarm = new Hyperswarm()
  goodbye(() => swarm.destroy(), 2)
  swarm.on('connection', onsocket.bind(null, swarm, core))
  swarm.join(core.discoveryKey)
  const done = core.findingPeers()
  swarm.flush().then(done, done)
  // await core.update()

  core.download()
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
    udp: { port: 53, address: '0.0.0.0', type: 'udp4' },
    tcp: { port: 53, address: '0.0.0.0' } // + is it actually needed?
  })

  // + wait for server
  goodbye(() => server.close(), 1)
}

async function onrequest (request, response, send, from) {
  const remoteInfo = from.address + ':' + from.port + ' (' + from.family + ') (size: ' + from.size + ')'

  if (!request.questions.length) throw new NameserverError('No questions', 'NO_QUESTIONS')
  if (request.questions.length >= 2) console.log('Notice: more than two questions', simplerReq(request))

  const question = request.questions[0]

  const name = sanitizeDomain(question.name) // + improve domain name validation
  validateDomain(name)

  const TYPE = TYPES.get(question.type)
  if (TYPE === undefined) throw new NameserverError('Type not supported (' + question.type + ')', 'TYPE_NOT_SUPPORTED')

  // + class 1 IN?

  // Query directly for now
  if (TYPE === 'NS') {
    const nameservers = await getNameserversFromAuthorities(name)
    console.log('DNS request (response)', [name, TYPE, nameservers], remoteInfo, simplerReq(request))

    for (const nameserver of nameservers) {
      response.answers.push({
        name,
        type: Packet.TYPE[TYPE],
        class: Packet.CLASS.IN,
        ttl: 1, // + obvs should set a better ttl
        ns: nameserver
      })
    }

    send(response)
    return
  }

  const parsed = psl.parse(name) // + this could throw? // + it sometimes parsed.domain is undefined, still don't know the original input
  const domain = bee.sub(parsed.domain, { keyEncoding: 'utf-8', valueEncoding: 'json' })
  const record = domain.sub(TYPE, { keyEncoding: 'utf-8', valueEncoding: 'json' }) // A, CNAME, MX, TXT, SRV, NS
  const address = await record.get(name, { timeout: 15000 })

  if (address === null) {
    console.log('DNS request (not found)', [name, TYPE], remoteInfo, simplerReq(request))
    send(response)
    return
  }

  console.log('DNS request (response)', [name, TYPE, address.value], remoteInfo, simplerReq(request))

  // + allow array of addresses for simple load-balancing

  response.answers.push({
    name,
    type: Packet.TYPE[TYPE],
    class: Packet.CLASS.IN,
    ttl: 1, // + obvs should set a better ttl
    address: address.value
  })

  send(response)

  // + probably add some optional analytics, store important info about requests, responses, etc
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

function onsocket (swarm, core, socket, peerInfo) {
  const remote = socket.rawStream.remoteHost + ':' + socket.rawStream.remotePort
  const pk = HypercoreId.encode(peerInfo.publicKey)

  console.log('(Swarm) Peer opened (' + swarm.connections.size + ')', remote, pk)
  socket.on('close', () => console.log('(Swarm) Peer closed (' + swarm.connections.size + ')', remote, pk))
  socket.on('error', (err) => console.error('(Swarm) Peer error', err, pk))

  core.replicate(socket)
}

function simplerReq (request) {
  const req = JSON.parse(JSON.stringify(request)) // Just to make sure, as this is temp
  return Object.assign({}, req, { header: null, headerId: req.header.id })
}
