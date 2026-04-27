import { includeIgnoreFile } from '@eslint/compat'
import eslintjs from '@eslint/js'
import prettier from 'eslint-config-prettier'
import * as path from 'path'
import typescriptEslint from 'typescript-eslint'

export default [
    includeIgnoreFile(path.resolve(import.meta.dirname, '.gitignore')),
    eslintjs.configs.recommended,
    ...typescriptEslint.configs.strictTypeChecked,
    ...typescriptEslint.configs.stylisticTypeChecked,
    prettier,
    { ignores: [path.basename(import.meta.filename)] },
    {
        languageOptions: {
            parserOptions: {
                sourceType: 'module',
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
            '@typescript-eslint/no-redundant-type-constituents': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/restrict-template-expressions': [
                'error',
                {
                    allowNumber: true,
                    allowNullish: true,
                },
            ],
            '@typescript-eslint/no-confusing-void-expression': 'off',
        },
    },
]
