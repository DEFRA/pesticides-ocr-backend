import neostandard from 'neostandard'

// Data-access boundary: Routes > Services > Repositories > MongoDB.
// Registration data (registrations, their history, access grants and the audit
// history) is reached only through src/repositories, so audit history,
// soft-delete, transactions and versioning cannot be bypassed.
const REPOSITORY_OWNED_COLLECTIONS = [
  'OCR_REGISTRATION_COLLECTION',
  'OCR_REGISTRATION_HISTORY_COLLECTION',
  'REGISTRATION_ACCESS_COLLECTION',
  'AUDIT_HISTORY_COLLECTION'
]

// Matches the collection names behind those constants, for .collection('…')
const REPOSITORY_OWNED_NAMES = '/^(ocr-registration|audit_history)/'

// The only places allowed to touch the driver or those collections directly:
// - src/repositories: the persistence layer
// - src/plugins/mongodb.js: opens the connection and builds the repositories
// - tests and their fixture: seed, assert on and clean up data
// - the seed scripts: development-only data, never run by the service
const REPOSITORY_BOUNDARY_EXCEPTIONS = [
  'src/repositories/**',
  'src/plugins/mongodb.js',
  'src/**/*.test.js',
  'src/routes/registration/registration.fixtures.js',
  'scripts/delete-seed.test.js',
  'scripts/seed.js',
  'scripts/delete-seed.js'
]

export const repositoryBoundary = {
  files: ['src/**/*.js', 'scripts/**/*.js'],
  ignores: REPOSITORY_BOUNDARY_EXCEPTIONS,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: ['mongodb', 'mongo-locks'].map((name) => ({
          name,
          message:
            'Access MongoDB through src/repositories (or src/plugins/mongodb.js), not directly.'
        })),
        patterns: [
          {
            group: ['**/constants/collections.js'],
            importNames: REPOSITORY_OWNED_COLLECTIONS,
            message:
              'Registration collections are owned by src/repositories; use request.registrations instead.'
          }
        ]
      }
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: `CallExpression:matches([callee.property.name='collection'], [callee.property.value='collection']):matches([arguments.0.value=${REPOSITORY_OWNED_NAMES}], [arguments.0.quasis.0.value.cooked=${REPOSITORY_OWNED_NAMES}])`,
        message:
          'Registration collections are owned by src/repositories; use request.registrations instead.'
      },
      {
        selector: `ImportExpression[source.value=/^(mongodb|mongo-locks)$|collections\\.js$/]`,
        message:
          'Import the MongoDB driver and collection names statically, so the boundary rules can check them.'
      }
    ]
  }
}

export default [
  ...neostandard({
    env: ['node', 'vitest'],
    ignores: [...neostandard.resolveIgnoresFromGitignore()],
    noJsx: true,
    noStyle: true
  }),
  repositoryBoundary,
  {
    files: [
      'src/services/metrics/helpers/record-event.js',
      'src/services/registration/registration.js'
    ],
    rules: {
      'no-void': ['error', { allowAsStatement: true }]
    }
  }
]
