/**
 * Integration tests for the error enrichment pipeline:
 * toError → classifyError → captureErrorContext → formatted output
 */

import { describe, it, expect } from 'vitest'
import { classifyError, SKIP_SNAPSHOT_CATEGORIES, toError } from '../../src/error-classification.js'
import { captureErrorContext } from '../../src/error-context.js'

interface TestPage {
  url(): string
  title(): Promise<string>
}

function makePage(url = 'https://app.example.com/dashboard', title = 'Dashboard'): TestPage {
  return {
    url: () => url,
    title: () => Promise.resolve(title),
  }
}

function makeSnapshot(lines: string[]) {
  return async () => lines.join('\n')
}

/**
 * Simulates the enrichment logic from the execute() catch block:
 * normalize → classify → decide snapshot → capture context → format.
 */
async function enrichError(
  options: {
    rawError: unknown
    page: TestPage | null
    consoleLogs?: Array<{ method: string; args: unknown[] }>
    snapshotLines?: string[]
  },
) {
  const {
    rawError,
    page,
    consoleLogs = [],
    snapshotLines = [],
  } = options
  const error = toError(rawError)
  const category = classifyError(error)
  const snapshotFn = (!SKIP_SNAPSHOT_CATEGORIES.has(category) && snapshotLines.length > 0)
    ? makeSnapshot(snapshotLines)
    : undefined

  const contextBlock = await captureErrorContext({ page, consoleLogs, snapshotFn })
  const contextSection = contextBlock ? `\n\n${contextBlock}` : ''

  return `[${category}] Error executing code: ${error.message}\n${error.stack || error.message}${contextSection}`
}

describe('Error Enrichment Pipeline', () => {
  describe('timeout error lifecycle', () => {
    it('classifies and enriches a timeout error with page context', async () => {
      const error = new Error('Timeout 30000ms exceeded')
      error.name = 'TimeoutError'
      const logs: Array<{ method: string; args: unknown[] }> = [{ method: 'error', args: ['API call hung'] }]
      const snapshot = ['- button "Submit" [ref=e1]', '- textbox "Email" [ref=e2]']

      const result = await enrichError({ rawError: error, page: makePage(), consoleLogs: logs, snapshotLines: snapshot })

      expect(result).toMatch(/^\[timeout\]/)
      expect(result).toContain('Timeout 30000ms exceeded')
      expect(result).toContain('URL: https://app.example.com/dashboard')
      expect(result).toContain('[error] API call hung')
      // Timeout gets snapshot (not in skip list)
      expect(result).toContain('--- Page Snapshot ---')
      expect(result).toContain('button "Submit"')
    })
  })

  describe('connection error lifecycle', () => {
    it('classifies connection errors and skips snapshot', async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:19988')
      const snapshot = ['- heading "Page" [ref=e1]']

      const result = await enrichError({ rawError: error, page: makePage(), snapshotLines: snapshot })

      expect(result).toMatch(/^\[connection\]/)
      expect(result).toContain('ECONNREFUSED')
      // Connection is in SKIP_SNAPSHOT_CATEGORIES
      expect(result).not.toContain('--- Page Snapshot ---')
    })

    it('includes console logs even with null page', async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:19988')
      const logs: Array<{ method: string; args: unknown[] }> = [{ method: 'error', args: ['connection lost'] }]
      const result = await enrichError({ rawError: error, page: null, consoleLogs: logs })

      expect(result).toMatch(/^\[connection\]/)
      expect(result).toContain('[error] connection lost')
    })
  })

  describe('selector error lifecycle', () => {
    it('includes snapshot for selector errors to aid correction', async () => {
      const error = new Error('locator.click: Timeout 5000ms exceeded.\nWaiting for locator(\'button:has-text("Save")\')')
      const logs: Array<{ method: string; args: unknown[] }> = [{ method: 'log', args: ['form loaded'] }]
      const snapshot = [
        '- button "Cancel" [ref=e3]',
        '- button "Save Draft" [ref=e4]',
        '- button "Publish" [ref=e5]',
      ]

      const result = await enrichError({
        rawError: error,
        page: makePage('https://app.example.com/editor', 'Editor'),
        consoleLogs: logs,
        snapshotLines: snapshot,
      })

      // "locator" matches selector before "timeout" matches timeout
      expect(result).toMatch(/^\[selector\]/)
      expect(result).toContain('URL: https://app.example.com/editor')
      expect(result).toContain('Title: Editor')
      expect(result).toContain('[log] form loaded')
      expect(result).toContain('button "Save Draft"')
      expect(result).toContain('button "Publish"')
    })
  })

  describe('target-closed error lifecycle', () => {
    it('skips snapshot for target-closed errors', async () => {
      const error = new Error('page.waitForNavigation: Target page, context or browser has been closed')
      const snapshot = ['- heading "Page" [ref=e1]']

      const result = await enrichError({ rawError: error, page: makePage(), snapshotLines: snapshot })

      expect(result).toMatch(/^\[target-closed\]/)
      expect(result).not.toContain('--- Page Snapshot ---')
    })
  })

  describe('sandbox error lifecycle', () => {
    it('skips snapshot for sandbox errors', async () => {
      const error = new Error('Module "child_process" is not allowed in sandbox')
      const snapshot = ['- heading "Page" [ref=e1]']

      const result = await enrichError({ rawError: error, page: makePage(), snapshotLines: snapshot })

      expect(result).toMatch(/^\[sandbox\]/)
      expect(result).not.toContain('--- Page Snapshot ---')
    })
  })

  describe('api-misuse error lifecycle', () => {
    it('skips snapshot for api-misuse errors', async () => {
      const error = new Error('page.foo is not a function')
      const snapshot = ['- heading "Page" [ref=e1]']

      const result = await enrichError({ rawError: error, page: makePage(), snapshotLines: snapshot })

      expect(result).toMatch(/^\[api-misuse\]/)
      expect(result).not.toContain('--- Page Snapshot ---')
    })
  })

  describe('unknown error lifecycle', () => {
    it('includes context for unknown errors', async () => {
      const error = new Error('Something truly unexpected happened')
      const result = await enrichError({
        rawError: error,
        page: makePage(),
        consoleLogs: [{ method: 'warn', args: ['unusual state'] }],
      })

      expect(result).toMatch(/^\[unknown\]/)
      expect(result).toContain('URL: https://app.example.com/dashboard')
      expect(result).toContain('[warn] unusual state')
    })
  })

  describe('non-Error throws', () => {
    it('handles string throws', async () => {
      const result = await enrichError({ rawError: 'oops', page: makePage() })
      expect(result).toMatch(/^\[unknown\] Error executing code: oops/)
    })

    it('handles null throws', async () => {
      const result = await enrichError({ rawError: null, page: makePage() })
      expect(result).toMatch(/^\[unknown\] Error executing code: null/)
    })

    it('handles undefined throws', async () => {
      const result = await enrichError({ rawError: undefined, page: makePage() })
      expect(result).toMatch(/^\[unknown\] Error executing code: undefined/)
    })

    it('handles number throws', async () => {
      const result = await enrichError({ rawError: 42, page: makePage() })
      expect(result).toMatch(/^\[unknown\] Error executing code: 42/)
    })
  })

  describe('output format', () => {
    it('prefixes with category in brackets', async () => {
      const error = new Error('Navigation failed')
      const result = await enrichError({ rawError: error, page: null })
      expect(result).toMatch(/^\[navigation\] Error executing code:/)
    })

    it('includes error message and stack', async () => {
      const error = new Error('test error')
      const result = await enrichError({ rawError: error, page: null })
      expect(result).toContain('Error executing code: test error')
    })
  })
})
