const NameserverError = require('./errors.js')

module.exports = {
  sanitizeDomain,
  validateDomain
}

function sanitizeDomain (name) {
  return name.toLowerCase()
}

// + actually this should only validate the domain body (no TLD, and not subdomain)
function validateDomain (name) {
  if (name.length < 3 || name.length > 63) throw new NameserverError('Invalid domain name: Min 3 length, and max 63 length', 'INVALID_DOMAIN_NAME_LENGTH')

  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)

    // first and last chars can't be hyphens
    if ((i === 0 || i === name.length - 1) && c === 45) throw new NameserverError('Invalid domain name: Can not start or end with a hyphen', 'INVALID_DOMAIN_START_END')

    // + invalidate two hyphens together

    if (c === 45) continue // hyphen (-)
    if (c === 95) continue // underscore (_)
    if (c === 46) continue // dot (.)

    if (c > 47 && c < 58) continue // numeric (0-9)
    if (c > 64 && c < 91) continue // upper alpha (A-Z)
    if (c > 96 && c < 123) continue // lower alpha (a-z)

    throw new NameserverError('Invalid domain name: Unknown character (' + c + ')', 'INVALID_DOMAIN_CHARACTER')
  }

  return true
}
