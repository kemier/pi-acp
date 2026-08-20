import test from 'node:test'
import assert from 'node:assert/strict'
import { formatToolTitle } from '../../src/acp/tool-titles.js'

test('formatToolTitle: read/write/edit include basename', () => {
  assert.equal(formatToolTitle('read', { path: '/tmp/foo/bar.ts' }), 'Read bar.ts')
  assert.equal(formatToolTitle('write', { path: '/tmp/foo/bar.ts' }), 'Write bar.ts')
  assert.equal(formatToolTitle('edit', { file_path: '/tmp/foo/bar.ts' }), 'Edit bar.ts')
})

test('formatToolTitle: bash uses command', () => {
  assert.equal(formatToolTitle('bash', { command: 'npm test' }), 'npm test')
})
