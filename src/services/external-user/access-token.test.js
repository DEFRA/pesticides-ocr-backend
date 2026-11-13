import { config } from '#/config.js'
import {
  issueExternalAccessToken,
  verifyExternalAccessToken
} from './access-token.js'

describe('external-user access token', () => {
  const originalSecret = config.get('externalUser.tokenSecret')
  const originalTtl = config.get('externalUser.tokenTtlSeconds')

  beforeEach(() => {
    config.set('externalUser.tokenSecret', 'test-external-user-secret')
    config.set('externalUser.tokenTtlSeconds', 2)
  })

  afterEach(() => {
    config.set('externalUser.tokenSecret', originalSecret)
    config.set('externalUser.tokenTtlSeconds', originalTtl)
  })

  test('issues a token that verifies back to the same subject/reference/role', async () => {
    const token = await issueExternalAccessToken({
      subject: 'subj-1',
      reference: 'OCR-AAA-001'
    })

    const payload = await verifyExternalAccessToken(token)
    expect(payload.sub).toBe('subj-1')
    expect(payload.reference).toBe('OCR-AAA-001')
    expect(payload.roles).toEqual(['external_user'])
  })

  test('rejects a token signed with a different secret', async () => {
    const token = await issueExternalAccessToken({
      subject: 'subj-1',
      reference: 'OCR-AAA-001'
    })

    config.set('externalUser.tokenSecret', 'a-different-secret')

    await expect(verifyExternalAccessToken(token)).rejects.toThrow()
  })

  test('rejects an expired token', async () => {
    config.set('externalUser.tokenTtlSeconds', -1)
    const token = await issueExternalAccessToken({
      subject: 'subj-1',
      reference: 'OCR-AAA-001'
    })

    await expect(verifyExternalAccessToken(token)).rejects.toThrow()
  })

  test('fails closed when no secret is configured', async () => {
    config.set('externalUser.tokenSecret', '')

    await expect(
      issueExternalAccessToken({ subject: 'subj-1', reference: 'OCR-AAA-001' })
    ).rejects.toThrow(/externalUser.tokenSecret is not configured/)
  })
})
