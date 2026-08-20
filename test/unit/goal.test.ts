import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GOAL_CONTROL_METHOD,
  applyGoalCommand,
  applyGoalControl,
  createGoalSnapshot,
  goalKickoffPrompt,
  goalPromptPrefix,
  parseGoalCommand,
  parseGoalControlParams,
  parseGoalStatusTrailer,
  type GoalSnapshot
} from '../../src/acp/goal.js'
import { PiAcpAgent } from '../../src/acp/agent.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

class FakeSessions {
  constructor(private readonly session: any) {}
  maybeGet(_id: string) {
    return this.session
  }
  get(_id: string) {
    return this.session
  }
}

function fakeGoalSession(
  proc: any,
  goalSnapshot: GoalSnapshot | null = null,
  opts?: { lastTurnAssistantText?: string }
) {
  const session = {
    sessionId: 's1',
    proc,
    fileCommands: [] as unknown[],
    goalSnapshot,
    lastTurnAssistantText: opts?.lastTurnAssistantText ?? '<!-- GOAL_STATUS: complete -->',
    wasCancelRequested: () => false,
    async prompt(message: string, images: unknown[] = []) {
      proc.prompts.push({ message, attachments: images })
      return 'end_turn' as const
    }
  }
  return session
}

test('parseGoalCommand: maps slash args to goal actions', () => {
  assert.deepEqual(parseGoalCommand(''), { type: 'status' })
  assert.deepEqual(parseGoalCommand('  '), { type: 'status' })
  assert.deepEqual(parseGoalCommand('clear'), { type: 'clear' })
  assert.deepEqual(parseGoalCommand('pause'), { type: 'pause' })
  assert.deepEqual(parseGoalCommand('resume'), { type: 'resume' })
  assert.deepEqual(parseGoalCommand('ship the chip UI'), { type: 'set', objective: 'ship the chip UI' })
  assert.deepEqual(parseGoalCommand('clear the backlog'), { type: 'set', objective: 'clear the backlog' })
})

test('applyGoalCommand: set/pause/resume/clear mutates snapshot', () => {
  const now = 1_710_000_000
  const set = applyGoalCommand(null, { type: 'set', objective: 'finish /goal' }, now)
  assert.equal(set.changed, true)
  assert.equal(set.snapshot?.status, 'active')
  assert.equal(set.snapshot?.objective, 'finish /goal')
  assert.equal(set.snapshot?.controlMethod, GOAL_CONTROL_METHOD)
  assert.equal(set.snapshot?.createdAt, now)

  const paused = applyGoalCommand(set.snapshot, { type: 'pause' }, now + 12)
  assert.equal(paused.changed, true)
  assert.equal(paused.snapshot?.status, 'paused')
  assert.equal(paused.snapshot?.timeUsedSeconds, 12)

  const resumed = applyGoalCommand(paused.snapshot, { type: 'resume' }, now + 20)
  assert.equal(resumed.changed, true)
  assert.equal(resumed.snapshot?.status, 'active')

  const cleared = applyGoalCommand(resumed.snapshot, { type: 'clear' })
  assert.equal(cleared.changed, true)
  assert.equal(cleared.snapshot, null)
})

test('applyGoalControl: pause and clear match chip buttons', () => {
  const current = createGoalSnapshot('keep going', 100)
  const paused = applyGoalControl(current, 'pause', 110)
  assert.equal(paused.snapshot?.status, 'paused')
  const cleared = applyGoalControl(paused.snapshot, 'clear')
  assert.equal(cleared.snapshot, null)
})

test('goalPromptPrefix: only active goals inject context', () => {
  const active = createGoalSnapshot('land the chip')
  assert.match(goalPromptPrefix(active), /Active session goal: land the chip/)
  assert.equal(goalPromptPrefix({ ...active, status: 'paused' }), '')
  assert.equal(goalPromptPrefix(null), '')
})

test('parseGoalStatusTrailer: reads the last complete/blocked marker', () => {
  assert.equal(parseGoalStatusTrailer('working'), null)
  assert.equal(parseGoalStatusTrailer('done\n<!-- GOAL_STATUS: complete -->'), 'complete')
  assert.equal(parseGoalStatusTrailer('<!-- GOAL_STATUS: blocked -->'), 'blocked')
  assert.equal(
    parseGoalStatusTrailer('<!-- GOAL_STATUS: blocked -->\nlater\n<!-- GOAL_STATUS: complete -->'),
    'complete'
  )
})

test('parseGoalControlParams: requires sessionId and pause|clear', () => {
  assert.deepEqual(parseGoalControlParams({ sessionId: 's1', action: 'pause' }), {
    sessionId: 's1',
    action: 'pause'
  })
  assert.throws(() => parseGoalControlParams({ action: 'pause' }))
  assert.throws(() => parseGoalControlParams({ sessionId: 's1', action: 'resume' }))
})

test('PiAcpAgent: /goal starts a model turn and emits _meta.codex.goal', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess() as any
  const session = fakeGoalSession(proc)

  const agent = new PiAcpAgent(asAgentConn(conn))
  ;(agent as any).sessions = new FakeSessions(session) as any

  const res = await agent.prompt({
    sessionId: 's1',
    prompt: [{ type: 'text', text: '/goal land the chip UI' }]
  } as any)

  assert.equal(res.stopReason, 'end_turn')
  assert.equal(proc.prompts.length, 1)
  assert.equal(proc.prompts[0]!.message, goalKickoffPrompt('land the chip UI'))
  assert.equal(session.goalSnapshot?.objective, 'land the chip UI')
  assert.equal(session.goalSnapshot?.status, 'complete')
  assert.equal(session.goalSnapshot?.controlMethod, GOAL_CONTROL_METHOD)

  const info = conn.updates.find(u => (u as any).update?.sessionUpdate === 'session_info_update')
  assert.equal((info as any)?.update?._meta?.codex?.goal?.objective, 'land the chip UI')
  assert.doesNotMatch(JSON.stringify(conn.updates), /Goal set:/)
})

test('PiAcpAgent: /goal continues until GOAL_STATUS complete', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess() as any
  const session = fakeGoalSession(proc, null, { lastTurnAssistantText: '' })
  let turns = 0
  session.prompt = async (message: string, images: unknown[] = []) => {
    proc.prompts.push({ message, attachments: images })
    turns += 1
    session.lastTurnAssistantText = turns === 1 ? 'still working' : 'done\n<!-- GOAL_STATUS: complete -->'
    return 'end_turn'
  }

  const agent = new PiAcpAgent(asAgentConn(conn))
  ;(agent as any).sessions = new FakeSessions(session) as any

  await agent.prompt({
    sessionId: 's1',
    prompt: [{ type: 'text', text: '/goal land the chip UI' }]
  } as any)

  assert.equal(proc.prompts.length, 2)
  assert.match(proc.prompts[0]!.message, /Start working toward it now/)
  assert.match(proc.prompts[1]!.message, /Continue working toward the active session goal/)
  assert.equal(session.goalSnapshot?.status, 'complete')
})

test('PiAcpAgent: /goal pause and /goal clear update the chip snapshot', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess() as any
  const session = fakeGoalSession(proc, createGoalSnapshot('keep going', 100))

  const agent = new PiAcpAgent(asAgentConn(conn))
  ;(agent as any).sessions = new FakeSessions(session) as any

  await agent.prompt({ sessionId: 's1', prompt: [{ type: 'text', text: '/goal pause' }] } as any)
  assert.equal(session.goalSnapshot?.status, 'paused')
  assert.equal(proc.prompts.length, 0)

  await agent.prompt({ sessionId: 's1', prompt: [{ type: 'text', text: '/goal clear' }] } as any)
  assert.equal(session.goalSnapshot, null)

  const cleared = conn.updates.filter(u => (u as any).update?.sessionUpdate === 'session_info_update').at(-1)
  assert.equal((cleared as any)?.update?._meta?.codex?.goal, null)
})

test('PiAcpAgent: goal_control extMethod pauses and clears like the chip buttons', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess() as any
  const session = fakeGoalSession(proc, createGoalSnapshot('keep going', 100))

  const agent = new PiAcpAgent(asAgentConn(conn))
  ;(agent as any).sessions = new FakeSessions(session) as any

  await agent.extMethod(GOAL_CONTROL_METHOD, { sessionId: 's1', action: 'pause' })
  assert.equal(session.goalSnapshot?.status, 'paused')

  await agent.extMethod(GOAL_CONTROL_METHOD, { sessionId: 's1', action: 'clear' })
  assert.equal(session.goalSnapshot, null)

  const last = conn.updates.at(-1)
  assert.equal((last as any)?.update?._meta?.codex?.goal, null)
})

test('PiAcpAgent: injects active goal into the next model prompt', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess() as any
  const session = fakeGoalSession(proc, createGoalSnapshot('land the chip'))

  const agent = new PiAcpAgent(asAgentConn(conn))
  ;(agent as any).sessions = new FakeSessions(session) as any

  await agent.prompt({
    sessionId: 's1',
    prompt: [{ type: 'text', text: 'continue' }]
  } as any)

  assert.equal(proc.prompts.length, 1)
  assert.match(proc.prompts[0]!.message, /Active session goal: land the chip/)
  assert.match(proc.prompts[0]!.message, /\n\ncontinue$/)
})
