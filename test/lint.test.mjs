import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

const eslint = new ESLint({
  cwd: fileURLToPath(new URL('..', import.meta.url)),
})

async function expectRule(filePath, code, ruleId) {
  const results = await eslint.lintText(code, { filePath })
  const messages = results.flatMap(result => result.messages)
  assert.ok(!messages.some(message => message.fatal), JSON.stringify(messages))
  assert.ok(
    messages.some(message => message.ruleId === ruleId),
    JSON.stringify(messages)
  )
}

test('type-aware rules cover every TypeScript project, including Vite configuration', async () => {
  for (const filePath of [
    'packages/core/src/index.ts',
    'packages/cli/src/cli.ts',
    'apps/dashboard/src/main.tsx',
    'apps/dashboard/src/stats-worker.ts',
    'apps/dashboard/vite.config.ts',
  ]) {
    await expectRule(filePath, 'Promise.resolve(1);', '@typescript-eslint/no-floating-promises')
  }
})

test('JavaScript tests and the root configuration are linted', async () => {
  for (const filePath of [
    'packages/core/test/analytics.test.mjs',
    'packages/cli/test/recap.test.mjs',
    'eslint.config.mjs',
  ]) {
    await expectRule(filePath, 'missingGlobal();', 'no-undef')
  }
})

test('Preact hooks and JSX accessibility violations fail lint', async () => {
  await expectRule(
    'apps/dashboard/src/app.tsx',
    `
        import { useEffect } from 'preact/hooks';
        export function App({ enabled }: { enabled: boolean }) {
            if (enabled) useEffect(() => {}, []);
            return <div />;
        }
    `,
    'react-hooks/rules-of-hooks'
  )
  await expectRule(
    'apps/dashboard/src/app.tsx',
    `
        import { useEffect } from 'preact/hooks';
        export function App({ value }: { value: string }) {
            useEffect(() => { console.log(value); }, []);
            return <div />;
        }
    `,
    'react-hooks/exhaustive-deps'
  )
  await expectRule(
    'apps/dashboard/src/app.tsx',
    "export const App = () => <img src='/image.png' />;",
    'jsx-a11y/alt-text'
  )
})

test('CSS and HTML are checked by their language plugins', async () => {
  await expectRule('apps/dashboard/src/style.css', 'body { colr: red; }', 'css/no-invalid-properties')
  await expectRule(
    'apps/dashboard/index.html',
    '<!doctype html><html><head><title>Test</title></head><body></body></html>',
    'html/require-lang'
  )
})

test('generated code, dependencies, and personal exports stay ignored', async () => {
  for (const filePath of [
    'dist/cli.js',
    'packages/core/dist/index.js',
    'apps/dashboard/dist/assets/index.js',
    'node_modules/example/index.js',
    'exports/private.js',
    'out/generated.js',
  ]) {
    assert.equal(await eslint.isPathIgnored(filePath), true, filePath)
  }
})
