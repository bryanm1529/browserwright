/**
 * Integration tests for the CDP relay server
 * Tests WebSocket routing and basic server functionality
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { startBrowserwrightCDPRelayServer, type RelayServer } from '../../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { killPortProcess } from 'kill-port-process'
import { createFileLogger } from '../../src/create-logger.js'

const TEST_PORT = 19998

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPortProcess(port)
  } catch {
    // Ignore if no process is running
  }
}

async function waitForConnection(ws: WebSocket, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection timeout')), timeout)

    ws.on('open', () => {
      clearTimeout(timer)
      resolve()
    })

    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

describe('Relay Server', () => {
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

  describe('Server Startup', () => {
    it('should start and be accessible on specified port', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      expect(server).toBeDefined()
      // Verify server is running by checking the status endpoint
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/extension/status`)
      expect(response.ok).toBe(true)
    })

    it('should accept connections after startup', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Server should be ready immediately after await
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      await waitForConnection(ws)
      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })
  })

  describe('WebSocket Endpoints', () => {
    it('should accept connections on /cdp endpoint without token', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
        // No token = no auth required
      })

      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      await waitForConnection(ws)

      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })

    it('should require token when configured', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        token: 'secret-token',
        logger
      })

      // Without token - should fail
      const wsNoToken = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      await expect(
        waitForConnection(wsNoToken)
      ).rejects.toThrow()

      // With correct token - should succeed
      const wsWithToken = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/cdp?token=secret-token`)
      await waitForConnection(wsWithToken)

      expect(wsWithToken.readyState).toBe(WebSocket.OPEN)
      wsWithToken.close()
    })

    it('should reject /cdp connection with wrong token', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        token: 'secret-token',
        logger
      })

      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/cdp?token=wrong-token`)

      await expect(waitForConnection(ws)).rejects.toThrow()
    })
  })

  describe('Extension Endpoint Security', () => {
    it('should reject /extension without chrome-extension origin', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // No origin header
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/extension`)

      await expect(waitForConnection(ws)).rejects.toThrow()
    })

    it('should reject /extension with non-whitelisted extension', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
      })

      await expect(waitForConnection(ws)).rejects.toThrow()
    })

    it('should accept /extension with whitelisted extension', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Use the production extension ID which should be whitelisted
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe' }
      })

      await waitForConnection(ws)
      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })
  })

  describe('HTTP Status Endpoint', () => {
    it('should respond to /extension/status endpoint', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/extension/status`)
      expect(response.ok).toBe(true)

      const status = await response.json()
      expect(status).toHaveProperty('connected')
    })
  })

  describe('Server Cleanup', () => {
    it('should close all connections on server.close()', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      await waitForConnection(ws)

      expect(ws.readyState).toBe(WebSocket.OPEN)

      server.close()

      // Wait for close
      await new Promise<void>((resolve) => {
        ws.on('close', () => resolve())
        setTimeout(resolve, 1000) // Fallback timeout
      })

      expect(ws.readyState).not.toBe(WebSocket.OPEN)
      server = null
    })
  })
})
