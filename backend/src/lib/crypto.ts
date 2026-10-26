import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto'

const KEYLEN = 64
const R = 8
const P = 3

function scrypt(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r: R, p: P, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })
}

/** Format: scrypt$N$r$p$saltB64$hashB64  parameters are stored so the cost can be raised later. */
export async function hashPassword(password: string, n: number): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, n)
  return `scrypt$${n}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$')
  if (alg !== 'scrypt' || Number(r) !== R || Number(p) !== P) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), Number(n))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
export const randomToken = (bytes = 48) => randomBytes(bytes).toString('base64url')
