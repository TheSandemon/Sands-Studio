// =============================================================================
// SkillCompiler — distill compacted context into Claude Code skill files
// Main process only (uses Node.js fs)
// =============================================================================

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import type { CompiledSkill, SkillManifest } from '../shared/dreamstate-types'

// ── HOME directory ─────────────────────────────────────────────────────────────

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''
const SKILLS_ROOT = join(HOME, '.terminal-habitat', 'skills')
const REGISTRY_FILE = join(SKILLS_ROOT, 'registry.json')

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Slugify a name into a URL-safe lowercase hyphenated string */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Convert a timestamp number to a base36 string (like a compact ID) */
function toBase36(n: number): string {
  return n.toString(36)
}

// ── SkillCompiler ─────────────────────────────────────────────────────────────

export class SkillCompiler {
  private readonly creatureId: string
  private readonly notes: string
  private readonly summary: string

  constructor(creatureId: string, options?: { notes?: string; summary?: string }) {
    this.creatureId = creatureId
    this.notes = options?.notes ?? ''
    this.summary = options?.summary ?? ''
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Compile a new skill from the current compacted context.
   *
   * 1. Generate skill-dir path: ~/.terminal-habitat/skills/{creatureId}/{skill-id}/
   * 2. Generate SKILL.md via AI (or fallback template)
   * 3. Write SKILL.md and skill.json to the skill dir
   * 4. Write annotation (compaction data) to annotations/
   * 5. Call registerSkill(manifest)
   * 6. Return CompiledSkill
   */
  async compile(
    name: string,
    triggers: string[] = [],
    description?: string
  ): Promise<CompiledSkill> {
    const skillId = `${toBase36(Date.now())}-${slugify(name)}`
    const skillDir = join(SKILLS_ROOT, this.creatureId, skillId)
    const annotationsDir = join(skillDir, 'annotations')

    // 1. Ensure skill dir + annotations dir exist
    mkdirSync(skillDir, { recursive: true })
    mkdirSync(annotationsDir, { recursive: true })

    // 2. Generate SKILL.md content
    const content = await this.generateSkillContent(name, triggers, description)

    // 3. Write SKILL.md
    writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8')

    // 4. Build manifest + write skill.json
    const manifest: SkillManifest = {
      id: skillId,
      name,
      description,
      triggers,
      creatureId: this.creatureId,
      createdAt: Date.now(),
      path: skillDir,
    }
    writeFileSync(join(skillDir, 'skill.json'), JSON.stringify(manifest, null, 2), 'utf-8')

    // 5. Write annotation (compaction data)
    const annotation = {
      compactionRound: 0, // caller can override if they know the compaction round
      sourceCreatureId: this.creatureId,
      compiledAt: Date.now(),
    }
    writeFileSync(
      join(annotationsDir, `compaction-${toBase36(Date.now())}.json`),
      JSON.stringify(annotation, null, 2),
      'utf-8'
    )

    // 6. Register in registry
    this.registerSkill(manifest)

    return { manifest, content, annotations: { compactionRound: 0, sourceCreatureId: this.creatureId } }
  }

  /** List all skills, optionally filtered by creatureId. */
  static listSkills(creatureId?: string): SkillManifest[] {
    const registry = this.loadRegistry()
    if (creatureId) {
      return registry.skills.filter((s) => s.creatureId === creatureId)
    }
    return registry.skills
  }

  /** Load a compiled skill (manifest + SKILL.md content) from a skill path. */
  static loadSkill(skillPath: string): CompiledSkill | null {
    try {
      const skillJsonPath = join(skillPath, 'skill.json')
      const skillMdPath = join(skillPath, 'SKILL.md')

      if (!existsSync(skillJsonPath) || !existsSync(skillMdPath)) {
        return null
      }

      const manifest: SkillManifest = JSON.parse(readFileSync(skillJsonPath, 'utf-8'))
      const content = readFileSync(skillMdPath, 'utf-8')

      // Load latest annotation if present
      const annotationsDir = join(skillPath, 'annotations')
      let annotations = { compactionRound: 0, sourceCreatureId: manifest.creatureId }
      if (existsSync(annotationsDir)) {
        const files = readdirSync(annotationsDir)
          .filter((f) => f.startsWith('compaction-') && f.endsWith('.json'))
          .sort()
          .reverse()
        if (files.length > 0) {
          const loaded = JSON.parse(readFileSync(join(annotationsDir, files[0]), 'utf-8'))
          annotations = {
            compactionRound: loaded.compactionRound ?? 0,
            sourceCreatureId: loaded.sourceCreatureId ?? manifest.creatureId,
          }
        }
      }

      return { manifest, content, annotations }
    } catch {
      return null
    }
  }

  /** Delete a skill (SKILL.md + skill.json) and remove it from the registry. */
  static deleteSkill(skillPath: string): void {
    try {
      const skillJsonPath = join(skillPath, 'skill.json')
      if (existsSync(skillJsonPath)) {
        const manifest: SkillManifest = JSON.parse(readFileSync(skillJsonPath, 'utf-8'))

        // Remove from registry
        const registry = this.loadRegistry()
        registry.skills = registry.skills.filter((s) => s.id !== manifest.id)
        writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8')

        // Delete files
        const skillMdPath = join(skillPath, 'SKILL.md')
        if (existsSync(skillMdPath)) unlinkSync(skillMdPath)
        unlinkSync(skillJsonPath)

        // Delete annotations dir if empty
        const annotationsDir = join(skillPath, 'annotations')
        if (existsSync(annotationsDir)) {
          try {
            const files = readdirSync(annotationsDir)
            if (files.length === 0) {
              unlinkSync(annotationsDir)
            }
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Silently ignore deletion errors
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Add a skill manifest to the registry.json file. */
  private registerSkill(manifest: SkillManifest): void {
    const registry = this.loadRegistry()
    // Remove existing entry with same id to avoid duplicates
    registry.skills = registry.skills.filter((s) => s.id !== manifest.id)
    registry.skills.push(manifest)
    writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8')
  }

  /** Load the registry.json file, returning an empty structure if missing. */
  private loadRegistry(): { skills: SkillManifest[] } {
    try {
      if (existsSync(REGISTRY_FILE)) {
        return JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'))
      }
    } catch {
      // Corrupt registry — rebuild
    }
    return { skills: [] }
  }

  /**
   * Generate SKILL.md content via AI using the `ai` SDK's generateText.
   * Falls back to a template string if AI generation fails.
   */
  private async generateSkillContent(name: string, triggers: string[], description?: string): Promise<string> {
    const systemPrompt = `You are a skill author. Create a Claude Code skill from the following context.
The skill should be reusable, self-contained, and invocable by phrase trigger.
Output a complete SKILL.md file following Claude Code skill format.

# Skill Name
The skill name should be descriptive and action-oriented.

## Triggers
- Phrases that would invoke this skill

## Context
What this skill is for.

## Patterns
Reusable patterns, commands, approaches.

## Notes
Permanent facts extracted from the conversation.

CONTEXT:
Summary: ${this.summary}
Notes: ${this.notes}
Skill Name: ${name}
Description: ${description ?? '(none provided)'}`

    try {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
      const client = new Anthropic({ apiKey })
      const response = await client.messages.create({
        model: 'claude-haiku',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Generate the SKILL.md content based on the context above.' }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      if (text.trim().length > 0) {
        return text.trim()
      }
    } catch (err) {
      console.warn('[SkillCompiler] AI generation failed, using fallback template:', err)
    }

    // Fallback template
    const triggersBlock =
      triggers.length > 0
        ? triggers.map((t) => `- "${t}"`).join('\n')
        : '- (no triggers defined)'

    return `# ${name}

${description ?? 'Auto-generated skill.'}

## Triggers
${triggersBlock}

## Context
Auto-compiled from conversation context.

## Notes
${this.notes || 'See conversation history for details.'}
`
  }
}
