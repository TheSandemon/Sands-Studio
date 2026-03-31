// =============================================================================
// CollisionDetector — Tracks file edits and detects simultaneous collisions
// =============================================================================

import type { FileEditEvent, CollisionResult } from '../shared/habitatCommsTypes'

const COLLISION_WINDOW_MS = 30_000 // 30-second collision window (matching hcom)

interface TrackedEdit {
  creatureId: string
  creatureName: string
  timestamp: number
  command?: string
}

export class CollisionDetector {
  // filePath → sorted array of recent edits (oldest first, pruned on check)
  private recentEdits = new Map<string, TrackedEdit[]>()

  // Heuristics: commands that typically write to files
  // These trigger a collision check when used with a file path
  private static readonly FILE_WRITE_PATTERNS = [
    /\s+>/,                     // output redirection: cmd > file
    /\|\s*tee/,                 // tee pipe: cmd | tee file
    /tee\s+/,                   // tee command: tee file
    /\$\(.*>/,                  // command substitution with redirect
    /\b(write|set-content|out-file|sc)\b/i, // PowerShell file-write cmdlets
    /\b(npm run|yarn|pnpm)\s+\S+\s+[^|]+>/, // package scripts with output redirect
    /\b(mv|cp)\s+\S+\s+\S+\.\S+/, // mv/cp with explicit destination file
    /\b(cat|echo|printf|print)\s+.*>\s*\S+/, // explicit write
    /\b(rm|del|rd)\s+\S+\.\S+/, // delete specific file (potential collision)
    /\bsed\s+(-i|--in-place)/,  // sed in-place edit
    /\bawk\s+(-i|--include)/,   // awk in-place edit
    />\s*\S+\.\S+/,            // redirect to a file: > path/to/file.ext
  ]

  // Patterns that suggest a path argument is a file being written
  private static readonly LIKELY_FILE_PATHS = [
    /\.ts$/, /\.tsx$/, /\.js$/, /\.jsx$/, /\.json$/,
    /\.md$/, /\.yaml$/, /\.yml$/, /\.toml$/, /\.ini$/,
    /\.css$/, /\.html$/, /\.xml$/, /\.env$/,
  ]

  /**
   * Check if a command string likely writes to a file (heuristic)
   */
  static suggestsFileWrite(command: string): boolean {
    return this.FILE_WRITE_PATTERNS.some((p) => p.test(command))
  }

  /**
   * Extract likely file paths from a command string (heuristic)
   */
  static extractFilePaths(command: string): string[] {
    const paths: string[] = []
    // Match things that look like file paths: /absolute/path or relative/path
    const matches = command.match(/(?:[a-zA-Z]:\\|\/)?(?:[.\w-]+\/)*[.\w-]+\.[a-z]{2,}/g)
    if (matches) {
      for (const m of matches) {
        if (this.LIKELY_FILE_PATHS.some((p) => p.test(m))) {
          paths.push(m)
        }
      }
    }
    return paths
  }

  /**
   * Record a file edit event and check for collisions.
   * Returns collision info if another creature edited the same file within the window.
   */
  record(creatureId: string, filePath: string, creatureName: string, command?: string): CollisionResult {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()

    let edits = this.recentEdits.get(normalizedPath)
    if (!edits) {
      edits = []
      this.recentEdits.set(normalizedPath, edits)
    }

    edits.push({ creatureId, creatureName, timestamp: Date.now(), command })

    return this.check(filePath, COLLISION_WINDOW_MS)
  }

  /**
   * Check if a file has recent edits from other creatures.
   */
  check(filePath: string, windowMs = COLLISION_WINDOW_MS): CollisionResult {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
    const edits = this.recentEdits.get(normalizedPath)
    if (!edits) return { hasCollision: false, editingCreatures: [], collisionWindowMs: windowMs }

    const cutoff = Date.now() - windowMs
    const recent = edits.filter((e) => e.timestamp > cutoff)

    // Prune old entries while we're at it
    const remaining = edits.filter((e) => e.timestamp > cutoff)
    if (remaining.length === 0) {
      this.recentEdits.delete(normalizedPath)
    } else {
      this.recentEdits.set(normalizedPath, remaining)
    }

    if (recent.length === 0) return { hasCollision: false, editingCreatures: [], collisionWindowMs: windowMs }

    return {
      hasCollision: recent.length > 1,
      editingCreatures: recent.map((e) => ({
        id: e.creatureId,
        name: e.creatureName,
        startedAt: e.timestamp,
      })),
      collisionWindowMs: windowMs,
    }
  }

  /**
   * Get all active editors for a file within the collision window.
   */
  getActiveEditors(filePath: string, windowMs = COLLISION_WINDOW_MS): Array<{ id: string; name: string; startedAt: number }> {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
    const edits = this.recentEdits.get(normalizedPath)
    if (!edits) return []

    const cutoff = Date.now() - windowMs
    return edits
      .filter((e) => e.timestamp > cutoff)
      .map((e) => ({ id: e.creatureId, name: e.creatureName, startedAt: e.timestamp }))
  }

  /**
   * Manually prune edits older than maxAgeMs.
   */
  prune(maxAgeMs = COLLISION_WINDOW_MS * 2): void {
    const cutoff = Date.now() - maxAgeMs
    for (const [path, edits] of this.recentEdits.entries()) {
      const remaining = edits.filter((e) => e.timestamp > cutoff)
      if (remaining.length === 0) {
        this.recentEdits.delete(path)
      } else {
        this.recentEdits.set(path, remaining)
      }
    }
  }
}
