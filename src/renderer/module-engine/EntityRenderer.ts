// =============================================================================
// Module Engine — Entity Renderer
// Renders game entities with smooth movement tweens.
// =============================================================================

import * as PIXI from 'pixi.js'
import type { Entity, EntityState, GridPosition, FreeformPosition, SerializedWorldState } from '../../shared/types'

// ── Tween ─────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

interface Tween {
  sprite: PIXI.Container
  startX: number
  startY: number
  endX: number
  endY: number
  startTime: number
  duration: number
  done: boolean
  delay?: number
}

interface HpTween {
  entityId: string
  hpBar: PIXI.Container
  currentRatio: number
  targetRatio: number
  startTime: number
  duration: number
  done: boolean
}

function tickTween(tween: Tween): boolean {
  if (tween.delay && Date.now() - tween.startTime < tween.delay) return false
  const elapsed = Date.now() - tween.startTime - (tween.delay ?? 0)
  const t = Math.min(1, elapsed / tween.duration)
  const eased = easeOutQuad(t)
  tween.sprite.x = lerp(tween.startX, tween.endX, eased)
  tween.sprite.y = lerp(tween.startY, tween.endY, eased)
  if (t >= 1) {
    tween.done = true
  }
  return tween.done
}

function easeOutBounce(t: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  else if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  else if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  else return n1 * (t -= 2.625 / d1) * t + 0.984375
}

function tickHpTween(tween: HpTween): boolean {
  const elapsed = Date.now() - tween.startTime
  const t = Math.min(1, elapsed / tween.duration)
  const eased = easeOutQuad(t)
  const ratio = lerp(tween.currentRatio, tween.targetRatio, eased)
  // Update the foreground bar width (child[1] is fg, geometry is at index 0)
  const fg = tween.hpBar.children[1] as PIXI.Graphics
  if (fg) {
    fg.clear()
    fg.rect(-16, 0, Math.round(32 * ratio), 4)
    fg.fill({ color: ratio > 0.5 ? 0x44ff44 : ratio > 0.25 ? 0xffff44 : 0xff4444 })
  }
  if (t >= 1) {
    tween.done = true
  }
  return tween.done
}

// ── Entity Renderer ────────────────────────────────────────────────────────────

export class EntityRenderer {
  private container: PIXI.Container
  private sprites = new Map<string, PIXI.Container>()
  private tweens = new Map<string, Tween>()
  private hpTweens = new Map<string, HpTween>()
  private assetResolver: (tag: string, category: 'entity') => PIXI.Texture | null
  private hpBars = new Map<string, PIXI.Container>()

  // State tint colors
  private static readonly STATE_TINTS: Partial<Record<EntityState, number>> = {
    idle: 0xffffff,
    moving: 0xffffff,
    attacking: 0xff4444,
    casting: 0x4488ff,
    talking: 0x88aaff,
    dying: 0xff0000,
    dead: 0x444444,
    hidden: 0x000000,
    stunned: 0xffaa00,
    flying: 0x88ffff,
  }

  constructor(
    parent: PIXI.Container,
    assetResolver: (tag: string, category: 'entity') => PIXI.Texture | null
  ) {
    this.container = new PIXI.Container()
    this.container.sortableChildren = true
    parent.addChild(this.container)
    this.assetResolver = assetResolver
  }

  sync(entities: Entity[], tileSize = 48): void {
    const ids = new Set(entities.map((e) => e.id))

    // Remove entities that no longer exist
    for (const [id, sprite] of this.sprites) {
      if (!ids.has(id)) {
        sprite.destroy({ children: true })
        this.sprites.delete(id)
        this.tweens.delete(id)
        this.hpBars.delete(id)
      }
    }

    // Add/update entities
    for (const entity of entities) {
      if (!entity.visible) continue

      if (!this.sprites.has(entity.id)) {
        const sprite = this.createEntitySprite(entity, tileSize)
        this.sprites.set(entity.id, sprite)
        this.container.addChild(sprite)
      }

      const sprite = this.sprites.get(entity.id)!
      const pos = this.entityToPixel(entity.position, tileSize)

      // Don't override position while a movement tween is in progress
      if (!this.tweens.has(entity.id)) {
        sprite.x = pos.x
        sprite.y = pos.y
      }
      sprite.zIndex = entity.layer ?? 0

      this.applyState(sprite, entity.state)

      // Animate HP bar to new value (interpolate over 300ms)
      const hpBar = this.hpBars.get(entity.id)
      if (hpBar) {
        const hp = entity.properties['hp'] as number | undefined
        const maxHp = entity.properties['maxHp'] as number | undefined
        if (hp !== undefined) {
          const targetRatio = Math.max(0, Math.min(1, hp / (maxHp ?? hp)))
          const existing = this.hpTweens.get(entity.id)
          const currentRatio = existing
            ? existing.currentRatio
            : (() => {
                // Read current displayed ratio from the fg child
                const fg = hpBar.children[1] as PIXI.Graphics
                if (fg && fg.width !== undefined) return fg.width / 32
                return targetRatio
              })()
          if (Math.abs(currentRatio - targetRatio) > 0.01) {
            this.hpTweens.set(entity.id, {
              entityId: entity.id,
              hpBar,
              currentRatio,
              targetRatio,
              startTime: Date.now(),
              duration: 300,
              done: false,
            })
          }
        }
      }
    }
  }

  private createEntitySprite(entity: Entity, tileSize: number): PIXI.Container {
    const container = new PIXI.Container()

    const texture = this.assetResolver(entity.spriteTag, 'entity')
    if (texture) {
      const sprite = new PIXI.Sprite(texture)
      sprite.anchor.set(0.5)
      container.addChild(sprite)
    } else {
      // Fallback: colored rectangle placeholder
      const rect = new PIXI.Graphics()
      rect.rect(-tileSize / 2, -tileSize / 2, tileSize, tileSize)
      rect.fill({ color: 0x5b90f0 })
      container.addChild(rect)
    }

    // Name label
    const name = new PIXI.Text({
      text: entity.name,
      style: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 9,
        fill: 0xffffff,
        dropShadow: { color: 0x000000, blur: 2, distance: 1 },
      },
    })
    name.anchor.set(0.5)
    name.y = tileSize / 2 + 6
    container.addChild(name)

    // Health bar (if entity has HP)
    const hp = entity.properties['hp'] as number | undefined
    const maxHp = entity.properties['maxHp'] as number | undefined
    if (hp !== undefined) {
      const bar = this.createHealthBar(hp, maxHp ?? hp)
      bar.y = -tileSize / 2 - 6
      container.addChild(bar)
      this.hpBars.set(entity.id, bar)
    }

    this.applyState(container, entity.state)
    return container
  }

  private createHealthBar(hp: number, maxHp: number): PIXI.Container {
    const container = new PIXI.Container()
    const bg = new PIXI.Graphics()
    const fg = new PIXI.Graphics()

    bg.rect(-16, 0, 32, 4)
    bg.fill({ color: 0x222222 })
    container.addChild(bg)

    const ratio = hp / maxHp
    fg.rect(-16, 0, 32 * ratio, 4)
    fg.fill({ color: ratio > 0.5 ? 0x44ff44 : ratio > 0.25 ? 0xffff44 : 0xff4444 })
    container.addChild(fg)

    return container
  }

  private applyState(sprite: PIXI.Container, state: EntityState): void {
    const tint = EntityRenderer.STATE_TINTS[state] ?? 0xffffff
    sprite.alpha = state === 'hidden' ? 0 : 1

    const spriteEl = sprite.children[0]
    if (spriteEl instanceof PIXI.Sprite) {
      spriteEl.tint = tint
    }
  }

  animateMove(
    entityId: string,
    from: GridPosition | FreeformPosition,
    to: GridPosition | FreeformPosition,
    tileSize = 48,
    duration = 400,
    delay = 0
  ): void {
    const sprite = this.sprites.get(entityId)
    if (!sprite) return

    const fromPos = this.entityToPixel(from, tileSize)
    const toPos = this.entityToPixel(to, tileSize)

    this.tweens.set(entityId, {
      sprite,
      startX: fromPos.x,
      startY: fromPos.y,
      endX: toPos.x,
      endY: toPos.y,
      startTime: Date.now(),
      duration,
      done: false,
      delay,
    })
  }

  animateSpawn(entityId: string): void {
    const sprite = this.sprites.get(entityId)
    if (!sprite) return
    sprite.scale.set(0)
    this._spawnAnimations.set(entityId, {
      sprite,
      startTime: Date.now(),
      duration: 200,
    })
  }

  animateDeath(entityId: string): void {
    const sprite = this.sprites.get(entityId)
    if (!sprite) return
    this._deathAnimations.set(entityId, {
      sprite,
      startTime: Date.now(),
      duration: 400,
      startAlpha: sprite.alpha,
      startScale: sprite.scale.x,
    })
  }

  private _spawnAnimations = new Map<string, { sprite: PIXI.Container; startTime: number; duration: number }>()
  private _deathAnimations = new Map<string, { sprite: PIXI.Container; startTime: number; duration: number; startAlpha: number; startScale: number }>()

  flashDamage(entityId: string): void {
    const sprite = this.sprites.get(entityId)
    if (!sprite) return

    const spriteEl = sprite.children[0]
    if (spriteEl instanceof PIXI.Sprite) {
      spriteEl.tint = 0xff0000
      setTimeout(() => { spriteEl.tint = 0xffffff }, 150)
    } else {
      // Fallback for Graphics placeholder: alpha pulse
      sprite.alpha = 0.3
      setTimeout(() => { sprite.alpha = 1 }, 150)
    }
  }

  flashHeal(entityId: string): void {
    const sprite = this.sprites.get(entityId)
    if (!sprite) return

    const spriteEl = sprite.children[0]
    if (spriteEl instanceof PIXI.Sprite) {
      spriteEl.tint = 0x44ff44
      setTimeout(() => { spriteEl.tint = 0xffffff }, 200)
    } else {
      sprite.alpha = 0.5
      setTimeout(() => { sprite.alpha = 1 }, 200)
    }
  }

  flashStatusEffect(entityId: string, color: number): void {
    const sprite = this.sprites.get(entityId)
    if (!sprite) return

    const spriteEl = sprite.children[0]
    if (spriteEl instanceof PIXI.Sprite) {
      spriteEl.tint = color
      setTimeout(() => { spriteEl.tint = 0xffffff }, 250)
    } else {
      sprite.alpha = 0.6
      setTimeout(() => { sprite.alpha = 1 }, 250)
    }
  }

  handleFacingChange(entityId: string, facing: 'left' | 'right' | 'up' | 'down'): void {
    const sprite = this.sprites.get(entityId)
    if (!sprite) return
    if (facing === 'left') sprite.scale.x = -Math.abs(sprite.scale.x)
    else if (facing === 'right') sprite.scale.x = Math.abs(sprite.scale.x)
  }

  addEntity(entity: Entity, tileSize: number): void {
    if (this.sprites.has(entity.id) || !entity.visible) return
    const sprite = this.createEntitySprite(entity, tileSize)
    const pos = this.entityToPixel(entity.position, tileSize)
    sprite.x = pos.x
    sprite.y = pos.y
    sprite.zIndex = entity.layer ?? 0
    this.sprites.set(entity.id, sprite)
    this.container.addChild(sprite)
  }

  removeEntity(entityId: string): void {
    const sprite = this.sprites.get(entityId)
    if (!sprite) return
    sprite.destroy({ children: true })
    this.sprites.delete(entityId)
    this.tweens.delete(entityId)
    this.hpTweens.delete(entityId)
    this._spawnAnimations.delete(entityId)
    this._deathAnimations.delete(entityId)
    this.hpBars.delete(entityId)
  }

  update(delta: number): void {
    for (const [id, tween] of this.tweens) {
      const done = tickTween(tween)
      if (done) {
        this.tweens.delete(id)
      }
    }

    // Tick HP bar interpolations
    for (const [id, tween] of this.hpTweens) {
      const done = tickHpTween(tween)
      if (done) {
        this.hpTweens.delete(id)
      }
    }

    // Tick spawn animations (scale 0 → 1 with bounce)
    for (const [id, anim] of this._spawnAnimations) {
      const elapsed = Date.now() - anim.startTime
      const t = Math.min(1, elapsed / anim.duration)
      anim.sprite.scale.set(easeOutBounce(t))
      if (t >= 1) {
        anim.sprite.scale.set(1)
        this._spawnAnimations.delete(id)
      }
    }

    // Tick death animations (fade to 50% + scale to 0.8, then remove)
    for (const [id, anim] of this._deathAnimations) {
      const elapsed = Date.now() - anim.startTime
      const t = Math.min(1, elapsed / anim.duration)
      anim.sprite.alpha = lerp(anim.startAlpha, 0.5, easeOutQuad(t))
      anim.sprite.scale.set(lerp(anim.startScale, 0.8, easeOutQuad(t)))
      if (t >= 1) {
        this.removeEntity(id)
        this._deathAnimations.delete(id)
      }
    }
  }

  private entityToPixel(pos: GridPosition | FreeformPosition, tileSize: number): { x: number; y: number } {
    if ('col' in pos) {
      return {
        x: pos.col * tileSize + tileSize / 2,
        y: pos.row * tileSize + tileSize / 2,
      }
    }
    return { x: pos.x, y: pos.y }
  }

  applyStateFromEvent(entityId: string, state: EntityState): void {
    const sprite = this.sprites.get(entityId)
    if (sprite) this.applyState(sprite, state)
  }

  getSprite(id: string): PIXI.Container | undefined {
    return this.sprites.get(id)
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy({ children: true })
    }
    this.sprites.clear()
    this.tweens.clear()
    this.hpTweens.clear()
    this._spawnAnimations.clear()
    this._deathAnimations.clear()
    this.hpBars.clear()
    this.container.destroy({ children: true })
  }
}
