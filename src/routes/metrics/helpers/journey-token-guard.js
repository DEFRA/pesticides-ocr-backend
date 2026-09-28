import { config } from '#/config.js'

// Fail-open guard: beacon token verification is gated on the secret being set
// (so local / onboarding tiers still work), but a deployed tier reaching here
// with no secret means the anti-spoofing control is silently off. Warn loudly at
// boot (mirrors the auth plugin's missing-config warning) rather than letting it
// pass unnoticed.
export function warnIfJourneyTokenUnset(server) {
  if (
    !config.get('journeyToken.secret') &&
    config.get('cdpEnvironment') !== 'local'
  ) {
    server.log(
      ['metrics', 'warn'],
      'journey token secret is not configured — journey beacons will accept unsigned requests'
    )
  }
}
