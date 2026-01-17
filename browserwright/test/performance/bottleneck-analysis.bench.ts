/**
 * Bottleneck Analysis Benchmarks
 * Identifies performance issues in the Claude Code → Browserwright integration
 *
 * Architecture layers being measured:
 * 1. MCP tool call overhead (execute tool invocation)
 * 2. VM context creation and code execution
 * 3. Playwright operation latency (fill, click, navigate, etc.)
 * 4. CDP relay message round-trip
 * 5. Screenshot/accessibility snapshot generation
 */

import { describe, bench, beforeAll, afterAll, expect } from 'vitest'
import { createMCPClient } from '../../src/mcp-client.js'
import { startBrowserwrightCDPRelayServer, type RelayServer } from '../../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { killPortProcess } from 'kill-port-process'
import { createFileLogger } from '../../src/create-logger.js'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium, type BrowserContext } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const execAsync = promisify(exec)
const BENCH_PORT = 19994

interface TimingResult {
  operation: string
  durationMs: number
  timestamp: number
}

const timings: TimingResult[] = []

function recordTiming(operation: string, startTime: number) {
  const duration = performance.now() - startTime
  timings.push({
    operation,
    durationMs: Math.round(duration * 100) / 100,
    timestamp: Date.now()
  })
  return duration
}

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPortProcess(port)
  } catch {
    // Ignore
  }
}

async function getExtensionServiceWorker(context: BrowserContext) {
  let serviceWorkers = context.serviceWorkers().filter(sw => sw.url().startsWith('chrome-extension://'))
  let serviceWorker = serviceWorkers[0]
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', {
      predicate: (sw) => sw.url().startsWith('chrome-extension://')
    })
  }
  for (let i = 0; i < 50; i++) {
    const isReady = await serviceWorker.evaluate(() => {
      // @ts-ignore
      return typeof globalThis.toggleExtensionForActiveTab === 'function'
    })
    if (isReady) break
    await new Promise(r => setTimeout(r, 100))
  }
  return serviceWorker
}

describe('Bottleneck Analysis - Layer by Layer', () => {
  let client: Awaited<ReturnType<typeof createMCPClient>>['client'] | null = null
  let cleanup: (() => Promise<void>) | null = null
  let relayServer: RelayServer | null = null
  let browserContext: BrowserContext | null = null
  let userDataDir: string | null = null

  beforeAll(async () => {
    await killProcessOnPort(BENCH_PORT)

    // Build extension
    const start = performance.now()
    await execAsync(`TESTING=1 BROWSERWRIGHT_PORT=${BENCH_PORT} pnpm build`, { cwd: '../extension' })
    recordTiming('extension_build', start)

    // Start relay server
    const relayStart = performance.now()
    const logger = createFileLogger()
    relayServer = await startBrowserwrightCDPRelayServer({ port: BENCH_PORT, logger })
    recordTiming('relay_server_start', relayStart)

    // Launch browser with extension
    const browserStart = performance.now()
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bottleneck-bench-'))
    const extensionPath = path.resolve('../extension/dist')

    browserContext = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })
    recordTiming('browser_launch', browserStart)

    // Initialize extension
    const extStart = performance.now()
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const page = await browserContext.newPage()
    await page.goto('about:blank')
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    recordTiming('extension_init', extStart)

    // Create MCP client
    const mcpStart = performance.now()
    const result = await createMCPClient({ port: BENCH_PORT })
    client = result.client
    cleanup = result.cleanup
    recordTiming('mcp_client_connect', mcpStart)
  }, 120000)

  afterAll(async () => {
    // Save timing results
    const resultsPath = path.join(__dirname, 'bottleneck-results.json')
    fs.writeFileSync(resultsPath, JSON.stringify({
      timings,
      summary: generateSummary(timings),
      timestamp: new Date().toISOString()
    }, null, 2))

    if (cleanup) await cleanup()
    if (browserContext) await browserContext.close()
    if (relayServer) relayServer.close()
    if (userDataDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true })
      } catch {}
    }
    await killProcessOnPort(BENCH_PORT)
  })

  // Layer 1: Raw MCP tool call overhead (empty operation)
  bench('Layer 1: MCP execute overhead (empty code)', async () => {
    if (!client) throw new Error('Client not initialized')

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: '// noop',
        timeout: 5000
      }
    })
    recordTiming('mcp_execute_empty', start)
  }, { iterations: 10 })

  // Layer 2: VM context + simple JS execution
  bench('Layer 2: VM execution (pure JS, no Playwright)', async () => {
    if (!client) throw new Error('Client not initialized')

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: 'const result = Array.from({length: 1000}, (_, i) => i * 2); return result.length;',
        timeout: 5000
      }
    })
    recordTiming('vm_pure_js', start)
  }, { iterations: 10 })

  // Layer 3: Playwright page access
  bench('Layer 3: Playwright page.url() (simple property)', async () => {
    if (!client) throw new Error('Client not initialized')

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: 'return page.url();',
        timeout: 5000
      }
    })
    recordTiming('playwright_page_url', start)
  }, { iterations: 10 })

  // Layer 4: Playwright navigation
  bench('Layer 4: Playwright navigation (goto)', async () => {
    if (!client) throw new Error('Client not initialized')

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `await page.goto('data:text/html,<html><body><input id="test"/></body></html>');`,
        timeout: 10000
      }
    })
    recordTiming('playwright_goto', start)
  }, { iterations: 5 })

  // Layer 5: DOM query operations
  bench('Layer 5: Playwright locator (DOM query)', async () => {
    if (!client) throw new Error('Client not initialized')

    // Setup: ensure we have a page with input
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `await page.setContent('<html><body><input id="test" type="text"/></body></html>');`,
        timeout: 5000
      }
    })

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `const loc = page.locator('#test'); return await loc.count();`,
        timeout: 5000
      }
    })
    recordTiming('playwright_locator', start)
  }, { iterations: 10 })

  // Layer 6: fill() operation - THE KEY OPERATION
  bench('Layer 6: Playwright fill() operation', async () => {
    if (!client) throw new Error('Client not initialized')

    // Setup
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `await page.setContent('<html><body><input id="test" type="text"/></body></html>');`,
        timeout: 5000
      }
    })

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `await page.locator('#test').fill('test value');`,
        timeout: 5000
      }
    })
    recordTiming('playwright_fill', start)
  }, { iterations: 10 })

  // Layer 7: click() operation
  bench('Layer 7: Playwright click() operation', async () => {
    if (!client) throw new Error('Client not initialized')

    await client.callTool({
      name: 'execute',
      arguments: {
        code: `await page.setContent('<html><body><button id="btn">Click</button></body></html>');`,
        timeout: 5000
      }
    })

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `await page.locator('#btn').click();`,
        timeout: 5000
      }
    })
    recordTiming('playwright_click', start)
  }, { iterations: 10 })

  // Layer 8: evaluate() - runs JS in browser
  bench('Layer 8: Playwright evaluate() (browser JS)', async () => {
    if (!client) throw new Error('Client not initialized')

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `return await page.evaluate(() => document.title);`,
        timeout: 5000
      }
    })
    recordTiming('playwright_evaluate', start)
  }, { iterations: 10 })

  // Layer 9: screenshot
  bench('Layer 9: Screenshot capture', async () => {
    if (!client) throw new Error('Client not initialized')

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `const buf = await page.screenshot(); return buf.length;`,
        timeout: 10000
      }
    })
    recordTiming('screenshot', start)
  }, { iterations: 5 })

  // Layer 10: accessibility snapshot
  bench('Layer 10: Accessibility snapshot', async () => {
    if (!client) throw new Error('Client not initialized')

    await client.callTool({
      name: 'execute',
      arguments: {
        code: `await page.setContent('<html><body><h1>Test</h1><button>Click me</button><input type="text" placeholder="Enter text"/></body></html>');`,
        timeout: 5000
      }
    })

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `return await accessibilitySnapshot({ page });`,
        timeout: 10000
      }
    })
    recordTiming('accessibility_snapshot', start)
  }, { iterations: 5 })

  // Complex operation: fill + click + wait
  bench('Complex: fill + click + waitForNavigation', async () => {
    if (!client) throw new Error('Client not initialized')

    await client.callTool({
      name: 'execute',
      arguments: {
        code: `await page.setContent('<html><body><form onsubmit="window.location=\\'/submitted\\';return false;"><input id="name" type="text"/><button type="submit">Submit</button></form></body></html>');`,
        timeout: 5000
      }
    })

    const start = performance.now()
    await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          await page.locator('#name').fill('Test User');
          await page.locator('button[type="submit"]').click();
        `,
        timeout: 10000
      }
    })
    recordTiming('complex_fill_click', start)
  }, { iterations: 5 })
})

// CDP Relay specific benchmarks
describe('Bottleneck Analysis - CDP Relay Layer', () => {
  let relayServer: RelayServer | null = null

  beforeAll(async () => {
    await killProcessOnPort(BENCH_PORT + 1)
    const logger = createFileLogger()
    relayServer = await startBrowserwrightCDPRelayServer({ port: BENCH_PORT + 1, logger })
  })

  afterAll(async () => {
    if (relayServer) relayServer.close()
    await killProcessOnPort(BENCH_PORT + 1)
  })

  bench('CDP Relay: WebSocket connect', async () => {
    const start = performance.now()
    const ws = new WebSocket(`ws://127.0.0.1:${BENCH_PORT + 1}/cdp`)

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })

    recordTiming('cdp_ws_connect', start)
    ws.close()
  }, { iterations: 10 })

  bench('CDP Relay: Message send (no response)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${BENCH_PORT + 1}/cdp`)

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })

    const start = performance.now()
    ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }))

    // Wait for response or timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 100)
      ws.once('message', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    recordTiming('cdp_message_roundtrip', start)
    ws.close()
  }, { iterations: 10 })
})

function generateSummary(timings: TimingResult[]): Record<string, { avg: number; min: number; max: number; count: number }> {
  const byOperation: Record<string, number[]> = {}

  for (const t of timings) {
    if (!byOperation[t.operation]) {
      byOperation[t.operation] = []
    }
    byOperation[t.operation].push(t.durationMs)
  }

  const summary: Record<string, { avg: number; min: number; max: number; count: number }> = {}

  for (const [op, durations] of Object.entries(byOperation)) {
    summary[op] = {
      avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length * 100) / 100,
      min: Math.min(...durations),
      max: Math.max(...durations),
      count: durations.length
    }
  }

  return summary
}
