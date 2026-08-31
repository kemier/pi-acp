/**
 * Slot KV cache save/restore via llama-server's slot API.
 *
 * Enables fast session resume by persisting the KV cache to disk
 * instead of re-prefilling the full conversation history.
 *
 * Requires:
 *   - llama-server started with `--slot-save-path <dir>`
 *   - PI_LLAMA_SERVER_URL env var (e.g. "http://192.168.124.14:8008")
 *   - PI_SLOT_CACHE_ENABLED env var set to "true" (feature gate)
 */

const SAVE_TIMEOUT_MS = 30_000
const RESTORE_TIMEOUT_MS = 60_000

type SlotCacheResult = {
  success: boolean
  filename: string
  nTokens: number
  fileBytes: number
  elapsedMs: number
  error?: string
}

function getLlamaServerUrl(): string | null {
  // Priority: env var > Pi models.json (provider named "vllm" which is the
  // direct llama.cpp connection, not the proxy)
  const envUrl = process.env.PI_LLAMA_SERVER_URL
  if (envUrl) {
    return envUrl.replace(/\/v1\/?$/, '')
  }
  // Fallback: read from Pi models.json — look for the "vllm" provider
  // (the direct llama.cpp endpoint, not the vllm-proxy).
  try {
    const os = require('node:os')
    const path = require('node:path')
    const fs = require('node:fs')
    const modelsPath = path.join(os.homedir(), '.pi', 'agent', 'models.json')
    const raw = fs.readFileSync(modelsPath, 'utf-8')
    const models = JSON.parse(raw)
    const providers = models.providers ?? {}
    // Prefer the provider named "vllm" (direct llama.cpp), not "vllm-proxy"
    const vllmProvider = providers['vllm']
    if (vllmProvider?.baseUrl) {
      return vllmProvider.baseUrl.replace(/\/v1\/?$/, '')
    }
  } catch {
    // ignore
  }
  return null
}

function isSlotCacheEnabled(): boolean {
  return process.env.PI_SLOT_CACHE_ENABLED === 'true'
}

function slotCacheDir(): string | null {
  return process.env.PI_SLOT_CACHE_DIR || null
}

/**
 * Save the KV cache for a llama-server slot to a file.
 * @param slotId - The llama-server slot ID (usually 0 for single-slot)
 * @param filename - Base filename for the saved KV (e.g. session ID)
 * @returns Result with token count and file size
 */
export async function saveSlotCache(
  slotId: number,
  filename: string,
): Promise<SlotCacheResult> {
  const base = getLlamaServerUrl()
  if (!base) {
    return { success: false, filename, nTokens: 0, fileBytes: 0, elapsedMs: 0, error: 'PI_LLAMA_SERVER_URL not set' }
  }

  const url = `${base}/slots/${slotId}`
  const t0 = Date.now()

  try {
    const res = await fetch(`${url}?action=save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
      signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        success: false,
        filename,
        nTokens: 0,
        fileBytes: 0,
        elapsedMs: Date.now() - t0,
        error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      }
    }

    const data = (await res.json()) as any
    return {
      success: true,
      filename: data.filename ?? filename,
      nTokens: data.n_saved ?? 0,
      fileBytes: data.n_written ?? 0,
      elapsedMs: Date.now() - t0,
    }
  } catch (e: any) {
    return {
      success: false,
      filename,
      nTokens: 0,
      fileBytes: 0,
      elapsedMs: Date.now() - t0,
      error: e?.message ?? String(e),
    }
  }
}

/**
 * Restore the KV cache for a llama-server slot from a file.
 * @param slotId - The llama-server slot ID (usually 0 for single-slot)
 * @param filename - Base filename of the saved KV
 * @returns Result with token count and file size
 */
export async function restoreSlotCache(
  slotId: number,
  filename: string,
): Promise<SlotCacheResult> {
  const base = getLlamaServerUrl()
  if (!base) {
    return { success: false, filename, nTokens: 0, fileBytes: 0, elapsedMs: 0, error: 'PI_LLAMA_SERVER_URL not set' }
  }

  const url = `${base}/slots/${slotId}`
  const t0 = Date.now()

  try {
    const res = await fetch(`${url}?action=restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
      signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        success: false,
        filename,
        nTokens: 0,
        fileBytes: 0,
        elapsedMs: Date.now() - t0,
        error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      }
    }

    const data = (await res.json()) as any
    return {
      success: true,
      filename: data.filename ?? filename,
      nTokens: data.n_restored ?? 0,
      fileBytes: data.n_read ?? 0,
      elapsedMs: Date.now() - t0,
    }
  } catch (e: any) {
    return {
      success: false,
      filename,
      nTokens: 0,
      fileBytes: 0,
      elapsedMs: Date.now() - t0,
      error: e?.message ?? String(e),
    }
  }
}

/**
 * Check if slot save/restore is available on the llama-server.
 * Returns true if the server supports slot actions (i.e. started with --slot-save-path).
 */
export async function isSlotCacheAvailable(slotId: number = 0): Promise<boolean> {
  const base = getLlamaServerUrl()
  if (!base) return false

  try {
    const res = await fetch(`${base}/slots/${slotId}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    })
    // If the server responds to /slots/ at all, it supports slot monitoring.
    // The actual save/restore support is checked by attempting a save.
    return res.ok
  } catch {
    return false
  }
}

/**
 * Get the current slot info from llama-server.
 * Returns slot ID, token count, and processing status.
 */
export async function getSlotInfo(slotId: number = 0): Promise<{
  id: number
  nPromptTokens: number
  nPromptTokensCache: number
  isProcessing: boolean
} | null> {
  const base = getLlamaServerUrl()
  if (!base) return null

  try {
    const res = await fetch(`${base}/slots/${slotId}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as any
    return {
      id: data.id ?? slotId,
      nPromptTokens: data.n_prompt_tokens ?? 0,
      nPromptTokensCache: data.n_prompt_tokens_cache ?? 0,
      isProcessing: data.is_processing ?? false,
    }
  } catch {
    return null
  }
}

export { isSlotCacheEnabled, getLlamaServerUrl }
