import { basename } from 'node:path'
import { bashCommand, stripShellPrefix } from './translate/bash.js'

function toolPath(args: unknown): string | null {
  const record = args as { path?: unknown; file_path?: unknown } | null | undefined
  if (typeof record?.path === 'string' && record.path.trim()) return record.path.trim()
  if (typeof record?.file_path === 'string' && record.file_path.trim()) return record.file_path.trim()
  return null
}

/** Human-readable ACP tool title (Codex/Claude-style) for collapsed-mode summaries. */
export function formatToolTitle(toolName: string, args: unknown): string {
  const name = String(toolName || 'tool').trim()
  const lower = name.toLowerCase()

  if (lower === 'bash' || lower === 'shell') {
    return stripShellPrefix(bashCommand(args) ?? name) ?? name
  }

  const path = toolPath(args)
  if (path) {
    const base = basename(path) || path
    if (lower === 'read') return `Read ${base}`
    if (lower === 'write') return `Write ${base}`
    if (lower === 'edit') return `Edit ${base}`
    return `${name} ${base}`
  }

  return name
}
