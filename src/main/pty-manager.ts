import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import os from 'os'

export interface PtyOptions {
  shell?: string
  cwd?: string
  cols?: number
  rows?: number
}

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, pty.IPty>()

  create(id: string, options: PtyOptions = {}): void {
    const shell =
      options.shell ??
      (process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL ?? '/bin/bash')

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: options.cwd ?? os.homedir(),
      env: process.env as Record<string, string>
    })

    this.sessions.set(id, proc)

    proc.onData((data) => this.emit('data', id, data))
    proc.onExit(({ exitCode }) => {
      this.emit('exit', id, exitCode)
      this.sessions.delete(id)
    })
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    try { this.sessions.get(id)?.kill() } catch {}
    this.sessions.delete(id)
  }

  /**
   * Capture PTY output until ~800ms of silence, or timeout.
   * Used by the agent runner to get command results.
   */
  captureOutput(id: string, timeout = 30_000): Promise<string> {
    return new Promise((resolve) => {
      let output = ''
      let silenceTimer: NodeJS.Timeout

      const finish = () => {
        clearTimeout(silenceTimer)
        this.off('data', handler)
        resolve(output)
      }

      const resetSilence = () => {
        clearTimeout(silenceTimer)
        silenceTimer = setTimeout(finish, 800)
      }

      const handler = (termId: string, data: string) => {
        if (termId !== id) return
        output += data
        resetSilence()
      }

      this.on('data', handler)
      setTimeout(finish, timeout)
      resetSilence()
    })
  }

  dispose(): void {
    for (const proc of this.sessions.values()) {
      try { proc.kill() } catch {}
    }
    this.sessions.clear()
  }
}

export const ptyManager = new PtyManager()
