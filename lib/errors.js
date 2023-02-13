module.exports = class NameserverError extends Error {
  constructor (msg, code) {
    super(code + ': ' + msg)
    this.code = code
  }

  get name () {
    return 'NameserverError'
  }
}
