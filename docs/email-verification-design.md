# Email verification (OTP) design

Verifies that the submitter owns the email address entered during the
registration journey, before the submission is completed. This is
verification only — it does not authenticate the user, create an account,
or link to a submission.

## Endpoints

```
POST /email-verifications                          { "email": "..." }   -> 201 { verificationId, expiresAt, ... }
POST /email-verifications/{verificationId}/confirm  { "code": "..." }    -> 200 { verified }
POST /email-verifications/{verificationId}/resend   (no body)            -> 201 { verificationId, expiresAt, ... }
```

## Decision: frontend-only gate

`POST /register` is deliberately not checked against verification state.
There is no token or submission-linking concept here — the frontend drives
the OTP step in the UI and only allows the user to proceed once `confirm`
has succeeded. A caller that bypasses the UI can submit without verifying.
This trade-off was accepted because:

- The OTP step exists to catch typos and give the applicant confidence
  they'll receive correspondence, not to prevent fraud.
- Wiring verification into `/register` would require persisting and
  validating a verification token across the form session, which is a
  bigger change than the value justifies for this use case.

## Decision: no per-IP rate limiting

Per-IP limiting was considered but dropped. On this service's hosting
platform (CDP), the backend only sees the load balancer's address in
`request.info.remoteAddress` — not the originating client IP — so an
IP-based limiter would either be a no-op (keying everything off the same
LB address) or require trusting an unsanitised `x-forwarded-for` header,
which is itself a spoofing risk without a confirmed, trusted proxy chain.

Abuse is bounded instead by, all scoped per email address:

- a per-email rate limit on starting/resending verification
  (`maxPerEmailPerHour`);
- a resend cooldown (`resendCooldownSeconds`) and a cap on resends
  (`maxResends`);
- a cap on incorrect code attempts (`maxAttempts`);
- OTP and record expiry (`codeTtlSeconds`, `recordTtlSeconds`).

## Concurrency

`confirmVerification` re-checks the stored `codeHash` as part of its
success-path update, so a `resend` that rotates the code between a
`confirm` request's read and write causes that `confirm` to fail with
`CodeExpiredError` rather than accepting a superseded code.
