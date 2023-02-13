const { Resolver } = require('dns').promises
const dnsSocket = require('dns-socket')
const psl = require('psl')
const Xache = require('xache')

const resolver = new Resolver()
resolver.setServers(['1.1.1.1', '8.8.8.8'])

const socket = dnsSocket()

const tlds = new Xache({
  maxSize: 50000,
  maxAge: 7 * 24 * 60 * 60 * 1000
})

const lookups = new Xache({
  maxSize: 50000,
  maxAge: 7 * 24 * 60 * 60 * 1000
})

module.exports = {
  getNameserversFromAuthorities,
  resolveNs,
  lookup,
  query
}

async function getNameserversFromAuthorities (name) {
  const parsed = psl.parse(name)

  const parentsAddress = []
  const parents = await resolveNs(parsed.tld)

  for (const hostname of parents) {
    // nameservers.push(hostname); continue
    const addrs = await lookup(hostname)
    if (addrs.length > 0) parentsAddress.push(addrs[0])
  }

  if (parentsAddress.length === 0) return []

  // Note: using Node dns.resolveNs throws ENODATA because it uses "Answer" instead of "Authority"
  // So we use dns-socket for manual querying the NS type to inspect authorities
  // + could use a cache
  const response = await query({
    questions: [{ type: 'NS', name: parsed.domain }]
  }, 53, parentsAddress[0])

  if (!response.authorities) return []

  return response.authorities.map(authority => authority.data).sort()
}

// + maybe protect against multiples at the time? still ok

async function resolveNs (name) {
  if (tlds.has(name)) return tlds.get(name)

  const nameservers = await resolver.resolveNs(name)
  tlds.set(name, nameservers)
  return nameservers
}

async function lookup (name) {
  if (lookups.has(name)) return lookups.get(name)

  const addrs = await resolver.resolve(name) // + lookup doesn't exists for some reason
  lookups.set(name, addrs)
  return addrs
}

function query (query, port, host) {
  return new Promise((resolve, reject) => {
    socket.query(query, port, host, function (err, res) {
      if (err) reject(err)
      else resolve(res)
    })
  })
}
