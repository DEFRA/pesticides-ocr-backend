import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from '#/common/helpers/convict/validate-mongo-uri.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const isDevelopment = process.env.NODE_ENV === 'development'

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
  isDevelopment: {
    doc: 'Whether the app is running in development mode, derived from NODE_ENV',
    format: Boolean,
    default: isDevelopment
  },
  isProduction: {
    doc: 'Whether the app is running in production mode, derived from NODE_ENV. Read by the Notify service to suppress verbose send logging.',
    format: Boolean,
    default: isProduction
  },
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
      },
      emailVerificationOtp: {
        doc: 'Notify template ID for the email verification one-time-code email. The template body must reference the code as ((otp)).',
        format: String,
        default: 'ca8b5958-4ba0-4806-9e84-1143dfc3e841',
        env: 'NOTIFY_TEMPLATE_EMAIL_VERIFICATION_OTP'
      }
    }
  },
  emailVerification: {
    codeLength: {
      doc: 'Length of the generated one-time verification code',
      format: [4, 6],
      default: 6,
      env: 'EMAIL_OTP_LENGTH'
    },
    codeTtlSeconds: {
      doc: 'How long a generated verification code remains valid for',
      format: 'nat',
      default: 900,
      env: 'EMAIL_OTP_TTL_SECONDS'
    },
    maxAttempts: {
      doc: 'Maximum incorrect code attempts allowed before a resend is required',
      format: 'nat',
      default: 5,
      env: 'EMAIL_OTP_MAX_ATTEMPTS'
    },
    maxResends: {
      doc: 'Maximum number of times a code can be resent for a single verification',
      format: 'nat',
      default: 5,
      env: 'EMAIL_OTP_MAX_RESENDS'
    },
    resendCooldownSeconds: {
      doc: 'Minimum time between resend requests for a single verification',
      format: 'nat',
      default: 60,
      env: 'EMAIL_OTP_RESEND_COOLDOWN_SECONDS'
    },
    recordTtlSeconds: {
      doc: 'How long a verification record (code/token hashes included) is retained before it is automatically deleted',
      format: 'nat',
      default: 86400,
      env: 'EMAIL_OTP_RECORD_TTL_SECONDS'
    },
    hashSecret: {
      doc: 'Server-side secret mixed into the HMAC used to hash verification codes at rest',
      format: String,
      default: '',
      sensitive: true,
      env: 'EMAIL_OTP_HASH_SECRET'
    },
    rateLimit: {
      maxPerEmailPerHour: {
        doc: 'Maximum verification starts/resends allowed per email address per hour',
        format: 'nat',
        default: 5,
        env: 'EMAIL_OTP_RATE_LIMIT_EMAIL_PER_HOUR'
      },
      maxPerIpPerHour: {
        doc: 'Maximum verification starts/resends allowed per caller IP per hour',
        format: 'nat',
        default: 20,
        env: 'EMAIL_OTP_RATE_LIMIT_IP_PER_HOUR'
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
        doc: 'Entra app-role value(s) that grant case-officer access, comma-separated (e.g. "case_officer" or "case_officer,admin"); enforced as a route scope',
        format: String,
        default: 'case_officer',
        env: 'ENTRA_CASE_OFFICER_ROLE_VALUES'
      },
      requiredScope: {
        doc: 'Required OAuth scope the access token must carry in its `scp` claim (EQ-442). Use the SHORT scope name only (e.g. "access_as_user") — this is what Entra puts in `scp`. Do NOT paste the frontend\'s ENTRA_API_SCOPE App-ID-URI value (api://<client-id>/access_as_user); that never matches `scp`. Empty = not enforced (an ID token / no-scope token is accepted). Set once the frontend forwards a scoped access token.',
        format: String,
        default: '',
        env: 'ENTRA_REQUIRED_SCOPE'
      }
    }
  },
  journeyToken: {
    secret: {
      doc: 'Shared HMAC secret for verifying signed journey-tracking beacon tokens (EQ-472). Set via CDP Secrets — the SAME value as the frontend JOURNEY_TOKEN_SECRET, per tier; never committed. Empty = verification disabled (local/unconfigured tiers accept unsigned beacons).',
      format: String,
      default: '',
      env: 'JOURNEY_TOKEN_SECRET',
      sensitive: true
    }
  }
})

config.validate({ allowed: 'strict' })
