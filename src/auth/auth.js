import { config } from '#/config.js'

import { entraBearerScheme } from './entra-bearer-scheme.js'
import { getJwks } from './jwks.js'
import { STRATEGY_NAME } from './strategy-name.js'

// Resolve the Entra validation parameters, deriving the standard v2.0 issuer and
// JWKS URI from the tenant id when they are not set explicitly.
export function resolveEntra() {
  const entra = config.get('auth.entra')
  const base = `https://login.microsoftonline.com/${entra.tenantId}`
  return {
    tenantId: entra.tenantId,
    audience: entra.audience,
    issuer: entra.issuer || `${base}/v2.0`,
    jwksUri: entra.jwksUri || `${base}/discovery/v2.0/keys`
  }
}

// Registers the `entra-bearer` auth scheme + strategy. Routes opt in via
// `options.auth` (see requireRole); it is NOT the server default, so open routes
// such as /health stay unauthenticated.
export const auth = {
  plugin: {
    name: 'auth',
    register(server) {
      const mode = config.get('auth.mode')

      // Fail closed: mock mode decodes tokens WITHOUT verifying them, so it must
      // never run on a deployed tier — only on local. Refuse to boot otherwise.
      if (mode === 'mock' && config.get('cdpEnvironment') !== 'local') {
        throw new Error(
          `auth: mock mode is only allowed locally (cdpEnvironment=${config.get('cdpEnvironment')})`
        )
      }

      // Warn (don't crash) if live mode is not fully configured: the scheme
      // fails closed per request (rejects with 401) when issuer/audience are
      // missing, so unprotected routes (e.g. /register) still deploy while Entra
      // onboarding is pending.
      if (mode === 'live') {
        const { tenantId, audience } = resolveEntra()
        if (!tenantId || !audience) {
          server.log(
            ['auth', 'warn'],
            'live mode is not fully configured (missing tenantId/audience) — protected routes will reject all requests until set'
          )
        }
      }

      // The scheme and strategy share the one name (see strategy-name.js).
      server.auth.scheme(STRATEGY_NAME, (schemeServer, schemeOptions) =>
        entraBearerScheme(schemeServer, {
          mode,
          resolveEntra,
          getKeySet: () => getJwks(resolveEntra().jwksUri),
          ...schemeOptions
        })
      )
      server.auth.strategy(STRATEGY_NAME, STRATEGY_NAME)
    }
  }
}
