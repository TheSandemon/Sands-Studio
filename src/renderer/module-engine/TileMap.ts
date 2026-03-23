// =============================================================================
// Module Engine — Tile Map Renderer
// Renders a grid-based world from a GridWorld definition.
// Falls back to a procedural checkerboard floor when no tiles are defined.
// =============================================================================

import * as PIXI from 'pixi.js'
import type { GridWorld, Tile } from '../../shared/types'

export class TileMap {
  private container: PIXI.Container
  private sprites = new Map<string, PIXI.Sprite>()
  private proceduralFloor: PIXI.Graphics | null = null
  private gridLines: PIXI.Graphics | null = null
  private grid?: GridWorld
  private tileWidth: number
  private tileHeight: number
  private showGrid: boolean
  private assetResolver: (tag: string, category: 'tile') => PIXI.Texture | null

  constructor(
    parent: PIXI.Container,
    assetResolver: (tag: string, category: 'tile') => PIXI.Texture | null,
    showGrid = false
  ) {
    this.container = new PIXI.Container()
    this.container.sortableChildren = true
    parent.addChild(this.container)
    this.tileWidth = 32
    this.tileHeight = 32
    this.showGrid = showGrid
    this.assetResolver = assetResolver
  }

  setGrid(grid: GridWorld): void {
    this.grid = grid
    this.tileWidth = grid.tileWidth ?? 32
    this.tileHeight = grid.tileHeight ?? 32
    this.rebuild()
  }

  private rebuild(): void {
    // Clear sprite tiles
    for (const sprite of this.sprites.values()) {
      sprite.destroy({ children: true })
    }
    this.sprites.clear()

    // Clear procedural graphics
    if (this.proceduralFloor) {
      this.proceduralFloor.destroy()
      this.proceduralFloor = null
    }
    if (this.gridLines) {
      this.gridLines.destroy()
      this.gridLines = null
    }

    if (!this.grid) return

    // Try to render actual tile sprites
    for (let row = 0; row < this.grid.height; row++) {
      for (let col = 0; col < this.grid.width; col++) {
        const tile = this.grid.tiles[row]?.[col]
        if (!tile) continue
        this.createTileSprite(tile)
      }
    }

    // If no tile sprites loaded, render a procedural floor
    if (this.sprites.size === 0) {
      this.buildProceduralFloor()
    }

    // Optional grid overlay
    if (this.showGrid) {
      this.buildGridLines()
    }
  }

  private buildProceduralFloor(): void {
    if (!this.grid) return
    const g = new PIXI.Graphics()
    for (let row = 0; row < this.grid.height; row++) {
      for (let col = 0; col < this.grid.width; col++) {
        g.rect(col * this.tileWidth, row * this.tileHeight, this.tileWidth, this.tileHeight)
        g.fill({ color: (row + col) % 2 === 0 ? 0x1e1e2e : 0x181828 })
      }
    }
    this.container.addChildAt(g, 0)
    this.proceduralFloor = g
  }

  private buildGridLines(): void {
    if (!this.grid) return
    const g = new PIXI.Graphics()
    const totalW = this.grid.width * this.tileWidth
    const totalH = this.grid.height * this.tileHeight
    for (let col = 0; col <= this.grid.width; col++) {
      g.moveTo(col * this.tileWidth, 0)
      g.lineTo(col * this.tileWidth, totalH)
    }
    for (let row = 0; row <= this.grid.height; row++) {
      g.moveTo(0, row * this.tileHeight)
      g.lineTo(totalW, row * this.tileHeight)
    }
    g.stroke({ width: 1, color: 0x333355, alpha: 0.4 })
    this.container.addChild(g)
    this.gridLines = g
  }

  private createTileSprite(tile: Tile): void {
    const key = `${tile.col},${tile.row}`
    const texture = this.assetResolver(tile.spriteTag, 'tile')
    if (!texture) return

    const sprite = new PIXI.Sprite(texture)
    sprite.x = tile.col * this.tileWidth
    sprite.y = tile.row * this.tileHeight
    sprite.width = this.tileWidth
    sprite.height = this.tileHeight
    sprite.zIndex = -1

    this.container.addChild(sprite)
    this.sprites.set(key, sprite)
  }

  getTileSprite(col: number, row: number): PIXI.Sprite | undefined {
    return this.sprites.get(`${col},${row}`)
  }

  updateTile(col: number, row: number, tile: Tile): void {
    const key = `${col},${row}`
    const existing = this.sprites.get(key)
    if (existing) {
      existing.destroy({ children: true })
      this.sprites.delete(key)
    }
    this.createTileSprite(tile)
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy({ children: true })
    }
    this.sprites.clear()
    this.proceduralFloor?.destroy()
    this.gridLines?.destroy()
    this.container.destroy({ children: true })
  }
}
