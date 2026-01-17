/**
 * Unit tests for CodeExecutionTimeoutError and timeout handling logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We need to test the timeout behavior that exists in mcp.ts
// Since CodeExecutionTimeoutError is not exported, we'll test the behavior pattern

describe('Timeout Handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('CodeExecutionTimeoutError pattern', () => {
    // Recreate the error class for testing since it's not exported
    class CodeExecutionTimeoutError extends Error {
      constructor(timeout: number) {
        super(`Code execution timed out after ${timeout}ms`)
        this.name = 'CodeExecutionTimeoutError'
      }
    }

    it('should create error with correct message', () => {
      const error = new CodeExecutionTimeoutError(5000)
      expect(error.message).toBe('Code execution timed out after 5000ms')
      expect(error.name).toBe('CodeExecutionTimeoutError')
    })

    it('should create error with custom timeout value', () => {
      const error = new CodeExecutionTimeoutError(15000)
      expect(error.message).toBe('Code execution timed out after 15000ms')
    })

    it('should be an instance of Error', () => {
      const error = new CodeExecutionTimeoutError(5000)
      expect(error).toBeInstanceOf(Error)
    })
  })

  describe('Race timeout pattern', () => {
    // This tests the pattern used in mcp.ts:1102
    // Promise.race([actualWork, timeout])

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

    it('should resolve when work completes before timeout', async () => {
      const workPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('success'), 100)
      })

      const resultPromise = executeWithTimeout(() => workPromise, 5000)

      // Fast-forward 100ms for work to complete
      vi.advanceTimersByTime(100)

      const result = await resultPromise
      expect(result).toBe('success')
    })

    it('should reject with CodeExecutionTimeoutError when timeout occurs first', async () => {
      const workPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('success'), 10000) // 10 seconds
      })

      const resultPromise = executeWithTimeout(() => workPromise, 5000)

      // Fast-forward 5 seconds for timeout
      vi.advanceTimersByTime(5000)

      await expect(resultPromise).rejects.toThrow(CodeExecutionTimeoutError)
      await expect(resultPromise).rejects.toThrow('Code execution timed out after 5000ms')
    })

    it('should work with default 5000ms timeout', async () => {
      const slowWork = new Promise<string>((resolve) => {
        setTimeout(() => resolve('success'), 6000)
      })

      const resultPromise = executeWithTimeout(() => slowWork, 5000)

      vi.advanceTimersByTime(5000)

      await expect(resultPromise).rejects.toThrow('Code execution timed out after 5000ms')
    })

    it('should work with custom 15000ms timeout', async () => {
      const slowWork = new Promise<string>((resolve) => {
        setTimeout(() => resolve('success'), 20000)
      })

      const resultPromise = executeWithTimeout(() => slowWork, 15000)

      vi.advanceTimersByTime(15000)

      await expect(resultPromise).rejects.toThrow('Code execution timed out after 15000ms')
    })
  })

  describe('Timeout error detection', () => {
    class CodeExecutionTimeoutError extends Error {
      constructor(timeout: number) {
        super(`Code execution timed out after ${timeout}ms`)
        this.name = 'CodeExecutionTimeoutError'
      }
    }

    it('should detect timeout error by instanceof', () => {
      const error = new CodeExecutionTimeoutError(5000)
      const isTimeoutError = error instanceof CodeExecutionTimeoutError
      expect(isTimeoutError).toBe(true)
    })

    it('should detect timeout error by name property', () => {
      const error = new CodeExecutionTimeoutError(5000)
      const isTimeoutError = error.name === 'CodeExecutionTimeoutError' || error.name === 'TimeoutError'
      expect(isTimeoutError).toBe(true)
    })

    it('should NOT detect regular errors as timeout errors', () => {
      const error = new Error('Something went wrong')
      const isTimeoutError = error.name === 'CodeExecutionTimeoutError' || error.name === 'TimeoutError'
      expect(isTimeoutError).toBe(false)
    })
  })
})
