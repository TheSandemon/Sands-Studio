/**
 * Creature.ts
 *
 * A shell agent's sprite in the habitat.
 * Wraps a Pixi AnimatedSprite, handles state transitions, and
 * implements movement between the agent's PC icon and flowchart nodes.
 *
 * Visual state effects use sprite.tint and container.alpha only —
 * no external filter packages needed.
 */

import * as PIXI from 'pixi.js'
import type { CreatureStateName } from './builtinCreatures'
import type { FpsMap, TextureMap } from './spriteSystem'

export interface Territory {
  x: number
  y: number
  width: number
  height: number
}

const SPEED: Record<CreatureStateName, number> = {
  idle:     0.7,
  busy:     2.2,
  sleep:    0,
  error:    1.5,
  talking:  1.0,
  egg:      0.2,
  hatching: 0
}

// Tint colours per state (0xffffff = no tint)
const TINT: Record<CreatureStateName, number> = {
  idle:     0xffffff,
  busy:     0xffee88, // warm yellow
  sleep:    0xffffff,
  error:    0xff4455, // red
  talking:  0xbbbbff, // cool blue
  egg:      0xffffff,
  hatching: 0xffff99  // golden glow
}

export class Creature {
  readonly container: PIXI.Container
  readonly terminalId: string

  /** Multiplier applied to all movement speeds. 0.4=slow, 1.0=normal, 2.0=fast */
  speedMultiplier = 1.0

  private sprite: PIXI.AnimatedSprite
  private textureMap: TextureMap | Record<string, PIXI.Texture[]>
  private fpsMap: FpsMap | Record<string, number>
  private state: CreatureStateName = 'idle'
  private territory: Territory

  private targetX: number
  private targetY: number
  private idleTimer = 0
  private readonly IDLE_WANDER_INTERVAL = 180 // frames between new random targets

  private nameLabel: PIXI.Text | null = null
  private computerIcon?: { getAgentStandX: () => number, getAgentStandY: () => number }

  /** When set, the sprite walks to this coordinate (a flowchart node) instead of the desk */
  private flowchartTargetX: number | null = null
  private flowchartTargetY: number | null = null

  /** Speech/thought bubble rendered above the sprite */
  private bubbleContainer: PIXI.Container | null = null
  private bubbleText: PIXI.Text | null = null
  private bubbleBg: PIXI.Graphics | null = null
  private bubbleTimer = 0
  private bubbleDuration = 0
  private bubbleOpacity = 0

  /** Current task description shown in the task branch node */
  currentTask: string | null = null

  constructor(
    terminalId: string,
    textureMap: TextureMap | Record<string, PIXI.Texture[]>,
    fpsMap: FpsMap | Record<string, number>,
    territory: Territory,
    computerIcon?: { getAgentStandX: () => number, getAgentStandY: () => number }
  ) {
    this.terminalId = terminalId
    this.textureMap = textureMap
    this.fpsMap = fpsMap
    this.territory = territory
    this.computerIcon = computerIcon

    this.container = new PIXI.Container()

    const idleTextures = textureMap['idle'] ?? Object.values(textureMap)[0]
    this.sprite = new PIXI.AnimatedSprite(idleTextures)
    this.sprite.animationSpeed = (fpsMap['idle'] ?? 2) / 60
    this.sprite.play()

    this.container.addChild(this.sprite)

    // Start in the middle of territory
    const cx = territory.x + territory.width / 2
    const cy = territory.y + territory.height / 2
    this.container.x = cx
    this.container.y = cy
    this.targetX = cx
    this.targetY = cy
  }

  setState(newState: CreatureStateName): void {
    if (newState === this.state) return
    this.state = newState

    const textures = this.textureMap[newState] ?? this.textureMap['idle']
    const fps = this.fpsMap[newState] ?? this.fpsMap['idle'] ?? 2

    this.sprite.textures = textures
    this.sprite.animationSpeed = fps / 60
    this.sprite.play()

    // Visual effects via tint and alpha — no filter packages needed
    this.sprite.tint = TINT[newState] ?? 0xffffff
    this.container.alpha = newState === 'sleep' ? 0.55 : 1

    // Pick a new wander target immediately on state change
    if (newState !== 'sleep') {
      this.pickNewTarget()
    }
  }

  setTerritory(territory: Territory): void {
    if (!territory) return
    this.territory = territory
    this.clampToTerritory()
    this.pickNewTarget()
  }

  setComputerIcon(icon: { getAgentStandX: () => number, getAgentStandY: () => number } | undefined): void {
    this.computerIcon = icon
  }

  /** Direct the sprite to walk toward a specific flowchart node coordinate. */
  setFlowchartTarget(x: number, y: number): void {
    this.flowchartTargetX = x
    this.flowchartTargetY = y
    // Immediately update the walk target
    this.targetX = x
    this.targetY = y
  }

  /** Clear the flowchart target so the sprite returns to its desk. */
  clearFlowchartTarget(): void {
    if (this.flowchartTargetX === null) return // already cleared
    this.flowchartTargetX = null
    this.flowchartTargetY = null
    this.pickNewTarget() // will snap back to desk
  }

  /** Show or hide a name label below this creature. */
  setName(name: string | undefined, visible: boolean): void {
    if (!name || !visible) {
      if (this.nameLabel) this.nameLabel.visible = false
      return
    }

    if (!this.nameLabel) {
      const label = new PIXI.Text({
        text: name,
        style: {
          fill: '#c8cce4',
          fontSize: 9,
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        }
      } as ConstructorParameters<typeof PIXI.Text>[0])
      label.y = 38 // below the ~36px sprite
      this.nameLabel = label
      this.container.addChild(label)
    } else {
      this.nameLabel.text = name
    }

    this.nameLabel.visible = true
  }

  /**
   * Display a speech/thought bubble above the sprite.
   * @param icon  Emoji or short icon string (e.g. '🔧', '💭', '⚡')
   * @param text  Short status text (e.g. 'Fixing routes...')
   * @param duration  How long to show in ms (0 = persistent until cleared)
   */
  setSpeechBubble(icon: string, text: string, duration = 5000): void {
    this.clearSpeechBubble()

    this.bubbleContainer = new PIXI.Container()
    this.bubbleContainer.y = -16 // above the sprite

    // Background pill
    this.bubbleBg = new PIXI.Graphics()
    this.bubbleContainer.addChild(this.bubbleBg)

    // Text
    const displayText = icon ? `${icon} ${text}` : text
    this.bubbleText = new PIXI.Text({
      text: displayText,
      style: {
        fill: '#e0e4ff',
        fontSize: 8,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        wordWrap: true,
        wordWrapWidth: 100,
      }
    } as ConstructorParameters<typeof PIXI.Text>[0])
    this.bubbleText.x = 6
    this.bubbleText.y = 3

    // Draw background after text is measured
    const padX = 8
    const padY = 4
    const tw = Math.min(this.bubbleText.width + padX * 2, 120)
    const th = this.bubbleText.height + padY * 2

    this.bubbleBg
      .roundRect(0, 0, tw, th, 6)
      .fill({ color: 0x0d0d1a, alpha: 0.85 })
      .roundRect(0, 0, tw, th, 6)
      .stroke({ color: 0x5b90f0, width: 1, alpha: 0.5 })

    // Small triangle pointer
    this.bubbleBg
      .moveTo(tw / 2 - 4, th)
      .lineTo(tw / 2, th + 5)
      .lineTo(tw / 2 + 4, th)
      .fill({ color: 0x0d0d1a, alpha: 0.85 })

    // Center the bubble above the sprite
    this.bubbleContainer.x = 18 - tw / 2

    this.bubbleContainer.addChild(this.bubbleText)
    this.container.addChild(this.bubbleContainer)

    this.bubbleDuration = duration
    this.bubbleTimer = 0
    this.bubbleOpacity = 1
  }

  /** Clear the speech bubble immediately. */
  clearSpeechBubble(): void {
    if (this.bubbleContainer) {
      this.container.removeChild(this.bubbleContainer)
      this.bubbleContainer.destroy({ children: true })
      this.bubbleContainer = null
      this.bubbleText = null
      this.bubbleBg = null
    }
    this.bubbleTimer = 0
    this.bubbleDuration = 0
  }

  /** Set the current task description for the task branch visualization. */
  setCurrentTask(task: string | null): void {
    this.currentTask = task
  }

  update(delta: number): void {
    this.idleTimer += delta

    // Wander: pick a new destination periodically
    const interval =
      this.state === 'busy' ? this.IDLE_WANDER_INTERVAL / 3 : this.IDLE_WANDER_INTERVAL
    if (this.idleTimer > interval) {
      this.idleTimer = 0
      this.pickNewTarget()
    }

    // Animate speech bubble fade-out
    if (this.bubbleContainer && this.bubbleDuration > 0) {
      this.bubbleTimer += delta * (1000 / 60) // approximate ms per frame
      if (this.bubbleTimer >= this.bubbleDuration) {
        // Fade out over 500ms
        const fadeStart = this.bubbleDuration
        const fadeEnd = this.bubbleDuration + 500
        if (this.bubbleTimer >= fadeEnd) {
          this.clearSpeechBubble()
        } else {
          this.bubbleOpacity = 1 - ((this.bubbleTimer - fadeStart) / 500)
          this.bubbleContainer.alpha = Math.max(0, this.bubbleOpacity)
        }
      }
    }

    if (this.state === 'sleep' || this.state === 'hatching') {
      // Keep name label centered even when not moving
      this.updateLabelPosition()
      return
    }

    const dx = this.targetX - this.container.x
    const dy = this.targetY - this.container.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > 1) {
      let speed = (SPEED[this.state] ?? 0.7) * this.speedMultiplier
      
      // Sprint when walking to task nodes far across the map
      if (this.flowchartTargetX !== null) {
        speed *= 8.0
      }

      this.container.x += (dx / dist) * speed * delta
      this.container.y += (dy / dist) * speed * delta

      // Flip sprite to face direction of travel
      this.sprite.scale.x = dx < 0 ? -1 : 1
      this.sprite.anchor.x = dx < 0 ? 1 : 0
    }

    this.updateLabelPosition()
  }

  private updateLabelPosition(): void {
    if (!this.nameLabel || !this.nameLabel.visible) return
    // Center the label below the sprite, accounting for flip direction.
    // sprite visual center in container coords: +18 when facing right, -18 when facing left
    const lw = this.nameLabel.width || 36
    const cx = this.sprite.anchor.x === 1 ? -18 : 18
    this.nameLabel.x = cx - lw / 2
  }

  private pickNewTarget(): void {
    if (!this.territory || !this.sprite || this.sprite.destroyed) return
    const { x, y, width, height } = this.territory
    
    let spriteW = 36
    let spriteH = 36
    try {
      spriteW = this.sprite.width || 36
      spriteH = this.sprite.height || 36
    } catch (err) {
      // Fallback if Pixi bounds computation throws immediately after creation/hatching
    }

    if (this.flowchartTargetX !== null && this.flowchartTargetY !== null) {
      // Walk toward the claimed flowchart node
      this.targetX = this.flowchartTargetX
      this.targetY = this.flowchartTargetY
    } else if (this.computerIcon) {
      // Stand directly beside the computer icon
      this.targetX = this.computerIcon.getAgentStandX()
      this.targetY = this.computerIcon.getAgentStandY()
    } else {
      // Random wandering inside territory
      this.targetX = x + spriteW / 2 + Math.random() * Math.max(0, width - spriteW)
      this.targetY = y + spriteH / 2 + Math.random() * Math.max(0, height - spriteH)
    }
  }

  private clampToTerritory(): void {
    if (!this.territory || !this.container || this.container.destroyed || !this.sprite || this.sprite.destroyed) return

    const { x, y, width, height } = this.territory
    
    this.container.x = Math.max(x, Math.min(x + width, this.container.x))
    this.container.y = Math.max(y, Math.min(y + height, this.container.y))
  }

  destroy(): void {
    this.sprite.stop()
    this.container.destroy({ children: true })
  }
}
