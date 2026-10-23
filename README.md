# Pesticides OCR Register backend

- [Requirements](#requirements)
  - [Node.js](#nodejs)
- [Local development](#local-development)
  - [Setup](#setup)
  - [Development](#development)
  - [Testing](#testing)
  - [Production](#production)
  - [Npm scripts](#npm-scripts)
  - [Formatting](#formatting)
    - [Windows prettier issue](#windows-prettier-issue)
- [API endpoints](#api-endpoints)
- [Database seeding](#database-seeding)
- [Docker](#docker)
  - [Development image](#development-image)
  - [Production image](#production-image)
  - [Docker Compose](#docker-compose)
  - [Dependabot](#dependabot)
  - [SonarCloud](#sonarcloud)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Requirements

### Node.js

Please install [Node.js](http://nodejs.org/) `>= v24` and [npm](https://nodejs.org/) `>= v11`. You will find it
easier to use the Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd pesticides-ocr-backend
nvm use
```

## Local development

### Setup

Install application dependencies:

```bash
npm install
```

### Environment variables

Create your local `.env` file from the example before running the app:

```bash
cp .env.example .env
```

The file may be left empty, but it must exist: the development script runs
`node --watch --env-file-if-exists=.env`, and `--watch` fails to start with an
`ENOENT` error if the `.env` file is missing. `.env` is git-ignored, so any
values you add stay local.

### Git hooks

Install git hooks (optional)

```bash
npm run git:hooks
```

### Development

To run the application in `development` mode run:

```bash
npm run dev
```

### Testing

To test the application run:

```bash
npm run test
```

### Production

To mimic the application running in `production` mode locally run:

```bash
npm start
```

### Npm scripts

All available Npm scripts can be seen in [package.json](./package.json).
To view them in your command line run:

```bash
npm run
```

### Formatting

#### Windows prettier issue

If you are having issues with formatting of line breaks on Windows update your global git config by running:

```bash
git config --global core.autocrlf false
```

## API endpoints

| Endpoint                       | Method    | Description                                                                                                                             |
| :----------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `/health`                      | GET       | Health check                                                                                                                            |
| `/register`                    | POST      | Submit a pesticide registration application, once its contact email is verified (see [POST /register](#post-register))                  |
| `/search`                      | GET       | Partial-match search of the register, paginated                                                                                         |
| `/export`                      | GET       | A reference or free-text match, as a CSV download                                                                                       |
| `/whoami`                      | GET       | Authenticated caller's identity (case-officer scope)                                                                                    |
| `/metrics/*`                   | GET, POST | Journey metrics (see [Journey metrics](#journey-metrics))                                                                               |
| `/email-verifications`         | POST      | Email a magic link to confirm the applicant's address (see [POST /email-verifications](#post-email-verifications))                      |
| `/email-verifications/verify`  | POST      | Use up a magic link, confirming the address (see [POST /email-verifications/verify](#post-email-verificationsverify))                   |
| `/email-verifications/current` | GET       | The journey's latest link: none, pending, expired or verified (see [GET /email-verifications/current](#get-email-verificationscurrent)) |

### POST /register

Public, called by the frontend to submit an application. It needs the frontend's signed `x-journey-token` header, and the primary contact's email address must have been verified by magic link for that journey (see [POST /email-verifications](#post-email-verifications)) within `EMAIL_VERIFICATION_VERIFIED_TTL_SECONDS` (default 4 hours). The address is compared trimmed and lower-cased, as it was stored when the link was requested. The body is the registration itself:

**Request body:**

```json
{
  "businessActivities": ["manufacture", "market"],
  "mainCustomer": "professional",
  "businessName": "Company Name",
  "address": {
    "addressLine1": "1 Example Street",
    "addressLine2": "Village",
    "addressTown": "Town",
    "addressCounty": "County",
    "addressPostcode": "AB12 3CD"
  },
  "primaryContact": {
    "contactName": "Full Name",
    "contactTelephone": "01234567890",
    "contactEmail": "contact@example.com"
  },
  "addressActivities": ["use", "store"],
  "quantity": {
    "quantityType": "area",
    "quantity": "50"
  },
  "professionalSectors": ["agriculture-horticulture"],
  "memberSchemes": ["BASIS"],
  "additionalAddresses": []
}
```

**Response (201):**

```json
{ "reference": "PPP-ABC-123" }
```

Reference numbers use the format `{PREFIX}-XXX-XXX` (uppercase alphanumeric). The prefix defaults to `PPP` and is configurable via the `REFERENCE_PREFIX` environment variable, which must itself be upper-case letters or digits (the app refuses to start otherwise).

The payload is validated first, so an invalid one is a `400` whatever the header. Then:

| Status | `code`                   | When                                                                                                                                                                     |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 401    | `JOURNEY_TOKEN_INVALID`  | `x-journey-token` is missing or not validly signed                                                                                                                       |
| 403    | `EMAIL_NOT_VERIFIED`     | The contact email has no verification for this journey: it was never verified, was verified on another journey, changed after verification, or was verified too long ago |
| 503    | `SERVICE_NOT_CONFIGURED` | `JOURNEY_TOKEN_SECRET` or any other email verification setting (hash secret, link base URL, Notify key or template ID) isn't set on this tier                            |

On a `403` the frontend sends the applicant back to verify the address. Nothing is saved on any of these.

`EMAIL_VERIFICATION_REQUIRED_FOR_REGISTRATION` (default `false`) turns the header and verification check on, once a tier's frontend sends the journey token to `/register`. Deployed tiers log a warning at every boot while it's `false`.

### GET /search

Case-officer bearer auth required (see [API authorisation](#api-authorisation-eq-413)): no token is a `401`, a token without the case-officer role a `403`. Searches the register on one or more partial criteria, a page at a time. Deleted registrations are never returned.

| Query              | Searches                      |
| ------------------ | ----------------------------- |
| `q`                | any of the fields below       |
| `reference`        | registration reference        |
| `organisationName` | business name                 |
| `applicantName`    | primary contact's name        |
| `email`            | primary contact's email       |
| `town`             | address town                  |
| `postcode`         | address postcode              |
| `page`             | page number (default 1)       |
| `pageSize`         | results per page (default 10) |

At least one criterion is required, blank ones are ignored, and every one supplied must match. Matching is case-insensitive and partial (`reference=ABC` finds `PPP-ABC-123`, and a full reference finds just that registration); `*` stands for any run of characters (`reference=PPP-*-123`), up to 5 per term, and a run of `*` counts as one. Results are newest `submittedAt` first, ties broken by reference, so pages are stable.

`pageSize` is capped by `SEARCH_MAX_PAGE_SIZE` (default 100, at least 1) and `page` at 10000. A missing criterion, an invalid or out-of-range `page` or `pageSize`, a wildcard-only term, or an unknown parameter is a `400` whose message lists every problem. A page past the last is an empty `data` list with the same totals.

```json
{
  "data": [
    {
      "reference": "PPP-ABC-123",
      "submittedAt": "2026-08-11T09:30:00.000Z",
      "businessName": "Example Organisation",
      "primaryContact": {
        "contactName": "Jane Doe",
        "contactEmail": "jane.doe@example.com"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "totalRecords": 142,
    "totalPages": 15
  }
}
```

Rows are registrations as stored, limited to the fields the register shows (reference, submittedAt, status, business name, activities, main customer, address, primary contact, address activities, quantity); display mapping is the caller's concern.

### GET /export

Same auth as `/search`, returned as a CSV download (`ocr-registrations.csv`). Takes exactly one of `?reference=` (one exact reference, using the configured `REFERENCE_PREFIX`) or `?q=` (a literal free-text match on the same fields as `/search`; blank exports the whole register). A reference exports one record, or just the header row if it doesn't exist. A term exports every match, up to `EXPORT_MAX_ROWS` (default 10000, at least 1); a larger match is a `400` asking for a narrower search, rather than a truncated file. Deleted registrations are never exported.

### POST /email-verifications

Public, called by the frontend to send (or resend) a magic link that confirms the applicant owns their email address. It needs the frontend's signed `x-journey-token` header, which binds the link to the journey. A new link supersedes the journey's earlier ones, so only the latest works. The body is at most 1 KB:

```json
{ "email": "jane.smith@example.com" }
```

**Response (202):** when the link stops working, and the earliest time the journey can ask for another. The response never includes the email address, token or any ID.

```json
{
  "expiresAt": "2026-10-15T10:15:00.000Z",
  "resendAvailableAt": "2026-10-15T10:01:00.000Z"
}
```

Errors carry a stable `code` for the frontend to branch on:

| Status | `code`                   | When                                                                                     |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`       | The email is missing, invalid or over 254 characters, or the body has other fields       |
| 401    | `JOURNEY_TOKEN_INVALID`  | `x-journey-token` is missing or not validly signed                                       |
| 429    | `RESEND_COOLDOWN`        | Within the cooldown since the journey's last email. `Retry-After` gives the seconds left |
| 429    | `RATE_LIMITED`           | A cap on emails per address, per journey or overall was reached. `Retry-After` is set    |
| 502    | `EMAIL_SEND_FAILED`      | Notify refused the email or couldn't be reached. Nothing is stored and no quota is used  |
| 503    | `SERVICE_NOT_CONFIGURED` | A secret, the link base URL, the Notify key or the template ID isn't set on this tier    |

The limits (`EMAIL_VERIFICATION_*` in [.env.example](.env.example)) are counted in Mongo, so they hold across instances. There's no per-IP limit, because CDP doesn't pass the client IP on.

### POST /email-verifications/verify

Public, called when the applicant presses Confirm on the page the magic link opens (never when the page loads, as email scanners open links too). The body is at most 1 KB:

```json
{ "token": "<the 43-character token from the link>" }
```

`x-journey-token` is optional here. It only decides `sameJourney`: without it, or from another browser, the link still verifies, against the journey that asked for it.

**Response (200):**

```json
{ "outcome": "VERIFIED", "sameJourney": true }
```

A link verifies once: of any number of concurrent attempts, exactly one succeeds.

| Status | `code`                | When                                                                                      |
| ------ | --------------------- | ----------------------------------------------------------------------------------------- |
| 400    | `TOKEN_INVALID`       | The token isn't 43 characters of base64url, or the body has other fields. Nothing is read |
| 404    | `TOKEN_INVALID`       | No link has this token, or its record has been purged                                     |
| 410    | `TOKEN_EXPIRED`       | The link wasn't used within `EMAIL_VERIFICATION_LINK_TTL_SECONDS`                         |
| 410    | `TOKEN_SUPERSEDED`    | A newer link was sent for the journey                                                     |
| 409    | `TOKEN_ALREADY_USED`  | The link has been used. The body also has `sameJourney`, as for a 200                     |
| 500    | `VERIFICATION_FAILED` | Unexpected error                                                                          |

### GET /email-verifications/current

Public, needs `x-journey-token`. The state of the journey's latest link, so the browser that asked for it can carry on after the link is used on another device. Nothing about the address goes in the URL or the response; the frontend checks it still holds the address it asked about.

**Response (200):**

```json
{
  "status": "verified",
  "expiresAt": "2026-10-15T10:15:00.000Z",
  "verifiedAt": "2026-10-15T10:03:12.000Z",
  "resendAvailableAt": "2026-10-15T10:01:00.000Z"
}
```

| `status`   | Meaning                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `none`     | No link has been sent for the journey. The dates are `null`                                                                  |
| `pending`  | The latest link is live                                                                                                      |
| `expired`  | The latest link can't be used any more, and its address isn't verified                                                       |
| `verified` | The latest link's address was verified for the journey within `EMAIL_VERIFICATION_VERIFIED_TTL_SECONDS`. `verifiedAt` is set |

Errors: `401 JOURNEY_TOKEN_INVALID`, or `503 SERVICE_NOT_CONFIGURED` without `JOURNEY_TOKEN_SECRET`.

### Email verification audit and monitoring

Each step is written to the CDP audit stream through `@defra/cdp-auditing`. Every event has `event`, the `journeyId` when there is one, and `emailHash` (an HMAC of the address under `EMAIL_VERIFICATION_HASH_SECRET`) when an address is involved. No event, metric or log line holds a token, token hash, link or address. In production the `x-journey-token` header is removed from request logs. Request bodies aren't logged, and no endpoint takes the token or address in its URL.

| Event                                 | Extra fields                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `EMAIL_VERIFICATION_LINK_REQUESTED`   |                                                                                      |
| `EMAIL_VERIFICATION_LINK_SENT`        | `expiresAt`                                                                          |
| `EMAIL_VERIFICATION_LINK_SEND_FAILED` | `reason`: Notify's error type (`BadRequestError`, …) or the network error code       |
| `EMAIL_VERIFICATION_RATE_LIMITED`     | `limit`: `cooldown`, `email`, `journey` or `global`. Never returned to the caller    |
| `EMAIL_VERIFICATION_VERIFIED`         | `sameJourney`                                                                        |
| `EMAIL_VERIFICATION_REJECTED`         | `code`: `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_SUPERSEDED` or `TOKEN_ALREADY_USED` |
| `REGISTRATION_EMAIL_NOT_VERIFIED`     | A `POST /register` refused with `EMAIL_NOT_VERIFIED`                                 |

Counters, through `@defra/cdp-metrics`:

| Metric                         | Dimensions                  |
| ------------------------------ | --------------------------- |
| `emailVerificationLinkSent`    |                             |
| `emailVerificationSendFailed`  |                             |
| `emailVerificationRateLimited` | `limit`, as for the event   |
| `emailVerificationVerified`    |                             |
| `emailVerificationRejected`    | `outcome`: the `code` above |
| `registrationEmailNotVerified` |                             |

A failed audit write or metric is logged and never changes the response.

Proposed alerts:

- Notify failures above 5% of sends over 15 minutes: `emailVerificationSendFailed` / (`emailVerificationLinkSent` + `emailVerificationSendFailed`).
- The global cap is reached: any `emailVerificationRateLimited` with `limit` = `global`.

The dashboards and alerts are set up in CDP and Grafana, not in this repository.

### Journey metrics

The digital completion metric, counted from the database for every applicant whether or not they accepted analytics cookies. Google Analytics only sees applicants who accept, so these are the totals to report; GA shows how consenting applicants move through the journey.

The frontend records two journey events, each at most once per session:

| Endpoint                             | Records                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| `POST /metrics/journey-starts`       | a journey start (the first question after the start page)  |
| `POST /metrics/journey-not-eligible` | an exit via the "You do not need to use this service" page |

These are public, as applicants aren't signed in. When `JOURNEY_TOKEN_SECRET` is set (the same value on the frontend), each must carry the frontend's signed per-session token in an `x-journey-token` header: a missing or forged token is a `401`, and a repeated one is stored once. Only a timestamp is stored, plus the token's session nonce when the token is required. Both return `204`.

The read endpoints need case-officer bearer auth and accept optional inclusive `?from=` and `?to=` ISO dates:

| Endpoint                            | Returns                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `GET /metrics/journeys`             | the completion metric: starts, finishes, drop-outs and rates, by year and month |
| `GET /metrics/journey-starts`       | `{ total, byMonth }` of journey starts                                          |
| `GET /metrics/registrations`        | `{ total, byMonth }` of completed registrations, including any deleted since    |
| `GET /metrics/journey-not-eligible` | `{ total, byMonth }` of not-eligible exits                                      |

`GET /metrics/journeys` returns the overall figures (the life of the service, or the `from`/`to` period), plus the same per year and per month:

```json
{
  "starts": 6,
  "registrations": 3,
  "notEligible": 1,
  "finished": 4,
  "dropOuts": 2,
  "completionRate": 0.6667,
  "registrationRate": 0.5,
  "byYear": [
    {
      "year": "2026",
      "starts": 6,
      "registrations": 3,
      "notEligible": 1,
      "finished": 4,
      "dropOuts": 2,
      "completionRate": 0.6667,
      "registrationRate": 0.5
    }
  ],
  "byMonth": [
    {
      "month": "2026-03",
      "starts": 4,
      "registrations": 2,
      "notEligible": 1,
      "finished": 3,
      "dropOuts": 1,
      "completionRate": 0.75,
      "registrationRate": 0.5
    },
    {
      "month": "2026-04",
      "starts": 2,
      "registrations": 1,
      "notEligible": 0,
      "finished": 1,
      "dropOuts": 1,
      "completionRate": 0.5,
      "registrationRate": 0.5
    }
  ]
}
```

A journey is finished when it reaches either end point: a saved registration (`registrations`) or the "You do not need to use this service" page (`notEligible`). Drop-outs are starts minus finished, floored at zero. The completion rate is finished ÷ starts, the GDS completion rate; the registration rate is registrations ÷ starts. Rates are capped at 1, and are `null` with no starts. A journey can start in one month and finish in the next, and start events are best-effort, so monthly figures are approximate; periods before start tracking began have no starts to compare against.

## API authorisation (EQ-413)

Protected routes require an `Authorization: Bearer <jwt>` header carrying a Microsoft Entra token. The reusable pieces live in [`src/auth/`](./src/auth):

- an `entra-bearer` Hapi auth **strategy** — in `live` mode it verifies the JWT signature against the Entra tenant JWKS and checks issuer, audience and expiry; in `mock` mode it decodes the token without verification (local/CI only, refused in production);
- a `requireRole(...roles)` helper returning the route `auth` options that authorise the caller by Entra app-role (via Hapi scope).

Protect a route by opting in:

```js
import { requireRole } from '#/auth/require-role.js'

export const example = {
  method: 'GET',
  path: '/example',
  options: { auth: requireRole('case_officer') },
  handler: (request, h) => h.response(request.auth.credentials)
}
```

The role value(s) are configurable — `GET /whoami` reads `auth.entra.roleValues` (comma-separated) rather than hard-coding the string.

Routes without `options.auth` (e.g. `/health`) stay open. A request with no/invalid token gets `401`; a valid token lacking the required role gets `403`. Configure live mode via `AUTH_MODE=live` + the `ENTRA_*` variables (see `.env.example`). `GET /whoami` is a worked example.

> The exact token contract (whether the frontend forwards the Entra access token or ID token, i.e. the expected `audience`/`issuer`) is confirmed at Entra onboarding and is fully config-driven — no code change needed.

## Registration history

Submission, search, export and the registrations metric all read and write registrations through the audited repository (`src/repositories/audited-repository.js`), which every request has as `request.registrations`. The `ocr-registration_history` collection keeps one entry per version of a registration, through `src/repositories/registration-history.js`. Entries can be added and read but never changed or removed. The audited repository's `create`, `update` and `softDelete` each add an entry, in the same transaction as the registration change, so neither is saved without the other. Each takes `by` (who made the change: `{ type: 'applicant' }`, or `{ type: 'case_officer', id }` with the Entra subject ID), and optionally `reason` and `requestId`. These are checked before anything is written, and `by.id` is never an email address. To group several changes, pass them the session from the repository's `withTransaction` (no other session is accepted): if any of them fails, including its input checks, the whole transaction rolls back and `withTransaction` rejects with that error, even if your code caught it. Don't call `withTransaction` inside another one; pass the session down instead, as a nested call starts a separate transaction.

| Field       | Required | Contents                                                                                         |
| ----------- | -------- | ------------------------------------------------------------------------------------------------ |
| `reference` | yes      | the registration's reference                                                                     |
| `version`   | yes      | the version this entry records                                                                   |
| `operation` | yes      | `create`, `update` or `delete`                                                                   |
| `at`        | yes      | when the change was made                                                                         |
| `by`        | yes      | who made it: `{ type, id }`, where `type` is `applicant` or `case_officer`, and `id` is optional |
| `reason`    | no       | why, where the operation needs one                                                               |
| `requestId` | no       | the request that made the change                                                                 |
| `snapshot`  | yes      | the complete registration as it was at this version                                              |

Versions start at 1 when a registration is created, and each successful change adds the next one, kept in the registration's `version` field, for example: 1 created, 2 updated, 3 deleted. A registration stored before versions were added gets version 1 on its first change, so its history has no `create` entry. A unique index on `reference` + `version` rejects a second entry for the same version. The snapshot must be of the same registration as the entry.

## Database seeding

Seed scripts are available for local development and testing.

### Seed records

Insert sample registration records (uses `SED-XXX-XXX` references to distinguish from real data):

```bash
npm run db:seed                 # insert 10 records (default)
npm run db:seed -- --count=50   # insert 50 records
```

### Delete seeded records

Remove all seeded records (those with a `SED-` reference prefix):

```bash
npm run db:seed:delete
```

Both scripts read `MONGO_URI` and `MONGO_DATABASE` from your `.env` file (or environment).

## Docker

Build:

```bash
docker build --no-cache --tag pesticides-ocr-backend .
```

Run:

```bash
docker run -e PORT=3001 -p 3001:3001 pesticides-ocr-backend
```

### Docker Compose

A local environment with:

- Floci for AWS services (S3, SQS, SNS etc)
- Redis
- MongoDB
- This service.
- A commented out frontend example.

```bash
docker compose up --build -d
```

Mock AWS resources can be created when Floci starts up by editing the scripts in `./compose/floci/start.d/`.
MongoDB records can also be created by editing the scripts in `./compose/mongo/`. They run only when the `mongodb-data` volume is first created, so run `docker compose down -v` to reset the data and run them again. The data is otherwise kept across `docker compose down`.

MongoDB runs as a single-member replica set (`rs0`), because multi-document transactions need a replica set, as on CDP. Connect with `directConnection=true` (the default `MONGO_URI`), so the same database works from inside Compose and from `npm run dev`. If your `.env` sets `MONGO_URI` without `directConnection=true`, add it, or the app and the seed scripts can't reach the Compose database. A standalone `mongod` still works for everything except transactions. The tests use an in-memory replica set, so they need no setup.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
