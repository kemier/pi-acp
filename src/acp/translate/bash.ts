import type { ToolCallContent } from '@agentclientprotocol/sdk'
import { isAbsolute as isAbsolutePath, relative as relativePath, resolve as resolvePath } from 'node:path'

type BashCommandRecord = {
  command?: unknown
  cmd?: unknown
  args?: BashCommandRecord
  input?: BashCommandRecord
  rawInput?: BashCommandRecord
  toolInput?: BashCommandRecord
  details?: BashCommandRecord
}

type BashResultRecord = {
  content?: unknown
  details?: unknown
  stdout?: unknown
  stderr?: unknown
  output?: unknown
  exitCode?: unknown
  code?: unknown
}

export function isBashTool(toolName: string): boolean {
  return toolName.toLowerCase() === 'bash'
}

export function bashCommand(value: unknown): string | undefined {
  const record = value as BashCommandRecord | null | undefined
  const command =
    record?.command ??
    record?.cmd ??
    record?.args?.command ??
    record?.args?.cmd ??
    record?.input?.command ??
    record?.input?.cmd ??
    record?.rawInput?.command ??
    record?.rawInput?.cmd ??
    record?.toolInput?.command ??
    record?.toolInput?.cmd ??
    record?.details?.command ??
    record?.details?.cmd

  return typeof command === 'string' && command.trim() ? stripShellPrefix(command) : undefined
}

/**
 * Strip a leading `cd <dir> && <cmd>` (or `cd <dir>\n<cmd>`) wrapper so the
 * tool-call title shows the real command. Mirrors codex-acp's CommandUtils.
 * The full command is still preserved in rawInput.
 *
 * What happens to the `cd` depends on where it points, relative to `cwd`:
 *  - the session cwd itself -> STRIPPED (that is where commands run anyway)
 *  - a directory INSIDE the cwd -> KEPT, rewritten relative ("cd src/ui && ...")
 *  - anywhere else -> STRIPPED (the command is the interesting part)
 *
 * Kept in sync with vscode-acp's src/utils/toolTitle.ts and codex-acp /
 * claude-code-acp, so the client's own normalization is a no-op here.
 */
export function stripShellPrefix(command: string, cwd?: string): string {
  let withoutShell = command.replace(/^(?:\/bin\/)?(?:bash|zsh|sh)\s+(?:-[lc]+\s+)?/, '')
  if (withoutShell.startsWith("'") && withoutShell.endsWith("'")) {
    withoutShell = withoutShell.slice(1, -1)
  }

  const nl = withoutShell.indexOf('\n')
  const firstLine = (nl === -1 ? withoutShell : withoutShell.slice(0, nl)).trim()
  const rest = nl === -1 ? '' : withoutShell.slice(nl + 1)

  // `cd <dir> && <cmd>` / `cd <dir>; <cmd>` — cd and the command share the
  // first line. Both separators occur in agent output.
  const cdAnd = firstLine.match(/^cd\s+(\S[^;&]*?)\s*(&&|;)\s*(.+)$/)
  if (cdAnd && cdAnd[3]) {
    const inline = cdAnd[3].trim()
    const sub = subdirOfCwd(cdAnd[1].trim(), cwd)
    if (sub) {
      const joined = `cd ${sub}${cdAnd[2] === ';' ? ';' : ' &&'} ${inline}`
      return rest ? `${joined}\n${rest}` : joined
    }
    return rest ? `${inline}\n${rest}` : inline
  }

  // Bare `cd <dir>` on its own line — the command starts on the next line.
  const cdOnly = firstLine.match(/^cd\s+(\S.*)$/)
  if (cdOnly && rest.trim()) {
    // Always stripped, even for a subdirectory: clients render only the FIRST
    // line of a title, so keeping 'cd src' would hide the command.
    return rest.replace(/^\n+/, '')
  }

  return withoutShell
}

/**
 * Relative path when `target` is a directory INSIDE `cwd`, else null. A relative
 * target resolves against `cwd`, never process.cwd(), so re-applying this to an
 * already-normalized title is a no-op.
 */
function subdirOfCwd(target: string, cwd?: string): string | null {
  if (!cwd) return null
  try {
    const base = resolvePath(cwd)
    const abs = isAbsolutePath(target) ? resolvePath(target) : resolvePath(base, target)
    const rel = relativePath(base, abs)
    if (!rel || rel === '.' || rel.startsWith('..') || isAbsolutePath(rel)) return null
    return rel
  } catch {
    return null
  }
}

export function bashResultText(result: unknown): string {
  const record = result as BashResultRecord | null | undefined
  const content = record?.content
  if (Array.isArray(content)) {
    const texts = content
      .map(c => {
        const block = c as { type?: unknown; text?: unknown }
        return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
      })
      .filter(Boolean)
    if (texts.length) return texts.join('')
  }

  const details = record?.details as BashResultRecord | null | undefined
  const stdout =
    (typeof details?.stdout === 'string' ? details.stdout : undefined) ??
    (typeof record?.stdout === 'string' ? record.stdout : undefined) ??
    (typeof details?.output === 'string' ? details.output : undefined) ??
    (typeof record?.output === 'string' ? record.output : undefined)
  const stderr =
    (typeof details?.stderr === 'string' ? details.stderr : undefined) ??
    (typeof record?.stderr === 'string' ? record.stderr : undefined)

  return [stdout, stderr].filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n')
}

export function bashExitCode(result: unknown, isError: boolean): number {
  const record = result as BashResultRecord | null | undefined
  const details = record?.details as BashResultRecord | null | undefined
  const exitCode = details?.exitCode ?? record?.exitCode ?? details?.code ?? record?.code
  return typeof exitCode === 'number' ? exitCode : isError ? 1 : 0
}

export function bashOutputDelta(previous: string, next: string): string {
  return next.startsWith(previous) ? next.slice(previous.length) : next
}

export function bashTerminalContent(toolCallId: string): ToolCallContent[] {
  return [{ type: 'terminal', terminalId: toolCallId }] satisfies ToolCallContent[]
}

export function bashTerminalInfoMeta(toolCallId: string, cwd: string) {
  // Zed renders ACP `execute` tools as display-only terminals when paired with
  // terminal content plus terminal metadata. See ACP execute tool schema:
  // https://agentclientprotocol.com/protocol/schema#param-execute
  return { terminal_info: { terminal_id: toolCallId, cwd } }
}

export function bashTerminalOutputMeta(toolCallId: string, data: string) {
  return { terminal_output: { terminal_id: toolCallId, data } }
}

export function bashTerminalExitMeta(toolCallId: string, exitCode: number) {
  return { terminal_exit: { terminal_id: toolCallId, exit_code: exitCode, signal: null } }
}
