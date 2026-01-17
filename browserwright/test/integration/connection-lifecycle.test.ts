/**
 * Integration tests for connection lifecycle management
 * Tests connect, disconnect, reconnect scenarios
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { startBrowserwrightCDPRelayServer, type RelayServer } from '../../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { killPortProcess } from 'kill-port-process'
import { createFileLogger } from '../../src/create-logger.js'

const TEST_PORT = 19997

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPortProcess(port)
  } catch {
    // Ignore
  }
}

function createWebSocketPromise(url: string, options?: { headers?: Record<string, string> }): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('Connection timeout'))
    }, 5000)

    ws.on('open', () => {
      clearTimeout(timeout)
      resolve(ws)
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

describe('Connection Lifecycle', () => {
  let server: RelayServer | null = null

  beforeAll(async () => {
    await killProcessOnPort(TEST_PORT)
  })

  afterEach(async () => {
    if (server) {
      server.close()
      server = null
    }
    await killProcessOnPort(TEST_PORT)
  })

  afterAll(async () => {
    await killProcessOnPort(TEST_PORT)
  })

  describe('Playwright Client Lifecycle', () => {
    it('should accept and maintain client connections', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Connect a client
      const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      expect(ws.readyState).toBe(WebSocket.OPEN)

      // Wait a bit and verify connection is still alive
      await new Promise(r => setTimeout(r, 100))
      expect(ws.readyState).toBe(WebSocket.OPEN)

      // Disconnect
      ws.close()
      await new Promise(r => setTimeout(r, 100))

      // Can connect again
      const ws2 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      expect(ws2.readyState).toBe(WebSocket.OPEN)
      ws2.close()
    })

    it('should handle client disconnect gracefully', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Send a message before disconnect
      ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }))

      // Abrupt close
      ws.close(1000, 'Test close')

      // Server should still be functional
      await new Promise(r => setTimeout(r, 100))

      const ws2 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      expect(ws2.readyState).toBe(WebSocket.OPEN)
      ws2.close()
    })

    it('should handle rapid connect/disconnect cycles', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      for (let i = 0; i < 5; i++) {
        const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
        expect(ws.readyState).toBe(WebSocket.OPEN)
        ws.close()
        await new Promise(r => setTimeout(r, 50))
      }

      // Final check - server still works
      const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })
  })

  describe('Extension Connection Lifecycle', () => {
    const EXTENSION_ORIGIN = 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe'

    it('should track extension connection status via status endpoint', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Initially not connected
      const status1 = await (await fetch(`http://127.0.0.1:${TEST_PORT}/extension/status`)).json()
      expect(status1.connected).toBe(false)

      // Connect extension
      const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      // Need more time for connection to register
      await new Promise(r => setTimeout(r, 200))

      const status2 = await (await fetch(`http://127.0.0.1:${TEST_PORT}/extension/status`)).json()
      expect(status2.connected).toBe(true)

      // Disconnect
      ws.close()
      await new Promise(r => setTimeout(r, 200))

      const status3 = await (await fetch(`http://127.0.0.1:${TEST_PORT}/extension/status`)).json()
      expect(status3.connected).toBe(false)
    })

    it('should replace existing extension connection', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // First connection
      const ws1 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      let ws1Closed = false
      ws1.on('close', () => { ws1Closed = true })

      // Second connection should replace first
      const ws2 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      // Wait for first to be closed
      await new Promise(r => setTimeout(r, 200))

      expect(ws1Closed).toBe(true)
      expect(ws2.readyState).toBe(WebSocket.OPEN)

      ws2.close()
    })
  })

  describe('Reconnection Scenarios', () => {
    it('should allow new connection after server-side disconnect', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const ws1 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      ws1.close(1000, 'Intentional close')

      await new Promise(r => setTimeout(r, 100))

      // New connection should work
      const ws2 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      expect(ws2.readyState).toBe(WebSocket.OPEN)
      ws2.close()
    })

    it('should handle reconnect after unexpected disconnect', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const ws1 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Simulate unexpected disconnect
      ws1.terminate()

      await new Promise(r => setTimeout(r, 100))

      // Reconnect should work
      const ws2 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      expect(ws2.readyState).toBe(WebSocket.OPEN)
      ws2.close()
    })
  })
})
