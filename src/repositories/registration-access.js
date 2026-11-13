import { REGISTRATION_ACCESS_COLLECTION } from '#/common/constants/collections.js'
import { assertReference } from '#/repositories/guards.js'

// One record per verified external identity that has been granted access to a
// registration. This is the source of truth for "does this external user own
// this registration" — checked on every external-user request before a
// protected operation runs (record-level authorisation, not just role-level).
//
// `subject` is the stable identifier for the verified external identity (never
// the plain email address — same reasoning as the Entra `sub` claim: an opaque
// id that can't be used to look someone up directly). It is minted when the
// access token is issued after email verification (see
// services/external-user/access-token.js) and stored alongside the reference
// it was granted for.
//
// Lifecycle (completion ticket AC5 — confirmed decision, see
// magic-link-tickets.md "Complete secure applicant access to registrations:
// decisions confirmed" §3 for the rationale): a grant is only active while BOTH
//   - it has not been explicitly revoked (`revokedAt` unset), and
//   - it has not passed its `expiresAt`.
// `expiresAt` defaults to the same lifetime as the access token minted
// alongside it (externalUser.tokenTtlSeconds) — the grant and the token it
// backs expire together, so a grant can never outlive every token issued
// from it. Re-verifying renews an existing grant in place (same `grantedAt`
// semantics as before: idempotent, no duplicate records) rather than
// creating a second one, extending `expiresAt` and clearing `revokedAt`.
const NO_ID = { _id: 0 }

function assertSubject(subject) {
  if (typeof subject !== 'string' || subject === '') {
    throw new TypeError('subject must be a non-empty string')
  }
}

// An active grant has no revokedAt and either no expiresAt (never set, legacy
// data) or an expiresAt still in the future.
const activeFilter = (subject, reference, now) => ({
  subject,
  reference,
  revokedAt: { $exists: false },
  $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }]
})

export function createRegistrationAccessRepository({ db }) {
  const collection = db.collection(REGISTRATION_ACCESS_COLLECTION)

  return {
    // Grants (or renews) `subject` access to `reference`, active until
    // `expiresAt`. Idempotent: re-verifying the same email for the same
    // registration renews the one record — extending its expiry and
    // clearing any prior revocation — rather than creating a duplicate.
    async grant({ subject, reference, grantedAt = new Date(), expiresAt }) {
      assertSubject(subject)
      assertReference(reference)
      await collection.updateOne(
        { subject, reference },
        {
          $set: { grantedAt, ...(expiresAt && { expiresAt }) },
          $unset: { revokedAt: '' }
        },
        { upsert: true }
      )
    },

    // Returns true only if `subject` has an active (not revoked, not
    // expired) grant for `reference`. Used by the record-level authorisation
    // check — callers must not use the reference supplied by the client for
    // anything other than this lookup.
    async isPermitted(subject, reference, { now = new Date() } = {}) {
      assertSubject(subject)
      assertReference(reference)
      const grant = await collection.findOne(
        activeFilter(subject, reference, now),
        { projection: NO_ID }
      )
      return grant !== null
    },

    // All registrations a subject currently holds a grant for, newest first.
    async listForSubject(subject) {
      assertSubject(subject)
      return collection
        .find({ subject }, { projection: NO_ID })
        .sort({ grantedAt: -1 })
        .toArray()
    },

    // Revokes every grant on `reference` (across every subject that was ever
    // granted access to it), regardless of expiry. Used when the
    // registration's contact email changes (completion ticket AC6 — default
    // decision): entitlement was established against the old email, so every
    // existing grant stops being valid and must be re-established by
    // re-verifying the new email.
    async revokeAllForReference(reference, { revokedAt = new Date() } = {}) {
      assertReference(reference)
      await collection.updateMany(
        { reference, revokedAt: { $exists: false } },
        { $set: { revokedAt } }
      )
    }
  }
}

