import { describe, it, expect } from '@jest/globals'
import { generateKeyPairSync } from 'crypto'
import { toPkcs8 } from '../src/auth'

describe('toPkcs8', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  it('converts a PKCS#1 key (as GitHub issues) to PKCS#8', () => {
    expect(pkcs1).toContain('BEGIN RSA PRIVATE KEY')
    const converted = toPkcs8(pkcs1)
    expect(converted).toContain('BEGIN PRIVATE KEY')
    expect(converted).not.toContain('BEGIN RSA PRIVATE KEY')
  })

  it('passes an already-PKCS#8 key through equivalently', () => {
    expect(toPkcs8(pkcs8).trim()).toBe(pkcs8.trim())
  })
})
