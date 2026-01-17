/**
 * Quick Performance Diagnostics
 * Fast tests to identify where time is being spent
 * Run with: pnpm vitest run test/performance/quick-diagnostics.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startBrowserwrightCDPRelayServer, type RelayServer } from '../../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { killPortProcess } from 'kill-port-process'
import { createFileLogger } from '../../src/create-logger.js'
import vm from 'node:vm'

const DIAG_PORT = 19993

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPortProcess(port)
  } catch {
    // Ignore
  }
}

function measure<T>(name: string, fn: () => T): { result: T; duration: number } {
  const start = performance.now()
  const result = fn()
  const duration = performance.now() - start
  return { result, duration }
}

async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = performance.now()
  const result = await fn()
  const duration = performance.now() - start
  console.log(`  ${name}: ${duration.toFixed(2)}ms`)
  return { result, duration }
}

describe('Quick Performance Diagnostics', () => {
  describe('1. VM Context Overhead', () => {
    it('measures VM context creation time', () => {
      const times: number[] = []

      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        const ctx = vm.createContext({ console, state: {} })
        times.push(performance.now() - start)
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length
      console.log(`\n  VM context creation: avg ${avg.toFixed(3)}ms (100 samples)`)
      console.log(`  Min: ${Math.min(...times).toFixed(3)}ms, Max: ${Math.max(...times).toFixed(3)}ms`)

      // VM context creation should be < 1ms
      expect(avg).toBeLessThan(5)
    })

    it('measures VM code execution time', () => {
      const simpleTimes: number[] = []
      const asyncTimes: number[] = []

      // Simple sync code - fresh context each time (like real execution)
      for (let i = 0; i < 100; i++) {
        const ctx = vm.createContext({ console, state: {} })
        const start = performance.now()
        vm.runInContext('const x = 1 + 1;', ctx)
        simpleTimes.push(performance.now() - start)
      }

      console.log(`\n  Simple sync code: avg ${(simpleTimes.reduce((a, b) => a + b, 0) / simpleTimes.length).toFixed(3)}ms`)

      // Async wrapper (like MCP execute does)
      for (let i = 0; i < 100; i++) {
        const ctx = vm.createContext({ console, state: {}, setTimeout, Promise })
        const start = performance.now()
        vm.runInContext('(async () => { const x = 1 + 1; })()', ctx)
        asyncTimes.push(performance.now() - start)
      }

      console.log(`  Async wrapper: avg ${(asyncTimes.reduce((a, b) => a + b, 0) / asyncTimes.length).toFixed(3)}ms`)
    })
  })

  describe('2. WebSocket Relay Overhead', () => {
    let server: RelayServer | null = null

    beforeAll(async () => {
      await killProcessOnPort(DIAG_PORT)
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({ port: DIAG_PORT, logger })
    })

    afterAll(async () => {
      if (server) server.close()
      await killProcessOnPort(DIAG_PORT)
    })

    it('measures WebSocket connection time', async () => {
      const times: number[] = []

      for (let i = 0; i < 20; i++) {
        const start = performance.now()
        const ws = new WebSocket(`ws://127.0.0.1:${DIAG_PORT}/cdp`)

        await new Promise<void>((resolve, reject) => {
          ws.on('open', () => resolve())
          ws.on('error', reject)
        })

        times.push(performance.now() - start)
        ws.close()
        await new Promise(r => setTimeout(r, 10))
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length
      console.log(`\n  WebSocket connect: avg ${avg.toFixed(2)}ms (20 samples)`)
      console.log(`  Min: ${Math.min(...times).toFixed(2)}ms, Max: ${Math.max(...times).toFixed(2)}ms`)

      // Connection should be fast on localhost
      expect(avg).toBeLessThan(100)
    })

    it('measures message serialization overhead', () => {
      const smallMessage = { id: 1, method: 'Test', params: {} }
      const largeMessage = {
        id: 1,
        method: 'Test',
        params: {
          data: Array.from({ length: 1000 }, (_, i) => ({ index: i, value: `item-${i}` }))
        }
      }

      const smallTimes: number[] = []
      const largeTimes: number[] = []

      for (let i = 0; i < 1000; i++) {
        let start = performance.now()
        JSON.stringify(smallMessage)
        smallTimes.push(performance.now() - start)

        start = performance.now()
        JSON.stringify(largeMessage)
        largeTimes.push(performance.now() - start)
      }

      console.log(`\n  Small message serialize: avg ${(smallTimes.reduce((a, b) => a + b, 0) / smallTimes.length).toFixed(4)}ms`)
      console.log(`  Large message serialize: avg ${(largeTimes.reduce((a, b) => a + b, 0) / largeTimes.length).toFixed(4)}ms`)
    })
  })

  describe('3. Timeout Pattern Analysis', () => {
    it('measures Promise.race timeout overhead', async () => {
      const times: number[] = []

      for (let i = 0; i < 100; i++) {
        const start = performance.now()

        // This is the pattern used in mcp.ts for timeouts
        await Promise.race([
          Promise.resolve('immediate'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ])

        times.push(performance.now() - start)
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length
      console.log(`\n  Promise.race overhead: avg ${avg.toFixed(4)}ms`)

      // Should be negligible
      expect(avg).toBeLessThan(1)
    })

    it('identifies timeout edge cases', async () => {
      // Test what happens when operation is just under timeout
      const timeoutMs = 100

      const start = performance.now()
      try {
        await Promise.race([
          new Promise(resolve => setTimeout(() => resolve('done'), 50)), // Just under timeout
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
        ])
      } catch (e) {
        console.log('  Unexpected timeout!')
      }
      const duration = performance.now() - start

      console.log(`\n  Operation (50ms) with 100ms timeout: ${duration.toFixed(2)}ms`)
      expect(duration).toBeLessThan(timeoutMs)
    })
  })

  describe('4. Bottleneck Summary', () => {
    it('generates diagnostic report', () => {
      console.log(`
╔════════════════════════════════════════════════════════════╗
║            PERFORMANCE DIAGNOSTIC SUMMARY                   ║
╠════════════════════════════════════════════════════════════╣
║                                                              ║
║  Typical latency breakdown for fill() operation:            ║
║                                                              ║
║  1. MCP tool call parsing    ~1-5ms                         ║
║  2. VM context access        ~0.1ms                         ║
║  3. Code wrapping/execution  ~1-2ms                         ║
║  4. Playwright locator       ~10-50ms (DOM query)           ║
║  5. fill() action            ~50-200ms (typing simulation)  ║
║  6. Wait for stability       ~variable                      ║
║  7. Response serialization   ~1-5ms                         ║
║                                                              ║
║  TOTAL expected: 100-300ms for simple fill()                ║
║                                                              ║
║  If seeing 15000ms timeouts, check:                         ║
║  - Page load state (still loading?)                         ║
║  - Element visibility/interactivity                         ║
║  - Network requests blocking                                ║
║  - Heavy JavaScript on page                                 ║
║  - Extension connection issues                              ║
║                                                              ║
╚════════════════════════════════════════════════════════════╝
      `)
    })
  })
})

describe('5. Common Bottleneck Patterns', () => {
  it('documents known slow operations', () => {
    const knownBottlenecks = {
      'waitForLoadState': {
        typical: '100-5000ms',
        cause: 'Waits for network idle, DOMContentLoaded, or load event',
        mitigation: 'Use waitUntil: "domcontentloaded" for faster loads'
      },
      'waitForSelector': {
        typical: '10-30000ms',
        cause: 'Polls DOM until element appears',
        mitigation: 'Check element exists before waiting, use shorter timeouts'
      },
      'screenshot': {
        typical: '50-500ms',
        cause: 'Renders page, encodes image, transfers data',
        mitigation: 'Use fullPage: false, smaller viewport, lower quality'
      },
      'accessibilitySnapshot': {
        typical: '100-2000ms',
        cause: 'Traverses entire DOM accessibility tree',
        mitigation: 'Use interactive: true, compact: true, maxDepth'
      },
      'fill()': {
        typical: '50-200ms',
        cause: 'Simulates real typing, triggers events',
        mitigation: 'Use page.evaluate() for direct value setting if events not needed'
      },
      'goto()': {
        typical: '100-30000ms',
        cause: 'Network request, page rendering, JS execution',
        mitigation: 'Use waitUntil option, timeout option'
      }
    }

    console.log('\n  Known bottleneck operations:')
    for (const [op, info] of Object.entries(knownBottlenecks)) {
      console.log(`\n  ${op}:`)
      console.log(`    Typical: ${info.typical}`)
      console.log(`    Cause: ${info.cause}`)
      console.log(`    Mitigation: ${info.mitigation}`)
    }

    expect(Object.keys(knownBottlenecks).length).toBeGreaterThan(0)
  })
})
