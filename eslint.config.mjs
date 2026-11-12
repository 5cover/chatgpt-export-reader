import { includeIgnoreFile } from '@eslint/compat'
import css from '@eslint/css'
import js from '@eslint/js'
import html from '@html-eslint/eslint-plugin'
import { defineConfig } from 'eslint/config'
import prettier from 'eslint-config-prettier/flat'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import hooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { fileURLToPath } from 'node:url'

export default defineConfig([
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))),
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    extends: [js.configs.recommended],
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Indexed tree/array algorithms retain explicit assertions after bounds checks.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // Empty strings intentionally select UI defaults and omit empty form values.
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: true,
          allowRegExp: false,
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}', 'packages/cli/src/**/*.ts', 'apps/dashboard/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/dashboard/src/**/*.{ts,tsx}'],
    ignores: ['apps/dashboard/src/stats-worker.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/dashboard/src/stats-worker.ts'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    extends: [jsxA11y.flatConfigs.strict],
    plugins: { 'react-hooks': hooks },
    rules: {
      // Preact shares the hook lifecycle, but does not use the React Compiler.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/*.css'],
    plugins: { css },
    language: 'css/css',
    extends: [css.configs.recommended],
    rules: {
      // Heatmap custom properties are supplied by Preact's inline styles.
      'css/no-invalid-properties': ['error', { allowUnknownVariables: true }],
      // These are progressive enhancements with existing font/selection fallbacks.
      'css/use-baseline': [
        'error',
        {
          allowProperties: ['user-select'],
          allowPropertyValues: { 'font-family': ['ui-sans-serif'] },
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    plugins: { html },
    language: 'html/html',
    extends: [html.configs.recommended],
    rules: {
      // html-eslint is not covered by eslint-config-prettier.
      'html/attrs-newline': 'off',
      'html/element-newline': 'off',
      'html/indent': 'off',
      'html/quotes': 'off',
      'html/no-extra-spacing-tags': 'off',
      'html/require-closing-tags': ['error', { selfClosing: 'always' }],
    },
  },
  // Formatting remains Prettier's responsibility.
  prettier,
])
