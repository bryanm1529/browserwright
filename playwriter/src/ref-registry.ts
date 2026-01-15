/**
 * RefRegistry - Manages short reference aliases (@e1, @e2) for aria-refs
 *
 * This provides a cleaner syntax for element references:
 * - Instead of: page.locator('aria-ref=e16')
 * - Use: page.locator('@e16')
 *
 * The registry maintains a bidirectional mapping and can transform code
 * containing @eN patterns into their aria-ref equivalents.
 */

export class RefRegistry {
  /**
   * Transform code containing @eN patterns to aria-ref=eN patterns
   *
   * @example
   * // Input:  "await page.locator('@e5').click()"
   * // Output: "await page.locator('aria-ref=e5').click()"
   */
  static resolveShortRefs(code: string): string {
    // Match @eN patterns (e.g., @e1, @e5, @e123)
    // Handle various contexts: '@e5', "@e5", `@e5`, @e5 (without quotes)
    return code.replace(
      /(['"`])@(e\d+)\1/g,
      (_, quote, ref) => `${quote}aria-ref=${ref}${quote}`
    )
  }

  /**
   * Check if code contains any @eN short ref patterns
   */
  static hasShortRefs(code: string): boolean {
    return /@e\d+/.test(code)
  }

  /**
   * Extract all short refs from code
   *
   * @returns Array of refs like ['e5', 'e16', 'e23']
   */
  static extractRefs(code: string): string[] {
    const matches = code.match(/@e\d+/g)
    if (!matches) return []
    return [...new Set(matches.map(m => m.slice(1)))] // Remove @ prefix
  }
}

/**
 * Transform snapshot output to use @eN format for easier reference
 *
 * @example
 * // Input:  "- link \"Home\" [ref=e5] [cursor=pointer]:"
 * // Output: "- link \"Home\" [ref=@e5] [cursor=pointer]:"
 */
export function addShortRefPrefix(snapshot: string): string {
  return snapshot.replace(/\[ref=(e\d+)\]/g, '[ref=@$1]')
}
