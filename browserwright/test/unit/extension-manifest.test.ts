import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

interface ExtensionManifest {
  manifest_version: number
  minimum_chrome_version?: string
  background: {
    service_worker: string
    type?: string
  }
}

function readExtensionManifest(): ExtensionManifest {
  const manifestUrl = new URL('../../../extension/manifest.json', import.meta.url)
  const manifestJson = fs.readFileSync(manifestUrl, 'utf-8')

  return JSON.parse(manifestJson) as ExtensionManifest
}

describe('Extension Manifest', () => {
  it('requires the Chrome version Browserwright depends on for MV3 lifetime guarantees', () => {
    const manifest = readExtensionManifest()

    expect(manifest.minimum_chrome_version).toBe('118')
  })

  it('keeps the extension background on a module service worker', () => {
    const manifest = readExtensionManifest()

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.background).toEqual({
      service_worker: 'lib/background.mjs',
      type: 'module',
    })
  })
})
