import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

export function getCdpUrl({ port = 19988, host = '127.0.0.1', token }: { port?: number; host?: string; token?: string } = {}) {
  // Use cryptographically secure random UUID instead of Math.random()
  const id = `${crypto.randomUUID()}_${Date.now()}`
  const queryString = token ? `?token=${token}` : ''
  return `ws://${host}:${port}/cdp/${id}${queryString}`
}

export const LOG_FILE_PATH = process.env.BROWSERWRIGHT_LOG_FILE_PATH || path.join(os.tmpdir(), 'browserwright', 'relay-server.log')

const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
export const VERSION = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version as string

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
