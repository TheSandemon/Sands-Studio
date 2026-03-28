import fs from 'fs'
import { join, resolve } from 'path'
import type { HabitatLogEvent, HabitatSnapshot, LastActiveHabitat } from '../shared/dreamstate-types'

const MAX_BUFFER = 10
const FLUSH_INTERVAL_MS = 5000
const MAX_LOG_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export class HabitatLog {
  private readonly baseDir: string
  private readonly habitatId: string

  private buffer: HabitatLogEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private isFlushing = false

  // Track current log file month so we switch to a new file when the month changes
  // or when the current file exceeds MAX_LOG_FILE_SIZE_BYTES
  private currentLogMonth: string | null = null

  constructor(habitatId: string) {
    this.habitatId = habitatId
    this.baseDir = resolve(process.cwd(), '.habitat')
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private logsDir(): string {
    return join(this.baseDir, 'logs', this.habitatId)
  }

  private snapshotsDir(): string {
    return join(this.baseDir, 'snapshots', this.habitatId)
  }

  private lastActivePath(): string {
    return join(this.baseDir, 'last-active-habitat.json')
  }

  private startFlushTimer(): void {
    if (this.flushTimer !== null) return
    this.flushTimer = setInterval(() => {
      this.flush()
    }, FLUSH_INTERVAL_MS)
  }

  private stopFlushTimer(): void {
    if (this.flushTimer === null) return
    clearInterval(this.flushTimer)
    this.flushTimer = null
  }

  private appendEventsToLog(filePath: string, events: HabitatLogEvent[]): void {
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
    fs.appendFileSync(filePath, lines, 'utf8')
  }

  private currentLogMonthTag(): string {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  }

  /**
   * Returns the path to the current log file, creating the directory as needed.
   * Switches to a fresh file when the month changes or the current file exceeds
   * the size limit (so we don't write a partial line into an over-sized file).
   */
  private getCurrentLogFile(): string {
    const tag = this.currentLogMonthTag()
    if (this.currentLogMonth !== tag) {
      this.currentLogMonth = tag
    }

    const dir = this.logsDir()
    fs.mkdirSync(dir, { recursive: true })
    const filePath = join(dir, `${tag}.log.jsonl`)

    // Check size; if over limit, mark that we need a fresh file next time
    try {
      const stat = fs.statSync(filePath)
      if (stat.size >= MAX_LOG_FILE_SIZE_BYTES) {
        // Stop writing to this file — force a new month/file on next write
        this.currentLogMonth = null
        return this.getCurrentLogFile()
      }
    } catch {
      // File doesn't exist yet — that's fine
    }

    return filePath
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Buffer an event; flush when the buffer reaches MAX_BUFFER or FLUSH_INTERVAL_MS elapses. */
  write(event: HabitatLogEvent): void {
    this.buffer.push(event)
    this.startFlushTimer()
    if (this.buffer.length >= MAX_BUFFER) {
      this.flush()
    }
  }

  /** Add multiple events; flush if the resulting buffer meets the flush threshold. */
  writeBatch(events: HabitatLogEvent[]): void {
    this.buffer.push(...events)
    this.startFlushTimer()
    if (this.buffer.length >= MAX_BUFFER) {
      this.flush()
    }
  }

  /**
   * Persist pending events, then write a snapshot file.
   * Snapshot is written to snapshots/{habitatId}/{ISO timestamp}.snap.json.
   */
  writeSnapshot(snapshot: Omit<HabitatSnapshot, 'type' | 'version'>): string {
    this.flush()

    const full: HabitatSnapshot = {
      ...snapshot,
      type: 'snapshot',
      version: 1,
    }

    const dir = this.snapshotsDir()
    fs.mkdirSync(dir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = join(dir, `${timestamp}.snap.json`)

    fs.writeFileSync(filePath, JSON.stringify(full, null, 2), 'utf8')
    return filePath
  }

  /** Return the most recent snapshot for a habitat, or null if none exist. */
  getSnapshot(habitatId: string): HabitatSnapshot | null {
    const dir = join(this.baseDir, 'snapshots', habitatId)

    if (!fs.existsSync(dir)) return null

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.snap.json'))
    if (files.length === 0) return null

    // Filenames are ISO timestamps — sort alphabetically for chronological order
    files.sort()
    const latest = files[files.length - 1]

    try {
      const raw = fs.readFileSync(join(dir, latest), 'utf8')
      return JSON.parse(raw) as HabitatSnapshot
    } catch {
      return null
    }
  }

  /** Alias for getSnapshot — returns the most recent session snapshot. */
  getLastSession(habitatId: string): HabitatSnapshot | null {
    return this.getSnapshot(habitatId)
  }

  /** Persist last-active pointer to disk (used on habitat close). */
  writeLastActive(habitatId: string, habitatName: string): void {
    const dir = this.baseDir
    fs.mkdirSync(dir, { recursive: true })

    const data: LastActiveHabitat = {
      habitatId,
      habitatName,
      closedAt: Date.now(),
      snapshotTimestamp: Date.now(),
    }

    // Atomic write: temp file + rename
    const tmp = join(dir, 'last-active-habitat.tmp.json')
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, this.lastActivePath())
  }

  /** Static — reads last-active pointer directly from disk. */
  static readLastActive(): LastActiveHabitat | null {
    const baseDir = resolve(process.cwd(), '.habitat')
    const path = join(baseDir, 'last-active-habitat.json')

    if (!fs.existsSync(path)) return null

    try {
      const raw = fs.readFileSync(path, 'utf8')
      return JSON.parse(raw) as LastActiveHabitat
    } catch {
      return null
    }
  }

  /**
   * Replay all `.log.jsonl` files for a habitat in chronological order.
   * Iterates every monthly log file, parses each JSON line, and calls `callback`.
   */
  replayLog(habitatId: string, callback: (event: HabitatLogEvent) => void): void {
    const dir = join(this.baseDir, 'logs', habitatId)

    if (!fs.existsSync(dir)) return

    let files = fs.readdirSync(dir).filter((f) => f.endsWith('.log.jsonl'))

    // Sort chronologically (filename is YYYY-MM)
    files.sort()

    for (const file of files) {
      const filePath = join(dir, file)
      const raw = fs.readFileSync(filePath, 'utf8')
      const lines = raw.split('\n').filter((l) => l.trim() !== '')

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as HabitatLogEvent
          callback(event)
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  /** Delete log files older than `olderThanDays` (default 30). Never deletes current month. */
  pruneOldLogs(habitatId: string, olderThanDays = 30): void {
    const dir = join(this.baseDir, 'logs', habitatId)
    if (!fs.existsSync(dir)) return

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - olderThanDays)
    const cutoffTag = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.log.jsonl'))

    for (const file of files) {
      // file format: YYYY-MM.log.jsonl — extract YYYY-MM for comparison
      const monthTag = file.replace('.log.jsonl', '')
      if (monthTag < cutoffTag) {
        try {
          fs.unlinkSync(join(dir, file))
        } catch {
          // Ignore deletion errors
        }
      }
    }
  }

  /** Number of events currently held in the flush buffer. */
  getEventCount(): number {
    return this.buffer.length
  }

  // ── Flush ───────────────────────────────────────────────────────────────────

  /**
   * Write buffered events to the current monthly log file.
   * Idempotent — safe to call even if the timer fires while a flush is in progress.
   */
  flush(): void {
    if (this.isFlushing) return
    if (this.buffer.length === 0) return

    this.isFlushing = true
    this.stopFlushTimer()

    try {
      const events = this.buffer.splice(0, this.buffer.length)
      const filePath = this.getCurrentLogFile()
      this.appendEventsToLog(filePath, events)

      // After writing, check if we just wrote into a file that's now >= limit.
      // If so, null out currentLogMonth so the next write picks a fresh file.
      try {
        const stat = fs.statSync(filePath)
        if (stat.size >= MAX_LOG_FILE_SIZE_BYTES) {
          this.currentLogMonth = null
        }
      } catch {
        // Ignore — file was written successfully above
      }
    } finally {
      this.isFlushing = false
    }
  }
}
