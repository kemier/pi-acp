import test from 'node:test'
import assert from 'node:assert/strict'
import { formatToolTitle } from '../../src/acp/tool-titles.js'
import { stripShellPrefix } from '../../src/acp/translate/bash.js'

test('formatToolTitle: read/write/edit include basename', () => {
  assert.equal(formatToolTitle('read', { path: '/tmp/foo/bar.ts' }), 'Read bar.ts')
  assert.equal(formatToolTitle('write', { path: '/tmp/foo/bar.ts' }), 'Write bar.ts')
  assert.equal(formatToolTitle('edit', { file_path: '/tmp/foo/bar.ts' }), 'Edit bar.ts')
})

test('formatToolTitle: bash uses command', () => {
  assert.equal(formatToolTitle('bash', { command: 'npm test' }), 'npm test')
})

test('formatToolTitle: bash strips cd prefix', () => {
  assert.equal(formatToolTitle('bash', { command: 'cd /workspace/git/ezennin/pi-acp && npm test' }), 'npm test')
  assert.equal(formatToolTitle('bash', { command: 'cd /workspace/git/ezennin/pi-acp\nnpm test' }), 'npm test')
  assert.equal(formatToolTitle('bash', { command: "bash -c 'cd /workspace && ls -la'" }), 'ls -la')
  assert.equal(formatToolTitle('bash', { command: 'cd /tmp' }), 'cd /tmp')
})

test('stripShellPrefix: keeps cd when it matches cwd', () => {
  assert.equal(
    stripShellPrefix('cd /workspace/git/ezennin/pi-acp && npm test', '/workspace/git/ezennin/pi-acp'),
    'cd /workspace/git/ezennin/pi-acp && npm test'
  )
  assert.equal(
    stripShellPrefix('cd /workspace/git/ezennin/pi-acp\nnpm test', '/workspace/git/ezennin/pi-acp/'),
    'cd /workspace/git/ezennin/pi-acp\nnpm test'
  )
  assert.equal(
    stripShellPrefix('cd /workspace/git/ezennin/pi-acp && npm test', '/tmp'),
    'npm test'
  )
  assert.equal(
    stripShellPrefix("bash -c 'cd /workspace && ls -la'", '/workspace'),
    'cd /workspace && ls -la'
  )
})
