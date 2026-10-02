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

| Endpoint     | Method    | Description                                               |
| :----------- | :-------- | :-------------------------------------------------------- |
| `/health`    | GET       | Health check                                              |
| `/register`  | POST      | Submit a pesticide registration application               |
| `/search`    | GET       | Find registrations by reference or free text              |
| `/export`    | GET       | The same search, as a CSV download                        |
| `/whoami`    | GET       | Authenticated caller's identity (case-officer scope)      |
| `/metrics/*` | GET, POST | Journey metrics (see [Journey metrics](#journey-metrics)) |

### POST /register

Accepts a JSON body with a `formSession` object containing the registration form data.

**Request body:**

```json
{
  "formSession": {
    "businessActivities": ["manufacture", "market"],
    "businessName": "Company Name",
    "address": {
      "line1": "1 Example Street",
      "line2": "Village",
      "town": "Town",
      "county": "County",
      "postcode": "AB12 3CD"
    },
    "primaryContact": {
      "name": "Full Name",
      "telephone": "01234567890",
      "email": "contact@example.com"
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
}
```

**Response (201):**

```json
{ "reference": "PPP-ABC-123" }
```

Reference numbers use the format `{PREFIX}-XXX-XXX` (uppercase alphanumeric). The prefix defaults to `PPP` and is configurable via the `REFERENCE_PREFIX` environment variable, which must itself be upper-case letters or digits (the app refuses to start otherwise).

### GET /search

Case-officer bearer auth required (see [API authorisation](#api-authorisation-eq-413)). Takes exactly one of:

| Query                    | Returns                                         |
| ------------------------ | ----------------------------------------------- |
| `?reference=PPP-ABC-123` | the stored registration, or `404`               |
| `?q=Norfolk`             | matching registrations, newest first, up to 500 |
| `?q=`                    | every registration, newest first, up to 500     |

Neither, both, a malformed reference or an unknown parameter is a `400`. Registrations are returned as stored; display mapping is the caller's concern. A reference must use the configured `REFERENCE_PREFIX`, so seeded `SED-` records aren't found by reference.

### GET /export

Same auth and query contract as `/search`, returned as a CSV download (`ocr-registrations.csv`). A reference exports one record, or just the header row if it doesn't exist. A term exports every match, up to `EXPORT_MAX_ROWS` (default 10000, at least 1); a larger match is a `400` asking for a narrower search, rather than a truncated file.

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
| `GET /metrics/registrations`        | `{ total, byMonth }` of completed registrations                                 |
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

A journey is finished when it reaches either end point: a saved registration (`registrations`) or the "You do not need to use this service" page (`notEligible`). Drop-outs are starts minus finished, floored at zero. The completion rate is finished ÷ starts, the GDS completion rate; the registration rate is registrations ÷ starts. Rates are `null` with no starts. A journey can start in one month and finish in the next, so monthly drop-outs are approximate, and periods before start tracking began have no starts to compare against.

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
MongoDB records can also be created when Mongo starts by editing the scripts in `./compose/mongo/`.

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
