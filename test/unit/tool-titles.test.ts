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

const CWD = '/workspace/git/ezennin/pi-acp'

test('stripShellPrefix: strips the cd when it targets the session cwd', () => {
  // The session already runs there — the title should show the work instead.
  assert.equal(stripShellPrefix(`cd ${CWD} && npm test`, CWD), 'npm test')
  assert.equal(stripShellPrefix(`cd ${CWD}\nnpm test`, `${CWD}/`), 'npm test')
  assert.equal(stripShellPrefix(`cd ${CWD}; npm test`, CWD), 'npm test')
  assert.equal(stripShellPrefix("bash -c 'cd /workspace && ls -la'", '/workspace'), 'ls -la')
})

test('stripShellPrefix: keeps a cd into a subdirectory, rewritten relative', () => {
  assert.equal(stripShellPrefix(`cd ${CWD}/src && npm test`, CWD), 'cd src && npm test')
  assert.equal(stripShellPrefix(`cd ${CWD}/src/acp; ls`, CWD), 'cd src/acp; ls')
  // Newline form: stripped even for a subdirectory (clients render line 1 only).
  assert.equal(stripShellPrefix(`cd ${CWD}/src\nnpm test`, CWD), 'npm test')
})

test('stripShellPrefix: strips a cd outside the cwd and stays idempotent', () => {
  assert.equal(stripShellPrefix(`cd ${CWD} && npm test`, '/tmp'), 'npm test')
  assert.equal(stripShellPrefix('cd /workspace/git/ezennin/codex-acp && ls', CWD), 'ls')
  assert.equal(stripShellPrefix('cd ../codex-acp && ls', CWD), 'ls')
  // Re-applying to an already-normalized title must keep the subdirectory.
  assert.equal(stripShellPrefix('cd src && npm test', CWD), 'cd src && npm test')
})
