import { describe, it, expect } from 'vitest'
import { classifyError, SKIP_SNAPSHOT_CATEGORIES, toError } from '../../src/error-classification.js'

function makeError(message: string, name = 'Error'): Error {
  const err = new Error(message)
  err.name = name
  return err
}

describe('classifyError', () => {
  describe('timeout', () => {
    it('classifies generic timeout', () => {
      expect(classifyError(makeError('Timeout 5000ms exceeded'))).toBe('timeout')
    })

    it('classifies TimeoutError by name', () => {
      expect(classifyError(makeError('something', 'TimeoutError'))).toBe('timeout')
    })

    it('classifies waitForEvent timeout as timeout (not selector)', () => {
      expect(classifyError(makeError('Timeout 30000ms exceeded while waiting for event "response"'))).toBe('timeout')
    })
  })

  describe('target-closed', () => {
    it('target closed', () => {
      expect(classifyError(makeError('Target closed'))).toBe('target-closed')
    })

    it('page has been closed', () => {
      expect(classifyError(makeError('page has been closed'))).toBe('target-closed')
    })

    it('context closed', () => {
      expect(classifyError(makeError('context has been closed'))).toBe('target-closed')
    })

    it('session closed', () => {
      expect(classifyError(makeError('Session closed. Most likely the page has been closed.'))).toBe('target-closed')
    })

    it('execution context destroyed', () => {
      expect(classifyError(makeError('Execution context was destroyed'))).toBe('target-closed')
    })

    it('waitForNavigation with target closed → target-closed (not navigation)', () => {
      expect(classifyError(makeError('page.waitForNavigation: Target page, context or browser has been closed'))).toBe('target-closed')
    })
  })

  describe('selector', () => {
    it('locator.click', () => {
      expect(classifyError(makeError('locator.click: element not found'))).toBe('selector')
    })

    it('strict mode violation', () => {
      expect(classifyError(makeError('strict mode violation: getByRole resolved to 3 elements'))).toBe('selector')
    })

    it('waiting for locator', () => {
      expect(classifyError(makeError('waiting for locator(\'button:has-text("Submit")\')'))).toBe('selector')
    })

    it('waiting for getByText', () => {
      expect(classifyError(makeError('waiting for getByText("Submit")'))).toBe('selector')
    })
  })

  describe('navigation', () => {
    it('navigation failed', () => {
      expect(classifyError(makeError('page.goto: Navigation failed'))).toBe('navigation')
    })

    it('net::ERR_ errors', () => {
      expect(classifyError(makeError('net::ERR_NAME_NOT_RESOLVED'))).toBe('navigation')
    })
  })

  describe('api-misuse', () => {
    it('expected argument', () => {
      expect(classifyError(makeError('Expected 2 arguments, but got 0'))).toBe('api-misuse')
    })

    it('is not a function', () => {
      expect(classifyError(makeError('page.foo is not a function'))).toBe('api-misuse')
    })

    it('cannot read property', () => {
      expect(classifyError(makeError("Cannot read properties of undefined (reading 'click')"))).toBe('api-misuse')
    })

    it('TypeError by name', () => {
      expect(classifyError(makeError('bad call', 'TypeError'))).toBe('api-misuse')
    })

    it('ReferenceError by name', () => {
      expect(classifyError(makeError('missingVar is not defined', 'ReferenceError'))).toBe('api-misuse')
    })

    it('SyntaxError by name', () => {
      expect(classifyError(makeError('Unexpected token )', 'SyntaxError'))).toBe('api-misuse')
    })
  })

  describe('sandbox', () => {
    it('not allowed', () => {
      expect(classifyError(makeError('Module child_process is not allowed in sandbox'))).toBe('sandbox')
    })

    it('blocked', () => {
      expect(classifyError(makeError('Access to fs is blocked'))).toBe('sandbox')
    })

    it('permission denied', () => {
      expect(classifyError(makeError('Permission denied'))).toBe('sandbox')
    })
  })

  describe('connection', () => {
    it('ECONNREFUSED', () => {
      expect(classifyError(makeError('connect ECONNREFUSED 127.0.0.1:19988'))).toBe('connection')
    })

    it('ECONNRESET', () => {
      expect(classifyError(makeError('read ECONNRESET'))).toBe('connection')
    })

    it('no heartbeat', () => {
      expect(classifyError(makeError('no heartbeat received'))).toBe('connection')
    })

    it('stale connection', () => {
      expect(classifyError(makeError('stale CDP session'))).toBe('connection')
    })

    it('WebSocket closed', () => {
      expect(classifyError(makeError('WebSocket is not open: readyState 3 (CLOSED)'))).toBe('connection')
    })

    it('disconnected', () => {
      expect(classifyError(makeError('Browser has been disconnected'))).toBe('connection')
    })
  })

  describe('unknown', () => {
    it('unrecognized error', () => {
      expect(classifyError(makeError('some completely unknown error'))).toBe('unknown')
    })
  })

  describe('overlap / priority', () => {
    it('navigation timeout → navigation (not timeout)', () => {
      expect(classifyError(makeError('Navigation timeout of 30000ms exceeded'))).toBe('navigation')
    })

    it('page closed with timeout in message → target-closed (not timeout)', () => {
      expect(classifyError(makeError('page has been closed, timeout waiting'))).toBe('target-closed')
    })

    it('locator timeout → selector (not timeout)', () => {
      expect(classifyError(makeError('locator.click: Timeout 5000ms exceeded'))).toBe('selector')
    })

    it('ERR_CONNECTION_REFUSED via navigation → navigation', () => {
      expect(classifyError(makeError('net::ERR_CONNECTION_REFUSED at http://localhost:3000'))).toBe('navigation')
    })
  })

  describe('SKIP_SNAPSHOT_CATEGORIES', () => {
    it('includes sandbox, api-misuse, connection, target-closed', () => {
      expect(SKIP_SNAPSHOT_CATEGORIES.has('sandbox')).toBe(true)
      expect(SKIP_SNAPSHOT_CATEGORIES.has('api-misuse')).toBe(true)
      expect(SKIP_SNAPSHOT_CATEGORIES.has('connection')).toBe(true)
      expect(SKIP_SNAPSHOT_CATEGORIES.has('target-closed')).toBe(true)
    })

    it('excludes timeout, selector, navigation', () => {
      expect(SKIP_SNAPSHOT_CATEGORIES.has('timeout')).toBe(false)
      expect(SKIP_SNAPSHOT_CATEGORIES.has('selector')).toBe(false)
      expect(SKIP_SNAPSHOT_CATEGORIES.has('navigation')).toBe(false)
    })
  })
})

describe('toError', () => {
  it('passes through Error instances', () => {
    const err = new Error('test')
    expect(toError(err)).toBe(err)
  })

  it('wraps string throws', () => {
    const err = toError('oops')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('oops')
  })

  it('wraps number throws', () => {
    const err = toError(42)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('42')
  })

  it('wraps null throws', () => {
    const err = toError(null)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('null')
  })

  it('wraps undefined throws', () => {
    const err = toError(undefined)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('undefined')
  })

  it('wraps error-like objects', () => {
    const err = toError({ message: 'bad', name: 'CustomError' })
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('bad')
    expect(err.name).toBe('CustomError')
  })

  it('wraps plain objects', () => {
    const err = toError({ foo: 'bar' })
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('[object Object]')
  })
})
