// =============================================================================
// Module Engine — A* Pathfinding
// Grid-aware shortest path calculation for agent use.
// =============================================================================

import type { GridPosition, GridWorld } from './types'

interface PathNode {
  col: number
  row: number
  g: number // cost from start
  h: number // heuristic to goal
  f: number // g + h
  parent: PathNode | null
}

function manhattan(a: GridPosition, b: GridPosition): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row)
}

function chebyshev(a: GridPosition, b: GridPosition): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))
}

const CARDINAL_DIRS = [
  { dc: 0, dr: -1 }, // up
  { dc: 1, dr: 0 },  // right
  { dc: 0, dr: 1 },  // down
  { dc: -1, dr: 0 }, // left
]

const DIAGONAL_DIRS = [
  ...CARDINAL_DIRS,
  { dc: 1, dr: -1 },  // up-right
  { dc: 1, dr: 1 },   // down-right
  { dc: -1, dr: 1 },  // down-left
  { dc: -1, dr: -1 }, // up-left
]

export interface PathfindingOptions {
  maxDistance?: number
  avoidPositions?: GridPosition[]
  diagonals?: boolean
}

/**
 * A* pathfinding on a grid world.
 * Returns the path as an array of positions (including start and end), or null if no path exists.
 */
export function findPath(
  grid: GridWorld,
  from: GridPosition,
  to: GridPosition,
  options: PathfindingOptions = {}
): GridPosition[] | null {
  const { maxDistance = 100, avoidPositions = [], diagonals = false } = options

  // Quick exit: target is out of bounds
  if (to.col < 0 || to.col >= grid.width || to.row < 0 || to.row >= grid.height) {
    return null
  }

  // Quick exit: target is not walkable
  const targetTile = grid.tiles[to.row]?.[to.col]
  if (!targetTile || !targetTile.walkable) {
    return null
  }

  // Quick exit: already there
  if (from.col === to.col && from.row === to.row) {
    return [{ col: from.col, row: from.row }]
  }

  const heuristic = diagonals ? chebyshev : manhattan
  const dirs = diagonals ? DIAGONAL_DIRS : CARDINAL_DIRS

  // Build avoid set for O(1) lookup
  const avoidSet = new Set(avoidPositions.map((p) => `${p.col},${p.row}`))

  const openSet: PathNode[] = []
  const closedSet = new Set<string>()

  const startNode: PathNode = {
    col: from.col,
    row: from.row,
    g: 0,
    h: heuristic(from, to),
    f: 0,
    parent: null,
  }
  startNode.f = startNode.g + startNode.h
  openSet.push(startNode)

  const gScores = new Map<string, number>()
  gScores.set(`${from.col},${from.row}`, 0)

  while (openSet.length > 0) {
    // Find node with lowest f score
    let bestIdx = 0
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[bestIdx].f) bestIdx = i
    }
    const current = openSet[bestIdx]
    openSet.splice(bestIdx, 1)

    // Reached the goal
    if (current.col === to.col && current.row === to.row) {
      const path: GridPosition[] = []
      let node: PathNode | null = current
      while (node) {
        path.unshift({ col: node.col, row: node.row })
        node = node.parent
      }
      return path
    }

    const key = `${current.col},${current.row}`
    if (closedSet.has(key)) continue
    closedSet.add(key)

    // Max distance check
    if (current.g >= maxDistance) continue

    for (const dir of dirs) {
      const nc = current.col + dir.dc
      const nr = current.row + dir.dr

      // Bounds check
      if (nc < 0 || nc >= grid.width || nr < 0 || nr >= grid.height) continue

      const nkey = `${nc},${nr}`
      if (closedSet.has(nkey)) continue

      // Walkability check
      const tile = grid.tiles[nr]?.[nc]
      if (!tile || !tile.walkable) continue

      // Avoid check
      if (avoidSet.has(nkey) && !(nc === to.col && nr === to.row)) continue

      const moveCost = (dir.dc !== 0 && dir.dr !== 0) ? 1.414 : 1
      const tentativeG = current.g + moveCost

      const prevG = gScores.get(nkey)
      if (prevG !== undefined && tentativeG >= prevG) continue

      gScores.set(nkey, tentativeG)
      const neighbor: PathNode = {
        col: nc,
        row: nr,
        g: tentativeG,
        h: heuristic({ col: nc, row: nr }, to),
        f: tentativeG + heuristic({ col: nc, row: nr }, to),
        parent: current,
      }
      openSet.push(neighbor)
    }
  }

  return null // No path found
}

/**
 * Get the shortest path distance between two grid positions.
 * Returns the distance and whether the target is reachable.
 */
export function getPathDistance(
  grid: GridWorld,
  from: GridPosition,
  to: GridPosition,
  options: PathfindingOptions = {}
): { distance: number; reachable: boolean } {
  const path = findPath(grid, from, to, options)
  if (!path) return { distance: -1, reachable: false }
  return { distance: path.length - 1, reachable: true }
}
