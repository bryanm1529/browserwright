/**
 * Performance benchmarks for latency measurement
 * Measures WebSocket connection and message round-trip times
 */

import { describe, bench, beforeAll, afterAll } from 'vitest'
import { startBrowserwrightCDPRelayServer, type RelayServer } from '../../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { killPortProcess } from 'kill-port-process'
import { createFileLogger } from '../../src/create-logger.js'
import fs from 'node:fs'
import path from 'node:path'

const PERF_PORT = 19995

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPortProcess(port)
  } catch {
    // Ignore
  }
}

interface PerformanceBaseline {
  connectionTime: {
    mean: number
    p95: number
    p99: number
  }
  messageRoundTrip: {
    mean: number
    p95: number
    p99: number
  }
  lastUpdated: string
}

function updateBaseline(name: string, times: number[]): void {
  const sorted = [...times].sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const p99 = sorted[Math.floor(sorted.length * 0.99)]

  const baselinePath = path.join(__dirname, 'baseline.json')
  let baseline: Record<string, any> = {}

  if (fs.existsSync(baselinePath)) {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'))
  }

  baseline[name] = { mean, p95, p99 }
  baseline.lastUpdated = new Date().toISOString()

  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2))
}

describe('Latency Benchmarks', () => {
  let server: RelayServer | null = null

  beforeAll(async () => {
    await killProcessOnPort(PERF_PORT)
    const logger = createFileLogger()
    server = await startBrowserwrightCDPRelayServer({
      port: PERF_PORT,
      logger
    })
  })

  afterAll(async () => {
    if (server) {
      server.close()
    }
    await killProcessOnPort(PERF_PORT)
  })

  bench('WebSocket connection establishment', async () => {
    const start = performance.now()
    const ws = new WebSocket(`ws://127.0.0.1:${PERF_PORT}/cdp`)

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })

    const elapsed = performance.now() - start
    ws.close()

    // Connection should typically be under 100ms on localhost
    if (elapsed > 100) {
      console.warn(`Slow connection: ${elapsed.toFixed(2)}ms`)
    }
  })

  bench('Message round-trip (CDP command)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PERF_PORT}/cdp`)

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })

    const start = performance.now()

    // Send a command and measure response time
    // Note: Without extension connected, this will timeout or error
    // but we're measuring the relay overhead
    ws.send(JSON.stringify({
      id: 1,
      method: 'Target.getTargets'
    }))

    // Wait for any response or a short timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 50)
      ws.once('message', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    const elapsed = performance.now() - start
    ws.close()

    // Message handling should be fast (< 50ms on localhost)
    if (elapsed > 50) {
      console.warn(`Slow message handling: ${elapsed.toFixed(2)}ms`)
    }
  })

  bench('Concurrent connection handling (10 clients)', async () => {
    const clients: WebSocket[] = []
    const start = performance.now()

    // Create 10 connections simultaneously
    const connectionPromises = Array.from({ length: 10 }, () => {
      return new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PERF_PORT}/cdp`)
        ws.on('open', () => {
          clients.push(ws)
          resolve(ws)
        })
        ws.on('error', reject)
      })
    })

    await Promise.all(connectionPromises)
    const elapsed = performance.now() - start

    // Cleanup
    clients.forEach(ws => ws.close())

    // 10 concurrent connections should complete in reasonable time
    if (elapsed > 500) {
      console.warn(`Slow concurrent connections: ${elapsed.toFixed(2)}ms for 10 clients`)
    }
  })
})

// Non-benchmark test to collect and save baseline metrics
describe('Baseline Collection', () => {
  let server: RelayServer | null = null

  beforeAll(async () => {
    await killProcessOnPort(PERF_PORT)
    const logger = createFileLogger()
    server = await startBrowserwrightCDPRelayServer({
      port: PERF_PORT,
      logger
    })
  })

  afterAll(async () => {
    if (server) {
      server.close()
    }
    await killProcessOnPort(PERF_PORT)
  })

  bench('collect baseline: connection time', async () => {
    const times: number[] = []

    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      const ws = new WebSocket(`ws://127.0.0.1:${PERF_PORT}/cdp`)

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve())
        ws.on('error', reject)
      })

      times.push(performance.now() - start)
      ws.close()
      await new Promise(r => setTimeout(r, 10))
    }

    updateBaseline('connectionTime', times)
  }, { iterations: 1 })
})
