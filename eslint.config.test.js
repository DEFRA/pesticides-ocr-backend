import { ESLint } from 'eslint'

// Guards the repository data-access boundary configured in eslint.config.js.
describe('repository data-access boundary', () => {
  const eslint = new ESLint()

  const lint = async (filePath, code) => {
    const [result] = await eslint.lintText(code, { filePath })
    return result.messages.map(({ ruleId }) => ruleId)
  }

  const importRegistrationCollection =
    "import { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'\nexport const name = OCR_REGISTRATION_COLLECTION\n"

  test.each([
    'src/routes/search/search.js',
    'src/services/search/search.js',
    'src/services/export/index.js',
    'src/services/metrics/registrations/registrations.js'
  ])('%s cannot import a registration collection', async (filePath) => {
    expect(await lint(filePath, importRegistrationCollection)).toContain(
      'no-restricted-imports'
    )
  })

  test.each([
    'OCR_REGISTRATION_HISTORY_COLLECTION',
    'REGISTRATION_ACCESS_COLLECTION',
    'AUDIT_HISTORY_COLLECTION'
  ])('the %s collection is repository-owned too', async (name) => {
    const code = `import { ${name} } from '#/common/constants/collections.js'\nexport const n = ${name}\n`

    expect(await lint('src/services/export/index.js', code)).toContain(
      'no-restricted-imports'
    )
  })

  test('application code cannot import the MongoDB driver', async () => {
    const code =
      "import { MongoClient } from 'mongodb'\nexport { MongoClient }\n"

    expect(await lint('src/services/search/search.js', code)).toContain(
      'no-restricted-imports'
    )
  })

  test.each([
    [
      'aliased import',
      "import { OCR_REGISTRATION_COLLECTION as c } from '#/common/constants/collections.js'\nexport { c }\n"
    ],
    [
      'namespace import',
      "import * as c from '#/common/constants/collections.js'\nexport { c }\n"
    ],
    [
      'relative import',
      "import { OCR_REGISTRATION_COLLECTION as c } from '../../common/constants/collections.js'\nexport { c }\n"
    ],
    [
      're-export',
      "export { OCR_REGISTRATION_COLLECTION } from '#/common/constants/collections.js'\n"
    ],
    [
      'mongo-locks import',
      "import { LockManager } from 'mongo-locks'\nexport { LockManager }\n"
    ]
  ])('a %s is rejected', async (_, code) => {
    expect(await lint('src/services/search/search.js', code)).toContain(
      'no-restricted-imports'
    )
  })

  test.each([
    "db.collection('ocr-registration')",
    "db.collection('ocr-registration_history')",
    "db.collection('ocr-registration-access')",
    "db.collection('audit_history')",
    'db.collection(`ocr-registration`)',
    "db['collection']('ocr-registration')"
  ])(
    'application code cannot open a registration collection: %s',
    async (call) => {
      const code = `export const find = (db) => ${call}.find()\n`

      expect(await lint('src/routes/search/search.js', code)).toContain(
        'no-restricted-syntax'
      )
    }
  )

  test.each([
    "import('mongodb')",
    "import('mongo-locks')",
    "import('../../common/constants/collections.js')"
  ])('a dynamic %s is rejected', async (call) => {
    const code = `export const load = () => ${call}\n`

    expect(await lint('src/services/search/search.js', code)).toContain(
      'no-restricted-syntax'
    )
  })

  test('metrics collections stay available to application code', async () => {
    const code =
      "import { JOURNEY_STARTS_COLLECTION } from '#/common/constants/collections.js'\nexport const name = JOURNEY_STARTS_COLLECTION\n"

    expect(await lint('src/services/metrics/helpers/x.js', code)).toEqual([])
  })

  test.each([
    'src/repositories/audited-repository.js',
    'src/plugins/mongodb.js',
    'src/routes/registration/registration.fixtures.js',
    'src/routes/search/search.test.js',
    'scripts/delete-seed.test.js',
    'scripts/seed.js',
    'scripts/delete-seed.js'
  ])('%s is an approved exception', async (filePath) => {
    expect(await lint(filePath, importRegistrationCollection)).toEqual([])
  })

  test('other fixtures are not exempt', async () => {
    expect(
      await lint(
        'src/services/notify/notify.fixtures.js',
        importRegistrationCollection
      )
    ).toContain('no-restricted-imports')
  })

  test('a new script is not exempt', async () => {
    expect(
      await lint('scripts/cleanup.js', importRegistrationCollection)
    ).toContain('no-restricted-imports')
  })
}, 60000)
