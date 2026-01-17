/**
 * Unit tests for extension ID validation
 */

import { describe, it, expect } from 'vitest'
import {
  EXTENSION_IDS,
  PRODUCTION_EXTENSION_ID,
  DEV_EXTENSION_IDS,
  isOurExtension
} from '../../src/extension-ids.js'

describe('Extension ID Validation', () => {
  describe('EXTENSION_IDS array', () => {
    it('should include the production extension ID', () => {
      expect(EXTENSION_IDS).toContain(PRODUCTION_EXTENSION_ID)
    })

    it('should include all development extension IDs', () => {
      DEV_EXTENSION_IDS.forEach(id => {
        expect(EXTENSION_IDS).toContain(id)
      })
    })

    it('should have unique IDs (no duplicates)', () => {
      const uniqueIds = new Set(EXTENSION_IDS)
      expect(uniqueIds.size).toBe(EXTENSION_IDS.length)
    })

    it('should only contain valid Chrome extension ID format', () => {
      // Chrome extension IDs are 32 lowercase letters
      const chromeExtensionIdPattern = /^[a-p]{32}$/

      EXTENSION_IDS.forEach(id => {
        expect(id).toMatch(chromeExtensionIdPattern)
      })
    })
  })

  describe('PRODUCTION_EXTENSION_ID', () => {
    it('should be a valid Chrome extension ID format', () => {
      expect(PRODUCTION_EXTENSION_ID).toMatch(/^[a-p]{32}$/)
    })

    it('should be the known production ID', () => {
      expect(PRODUCTION_EXTENSION_ID).toBe('jfeammnjpkecdekppnclgkkffahnhfhe')
    })
  })

  describe('isOurExtension()', () => {
    it('should return true for production extension ID', () => {
      expect(isOurExtension(PRODUCTION_EXTENSION_ID)).toBe(true)
    })

    it('should return true for all known development IDs', () => {
      DEV_EXTENSION_IDS.forEach(id => {
        expect(isOurExtension(id)).toBe(true)
      })
    })

    it('should return false for unknown extension ID', () => {
      expect(isOurExtension('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isOurExtension('')).toBe(false)
    })

    it('should return false for malformed ID (wrong length)', () => {
      expect(isOurExtension('abc')).toBe(false)
      expect(isOurExtension('abcdefghijklmnopqrstuvwxyzabcdefghij')).toBe(false)
    })

    it('should be case-sensitive', () => {
      const upperCaseId = PRODUCTION_EXTENSION_ID.toUpperCase()
      expect(isOurExtension(upperCaseId)).toBe(false)
    })
  })

  describe('URL-based extension ID extraction', () => {
    // This tests the pattern used in cdp-relay.ts for extracting extension IDs from URLs

    function extractExtensionId(url: string): string | null {
      if (!url.startsWith('chrome-extension://')) {
        return null
      }
      return url.replace('chrome-extension://', '').split('/')[0]
    }

    it('should extract extension ID from chrome-extension:// URL', () => {
      const url = 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe/popup.html'
      expect(extractExtensionId(url)).toBe('jfeammnjpkecdekppnclgkkffahnhfhe')
    })

    it('should extract extension ID from URL without path', () => {
      const url = 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe'
      expect(extractExtensionId(url)).toBe('jfeammnjpkecdekppnclgkkffahnhfhe')
    })

    it('should return null for non-extension URLs', () => {
      expect(extractExtensionId('https://example.com')).toBeNull()
      expect(extractExtensionId('http://localhost:3000')).toBeNull()
      expect(extractExtensionId('file:///path/to/file')).toBeNull()
    })

    it('should handle URL with query parameters', () => {
      const url = 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe/page.html?foo=bar'
      expect(extractExtensionId(url)).toBe('jfeammnjpkecdekppnclgkkffahnhfhe')
    })

    it('extracted ID should validate correctly', () => {
      const url = `chrome-extension://${PRODUCTION_EXTENSION_ID}/popup.html`
      const extractedId = extractExtensionId(url)
      expect(extractedId).not.toBeNull()
      expect(isOurExtension(extractedId!)).toBe(true)
    })
  })

  describe('Origin-based extension ID validation', () => {
    // This tests the pattern used in cdp-relay.ts for validating WebSocket origins

    function validateExtensionOrigin(origin: string | undefined): { valid: boolean; extensionId?: string } {
      if (!origin || !origin.startsWith('chrome-extension://')) {
        return { valid: false }
      }

      const extensionId = origin.replace('chrome-extension://', '')
      if (!isOurExtension(extensionId)) {
        return { valid: false, extensionId }
      }

      return { valid: true, extensionId }
    }

    it('should validate correct extension origin', () => {
      const result = validateExtensionOrigin(`chrome-extension://${PRODUCTION_EXTENSION_ID}`)
      expect(result.valid).toBe(true)
      expect(result.extensionId).toBe(PRODUCTION_EXTENSION_ID)
    })

    it('should reject unknown extension origin', () => {
      const result = validateExtensionOrigin('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      expect(result.valid).toBe(false)
      expect(result.extensionId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    })

    it('should reject non-extension origins', () => {
      expect(validateExtensionOrigin('https://evil.com').valid).toBe(false)
      expect(validateExtensionOrigin('http://localhost:3000').valid).toBe(false)
    })

    it('should reject undefined origin', () => {
      expect(validateExtensionOrigin(undefined).valid).toBe(false)
    })

    it('should reject empty origin', () => {
      expect(validateExtensionOrigin('').valid).toBe(false)
    })
  })
})
