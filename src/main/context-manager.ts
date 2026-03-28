// =============================================================================
// ContextManager — AI-powered context compaction for creature memories
// Main process only (uses Node.js fs)
// =============================================================================

import { mkdir, readFile, writeFile } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import type { CreatureMemory, CompactionResult, CoreMessage } from '../shared/dreamstate-types'

const CREATURES_DIR = join(process.cwd(), '.habitat', 'creatures')
const MAX_MESSAGES_AFTER_COMPACT = 50
const MIN_MESSAGES_TO_COMPACT = 20
const DEFAULT_AUTO_COMPACT_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const AUTO_COMPACT_THRESHOLD = 200

interface CompactOptions {
  model?: string
  apiKey?: string
  baseURL?: string
}

type CompactCallback = (result: CompactionResult) => void

// Naive fallback: just keep last N messages
function naiveCompact(messages: CoreMessage[], keepLast: number): CoreMessage[] {
  if (messages.length <= keepLast) return messages
  return messages.slice(-keepLast)
}

export class ContextManager {
  private creatureId: string
  private memory: CreatureMemory
  private compactCallback: CompactCallback | null = null
  private autoCompactTimer: ReturnType<typeof setInterval> | null = null
  private lastActivityTime: number = Date.now()

  constructor(creatureId: string, memory: CreatureMemory) {
    this.creatureId = creatureId
    this.memory = memory
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  save(): void {
    const filePath = join(CREATURES_DIR, `${this.creatureId}.json`)
    const dir = CREATURES_DIR

    // Ensure directory exists
    mkdir(dir, { recursive: true }, (err) => {
      if (err && err.code !== 'EEXIST') {
        console.error(`[ContextManager] Failed to create directory ${dir}:`, err)
        return
      }
      writeFile(filePath, JSON.stringify(this.memory, null, 2), 'utf8', (err) => {
        if (err) {
          console.error(`[ContextManager] Failed to save memory for ${this.creatureId}:`, err)
        }
      })
    })
  }

  static load(creatureId: string): CreatureMemory | null {
    const filePath = join(CREATURES_DIR, `${creatureId}.json`)
    try {
      const raw = readFileSync(filePath, 'utf8')
      return JSON.parse(raw) as CreatureMemory
    } catch {
      return null
    }
  }

  // ── Compaction ─────────────────────────────────────────────────────────────

  async compact(options: CompactOptions = {}): Promise<CompactionResult> {
    const messages = this.memory.messages

    // Skip if not enough messages
    if (messages.length < MIN_MESSAGES_TO_COMPACT) {
      return {
        creatureId: this.creatureId,
        round: this.memory.compactionRounds,
        summaryLength: 0,
        messageCountBefore: messages.length,
        messageCountAfter: messages.length,
        notesExtracted: false,
        timestamp: Date.now(),
      }
    }

    const round = this.memory.compactionRounds + 1
    const messageCountBefore = messages.length

    // Take last 150 messages for summarization
    const messagesToCompact = messages.slice(-150)

    // Build conversation text for the AI
    const conversationText = messagesToCompact
      .map((m) => {
        const role = m.role
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return `[${role}]\n${content}`
      })
      .join('\n\n')

    let summary = ''

    // Try AI-powered compaction
    try {
      const apiKey = options.apiKey ?? this.memory.apiKey
      const baseURL = options.baseURL ?? this.memory.baseURL ?? 'https://api.anthropic.com'

      // Determine model: prefer haiku variants for cost efficiency
      let model = options.model ?? this.memory.model ?? 'claude-haiku'
      if (!model.includes('haiku')) {
        model = `${model}-haiku`
      }

      const systemPrompt =
        'You are a context compactor. Summarize the following conversation into a dense, structured format. ' +
        'Preserve: all decisions made, commands run, errors encountered, tools used, important facts, patterns discovered. ' +
        'Discard: filler, retries, irrelevant chatter. ' +
        'Output format: First a 3-5 sentence executive summary, then a bulleted list of "permanent facts" ' +
        '(things that should never be forgotten), then a "patterns" section (reusable approaches).'

      const client = new Anthropic({ apiKey, baseURL })
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: `CONVERSATION TO COMPACT:\n${conversationText}` }],
      })

      summary = response.content[0].type === 'text' ? response.content[0].text : '[AI returned non-text response]'
    } catch (err) {
      console.warn(`[ContextManager] AI compaction failed for ${this.creatureId}, using naive fallback:`, err)
      // Naive fallback: keep last 50 messages unchanged
      summary = '[Compaction fallback - no AI summary available]'
    }

    // Build compacted messages array
    const compactedAt = new Date().toISOString()
    const systemMessage: CoreMessage = {
      role: 'system',
      content: `[Compacted context — round ${round}]\n\n${summary}`,
      annotations: { compactedAt, round },
    }

    const lastMessages = naiveCompact(messages, MAX_MESSAGES_AFTER_COMPACT)
    const compactedMessages: CoreMessage[] = [systemMessage, ...lastMessages]

    // Update memory
    this.memory.messages = compactedMessages
    this.memory.compactionRounds = round
    this.memory.lastCompactedAt = compactedAt

    // Extract notes
    const notesExtracted = await this.extractNotes(summary)

    // Persist
    this.save()

    // Fire callback
    if (this.compactCallback) {
      const result: CompactionResult = {
        creatureId: this.creatureId,
        round,
        summaryLength: summary.length,
        messageCountBefore,
        messageCountAfter: compactedMessages.length,
        notesExtracted,
        timestamp: Date.now(),
      }
      this.compactCallback(result)
    }

    return {
      creatureId: this.creatureId,
      round,
      summaryLength: summary.length,
      messageCountBefore,
      messageCountAfter: compactedMessages.length,
      notesExtracted,
      timestamp: Date.now(),
    }
  }

  // ── Notes ──────────────────────────────────────────────────────────────────

  async extractNotes(summary?: string): Promise<boolean> {
    try {
      const notesPath = join(CREATURES_DIR, `${this.creatureId}-notes.md`)
      const content = summary ?? this.getSummary() ?? ''

      // Build notes content
      const notesContent = `# Notes for ${this.creatureId}\n\nExtracted at: ${new Date().toISOString()}\n\n## Summary\n\n${content}\n`

      await writeFilePromise(notesPath, notesContent, 'utf8')
      this.memory.notesPath = notesPath
      return true
    } catch (err) {
      console.error(`[ContextManager] Failed to extract notes for ${this.creatureId}:`, err)
      return false
    }
  }

  getNotes(): string | null {
    const notesPath = this.memory.notesPath ?? join(CREATURES_DIR, `${this.creatureId}-notes.md`)
    try {
      return readFileSync(notesPath, 'utf8')
    } catch {
      return null
    }
  }

  // ── Auto-compact ───────────────────────────────────────────────────────────

  startAutoCompact(intervalMs: number = DEFAULT_AUTO_COMPACT_INTERVAL_MS): void {
    this.stopAutoCompact()
    this.autoCompactTimer = setInterval(async () => {
      if (this.memory.messages.length > AUTO_COMPACT_THRESHOLD) {
        console.log(`[ContextManager] Auto-compacting ${this.creatureId} (${this.memory.messages.length} messages)`)
        await this.compact()
      }
    }, intervalMs)
  }

  stopAutoCompact(): void {
    if (this.autoCompactTimer !== null) {
      clearInterval(this.autoCompactTimer)
      this.autoCompactTimer = null
    }
  }

  // ── Activity tracking ─────────────────────────────────────────────────────

  recordActivity(): void {
    this.lastActivityTime = Date.now()
  }

  // ── State accessors ────────────────────────────────────────────────────────

  getMessageCount(): number {
    return this.memory.messages.length
  }

  getSummary(): string | null {
    // Find the most recent system message with compactedAt annotation
    for (let i = this.memory.messages.length - 1; i >= 0; i--) {
      const msg = this.memory.messages[i]
      if (msg.role === 'system' && msg.annotations && typeof msg.annotations === 'object') {
        const ann = msg.annotations as Record<string, unknown>
        if (ann.compactedAt) {
          return typeof msg.content === 'string' ? msg.content : null
        }
      }
    }
    return null
  }

  getCreatureId(): string {
    return this.creatureId
  }

  getMemory(): CreatureMemory {
    return this.memory
  }

  onCompact(callback: CompactCallback): void {
    this.compactCallback = callback
  }
}

// ── Sync helpers (avoid callback hell for simple file ops) ───────────────────

function readFileSync(path: string, encoding: BufferEncoding): string {
  const { readFileSync: _readFileSync } = require('fs') as typeof import('fs')
  return _readFileSync(path, encoding)
}

function writeFilePromise(
  path: string,
  data: string,
  encoding: BufferEncoding
): Promise<void> {
  return new Promise((resolve, reject) => {
    writeFile(path, data, encoding, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}
