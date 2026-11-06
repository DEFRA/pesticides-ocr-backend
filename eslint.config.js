import neostandard from 'neostandard'

export default [
  ...neostandard({
    env: ['node', 'vitest'],
    ignores: [...neostandard.resolveIgnoresFromGitignore()],
    noJsx: true,
    noStyle: true
  }),
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
