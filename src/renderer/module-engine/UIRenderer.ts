// =============================================================================
// Module Engine — UI Renderer
// Event log, speech bubbles, narration, and visual effects overlay.
// =============================================================================

import * as PIXI from 'pixi.js'
import type { ModuleRendererEvent, GridPosition, FreeformPosition } from '../../shared/types'
import type { EntityRenderer } from './EntityRenderer'

// ── Speech Bubble ──────────────────────────────────────────────────────────────

class SpeechBubble {
  readonly entityId: string
  private container: PIXI.Container
  private text: PIXI.Text
  private bg: PIXI.Graphics
  private fadeStart: number
  private readonly duration: number

  constructor(parent: PIXI.Container, entityId: string, text: string, duration: number) {
    this.entityId = entityId
    this.duration = duration ?? 4000
    this.fadeStart = Date.now() + Math.max(0, this.duration - 1000) // start fading 1s before dismiss

    this.container = new PIXI.Container()
    parent.addChild(this.container)

    const padding = 8
    const fontSize = 10

    this.text = new PIXI.Text({
      text,
      style: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize,
        fill: 0xffffff,
        wordWrap: true,
        wordWrapWidth: 180,
      },
    })

    this.bg = new PIXI.Graphics()
    this.bg.roundRect(
      -padding,
      -padding - this.text.height,
      this.text.width + padding * 2,
      this.text.height + padding * 2,
      6
    )
    this.bg.fill({ color: 0x1a1a2e, alpha: 0.9 })

    this.container.addChild(this.bg)
    this.container.addChild(this.text)

    // Tail
    const tail = new PIXI.Graphics()
    tail.poly([0, 0, -6, 10, 6, 10])
    tail.fill({ color: 0x1a1a2e, alpha: 0.9 })
    tail.y = this.bg.height - padding
    tail.x = 0
    this.container.addChild(tail)
  }

  setPosition(screenX: number, screenY: number): void {
    this.container.x = screenX
    this.container.y = screenY
  }

  tick(): boolean {
    const now = Date.now()
    if (now >= this.fadeStart) {
      const elapsed = now - this.fadeStart
      const remaining = 1000 - elapsed
      this.container.alpha = remaining / 1000
    }
    if (now >= this.fadeStart + 1000) {
      this.container.destroy({ children: true })
      return true // expired
    }
    return false
  }

  destroy(): void {
    this.container.destroy({ children: true })
  }
}

// ── Narration Display ─────────────────────────────────────────────────────────

class NarrationDisplay {
  private container: PIXI.Container
  private text: PIXI.Text
  private bg: PIXI.Graphics
  private charIndex = 0
  private fullText = ''
  private charDuration = 30 // ms per character
  private lastCharTime = 0
  private done = false
  private dismissed = false
  private style: 'dramatic' | 'normal' | 'shout' | 'whisper' = 'normal'

  constructor(parent: PIXI.Container, text: string, style: string = 'normal', canvasWidth = 1440, canvasHeight = 900) {
    this.style = (style as typeof this.style) ?? 'normal'
    this.fullText = text

    const isDramatic = this.style === 'dramatic'
    const isShout = this.style === 'shout'
    const isWhisper = this.style === 'whisper'

    const fontSize = isDramatic ? 18 : isShout ? 16 : isWhisper ? 12 : 13
    const fontFamily = isDramatic ? 'Georgia, serif' : 'JetBrains Mono, monospace'

    this.container = new PIXI.Container()
    parent.addChild(this.container)

    // Position at bottom center using passed canvas dimensions
    this.container.x = canvasWidth / 2
    this.container.y = canvasHeight - 120

    const maxWidth = 700
    this.text = new PIXI.Text({
      text: '',
      style: {
        fontFamily,
        fontSize,
        fill: isShout ? 0xffdd44 : isWhisper ? 0xaaaaaa : 0xffffff,
        stroke: { color: 0x000000, width: 3 },
        wordWrap: true,
        wordWrapWidth: maxWidth,
        align: 'center',
      },
    })
    this.text.anchor.set(0.5, 1)

    this.bg = new PIXI.Graphics()
    this.redrawBg(0)

    this.container.addChild(this.bg)
    this.container.addChild(this.text)

    // Fade in
    this.container.alpha = 0
  }

  private redrawBg(padding: number): void {
    this.bg.clear()
    this.bg.roundRect(
      -this.text.width / 2 - padding,
      -this.text.height - padding,
      this.text.width + padding * 2,
      this.text.height + padding * 2,
      8
    )
    this.bg.fill({ color: 0x000000, alpha: 0.7 })
  }

  /** Signal that this narration has been dismissed so the queue can advance. */
  dismiss(): void {
    this.dismissed = true
  }

  isDismissed(): boolean {
    return this.dismissed
  }

  tick(now: number): boolean {
    // Fade in
    if (this.container.alpha < 1) {
      this.container.alpha = Math.min(1, this.container.alpha + 0.05)
    }

    // Typewriter
    if (this.charIndex < this.fullText.length) {
      if (now - this.lastCharTime >= this.charDuration) {
        this.charIndex++
        this.text.text = this.fullText.slice(0, this.charIndex)
        this.redrawBg(12)
        this.lastCharTime = now
      }
      return false
    }

    if (!this.done) {
      this.done = true
      // Auto-dismiss after 5s of full text displayed
      setTimeout(() => {
        this.dismissed = true
      }, 5000)
      return false
    }

    return false
  }

  destroy(): void {
    this.container.destroy({ children: true })
  }
}

// ── UI Renderer ────────────────────────────────────────────────────────────────

export class UIRenderer {
  private container: PIXI.Container
  private eventLog: PIXI.Container
  private logTexts: PIXI.Text[] = []
  private speechBubbles = new Map<string, SpeechBubble>()
  private narration: NarrationDisplay | null = null
  private narrationQueue: Array<{ text: string; style?: string }> = []
  private effects = new Map<string, PIXI.Container>()
  private assetResolver: (tag: string, category: 'effect') => PIXI.Texture | null
  private canvasWidth: number
  private canvasHeight: number
  private ticker: PIXI.Ticker
  private entityRenderer: EntityRenderer | null = null
  private getEntityScreenPosFn: ((entityId: string) => { x: number; y: number } | null) | null = null

  private static readonly MAX_LOG_LINES = 6
  private static readonly MAX_NARRATION_QUEUE = 5

  constructor(
    parent: PIXI.Container,
    canvasWidth: number,
    canvasHeight: number,
    assetResolver: (tag: string, category: 'effect') => PIXI.Texture | null,
    ticker: PIXI.Ticker
  ) {
    this.canvasWidth = canvasWidth
    this.canvasHeight = canvasHeight
    this.assetResolver = assetResolver
    this.ticker = ticker

    // Main UI container (on top of everything)
    this.container = new PIXI.Container()
    this.container.zIndex = 1000
    parent.addChild(this.container)

    // Event log (top-left)
    this.eventLog = new PIXI.Container()
    this.eventLog.x = 12
    this.eventLog.y = 12
    this.container.addChild(this.eventLog)
  }

  setEntityRenderer(er: EntityRenderer): void {
    this.entityRenderer = er
  }

  setEntityPositionResolver(fn: (entityId: string) => { x: number; y: number } | null): void {
    this.getEntityScreenPosFn = fn
  }

  handleEvent(event: ModuleRendererEvent): void {
    switch (event.type) {
      case 'speech': {
        // Dismiss old bubble for same entity
        this.speechBubbles.get(event.entityId)?.destroy()
        const pos = this.getEntityScreenPosFn?.(event.entityId) ?? null
        const bubble = new SpeechBubble(this.container, event.entityId, event.text, event.duration ?? 4000)
        if (pos) bubble.setPosition(pos.x, pos.y - 40)
        this.speechBubbles.set(event.entityId, bubble)
        break
      }

      case 'narration': {
        // If narration is currently showing, queue the new one instead of replacing
        if (this.narration !== null) {
          if (this.narrationQueue.length < UIRenderer.MAX_NARRATION_QUEUE) {
            this.narrationQueue.push({ text: event.text, style: event.style })
          }
        } else {
          this.narration = new NarrationDisplay(this.container, event.text, event.style, this.canvasWidth, this.canvasHeight)
        }
        this.addLogLine(`[${event.style ?? 'narration'}] ${event.text.slice(0, 60)}`)
        break
      }

      case 'entity_damaged': {
        this.entityRenderer?.flashDamage(event.entityId)
        this.addLogLine(`${event.entityId} took ${event.amount} dmg`)
        break
      }

      case 'entity_healed': {
        this.entityRenderer?.flashHeal(event.entityId)
        this.addLogLine(`${event.entityId} healed ${event.amount} HP`)
        break
      }

      case 'entity_facing_changed': {
        this.entityRenderer?.handleFacingChange(event.entityId, event.facing)
        break
      }

      case 'tile_changed': {
        this.addLogLine(`Tile (${event.col},${event.row}) changed`)
        break
      }

      case 'world_property_set': {
        this.addLogLine(`World: ${event.key} = ${JSON.stringify(event.value)}`)
        break
      }

      case 'effect': {
        this.playEffect(event.position, event.effectTag, event.duration)
        break
      }

      case 'round_started': {
        this.addLogLine(`─── Round ${event.round} ───`)
        break
      }

      case 'turn_started': {
        this.addLogLine(`→ Turn: ${event.agentRoleId}`)
        break
      }

      // ── New subsystem events ──────────────────────────────────────────

      case 'timer_fired': {
        this.addLogLine(`⏱ Timer: ${event.timerName}`)
        break
      }

      case 'trigger_fired': {
        this.addLogLine(`⚡ Trigger: ${event.triggerName} (${event.fireType} by ${event.entityId})`)
        break
      }

      case 'status_effect_applied': {
        this.addLogLine(`✦ ${event.entityId} +${event.effectName}`)
        this.entityRenderer?.flashStatusEffect(event.entityId, 0x8844ff)
        break
      }

      case 'status_effect_expired': {
        this.addLogLine(`✧ ${event.entityId} -${event.effectName}`)
        break
      }

      case 'status_effect_removed': {
        this.addLogLine(`✧ ${event.entityId} -${event.effectName}`)
        break
      }

      case 'item_received': {
        this.addLogLine(`📦 ${event.entityId} got ${event.itemName}`)
        break
      }

      case 'item_equipped': {
        this.addLogLine(`⚔ ${event.entityId} equipped ${event.itemName} [${event.slot}]`)
        break
      }

      case 'item_used': {
        this.addLogLine(`🧪 ${event.entityId} used ${event.itemName}`)
        break
      }

      case 'item_transferred': {
        this.addLogLine(`↔ ${event.itemName}: ${event.fromEntityId} → ${event.toEntityId}`)
        break
      }

      case 'state_transition': {
        const entity = event.entityId ? ` (${event.entityId})` : ''
        this.addLogLine(`⚙ ${event.machineId}${entity}: ${event.oldState} → ${event.newState}`)
        break
      }

      case 'group_created': {
        this.addLogLine(`👥 Group: ${event.groupName}`)
        break
      }

      case 'relationship_created': {
        this.addLogLine(`🔗 ${event.fromEntityId} ${event.relType} ${event.toEntityId}`)
        break
      }
    }
  }

  private addLogLine(text: string): void {
    const logText = new PIXI.Text({
      text,
      style: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
        fill: 0x888888,
        wordWrap: true,
        wordWrapWidth: 400,
      },
    })
    logText.y = this.logTexts.length * 14
    this.eventLog.addChild(logText)
    this.logTexts.push(logText)

    // Trim log
    while (this.logTexts.length > UIRenderer.MAX_LOG_LINES) {
      const old = this.logTexts.shift()
      old?.destroy()
      for (const t of this.logTexts) {
        t.y -= 14
      }
    }
  }

  private playEffect(
    position: GridPosition | FreeformPosition,
    effectTag: string,
    duration = 1000,
    tileSize = 48
  ): void {
    const texture = this.assetResolver(effectTag, 'effect')
    if (!texture) return

    const sprite = new PIXI.Sprite(texture)
    if ('col' in position) {
      sprite.x = position.col * tileSize + tileSize / 2
      sprite.y = position.row * tileSize + tileSize / 2
    } else {
      sprite.x = position.x
      sprite.y = position.y
    }
    sprite.anchor.set(0.5)
    sprite.alpha = 1

    const id = `effect_${Date.now()}_${Math.random().toString(36).slice(2)}`
    this.effects.set(id, sprite)
    this.container.addChild(sprite)

    const startTime = performance.now()
    const onTick = () => {
      const elapsed = performance.now() - startTime
      const t = elapsed / duration
      sprite.alpha = 1 - t
      sprite.scale.set(1 + t * 0.5)
      if (t >= 1) {
        sprite.destroy()
        this.effects.delete(id)
        this.ticker.remove(onTick)
      }
    }
    this.ticker.add(onTick)
  }

  tick(): void {
    const now = Date.now()

    // Update speech bubbles — track entity positions during movement
    for (const [id, bubble] of this.speechBubbles) {
      const pos = this.getEntityScreenPosFn?.(bubble.entityId) ?? null
      if (pos) bubble.setPosition(pos.x, pos.y - 40)
      if (bubble.tick()) {
        this.speechBubbles.delete(id)
      }
    }

    // Update narration — drain queue when current narration is dismissed
    if (this.narration) {
      this.narration.tick(now)
      if (this.narration.isDismissed()) {
        this.narration.destroy()
        this.narration = null
        // Advance to next in queue
        if (this.narrationQueue.length > 0) {
          const next = this.narrationQueue.shift()!
          this.narration = new NarrationDisplay(this.container, next.text, next.style, this.canvasWidth, this.canvasHeight)
        }
      }
    }
  }

  updateCanvasSize(width: number, height: number): void {
    this.canvasWidth = width
    this.canvasHeight = height
  }

  destroy(): void {
    for (const bubble of this.speechBubbles.values()) {
      bubble.destroy()
    }
    this.speechBubbles.clear()
    for (const effect of this.effects.values()) {
      effect.destroy()
    }
    this.effects.clear()
    for (const t of this.logTexts) {
      t.destroy()
    }
    this.logTexts = []
    this.container.destroy({ children: true })
  }
}
