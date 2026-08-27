import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from '#/common/helpers/convict/validate-mongo-uri.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

// Auth mode keys off the CDP tier (the `ENVIRONMENT` var, same signal the
// `cdpEnvironment` setting below reads), not NODE_ENV, so a deployed tier can
// never silently fall back to the unverified mock auth path.
const isLocalTier = (process.env.ENVIRONMENT ?? 'local') === 'local'

const notifyKeyMode = process.env.NOTIFY_KEY_MODE ?? 'test'
const localNotifyApiKey =
  {
    team: process.env.NOTIFY_TEAM_API_KEY,
    test: process.env.NOTIFY_TEST_API_KEY
  }[notifyKeyMode] ?? ''

convict.addFormats(convictFormatWithValidator)

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind',
    format: 'port',
    default: 3001,
    env: 'PORT'
  },
  serviceName: {
    doc: 'Api Service Name',
    format: String,
    default: 'pesticides-ocr-backend'
  },
  cdpEnvironment: {
    doc: 'The CDP environment the app is running in. With the addition of "local" for local development',
    format: [
      'local',
      'infra-dev',
      'management',
      'dev',
      'test',
      'perf-test',
      'ext-test',
      'prod'
    ],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  log: {
    isEnabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: !isTest,
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : ['req', 'res', 'responseTime']
    }
  },
  mongo: {
    mongoUrl: {
      doc: 'URI for mongodb',
      format: String,
      default: 'mongodb://127.0.0.1:27017/',
      env: 'MONGO_URI'
    },
    databaseName: {
      doc: 'database for mongodb',
      format: String,
      default: 'pesticides-ocr-backend',
      env: 'MONGO_DATABASE'
    },
    mongoOptions: {
      retryWrites: {
        doc: 'Enable Mongo write retries, overrides mongo URI when set.',
        format: Boolean,
        default: null,
        nullable: true,
        env: 'MONGO_RETRY_WRITES'
      },
      readPreference: {
        doc: 'Mongo read preference, overrides mongo URI when set.',
        format: [
          'primary',
          'primaryPreferred',
          'secondary',
          'secondaryPreferred',
          'nearest'
        ],
        default: null,
        nullable: true,
        env: 'MONGO_READ_PREFERENCE'
      }
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy URL',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  tracing: {
    header: {
      doc: 'CDP tracing header name',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  referencePrefix: {
    doc: 'Prefix used when generating registration reference numbers (e.g. PPP produces PP-XXX-XXX)',
    format: String,
    default: 'PPP',
    env: 'REFERENCE_PREFIX'
  },
  notify: {
    keyMode: {
      doc: 'Which local Notify key to use: team sends real email to the guestlist, test sends none. Ignored when NOTIFY_API_KEY is set.',
      format: ['team', 'test'],
      default: notifyKeyMode,
      env: 'NOTIFY_KEY_MODE'
    },
    apiKey: {
      doc: 'Gov.UK Notify API key. Injected as a pipeline secret in deployed environments, resolved from NOTIFY_KEY_MODE locally.',
      format: String,
      default: localNotifyApiKey,
      sensitive: true,
      env: 'NOTIFY_API_KEY'
    },
    templates: {
      submissionConfirmation: {
        doc: 'Notify template ID for the submission confirmation email',
        format: String,
        default: '',
        env: 'NOTIFY_TEMPLATE_SUBMISSION_CONFIRMATION'
      }
    }
  },
  // API authorisation (EQ-413). Protected routes require a bearer token:
  //   live  - a Microsoft Entra JWT, signature-verified against the tenant JWKS
  //           with issuer + audience checks.
  //   mock  - the token is decoded WITHOUT signature verification (local/CI only,
  //           never production) so the API can be exercised without a live IdP.
  auth: {
    mode: {
      doc: 'API auth mode: mock (decode token, no IdP; local only) or live (verify Entra JWTs via JWKS). Defaults to live on every deployed tier.',
      format: ['mock', 'live'],
      default: isLocalTier ? 'mock' : 'live',
      env: 'AUTH_MODE'
    },
    entra: {
      tenantId: {
        doc: 'Entra tenant (directory) id — issuer and JWKS URI are derived from it',
        format: String,
        default: '',
        env: 'ENTRA_TENANT_ID'
      },
      audience: {
        doc: 'Expected token audience (the API app-registration id / app-id-uri). Required in live mode.',
        format: String,
        default: '',
        env: 'ENTRA_API_AUDIENCE'
      },
      issuer: {
        doc: 'Expected token issuer. Empty = derive the v2.0 issuer from tenantId.',
        format: String,
        default: '',
        env: 'ENTRA_ISSUER'
      },
      jwksUri: {
        doc: 'JWKS endpoint. Empty = derive from tenantId.',
        format: String,
        default: '',
        env: 'ENTRA_JWKS_URI'
      },
      roleValues: {
        doc: 'Entra app-role value(s) that grant case-officer access, comma-separated; enforced as a route scope',
        format: String,
        default: 'case_officer',
        env: 'ENTRA_CASE_OFFICER_ROLE_VALUE'
      }
    }
  }
})

config.validate({ allowed: 'strict' })
