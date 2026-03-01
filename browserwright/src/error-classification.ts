export type ErrorCategory =
  | 'timeout'
  | 'target-closed'
  | 'selector'
  | 'navigation'
  | 'api-misuse'
  | 'sandbox'
  | 'connection'
  | 'unknown'

/** Categories where a page snapshot is irrelevant (no visual state to inspect). */
export const SKIP_SNAPSHOT_CATEGORIES = new Set<ErrorCategory>([
  'sandbox',
  'api-misuse',
  'connection',
  'target-closed',
])

interface PatternEntry {
  pattern: RegExp
  category: ErrorCategory
}

interface ErrorLikeShape {
  message?: unknown
  name?: unknown
  stack?: unknown
}

/**
 * Ordered list of patterns — first match wins.
 * More specific patterns come before generic ones.
 *
 * Key ordering decisions:
 * - target-closed before navigation (so "waitForNavigation: Target closed" → target-closed)
 * - locator/selector before generic timeout (locator timeouts are selector problems)
 * - "waiting for locator" specifically, not bare "waiting for" (avoids misclassifying waitForEvent)
 */
const PATTERNS: PatternEntry[] = [
  // Target / page closed (must precede navigation — "waitForNavigation: Target closed" is target-closed)
  { pattern: /target closed/i, category: 'target-closed' },
  { pattern: /page.*closed/i, category: 'target-closed' },
  { pattern: /context.*closed/i, category: 'target-closed' },
  { pattern: /session.*closed/i, category: 'target-closed' },
  { pattern: /execution context was destroyed/i, category: 'target-closed' },

  // Navigation-specific (after target-closed, before generic timeout)
  { pattern: /navigation/i, category: 'navigation' },
  { pattern: /net::ERR_/i, category: 'navigation' },

  // Selector / locator (must precede generic timeout — locator timeouts are selector problems)
  { pattern: /locator/i, category: 'selector' },
  { pattern: /selector/i, category: 'selector' },
  { pattern: /strict mode violation/i, category: 'selector' },
  { pattern: /waiting for locator/i, category: 'selector' },
  { pattern: /waiting for getBy/i, category: 'selector' },

  // Timeout (generic — after navigation and selector checks)
  { pattern: /timeout/i, category: 'timeout' },

  // API misuse
  { pattern: /expected.*argument/i, category: 'api-misuse' },
  { pattern: /is not a function/i, category: 'api-misuse' },
  { pattern: /\bTypeError\b/i, category: 'api-misuse' },
  { pattern: /\bReferenceError\b/i, category: 'api-misuse' },
  { pattern: /\bSyntaxError\b/i, category: 'api-misuse' },
  { pattern: /cannot read propert/i, category: 'api-misuse' },
  { pattern: /is not defined/i, category: 'api-misuse' },

  // Sandbox
  { pattern: /not allowed/i, category: 'sandbox' },
  { pattern: /blocked/i, category: 'sandbox' },
  { pattern: /permission denied/i, category: 'sandbox' },

  // Connection
  { pattern: /ECONNREFUSED/i, category: 'connection' },
  { pattern: /ECONNRESET/i, category: 'connection' },
  { pattern: /no heartbeat/i, category: 'connection' },
  { pattern: /stale/i, category: 'connection' },
  { pattern: /WebSocket.*closed/i, category: 'connection' },
  { pattern: /disconnected/i, category: 'connection' },
]

/**
 * Coerce an unknown thrown value into an Error instance.
 * Handles: Error, string, number, null, undefined, objects.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value
  }

  if (value === null || value === undefined) {
    return new Error(String(value))
  }

  if (typeof value === 'string') {
    return new Error(value)
  }

  if (typeof value === 'object') {
    const errorLike = value as ErrorLikeShape
    if (errorLike.message !== undefined) {
      const err = new Error(String(errorLike.message))
      if (errorLike.name !== undefined) {
        err.name = String(errorLike.name)
      }
      if (errorLike.stack !== undefined) {
        err.stack = String(errorLike.stack)
      }
      return err
    }
  }

  return new Error(String(value))
}

/**
 * Classify an error into one of the known categories by matching
 * against `error.name + ' ' + error.message`.
 */
export function classifyError(error: Error): ErrorCategory {
  const haystack = `${error.name} ${error.message}`
  for (const { pattern, category } of PATTERNS) {
    if (pattern.test(haystack)) return category
  }
  return 'unknown'
}
