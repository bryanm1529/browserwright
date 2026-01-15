import { describe, it, expect } from 'vitest'
import { filterSnapshot, INTERACTIVE_ROLES, getFilterStats } from '../src/snapshot-filter'
import { RefRegistry, addShortRefPrefix } from '../src/ref-registry'

// Sample snapshot from Hacker News
const sampleSnapshot = `Return value:
- table [ref=e3]:
  - rowgroup [ref=e4]:
    - row "Hacker News" [ref=e5]:
      - cell "Hacker News" [ref=e6]:
        - link "Hacker News" [ref=e16] [cursor=pointer]:
          - /url: news
        - link "new" [ref=e17] [cursor=pointer]:
          - /url: newest
        - text: "|"
        - link "past" [ref=e18] [cursor=pointer]:
          - /url: front
        - button "Submit" [ref=e19] [cursor=pointer]:
          - /url: submit
        - textbox "Search" [ref=e20]:
        - checkbox "Remember me" [ref=e21]:`

describe('RefRegistry', () => {
  it('resolves short refs in code', () => {
    const code = `await page.locator('@e5').click()`
    const resolved = RefRegistry.resolveShortRefs(code)
    expect(resolved).toBe(`await page.locator('aria-ref=e5').click()`)
  })

  it('handles double quotes', () => {
    const code = `await page.locator("@e16").fill("test")`
    const resolved = RefRegistry.resolveShortRefs(code)
    expect(resolved).toBe(`await page.locator("aria-ref=e16").fill("test")`)
  })

  it('handles template literals', () => {
    const code = 'await page.locator(`@e3`).click()'
    const resolved = RefRegistry.resolveShortRefs(code)
    expect(resolved).toBe('await page.locator(`aria-ref=e3`).click()')
  })

  it('hasShortRefs detects patterns', () => {
    expect(RefRegistry.hasShortRefs('@e5')).toBe(true)
    expect(RefRegistry.hasShortRefs('aria-ref=e5')).toBe(false)
    expect(RefRegistry.hasShortRefs('click @e16 button')).toBe(true)
  })

  it('extractRefs finds all refs', () => {
    const code = 'click @e5 then @e16 and @e5 again'
    const refs = RefRegistry.extractRefs(code)
    expect(refs).toEqual(['e5', 'e16']) // Unique refs only
  })
})

describe('addShortRefPrefix', () => {
  it('adds @ prefix to refs', () => {
    const snapshot = '- link "Home" [ref=e5] [cursor=pointer]:'
    const result = addShortRefPrefix(snapshot)
    expect(result).toBe('- link "Home" [ref=@e5] [cursor=pointer]:')
  })

  it('handles multiple refs', () => {
    const snapshot = `- link "A" [ref=e1]:
- button "B" [ref=e2]:
- textbox "C" [ref=e3]:`
    const result = addShortRefPrefix(snapshot)
    expect(result).toContain('[ref=@e1]')
    expect(result).toContain('[ref=@e2]')
    expect(result).toContain('[ref=@e3]')
  })
})

describe('filterSnapshot', () => {
  it('filters to interactive elements only', () => {
    const filtered = filterSnapshot(sampleSnapshot, { interactive: true })
    const lines = filtered.split('\n')

    // Should only contain interactive roles
    lines.forEach(line => {
      if (line.trim().startsWith('-')) {
        const role = line.match(/^\s*-\s+(\w+)/)?.[1]
        if (role) {
          expect(INTERACTIVE_ROLES.has(role)).toBe(true)
        }
      }
    })

    // Should include link, button, textbox, checkbox
    expect(filtered).toContain('link')
    expect(filtered).toContain('button')
    expect(filtered).toContain('textbox')
    expect(filtered).toContain('checkbox')

    // Should NOT include non-interactive roles
    expect(filtered).not.toContain('- table')
    expect(filtered).not.toContain('- rowgroup')
    expect(filtered).not.toContain('- row')
    expect(filtered).not.toContain('- cell')
  })

  it('converts to compact format', () => {
    const filtered = filterSnapshot(sampleSnapshot, { compact: true, interactive: true })
    const lines = filtered.split('\n')

    // Compact format: "@e16 link Hacker News"
    expect(lines.some(l => l.match(/@e\d+ \w+/))).toBe(true)

    // Should not have YAML-style indentation
    expect(lines.every(l => !l.startsWith('  '))).toBe(true)
  })

  it('limits depth', () => {
    const filtered = filterSnapshot(sampleSnapshot, { maxDepth: 2 })
    const lines = filtered.split('\n')

    // Check all lines have reasonable indentation
    lines.forEach(line => {
      const match = line.match(/^(\s*)/)
      const indent = match ? match[1].length : 0
      expect(indent).toBeLessThanOrEqual(4) // 2 levels * 2 spaces
    })
  })

  it('achieves significant token reduction', () => {
    const filtered = filterSnapshot(sampleSnapshot, { interactive: true, compact: true })
    const stats = getFilterStats(sampleSnapshot, filtered)

    // Should achieve at least 50% reduction
    expect(stats.reductionPercent).toBeGreaterThanOrEqual(50)
  })
})
