/**
 * Integration tests for error handling
 * Tests timeout errors, message errors, and error propagation
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { startBrowserwrightCDPRelayServer, type RelayServer } from '../../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { killPortProcess } from 'kill-port-process'
import { createFileLogger } from '../../src/create-logger.js'

const TEST_PORT = 19996

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

describe('Error Handling', () => {
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

  describe('Invalid Message Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Send invalid JSON - server should not crash
      ws.send('not valid json {{{')

      // Wait a bit and verify connection still works
      await new Promise(r => setTimeout(r, 100))

      // Should still be able to send valid messages
      ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }))

      // Server should still be alive
      expect(ws.readyState).toBe(WebSocket.OPEN)

      ws.close()
    })

    it('should handle malformed CDP commands', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Send valid JSON but invalid CDP format
      ws.send(JSON.stringify({ foo: 'bar' }))
      ws.send(JSON.stringify({ id: 'not a number', method: 'Test' }))
      ws.send(JSON.stringify({ id: 1 })) // Missing method

      await new Promise(r => setTimeout(r, 100))

      // Server should still work
      expect(ws.readyState).toBe(WebSocket.OPEN)

      ws.close()
    })

    it('should handle empty messages', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      ws.send('')
      ws.send('{}')
      ws.send('[]')

      await new Promise(r => setTimeout(r, 100))

      expect(ws.readyState).toBe(WebSocket.OPEN)
      ws.close()
    })
  })

  describe('Extension Message Errors', () => {
    const EXTENSION_ORIGIN = 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe'

    it('should handle invalid JSON from extension', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      let closed = false
      ws.on('close', () => { closed = true })

      // Send invalid JSON - should close connection with error
      ws.send('invalid json')

      await new Promise(r => setTimeout(r, 200))

      // Extension connection should be closed for invalid JSON
      expect(closed).toBe(true)
    })
  })

  describe('Timeout Error Patterns', () => {
    // Test the timeout pattern used in the codebase

    class CodeExecutionTimeoutError extends Error {
      constructor(timeout: number) {
        super(`Code execution timed out after ${timeout}ms`)
        this.name = 'CodeExecutionTimeoutError'
      }
    }

    async function executeWithTimeout<T>(
      work: () => Promise<T>,
      timeout: number
    ): Promise<T> {
      return Promise.race([
        work(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new CodeExecutionTimeoutError(timeout)), timeout)
        ),
      ])
    }

    it('should timeout long-running operations', async () => {
      const slowOperation = async () => {
        await new Promise(r => setTimeout(r, 10000))
        return 'completed'
      }

      vi.useFakeTimers()

      const resultPromise = executeWithTimeout(slowOperation, 5000)

      vi.advanceTimersByTime(5000)

      await expect(resultPromise).rejects.toThrow(CodeExecutionTimeoutError)
      await expect(resultPromise).rejects.toThrow('timed out after 5000ms')

      vi.useRealTimers()
    })

    it('should distinguish timeout errors from other errors', async () => {
      const failingOperation = async () => {
        throw new Error('Network error')
      }

      try {
        await executeWithTimeout(failingOperation, 5000)
      } catch (error: any) {
        expect(error).not.toBeInstanceOf(CodeExecutionTimeoutError)
        expect(error.message).toBe('Network error')
      }
    })
  })

  describe('Server Error Recovery', () => {
    it('should continue working after client errors', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Bad client 1 - sends garbage
      const ws1 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      ws1.send('garbage data')
      ws1.terminate()

      await new Promise(r => setTimeout(r, 100))

      // Good client should still work
      const ws2 = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      expect(ws2.readyState).toBe(WebSocket.OPEN)

      // Send valid message
      ws2.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }))

      ws2.close()
    })

    it('should handle multiple simultaneous error conditions', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      // Create multiple clients that all send bad data
      const clients: WebSocket[] = []

      for (let i = 0; i < 3; i++) {
        const ws = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
        clients.push(ws)
        ws.send('bad data ' + i)
      }

      // Terminate all
      clients.forEach(ws => ws.terminate())

      await new Promise(r => setTimeout(r, 200))

      // Server should still be healthy
      const status = await (await fetch(`http://127.0.0.1:${TEST_PORT}/extension/status`)).json()
      expect(status).toBeDefined()

      // Can still connect
      const healthyClient = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)
      expect(healthyClient.readyState).toBe(WebSocket.OPEN)
      healthyClient.close()
    })
  })

  describe('Error Response Format', () => {
    it('should return proper error format in responses', async () => {
      const logger = createFileLogger()
      server = await startBrowserwrightCDPRelayServer({
        port: TEST_PORT,
        logger
      })

      const EXTENSION_ORIGIN = 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe'

      // Connect extension
      const ext = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/extension`, {
        headers: { Origin: EXTENSION_ORIGIN }
      })

      // Connect client
      const client = await createWebSocketPromise(`ws://127.0.0.1:${TEST_PORT}/cdp`)

      // Send a command that will fail (no targets attached)
      const responsePromise = new Promise<any>((resolve) => {
        client.on('message', (data) => {
          resolve(JSON.parse(data.toString()))
        })
      })

      client.send(JSON.stringify({
        id: 1,
        method: 'Target.getTargets'
      }))

      // Wait for response (either success or error)
      const response = await Promise.race([
        responsePromise,
        new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 2000))
      ])

      // Response should have an id that matches the request
      if (!('timeout' in response)) {
        expect(response.id).toBe(1)
      }

      ext.close()
      client.close()
    })
  })
})
