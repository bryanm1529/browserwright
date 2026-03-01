import childProcess from 'node:child_process'
import process from 'node:process'
import { sleep } from './utils.js'

interface CommandResult {
  exitCode: number | null
  notFound: boolean
  stdout: string
}

interface CommandOptions {
  args: string[]
  command: string
}

type LookupPids = (port: number) => Promise<Set<number> | null>

function parseLsofOutput(stdout: string): Set<number> {
  return new Set(
    stdout
      .split('\n')
      .map((line) => {
        return Number(line.trim())
      })
      .filter((pid) => {
        return Number.isInteger(pid) && pid > 0
      }),
  )
}

function parseSsOutput(stdout: string, port: number): Set<number> {
  const pids: Set<number> = new Set()

  for (const line of stdout.split('\n')) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 6) {
      continue
    }

    const state = columns[1]
    const localAddress = columns[4]
    if (state !== 'LISTEN' || !localAddress.endsWith(`:${port}`)) {
      continue
    }

    for (const match of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(match[1])
      if (Number.isInteger(pid) && pid > 0) {
        pids.add(pid)
      }
    }
  }

  return pids
}

function parseUnixNetstatOutput(stdout: string, port: number): Set<number> {
  const pids: Set<number> = new Set()

  for (const line of stdout.split('\n')) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 7) {
      continue
    }

    const localAddress = columns[3]
    const state = columns[5]
    const pidAndProgram = columns[6]
    if (state !== 'LISTEN' || !localAddress.endsWith(`:${port}`)) {
      continue
    }

    const pid = Number(pidAndProgram.split('/')[0])
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid)
    }
  }

  return pids
}

function parseWindowsNetstatOutput(stdout: string, port: number): Set<number> {
  const pids: Set<number> = new Set()

  for (const line of stdout.split('\n')) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 5) {
      continue
    }

    const localAddress = columns[1]
    const state = columns[3]
    const pid = Number(columns[4])
    if (state !== 'LISTENING' || !localAddress.endsWith(`:${port}`)) {
      continue
    }

    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid)
    }
  }

  return pids
}

async function runCommand({ args, command }: CommandOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let settled = false
    let stdout = ''

    const finish = (result: CommandResult) => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        finish({ exitCode: null, notFound: true, stdout: '' })
        return
      }

      reject(error)
    })

    child.on('close', (exitCode) => {
      finish({ exitCode, notFound: false, stdout })
    })
  })
}

async function lookupPidsWithLsof(port: number): Promise<Set<number> | null> {
  const result = await runCommand({
    command: 'lsof',
    args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
  })

  if (result.notFound) {
    return null
  }

  return parseLsofOutput(result.stdout)
}

async function lookupPidsWithSs(port: number): Promise<Set<number> | null> {
  const result = await runCommand({
    command: 'ss',
    args: ['-ltnp'],
  })

  if (result.notFound) {
    return null
  }

  return parseSsOutput(result.stdout, port)
}

async function lookupPidsWithNetstat(port: number): Promise<Set<number> | null> {
  const args = process.platform === 'win32' ? ['-ano', '-p', 'tcp'] : ['-ltnp']
  const result = await runCommand({
    command: 'netstat',
    args,
  })

  if (result.notFound) {
    return null
  }

  if (process.platform === 'win32') {
    return parseWindowsNetstatOutput(result.stdout, port)
  }

  return parseUnixNetstatOutput(result.stdout, port)
}

async function lookupListeningPids(port: number): Promise<Set<number>> {
  const lookups: LookupPids[] = (() => {
    if (process.platform === 'win32') {
      return [lookupPidsWithNetstat]
    }

    if (process.platform === 'darwin') {
      return [lookupPidsWithLsof, lookupPidsWithNetstat]
    }

    return [lookupPidsWithSs, lookupPidsWithNetstat, lookupPidsWithLsof]
  })()

  for (const lookup of lookups) {
    const pids = await lookup(port)
    if (pids !== null) {
      return pids
    }
  }

  return new Set()
}

async function killPid(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await runCommand({
      command: 'taskkill',
      args: ['/PID', String(pid), '/F', '/T'],
    })
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') {
      return
    }
    throw error
  }
}

async function waitForPortToClear(port: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pids = await lookupListeningPids(port)
    if (pids.size === 0) {
      return
    }
    await sleep(100)
  }
}

export async function killPortProcess(port: number): Promise<void> {
  const pids = await lookupListeningPids(port)
  if (pids.size === 0) {
    return
  }

  await Promise.all(
    [...pids].map(async (pid) => {
      await killPid(pid)
    }),
  )

  await waitForPortToClear(port)
}
