import util from 'node:util'

export function toWellFormedString(value: string): string {
  if (typeof value.toWellFormed === 'function') {
    return value.toWellFormed()
  }

  return util.toUSVString(value)
}
