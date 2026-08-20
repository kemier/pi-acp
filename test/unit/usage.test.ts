import test from 'node:test'
import assert from 'node:assert/strict'
import { buildUsageUpdateFromStats, buildUsageUpdateFromTurnUsage, tokensFromUsage } from '../../src/acp/usage.js'

test('tokensFromUsage: prefers totalTokens', () => {
  assert.equal(tokensFromUsage({ totalTokens: 1234, input: 1, output: 2 }), 1234)
})

test('tokensFromUsage: sums components when totalTokens missing', () => {
  assert.equal(tokensFromUsage({ input: 100, output: 50, cacheRead: 10, cacheWrite: 5 }), 165)
})

test('buildUsageUpdateFromStats: maps contextUsage to used/size', () => {
  assert.deepEqual(
    buildUsageUpdateFromStats({
      contextUsage: { tokens: 12000, contextWindow: 245760, percent: 4.88 },
      cost: 0.0123
    }),
    {
      used: 12000,
      size: 245760,
      cost: { amount: 0.0123, currency: 'USD' }
    }
  )
})

test('buildUsageUpdateFromStats: caps used at size', () => {
  const update = buildUsageUpdateFromStats({
    contextUsage: { tokens: 300000, contextWindow: 245760, percent: 122 }
  })
  assert.equal(update?.used, 245760)
  assert.equal(update?.size, 245760)
})

test('buildUsageUpdateFromTurnUsage: uses turn usage with context window', () => {
  assert.deepEqual(
    buildUsageUpdateFromTurnUsage({ totalTokens: 5000 }, 245760, {
      contextUsage: { tokens: 5000, contextWindow: 245760, percent: 2 },
      cost: 0.01
    }),
    {
      used: 5000,
      size: 245760,
      cost: { amount: 0.01, currency: 'USD' }
    }
  )
})
