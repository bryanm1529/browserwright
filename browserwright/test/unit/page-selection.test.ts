import { describe, expect, it } from 'vitest'
import { selectPage } from '../../src/page-selection.js'

interface MockPage {
  id: string
  isClosed(): boolean
}

function createPage({ id, closed = false }: { id: string; closed?: boolean }): MockPage {
  return {
    id,
    isClosed() {
      return closed
    },
  }
}

describe('selectPage', () => {
  it('returns null when no pages exist', () => {
    expect(selectPage<MockPage>({ pages: [], previousPage: null })).toBeNull()
  })

  it('prefers the previous page when it is still open and present', () => {
    const pageA = createPage({ id: 'a' })
    const pageB = createPage({ id: 'b' })

    expect(selectPage({ pages: [pageA, pageB], previousPage: pageB })).toBe(pageB)
  })

  it('falls back to the first page when the previous page is missing', () => {
    const pageA = createPage({ id: 'a' })
    const pageB = createPage({ id: 'b' })
    const previousPage = createPage({ id: 'old' })

    expect(selectPage({ pages: [pageA, pageB], previousPage })).toBe(pageA)
  })

  it('falls back to the first page when the previous page is closed', () => {
    const pageA = createPage({ id: 'a' })
    const previousPage = createPage({ id: 'old', closed: true })

    expect(selectPage({ pages: [pageA], previousPage })).toBe(pageA)
  })
})
