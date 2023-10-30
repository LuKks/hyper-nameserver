const NameserverError = require('./errors.js')

module.exports = {
  sanitizeDomain,
  validateDomain
}

function sanitizeDomain (name) {
  return name.toLowerCase()
}

// TODO: This should only validate the domain body (no TLD, and not subdomain)
function validateDomain (name) {
  if (name.length < 3 || name.length > 63) throw new NameserverError('Invalid domain name: Min 3 length, and max 63 length', 'INVALID_DOMAIN_NAME_LENGTH')

  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)

    // First and last chars can't be hyphens
    if ((i === 0 || i === name.length - 1) && c === 45) throw new NameserverError('Invalid domain name: Can not start or end with a hyphen', 'INVALID_DOMAIN_START_END')

    // TODO: Invalidate two hyphens together

    if (c === 45) continue // Hyphen (-)
    if (c === 95) continue // Underscore (_)
    if (c === 46) continue // Dot (.)

    if (c > 47 && c < 58) continue // Numeric (0-9)
    if (c > 64 && c < 91) continue // Upper alpha (A-Z)
    if (c > 96 && c < 123) continue // Lower alpha (a-z)

    throw new NameserverError('Invalid domain name: Unknown character (' + c + ')', 'INVALID_DOMAIN_CHARACTER')
  }

  return true
}
