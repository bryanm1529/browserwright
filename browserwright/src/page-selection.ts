interface ClosablePage {
  isClosed(): boolean
}

interface SelectPageOptions<T extends ClosablePage> {
  pages: T[]
  previousPage: T | null
}

export function selectPage<T extends ClosablePage>({ pages, previousPage }: SelectPageOptions<T>): T | null {
  if (previousPage && !previousPage.isClosed() && pages.includes(previousPage)) {
    return previousPage
  }

  return pages[0] ?? null
}
