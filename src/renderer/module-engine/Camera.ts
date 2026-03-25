// =============================================================================
// Module Engine — Camera
// Viewport management: follow entity, pan, zoom, shake.
// =============================================================================

import * as PIXI from 'pixi.js'

export class Camera {
  private app: PIXI.Application
  private viewport: PIXI.Container
  private target: PIXI.Container | null = null
  private zoom = 1.0
  private targetZoom = 1.0
  private panTarget: { x: number; y: number } | null = null
  private readonly minZoom = 0.5
  private readonly maxZoom = 3.0

  // Shake state
  private shakeIntensity = 0
  private shakeDuration = 0
  private shakeElapsed = 0
  private shakeOffsetX = 0
  private shakeOffsetY = 0

  constructor(app: PIXI.Application) {
    this.app = app
    this.viewport = new PIXI.Container()
    app.stage.addChild(this.viewport)
  }

  get container(): PIXI.Container {
    return this.viewport
  }

  follow(entityContainer: PIXI.Container | null): void {
    this.target = entityContainer
  }

  panTo(x: number, y: number, animated = true): void {
    if (!animated) {
      this.viewport.x = -x * this.zoom + this.app.screen.width / 2
      this.viewport.y = -y * this.zoom + this.app.screen.height / 2
      this.panTarget = null
      return
    }
    this.panTarget = { x, y }
  }

  setZoom(level: number, animated = true): void {
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, level))
    if (!animated) {
      this.zoom = this.targetZoom
      this.viewport.scale.set(this.zoom)
    }
  }

  /** Trigger a camera shake for impact moments. */
  shake(intensity: number, durationMs: number): void {
    this.shakeIntensity = intensity
    this.shakeDuration = durationMs
    this.shakeElapsed = 0
  }

  update(delta: number): void {
    // Smooth zoom
    if (Math.abs(this.zoom - this.targetZoom) > 0.001) {
      this.zoom += (this.targetZoom - this.zoom) * 0.1 * delta
      this.viewport.scale.set(this.zoom)
    }

    // Follow target entity
    if (this.target) {
      const tx = -this.target.x * this.zoom + this.app.screen.width / 2
      const ty = -this.target.y * this.zoom + this.app.screen.height / 2
      this.viewport.x += (tx - this.viewport.x) * 0.08 * delta
      this.viewport.y += (ty - this.viewport.y) * 0.08 * delta
    }

    // Pan to target
    if (this.panTarget) {
      const tx = -this.panTarget.x * this.zoom + this.app.screen.width / 2
      const ty = -this.panTarget.y * this.zoom + this.app.screen.height / 2
      this.viewport.x += (tx - this.viewport.x) * 0.1 * delta
      this.viewport.y += (ty - this.viewport.y) * 0.1 * delta
      if (Math.abs(this.viewport.x - tx) < 1 && Math.abs(this.viewport.y - ty) < 1) {
        this.panTarget = null
      }
    }

    // Camera shake — decaying random offset applied each frame
    if (this.shakeElapsed < this.shakeDuration) {
      this.shakeElapsed += delta * 16.67  // rough ms per frame
      const progress = this.shakeElapsed / this.shakeDuration
      const decay = 1 - progress
      const magnitude = this.shakeIntensity * decay
      this.shakeOffsetX = (Math.random() * 2 - 1) * magnitude
      this.shakeOffsetY = (Math.random() * 2 - 1) * magnitude
    } else {
      this.shakeOffsetX = 0
      this.shakeOffsetY = 0
    }

    // Apply shake offset on top of viewport position
    const base = this.viewport
    // Note: we apply shake via viewport position offset, done in the render layer
  }

  /** Returns current shake offsets for external application. */
  getShakeOffset(): { x: number; y: number } {
    return { x: this.shakeOffsetX, y: this.shakeOffsetY }
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: wx * this.zoom + this.viewport.x,
      y: wy * this.zoom + this.viewport.y,
    }
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewport.x) / this.zoom,
      y: (sy - this.viewport.y) / this.zoom,
    }
  }
}
