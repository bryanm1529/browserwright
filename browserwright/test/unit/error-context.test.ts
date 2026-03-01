import { describe, it, expect } from 'vitest'
import { captureErrorContext } from '../../src/error-context.js'

interface TestPage {
  url(): string
  title(): Promise<string>
}

function makePage(overrides: {
  url?: string | (() => string)
  title?: string | (() => Promise<string>)
  throwUrl?: boolean
  throwTitle?: boolean
} = {}): TestPage {
  return {
    url: overrides.throwUrl
      ? () => { throw new Error('page closed') }
      : typeof overrides.url === 'function'
        ? overrides.url
        : () => overrides.url ?? 'https://example.com',
    title: overrides.throwTitle
      ? () => Promise.reject(new Error('page closed'))
      : typeof overrides.title === 'function'
        ? overrides.title
        : () => Promise.resolve(overrides.title ?? 'Example Page'),
  }
}

function makeLogs(count: number, method = 'log'): Array<{ method: string; args: unknown[] }> {
  return Array.from({ length: count }, (_, i) => ({
    method,
    args: [`message ${i + 1}`],
  }))
}

describe('captureErrorContext', () => {
  it('returns empty string for null page with no logs', async () => {
    expect(await captureErrorContext({ page: null, consoleLogs: [] })).toBe('')
  })

  it('returns empty string for undefined page with no logs', async () => {
    expect(await captureErrorContext({ page: undefined, consoleLogs: [] })).toBe('')
  })

  it('returns console logs even when page is null', async () => {
    const logs = [{ method: 'error', args: ['fetch failed'] }]
    const result = await captureErrorContext({ page: null, consoleLogs: logs })
    expect(result).toContain('--- Console (recent) ---')
    expect(result).toContain('[error] fetch failed')
  })

  it('returns console logs even when page is closed (both url and title throw)', async () => {
    const page = makePage({ throwUrl: true, throwTitle: true })
    const logs = [{ method: 'warn', args: ['something went wrong'] }]
    const result = await captureErrorContext({ page, consoleLogs: logs })
    expect(result).toContain('[warn] something went wrong')
  })

  it('captures URL and title', async () => {
    const page = makePage({ url: 'https://test.dev/login', title: 'Login' })
    const result = await captureErrorContext({ page, consoleLogs: [] })
    expect(result).toContain('URL: https://test.dev/login')
    expect(result).toContain('Title: Login')
  })

  it('survives page.url() throwing', async () => {
    const page = makePage({ throwUrl: true, title: 'Still Works' })
    const result = await captureErrorContext({ page, consoleLogs: [] })
    expect(result).not.toContain('URL:')
    expect(result).toContain('Title: Still Works')
  })

  it('survives page.title() throwing', async () => {
    const page = makePage({ url: 'https://example.com', throwTitle: true })
    const result = await captureErrorContext({ page, consoleLogs: [] })
    expect(result).toContain('URL: https://example.com')
    expect(result).not.toContain('Title:')
  })

  it('formats console logs', async () => {
    const logs = [
      { method: 'error', args: ['fetch failed', { status: 404 }] },
      { method: 'warn', args: ['deprecated API'] },
    ]
    const result = await captureErrorContext({ page: makePage(), consoleLogs: logs })
    expect(result).toContain('--- Console (recent) ---')
    expect(result).toContain('[error] fetch failed {"status":404}')
    expect(result).toContain('[warn] deprecated API')
  })

  it('limits console logs to last 10 entries', async () => {
    const logs = makeLogs(15)
    const result = await captureErrorContext({ page: makePage(), consoleLogs: logs })
    // Should have entries 6-15 (last 10)
    expect(result).not.toContain('message 5')
    expect(result).toContain('message 6')
    expect(result).toContain('message 15')
  })

  it('handles circular objects in console logs', async () => {
    const circular: Record<string, unknown> & { self?: unknown } = { a: 1 }
    circular.self = circular
    const logs = [{ method: 'log', args: [circular] }]
    const result = await captureErrorContext({ page: makePage(), consoleLogs: logs })
    expect(result).toContain('[log] [unserializable]')
  })

  it('handles BigInt in console logs', async () => {
    const logs = [{ method: 'log', args: [BigInt(42)] }]
    const result = await captureErrorContext({ page: makePage(), consoleLogs: logs })
    expect(result).toContain('[log] 42')
  })

  it('includes snapshot when provided', async () => {
    const snapshotFn = async () => '- heading "Dashboard" [ref=e1]\n- button "Logout" [ref=e2]'
    const result = await captureErrorContext({ page: makePage(), consoleLogs: [], snapshotFn })
    expect(result).toContain('--- Page Snapshot ---')
    expect(result).toContain('heading "Dashboard"')
    expect(result).toContain('button "Logout"')
  })

  it('caps snapshot at 40 lines', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `- item "Line ${i}" [ref=e${i}]`)
    const snapshotFn = async () => lines.join('\n')
    const result = await captureErrorContext({ page: makePage(), consoleLogs: [], snapshotFn })
    expect(result).toContain('Line 39')
    expect(result).not.toContain('Line 40')
  })

  it('survives snapshot function throwing', async () => {
    const snapshotFn = async (): Promise<string> => { throw new Error('snapshot failed') }
    const result = await captureErrorContext({ page: makePage(), consoleLogs: [], snapshotFn })
    // Should still have page context
    expect(result).toContain('URL: https://example.com')
    expect(result).not.toContain('Snapshot')
  })

  it('caps total output at 2000 characters', async () => {
    const longLogs = Array.from({ length: 10 }, (_, i) => ({
      method: 'log',
      args: ['x'.repeat(200) + ` entry${i}`],
    }))
    const snapshotFn = async () => 'y'.repeat(1000)
    const result = await captureErrorContext({ page: makePage(), consoleLogs: longLogs, snapshotFn })
    expect(result.length).toBeLessThanOrEqual(2000)
    expect(result).toMatch(/\.\.\.$/)
  })

  it('omits console section when no logs', async () => {
    const result = await captureErrorContext({ page: makePage(), consoleLogs: [] })
    expect(result).not.toContain('Console')
  })

  it('omits snapshot section when snapshotFn not provided', async () => {
    const result = await captureErrorContext({ page: makePage(), consoleLogs: [] })
    expect(result).not.toContain('Snapshot')
  })
})
