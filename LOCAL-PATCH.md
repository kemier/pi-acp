# Local patch: thought_level persistence

## Problem

When changing **Thinking** in vscode-acp, pi-acp returned `currentValue: "off"` even after
`session/set_config_option(thought_level=high)` succeeded. Pi's `get_state` can stay stale
on vLLM/OpenAI-compatible backends.

## Fix

Cache the last ACP-set thinking level on `PiAcpSession` and prefer it when building
`configOptions` after `setSessionConfigOption` / `setSessionMode`.

## Use with vscode-acp

Build once:

```bash
cd /Users/zaedinzeng/projects/pi-acp
npm install && npm run build
```

Point your agent at the local build (VS Code/Cursor `settings.json`):

```json
"acp.agents": {
  "PI Agent": {
    "command": "node",
    "args": ["/Users/zaedinzeng/projects/pi-acp/dist/index.js"]
  }
}
```

Reload the window, reconnect PI Agent, and change Thinking — the picker should stay on your selection.

## Turn-scoped ACP `messageId` on streamed tokens

vscode-acp (and Zed) group `agent_message_chunk` / `agent_thought_chunk` by
`messageId`. Pi does not emit one, so clients that invent a new id per token
render "Hello world" as one word per line.

`PiAcpSession` now attaches a stable `messageId` (`turn-<sessionId>-<n>`) to
every `text_delta` / `thinking_delta` in a prompt. Status notices (retry,
compaction, queue) still omit `messageId` so they do not fuse into the model
reply. A new id is minted at `startTurn` and cleared at `agent_settled`.

Rebuild:

```bash
cd /Users/zaedinzeng/projects/pi-acp
npm run build
```

Then rsync/build on Ubuntu if that host uses `~/projects/pi-acp/dist/index.js`.

## Context usage ring (vscode-acp / Zed)

Pi exposes live context fill via `get_session_stats.contextUsage`. This patch emits standard ACP
`usage_update` notifications (same path as codex-acp and claude-code-acp), so vscode-acp shows the
context ring in the composer toolbar after your first prompt.

Emitted on: `turn_end`, `agent_settled`, auto-compaction, manual `/compact`, and session load.

No vscode-acp changes required — it already handles `sessionUpdate: 'usage_update'`.

## Collapsed-mode fold title ("Reply" vs tool summary)

**Cause:** vscode-acp shows hardcoded `"Reply"` when the collapsed fold has interim assistant
text but no tools/thoughts yet. Pi often streams `agent_message_chunk` before `tool_call`, and
(with thinking off) sends no `agent_thought_chunk` — so Codex/Claude show `"Thought"` or
`"2 reads, 1 command"` while Pi showed `"Reply"`.

**Fixes in this patch:**

- **pi-acp:** `formatToolTitle()` — `read` → `Read bar.ts`, bash → command string (Codex-style)
- **vscode-acp:** use first line of interim assistant text instead of `"Reply"` when present

Rebuild pi-acp and redeploy vscode-acp for both parts.
