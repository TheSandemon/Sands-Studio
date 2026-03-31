/**
 * ComputerIcon.ts
 *
 * A clickable pixel-art computer drawn with Pixi.js Graphics.
 * Rendered inside the Habitat canvas — one per terminal territory.
 * Screen color reflects terminal state; clicking toggles terminal visibility.
 */

import * as PIXI from 'pixi.js'
import { useTerminalStore } from '../store/useTerminalStore'
import type { Territory } from './Creature'
import type { TerminalState } from '../store/useTerminalStore'

// Monitor pixel dimensions
const MON_W  = 34
const MON_H  = 22
const STAND_W = 6
const STAND_H = 5
const BASE_W  = 20
const BASE_H  = 3
const TOTAL_H = MON_H + STAND_H + BASE_H  // 30

const SCREEN_COLOR: Record<string, number> = {
  idle:     0x5b90f0,
  busy:     0xffdd55,
  sleep:    0x1a1a44,
  error:    0xff4455,
  talking:  0xbd93f9,
  egg:      0xfff5cc,
  hatching: 0xffff55,
}

export class ComputerIcon {
  readonly container: PIXI.Container
  readonly terminalId: string

  private gfx: PIXI.Graphics
  private state: TerminalState = 'idle'
  private active = true
  private hovering = false

  constructor(terminalId: string, territory: Territory) {
    this.terminalId = terminalId

    this.container = new PIXI.Container()
    this.container.eventMode = 'static'
    this.container.cursor = 'pointer'

    this.gfx = new PIXI.Graphics()
    this.container.addChild(this.gfx)

    this.container.on('pointerdown', () => {
      const store = useTerminalStore.getState()
      const t = store.terminals.find((x) => x.id === terminalId)
      const currentVisible = t?.visible !== false
      store.setVisible(terminalId, !currentVisible)
    })

    this.container.on('pointerover', () => {
      this.hovering = true
      this._draw()
    })

    this.container.on('pointerout', () => {
      this.hovering = false
      this._draw()
    })

    this.setPosition(territory)
    this._draw()
  }

  /** Reposition icon within updated territory. */
  setPosition(territory: Territory): void {
    // Anchor to bottom-right quadrant of the territory
    const cx = territory.x + territory.width * 0.72
    const cy = territory.y + territory.height - 4
    this.container.x = Math.round(cx - MON_W / 2)
    this.container.y = Math.round(cy - TOTAL_H)
  }

  /** World X where the creature should idle beside this computer. */
  getAgentStandX(): number {
    return this.container.x - 14
  }

  /** World Y where the creature should idle beside this computer. */
  getAgentStandY(): number {
    return this.container.y + MON_H / 2
  }

  setState(state: TerminalState): void {
    if (state === this.state) return
    this.state = state
    this._draw()
  }

  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    this._draw()
  }

  private _draw(): void {
    this.gfx.clear()

    const alpha     = this.active ? 1.0 : 0.38
    const bodyColor = 0x1a1a32
    const rimColor  = this.hovering ? 0x8888cc : (this.active ? 0x4a4a74 : 0x2a2a44)
    const screenCol = SCREEN_COLOR[this.state] ?? 0x5b90f0
    const screenAlp = this.active ? (this.hovering ? 1.0 : 0.85) : 0.12

    // ── Monitor body ───────────────────────────────────────────────────────
    this.gfx.roundRect(0, 0, MON_W, MON_H, 3)
    this.gfx.fill({ color: bodyColor, alpha })
    this.gfx.stroke({ color: rimColor, width: 1.5, alpha })

    // ── Screen ─────────────────────────────────────────────────────────────
    this.gfx.rect(3, 3, MON_W - 6, MON_H - 6)
    this.gfx.fill({ color: screenCol, alpha: screenAlp })

    // Scanlines on active screen
    if (this.active && this.state !== 'sleep') {
      const lineAlpha = 0.14
      for (let sy = 5; sy < MON_H - 4; sy += 3) {
        this.gfx.moveTo(3, sy)
        this.gfx.lineTo(MON_W - 3, sy)
      }
      this.gfx.stroke({ color: 0x000000, width: 1, alpha: lineAlpha })
    }

    // Screen corner reflection dot
    if (this.active) {
      this.gfx.rect(4, 4, 4, 2)
      this.gfx.fill({ color: 0xffffff, alpha: 0.18 })
    }

    // ── Stand ──────────────────────────────────────────────────────────────
    const standX = Math.round((MON_W - STAND_W) / 2)
    this.gfx.rect(standX, MON_H, STAND_W, STAND_H)
    this.gfx.fill({ color: rimColor, alpha })

    // ── Base ───────────────────────────────────────────────────────────────
    const baseX = Math.round((MON_W - BASE_W) / 2)
    this.gfx.rect(baseX, MON_H + STAND_H, BASE_W, BASE_H)
    this.gfx.fill({ color: rimColor, alpha })

    // ── Hover ring ────────────────────────────────────────────────────────
    if (this.hovering) {
      this.gfx.roundRect(-2, -2, MON_W + 4, TOTAL_H + 4, 4)
      this.gfx.stroke({ color: 0x8888ff, width: 1, alpha: 0.5 })
    }

    // ── Offline indicator (×) when terminal is hidden ─────────────────────
    if (!this.active) {
      const cx = MON_W / 2
      const cy = (MON_H - 6) / 2 + 3
      const r  = 4
      this.gfx.moveTo(cx - r, cy - r)
      this.gfx.lineTo(cx + r, cy + r)
      this.gfx.moveTo(cx + r, cy - r)
      this.gfx.lineTo(cx - r, cy + r)
      this.gfx.stroke({ color: 0xff4455, width: 1.5, alpha: 0.8 })
    }
  }

  destroy(): void {
    this.container.destroy({ children: true })
  }
}
