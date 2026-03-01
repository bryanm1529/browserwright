const MAX_OUTPUT_CHARS = 2000
const MAX_CONSOLE_ENTRIES = 10
const MAX_SNAPSHOT_LINES = 40

export interface ConsoleLogEntry {
  method: string
  args: unknown[]
}

export interface ErrorContextPage {
  url(): string
  title(): Promise<string>
}

export interface CaptureErrorContextOptions {
  page: ErrorContextPage | null | undefined
  consoleLogs: ConsoleLogEntry[]
  snapshotFn?: () => Promise<string>
}

/**
 * Safely serialize a console arg. Handles circular refs, BigInt, and other
 * values that JSON.stringify chokes on.
 */
function safeStringify(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

/**
 * Format console log entries. Independent of page state —
 * console logs are always available even when the page is closed.
 */
function formatConsoleLogs(consoleLogs: ConsoleLogEntry[]): string {
  if (consoleLogs.length === 0) return ''

  const parts: string[] = ['', '--- Console (recent) ---']
  const recent = consoleLogs.slice(-MAX_CONSOLE_ENTRIES)
  for (const { method, args } of recent) {
    const formatted = args.map(safeStringify).join(' ')
    parts.push(`[${method}] ${formatted}`)
  }
  return parts.join('\n')
}

/**
 * Best-effort capture of page context for error enrichment.
 * Every individual capture is wrapped in its own try/catch so a
 * single failure never masks others or the original error.
 *
 * Console logs are always included regardless of page state.
 * Page URL/title and snapshot are only included when the page is accessible.
 *
 * Returns a formatted string ready to append to an error message,
 * or '' if nothing useful could be captured.
 */
export async function captureErrorContext(options: CaptureErrorContextOptions): Promise<string> {
  const { page, consoleLogs, snapshotFn } = options
  const parts: string[] = []

  // --- Page info (may be unavailable if page is closed) ---
  if (page) {
    let url = ''
    try {
      url = page.url()
    } catch {
      // page closed / disconnected
    }

    let title = ''
    try {
      title = await page.title()
    } catch {
      // page closed / disconnected
    }

    if (url || title) {
      parts.push('--- Page Context ---')
      if (url) parts.push(`URL: ${url}`)
      if (title) parts.push(`Title: ${title}`)
    }
  }

  // --- Console logs (independent of page state) ---
  const logsSection = formatConsoleLogs(consoleLogs)
  if (logsSection) parts.push(logsSection)

  // --- Accessibility snapshot ---
  if (snapshotFn) {
    try {
      const snapshot = await snapshotFn()
      if (snapshot) {
        const lines = snapshot.split('\n').slice(0, MAX_SNAPSHOT_LINES)
        parts.push('')
        parts.push('--- Page Snapshot ---')
        parts.push(lines.join('\n'))
      }
    } catch {
      // snapshot failed — that's fine, skip it
    }
  }

  // Nothing captured at all
  if (parts.length === 0) return ''

  let result = parts.join('\n')
  if (result.length > MAX_OUTPUT_CHARS) {
    result = result.slice(0, MAX_OUTPUT_CHARS - 3) + '...'
  }
  return result
}
