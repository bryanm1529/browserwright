/**
 * Browser launcher for "just works" mode
 * Spawns Chrome with debugging enabled and persistent profile
 *
 * Supports multiple MCP sessions by:
 * 1. Launching Chrome with a debugging port
 * 2. Subsequent sessions connect to the existing browser via CDP
 *
 * Based on best practices from:
 * - Microsoft Playwright MCP: https://github.com/microsoft/playwright-mcp
 * - BrowserStack Guide: https://www.browserstack.com/guide/playwright-persistent-context
 * - Playwright Issue #19742: https://github.com/microsoft/playwright/issues/19742
 */

import { chromium, BrowserContext, Browser, devices } from 'playwright-core'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// Default debugging port for multi-session support
const DEFAULT_DEBUG_PORT = 9222

export type BrowserChannel = 'chrome' | 'chrome-beta' | 'chrome-dev' | 'chrome-canary' | 'msedge' | 'msedge-beta' | 'msedge-dev'

export interface LaunchOptions {
  /** Run browser in headless mode (default: false - headed) */
  headless?: boolean
  /** Custom user data directory for persistent profile */
  userDataDir?: string
  /** Browser channel (default: 'chrome') */
  channel?: BrowserChannel
  /** Viewport size (default: 1280x720) */
  viewport?: { width: number; height: number }
  /** Device to emulate (e.g., 'iPhone 15', 'Pixel 7') */
  device?: string
  /** Run in isolated mode - no persistent profile */
  isolated?: boolean
  /** CDP endpoint to connect to existing browser instead of launching */
  cdpEndpoint?: string
  /** Custom executable path */
  executablePath?: string
  /** Additional browser args */
  args?: string[]
}

export interface LaunchedBrowser {
  context: BrowserContext
  browser: Browser | null
  wsEndpoint: string | null
  userDataDir: string | null
  mode: 'launch' | 'cdp' | 'isolated'
  close: () => Promise<void>
}

/**
 * Get the default user data directory for persistent browser profiles
 * Follows the same pattern as Microsoft Playwright MCP
 */
export function getDefaultUserDataDir(channel: BrowserChannel = 'chrome'): string {
  const platform = process.platform
  const cacheDir = platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches')
    : platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.cache')

  // Match Playwright MCP pattern: mcp-{channel}-profile
  return path.join(cacheDir, 'browserwright', `mcp-${channel}-profile`)
}

/**
 * Check if a browser profile is currently locked (in use by another process)
 * Chrome creates a SingletonLock file when using a profile
 */
export function isProfileLocked(userDataDir: string): boolean {
  const lockFile = path.join(userDataDir, 'SingletonLock')
  try {
    // On Linux, SingletonLock is a symlink pointing to the PID
    const stats = fs.lstatSync(lockFile)
    if (stats.isSymbolicLink()) {
      // Check if the PID in the symlink is still running
      try {
        const target = fs.readlinkSync(lockFile)
        // Format is typically "hostname-pid" or just the hostname
        const pidMatch = target.match(/-(\d+)$/)
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10)
          // Check if process is running (signal 0 doesn't kill, just checks)
          process.kill(pid, 0)
          return true // Process is running
        }
      } catch {
        // Process not running or can't check - assume not locked
        return false
      }
    }
    return stats.isFile() || stats.isSymbolicLink()
  } catch {
    return false // Lock file doesn't exist
  }
}

/**
 * Try to connect to an existing browser on the debugging port
 * Returns the WebSocket URL if successful, null otherwise
 */
export async function tryConnectToExistingBrowser(port: number = DEFAULT_DEBUG_PORT): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2000)
    })
    if (response.ok) {
      const data = await response.json() as { webSocketDebuggerUrl?: string }
      return data.webSocketDebuggerUrl || null
    }
  } catch {
    // No browser found on this port
  }
  return null
}

/**
 * Connect to an existing browser via CDP endpoint
 */
export async function connectToCDP(cdpEndpoint: string): Promise<LaunchedBrowser> {
  console.error(`[browserwright] Connecting to CDP endpoint: ${cdpEndpoint}`)

  const browser = await chromium.connectOverCDP(cdpEndpoint)
  const contexts = browser.contexts()
  const context = contexts[0] || await browser.newContext()

  // Ensure at least one page exists
  if (context.pages().length === 0) {
    await context.newPage()
  }

  console.error(`[browserwright] Connected to existing browser via CDP`)

  return {
    context,
    browser,
    wsEndpoint: cdpEndpoint,
    userDataDir: null,
    mode: 'cdp',
    close: async () => {
      // Don't close user's browser, just disconnect
      await browser.close()
    }
  }
}

/**
 * Launch a browser with debugging enabled and persistent profile
 * This enables "just works" mode without needing the extension
 *
 * Multi-session support:
 * - First session launches Chrome with --remote-debugging-port
 * - Subsequent sessions connect to the existing browser via CDP
 * - All sessions share the same browser instance
 */
export async function launchBrowser(options: LaunchOptions = {}): Promise<LaunchedBrowser> {
  // If CDP endpoint provided, connect instead of launching
  if (options.cdpEndpoint) {
    return connectToCDP(options.cdpEndpoint)
  }

  const channel = options.channel ?? 'chrome'

  // Isolated mode uses temp directory
  const userDataDir = options.isolated
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'browserwright-'))
    : (options.userDataDir || getDefaultUserDataDir(channel))

  // For persistent mode, check if another session is already using the browser
  if (!options.isolated) {
    // First, try to connect to an existing browser on the debugging port
    const existingWsUrl = await tryConnectToExistingBrowser(DEFAULT_DEBUG_PORT)
    if (existingWsUrl) {
      console.error(`[browserwright] Found existing browser, connecting via CDP...`)
      return connectToCDP(existingWsUrl)
    }

    // Check if profile is locked (browser running without debugging port)
    if (isProfileLocked(userDataDir)) {
      console.error(`[browserwright] Profile is locked by another process`)
      console.error(`[browserwright] Tip: Close other Chrome instances or use --isolated mode`)

      // Try common debugging ports in case browser was started with one
      for (const port of [9222, 9223, 9224]) {
        const wsUrl = await tryConnectToExistingBrowser(port)
        if (wsUrl) {
          console.error(`[browserwright] Found browser on port ${port}, connecting...`)
          return connectToCDP(wsUrl)
        }
      }

      // Last resort: fall back to isolated mode
      console.error(`[browserwright] Falling back to isolated mode (temporary profile)`)
      return launchBrowser({ ...options, isolated: true })
    }
  }

  // Ensure the profile directory exists
  fs.mkdirSync(userDataDir, { recursive: true })

  console.error(`[browserwright] Launching browser...`)
  console.error(`[browserwright] Mode: ${options.isolated ? 'isolated' : 'persistent'}`)
  console.error(`[browserwright] Profile: ${userDataDir}`)
  console.error(`[browserwright] Channel: ${channel}`)

  // Get device emulation settings if specified
  const deviceDescriptor = options.device ? devices[options.device] : undefined
  if (options.device && !deviceDescriptor) {
    console.error(`[browserwright] Warning: Unknown device "${options.device}", ignoring`)
  }

  // Combine base args with any custom args
  // Include debugging port for multi-session support
  const baseArgs = [
    // Reduce automation detection
    '--disable-blink-features=AutomationControlled',
    // Enable debugging port so other sessions can connect
    `--remote-debugging-port=${DEFAULT_DEBUG_PORT}`,
  ]
  const allArgs = [...baseArgs, ...(options.args || [])]

  try {
    // Launch persistent context - this keeps logins between sessions
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: options.headless ?? false,
      channel,
      executablePath: options.executablePath,
      viewport: deviceDescriptor?.viewport || options.viewport || { width: 1280, height: 720 },
      userAgent: deviceDescriptor?.userAgent,
      deviceScaleFactor: deviceDescriptor?.deviceScaleFactor,
      isMobile: deviceDescriptor?.isMobile,
      hasTouch: deviceDescriptor?.hasTouch,
      args: allArgs,
      ignoreDefaultArgs: ['--enable-automation'],
    })

    // Get browser reference (may be null for persistent contexts)
    const browser = context.browser()

    // Create initial page if none exists
    if (context.pages().length === 0) {
      await context.newPage()
    }

    console.error(`[browserwright] Browser launched successfully`)
    console.error(`[browserwright] Debugging port: ${DEFAULT_DEBUG_PORT} (other sessions can connect)`)

    return {
      context,
      browser,
      wsEndpoint: `ws://127.0.0.1:${DEFAULT_DEBUG_PORT}`,
      userDataDir,
      mode: options.isolated ? 'isolated' : 'launch',
      close: async () => {
        await context.close()
        // Clean up temp directory for isolated mode
        if (options.isolated) {
          try {
            fs.rmSync(userDataDir, { recursive: true, force: true })
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }
  } catch (error: any) {
    // Handle "Opening in existing browser session" error
    if (error.message?.includes('Target page, context or browser has been closed') ||
        error.message?.includes('Opening in existing browser session')) {
      console.error(`[browserwright] Launch failed: browser profile is in use`)

      // Wait a moment for the browser to fully start, then try to connect
      await new Promise(resolve => setTimeout(resolve, 1000))

      const wsUrl = await tryConnectToExistingBrowser(DEFAULT_DEBUG_PORT)
      if (wsUrl) {
        console.error(`[browserwright] Connecting to existing browser...`)
        return connectToCDP(wsUrl)
      }

      // Fall back to isolated mode
      console.error(`[browserwright] Falling back to isolated mode`)
      return launchBrowser({ ...options, isolated: true })
    }

    throw error
  }
}

/**
 * Check if a browser is already running with debugging enabled
 */
export async function findExistingBrowser(port: number = DEFAULT_DEBUG_PORT): Promise<string | null> {
  return tryConnectToExistingBrowser(port)
}

/**
 * List available device emulation options
 */
export function listDevices(): string[] {
  return Object.keys(devices)
}
