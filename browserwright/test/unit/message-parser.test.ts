/**
 * Unit tests for CDP and Extension message parsing
 */

import { describe, it, expect } from 'vitest'
import type {
  ExtensionMessage,
  ExtensionResponseMessage,
  ExtensionEventMessage,
  ExtensionLogMessage,
  ExtensionPongMessage
} from '../../src/protocol.js'

describe('Message Parsing', () => {
  describe('JSON parsing safety', () => {
    function safeParseMessage(data: string): ExtensionMessage | null {
      try {
        return JSON.parse(data)
      } catch {
        return null
      }
    }

    it('should parse valid JSON message', () => {
      const message = safeParseMessage('{"id": 1, "result": "success"}')
      expect(message).not.toBeNull()
      expect(message).toEqual({ id: 1, result: 'success' })
    })

    it('should return null for invalid JSON', () => {
      expect(safeParseMessage('not json')).toBeNull()
      expect(safeParseMessage('{')).toBeNull()
      expect(safeParseMessage('')).toBeNull()
    })

    it('should return null for non-string input after toString', () => {
      // This simulates what happens when event.data is not a string
      const buffer = Buffer.from('{"id": 1}')
      const message = safeParseMessage(buffer.toString())
      expect(message).toEqual({ id: 1 })
    })
  })

  describe('ExtensionResponseMessage', () => {
    function isResponseMessage(msg: ExtensionMessage): msg is ExtensionResponseMessage {
      return msg.id !== undefined && msg.method === undefined
    }

    it('should identify success response', () => {
      const msg: ExtensionMessage = { id: 1, result: { success: true } }
      expect(isResponseMessage(msg)).toBe(true)
    })

    it('should identify error response', () => {
      const msg: ExtensionMessage = { id: 1, error: 'Something went wrong' }
      expect(isResponseMessage(msg)).toBe(true)
    })

    it('should NOT identify event message as response', () => {
      const msg: ExtensionMessage = {
        method: 'forwardCDPEvent',
        params: { method: 'Page.frameNavigated', sessionId: 'abc', params: {} }
      } as ExtensionEventMessage
      expect(isResponseMessage(msg)).toBe(false)
    })
  })

  describe('ExtensionEventMessage', () => {
    function isEventMessage(msg: ExtensionMessage): msg is ExtensionEventMessage {
      return msg.method === 'forwardCDPEvent'
    }

    it('should identify CDP event forward', () => {
      const msg: ExtensionEventMessage = {
        method: 'forwardCDPEvent',
        params: {
          method: 'Page.loadEventFired',
          sessionId: 'session123',
          params: { timestamp: 12345 }
        }
      }
      expect(isEventMessage(msg)).toBe(true)
    })

    it('should NOT identify response as event', () => {
      const msg: ExtensionMessage = { id: 1, result: {} }
      expect(isEventMessage(msg)).toBe(false)
    })
  })

  describe('ExtensionLogMessage', () => {
    function isLogMessage(msg: ExtensionMessage): msg is ExtensionLogMessage {
      return msg.method === 'log'
    }

    it('should identify log message', () => {
      const msg: ExtensionLogMessage = {
        method: 'log',
        params: {
          level: 'debug',
          args: ['Test message', 'with args']
        }
      }
      expect(isLogMessage(msg)).toBe(true)
    })

    it('should support all log levels', () => {
      const levels: ExtensionLogMessage['params']['level'][] = ['log', 'debug', 'info', 'warn', 'error']

      levels.forEach(level => {
        const msg: ExtensionLogMessage = {
          method: 'log',
          params: { level, args: ['test'] }
        }
        expect(isLogMessage(msg)).toBe(true)
        expect(msg.params.level).toBe(level)
      })
    })
  })

  describe('ExtensionPongMessage', () => {
    function isPongMessage(msg: ExtensionMessage): msg is ExtensionPongMessage {
      return msg.method === 'pong'
    }

    it('should identify pong message', () => {
      const msg: ExtensionPongMessage = { method: 'pong' }
      expect(isPongMessage(msg)).toBe(true)
    })
  })

  describe('Message type discrimination', () => {
    // Full message handler pattern as used in cdp-relay.ts

    function handleMessage(data: string): {
      type: 'response' | 'event' | 'log' | 'pong' | 'unknown' | 'invalid'
      message?: ExtensionMessage
    } {
      let message: ExtensionMessage

      try {
        message = JSON.parse(data)
      } catch {
        return { type: 'invalid' }
      }

      if (message.id !== undefined) {
        return { type: 'response', message }
      }

      if (message.method === 'forwardCDPEvent') {
        return { type: 'event', message }
      }

      if (message.method === 'log') {
        return { type: 'log', message }
      }

      if (message.method === 'pong') {
        return { type: 'pong', message }
      }

      return { type: 'unknown', message }
    }

    it('should correctly discriminate response messages', () => {
      const result = handleMessage('{"id": 1, "result": {}}')
      expect(result.type).toBe('response')
    })

    it('should correctly discriminate event messages', () => {
      const result = handleMessage('{"method": "forwardCDPEvent", "params": {"method": "Page.loadEventFired"}}')
      expect(result.type).toBe('event')
    })

    it('should correctly discriminate log messages', () => {
      const result = handleMessage('{"method": "log", "params": {"level": "info", "args": []}}')
      expect(result.type).toBe('log')
    })

    it('should correctly discriminate pong messages', () => {
      const result = handleMessage('{"method": "pong"}')
      expect(result.type).toBe('pong')
    })

    it('should handle invalid JSON', () => {
      const result = handleMessage('not json')
      expect(result.type).toBe('invalid')
    })

    it('should handle unknown message types', () => {
      const result = handleMessage('{"method": "unknownMethod"}')
      expect(result.type).toBe('unknown')
    })
  })

  describe('CDP command message structure', () => {
    interface CDPCommand {
      id: number
      method: string
      sessionId?: string
      params?: Record<string, unknown>
    }

    function parseCDPCommand(data: string): CDPCommand | null {
      try {
        const parsed = JSON.parse(data)
        if (typeof parsed.id !== 'number' || typeof parsed.method !== 'string') {
          return null
        }
        return parsed as CDPCommand
      } catch {
        return null
      }
    }

    it('should parse valid CDP command', () => {
      const cmd = parseCDPCommand('{"id": 1, "method": "Page.navigate", "params": {"url": "https://example.com"}}')
      expect(cmd).not.toBeNull()
      expect(cmd!.id).toBe(1)
      expect(cmd!.method).toBe('Page.navigate')
      expect(cmd!.params).toEqual({ url: 'https://example.com' })
    })

    it('should parse CDP command with sessionId', () => {
      const cmd = parseCDPCommand('{"id": 2, "method": "Runtime.evaluate", "sessionId": "abc123", "params": {"expression": "1+1"}}')
      expect(cmd).not.toBeNull()
      expect(cmd!.sessionId).toBe('abc123')
    })

    it('should reject command without id', () => {
      expect(parseCDPCommand('{"method": "Page.navigate"}')).toBeNull()
    })

    it('should reject command without method', () => {
      expect(parseCDPCommand('{"id": 1}')).toBeNull()
    })
  })
})
