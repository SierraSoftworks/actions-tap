// See: https://eslint.org/docs/latest/use/configure/configuration-files

import js from '@eslint/js'
import prettier from 'eslint-config-prettier'

export default [
  { ignores: ['coverage', 'dist', 'node_modules'] },
  js.configs.recommended,
  prettier
]
