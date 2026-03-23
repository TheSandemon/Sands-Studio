/**
 * Creature.ts
 *
 * A single living creature in the habitat.
 * Wraps a Pixi AnimatedSprite, handles state transitions, and
 * implements wandering movement within an assigned territory.
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

  constructor(
    terminalId: string,
    textureMap: TextureMap | Record<string, PIXI.Texture[]>,
    fpsMap: FpsMap | Record<string, number>,
    territory: Territory
  ) {
    this.terminalId = terminalId
    this.textureMap = textureMap
    this.fpsMap = fpsMap
    this.territory = territory

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
    this.territory = territory
    this.clampToTerritory()
    this.pickNewTarget()
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

  update(delta: number): void {
    this.idleTimer += delta

    // Wander: pick a new destination periodically
    const interval =
      this.state === 'busy' ? this.IDLE_WANDER_INTERVAL / 3 : this.IDLE_WANDER_INTERVAL
    if (this.idleTimer > interval) {
      this.idleTimer = 0
      this.pickNewTarget()
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
      const speed = (SPEED[this.state] ?? 0.7) * this.speedMultiplier
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
    const { x, y, width, height } = this.territory
    const spriteW = this.sprite.width
    const spriteH = this.sprite.height

    this.targetX = x + spriteW / 2 + Math.random() * Math.max(0, width - spriteW)
    this.targetY = y + spriteH / 2 + Math.random() * Math.max(0, height - spriteH)
  }

  private clampToTerritory(): void {
    const { x, y, width, height } = this.territory
    this.container.x = Math.max(x, Math.min(x + width, this.container.x))
    this.container.y = Math.max(y, Math.min(y + height, this.container.y))
  }

  destroy(): void {
    this.sprite.stop()
    this.container.destroy({ children: true })
  }
}
