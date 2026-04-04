/**
 * FlowchartWorkspace.tsx
 *
 * Renders a live Mermaid.js flowchart inside the Habitat area.
 * Supports two modes:
 * 1. File-based: watches a `.mermaid` file on disk
 * 2. Atlas scan: auto-generates a structural map from the project directory
 *
 * After rendering, extracts SVG node positions and syncs them to
 * useFlowchartStore so the Pixi.js sprite layer can animate agents
 * walking to their claimed nodes. Task branches from agents are
 * dynamically composed into the mermaid text as dashed overlay edges.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import mermaid from 'mermaid'
import { useFlowchartStore, type FlowchartNodeCoords } from '../store/useFlowchartStore'
import './FlowchartWorkspace.css'

// Initialize mermaid with a dark theme that blends with the habitat
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  maxTextSize: 9000000,
  themeVariables: {
    darkMode: true,
    background: 'transparent',
    primaryColor: '#2a2a50',
    primaryTextColor: '#c8cce4',
    primaryBorderColor: '#5b90f0',
    lineColor: '#4a4a74',
    secondaryColor: '#1a1a44',
    tertiaryColor: '#0d0d1a',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '16px',
    nodeBorder: '#5b90f0',
    clusterBkg: 'rgba(26, 26, 68, 0.85)',
    clusterBorder: 'rgba(90, 90, 140, 0.5)',
    edgeLabelBackground: 'rgba(13, 13, 26, 0.9)',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis',
    padding: 16,
    nodeSpacing: 60,
    rankSpacing: 80,
  },
})

interface Props {
  /** Current working directory — we look for .mermaid files here */
  cwd?: string
}

export default function FlowchartWorkspace({ cwd }: Props) {
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [activeCwd, setActiveCwd] = useState<string | undefined>(cwd)
  const [tooltipInfo, setTooltipInfo] = useState<{
    nodeId: string
    label: string
    claimedBy?: string
    x: number
    y: number
  } | null>(null)

  const mermaidText = useFlowchartStore((s) => s.mermaidText)
  const filePath = useFlowchartStore((s) => s.filePath)
  const claims = useFlowchartStore((s) => s.claims)
  const visible = useFlowchartStore((s) => s.visible)
  const scanning = useFlowchartStore((s) => s.scanning)
  const taskBranches = useFlowchartStore((s) => s.taskBranches)
  const setMermaidText = useFlowchartStore((s) => s.setMermaidText)
  const setAtlasMermaid = useFlowchartStore((s) => s.setAtlasMermaid)
  const setFilePath = useFlowchartStore((s) => s.setFilePath)
  const setNodes = useFlowchartStore((s) => s.setNodes)
  const setLastModified = useFlowchartStore((s) => s.setLastModified)
  const setVisible = useFlowchartStore((s) => s.setVisible)
  const setScanning = useFlowchartStore((s) => s.setScanning)
  const setDimensions = useFlowchartStore((s) => s.setDimensions)
  const getComposedMermaid = useFlowchartStore((s) => s.getComposedMermaid)

  // ── Sync activeCwd with prop ──────────────────────────────────────────
  useEffect(() => {
    if (cwd) {
      setActiveCwd(cwd)
    } else if (window.flowchartAPI?.getCwd) {
      // Fallback to main process cwd if no shell is active
      window.flowchartAPI.getCwd().then(setActiveCwd)
    }
  }, [cwd])

  // ── Auto-discover .mermaid file in activeCwd ──────────────────────────
  useEffect(() => {
    if (!activeCwd || !window.flowchartAPI) return
    let cancelled = false

    const discover = async () => {
      const result = await window.flowchartAPI.find(activeCwd)
      if (cancelled || !result.ok || result.files.length === 0) {
        // Auto-scan if no mermaid file is found
        if (window.flowchartAPI?.scan) {
          setScanning(true)
          try {
            const scanResult = await window.flowchartAPI.scan(activeCwd, { maxDepth: 4 })
            if (!cancelled && scanResult.ok && scanResult.mermaid) {
              setAtlasMermaid(scanResult.mermaid, scanResult.tree, scanResult.rootId)
              setMermaidText(scanResult.mermaid)
            }
          } catch (err) {
            console.error('[FlowchartWorkspace] Auto-scan failed:', err)
          } finally {
            if (!cancelled) setScanning(false)
          }
        }
        return
      }

      const target = result.files[0]
      setFilePath(target)

      const readResult = await window.flowchartAPI.read(target)
      if (cancelled || !readResult.ok || !readResult.text) return

      setMermaidText(readResult.text)
      setLastModified(readResult.mtime ?? 0)

      await window.flowchartAPI.watch(target)
    }

    discover()

    return () => {
      cancelled = true
      window.flowchartAPI?.unwatch()
    }
  }, [activeCwd, setFilePath, setMermaidText, setLastModified])

  // ── Listen for file changes from the watcher ──────────────────────────
  useEffect(() => {
    if (!window.flowchartAPI) return

    const off = window.flowchartAPI.onChanged(({ text, mtime }) => {
      setMermaidText(text)
      setLastModified(mtime)
    })

    return off
  }, [setMermaidText, setLastModified])

  // ── Scan project directory (Atlas) ────────────────────────────────────
  const handleScanProject = useCallback(async () => {
    if (!activeCwd || !window.flowchartAPI?.scan) return
    setScanning(true)
    try {
      const result = await window.flowchartAPI.scan(activeCwd, { maxDepth: 4 })
      if (result.ok && result.mermaid) {
        setAtlasMermaid(result.mermaid, result.tree, result.rootId)
        if (!mermaidText) {
          setMermaidText(result.mermaid)
        }
      }
    } catch (err) {
      console.error('[FlowchartWorkspace] Scan failed:', err)
    } finally {
      setScanning(false)
    }
  }, [activeCwd, mermaidText, setAtlasMermaid, setMermaidText, setScanning])

  // ── Extract node positions from rendered SVG ──────────────────────────
  const extractNodePositions = useCallback(() => {
    const container = svgContainerRef.current
    if (!container) return

    const svgEl = container.querySelector('svg')
    if (!svgEl) return

    const containerRect = container.getBoundingClientRect()
    const nodeGroups = svgEl.querySelectorAll('.node, .cluster')
    const coords: FlowchartNodeCoords[] = []

    nodeGroups.forEach((group) => {
      let id = group.id || (group as HTMLElement).dataset?.id || ''
      if (!id) return

      // Mermaid wraps node IDs: "flowchart-myNodeId-123" → extract "myNodeId"
      const mermaidMatch = id.match(/^flowchart-(.+)-\d+$/)
      if (mermaidMatch) {
        id = mermaidMatch[1]
      }

      const rect = group.getBoundingClientRect()
      const isCluster = group.classList.contains('cluster')
      const labelEl = isCluster ? group.querySelector('.cluster-label, text') : group.querySelector('.nodeLabel, tspan, text')
      const label = labelEl?.textContent?.trim() || id

      coords.push({
        id,
        label,
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
      })
    })

    setNodes(coords)
  }, [setNodes])

  // ── Apply claim highlights ──────────────────────────────────────────
  const applyClaims = useCallback(() => {
    const container = svgContainerRef.current
    if (!container) return

    container.querySelectorAll('.node.claimed').forEach((el) => {
      el.classList.remove('claimed')
    })

    for (const [nodeId] of Object.entries(claims)) {
      // Mermaid wraps IDs as "flowchart-<nodeId>-<N>", so match via contains
      const nodeEl = container.querySelector(`[id*="${CSS.escape(nodeId)}"]`)
      if (nodeEl) {
        const closest = nodeEl.closest('.node') || nodeEl
        closest.classList.add('claimed')
      }
    }
  }, [claims])

  useEffect(() => {
    applyClaims()
  }, [claims, applyClaims])

  // ── Render mermaid text to SVG ────────────────────────────────────────
  const composedText = getComposedMermaid()

  useEffect(() => {
    if (!composedText.trim() || !svgContainerRef.current) return

    let cancelled = false

    const render = async () => {
      try {
        const uniqueId = `flowchart-${Date.now()}`
        let { svg } = await mermaid.render(uniqueId, composedText)

        // Workaround for Mermaid's injected scaling that squishes large diagrams:
        if (cancelled || !svgContainerRef.current) return

        svgContainerRef.current.innerHTML = svg
        setRenderError(null)

        // Read intrinsic dimensions and explicitly assign them to override CSS layout compression
        const svgEl = svgContainerRef.current.querySelector('svg')
        if (svgEl) {
          // Remove default conflicting properties
          svgEl.removeAttribute('width')
          svgEl.removeAttribute('height')
          const existingStyle = svgEl.getAttribute('style') || ''
          svgEl.setAttribute('style', existingStyle.replace(/max-width:\s*[^;]+;?/g, '') + ' max-width: none;')

          // Force the inline bounds to equal the true canvas bounds of the flow tree
          const viewBox = svgEl.getAttribute('viewBox')
          if (viewBox) {
            const parts = viewBox.trim().split(/[\s,]+/)
            if (parts.length === 4) {
              const w = Number(parts[2])
              const h = Number(parts[3])
              if (!isNaN(w) && !isNaN(h)) {
                svgEl.style.width = w + 'px'
                svgEl.style.height = h + 'px'
                setDimensions({ width: w, height: h })
              }
            }
          }
        }

        requestAnimationFrame(() => {
          if (!cancelled) extractNodePositions()
        })

        applyClaims()
      } catch (err) {
        if (!cancelled) {
          setRenderError(String(err))
          console.error('[FlowchartWorkspace] Render failed:', err)
        }
      }
    }

    render()

    return () => {
      cancelled = true
    }
  }, [composedText, extractNodePositions, applyClaims])

  // ── Click handler for node info tooltip ───────────────────────────────
  const handleNodeClick = useCallback(
    (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest('.node')
      if (!target) {
        setTooltipInfo(null)
        return
      }

      const nodeId = target.id || ''
      const labelEl = target.querySelector('.nodeLabel, tspan, text')
      const label = labelEl?.textContent?.trim() || nodeId
      const claimedBy = claims[nodeId]

      const activeBranch = Object.values(taskBranches).find(b => b.nodeId === nodeId)

      setTooltipInfo({
        nodeId,
        label,
        claimedBy: claimedBy || (activeBranch ? `${activeBranch.agentName} — ${activeBranch.task}` : undefined),
        x: e.clientX + 12,
        y: e.clientY - 8,
      })

      setTimeout(() => setTooltipInfo(null), 4000)
    },
    [claims, taskBranches]
  )

  // ── Recompute node positions on resize ────────────────────────────────
  useEffect(() => {
    const container = svgContainerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      extractNodePositions()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [extractNodePositions])

  // ── Render ────────────────────────────────────────────────────────────

  const habitatEl = document.querySelector('.habitat')

  const uiElements = (
    <>
      {/* Status badge */}
      {(filePath || mermaidText) && (
        <div className="flowchart-status-bar">
          <div
            className="flowchart-status-badge"
            onClick={() => setVisible(!visible)}
            title={visible ? 'Hide project map' : 'Show project map'}
          >
            {visible ? '◉' : '○'} flowchart
          </div>
          {activeCwd && visible && (
            <button
              className="flowchart-rescan-btn"
              onClick={handleScanProject}
              disabled={scanning}
              title="Re-scan project structure"
            >
              {scanning ? '⏳' : '🔄'}
            </button>
          )}
        </div>
      )}
      {/* Empty State */}
      {(!filePath && !mermaidText) && (
        <div className={`flowchart-workspace-ui flowchart-empty ${visible ? '' : 'hidden'}`} style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div>
            <p style={{ color: 'rgba(200, 204, 228, 0.35)', fontSize: 11, fontFamily: 'monospace' }}>No project flowchart detected.</p>
            <p style={{ color: 'rgba(200, 204, 228, 0.35)', fontSize: 11, fontFamily: 'monospace' }}>
              Create a <code style={{ background: 'rgba(91, 144, 240, 0.12)', padding: '2px 6px', borderRadius: 3 }}>.mermaid</code> or <code style={{ background: 'rgba(91, 144, 240, 0.12)', padding: '2px 6px', borderRadius: 3 }}>.mmd</code> file, or scan your project.
            </p>
            <button
              className="flowchart-scan-btn"
              onClick={handleScanProject}
              disabled={scanning || !activeCwd}
              style={{ pointerEvents: 'auto' }}
            >
              {scanning ? '⏳ Scanning…' : '🗂️ Scan & Map Project'}
            </button>
          </div>
        </div>
      )}
    </>
  )

  return (
    <>
      {habitatEl && createPortal(uiElements, habitatEl)}

      <div className={`flowchart-workspace ${visible && (filePath || mermaidText) ? '' : 'hidden'}`}>
          {renderError ? (
            <div style={{ color: '#ff4455', fontSize: 11, fontFamily: 'monospace' }}>
              Parse error: {renderError}
            </div>
          ) : (
            <div
              ref={svgContainerRef}
              className="flowchart-svg-container"
              onClick={handleNodeClick}
            />
          )}
      </div>

      {/* Tooltip */}
      {tooltipInfo && (
        <div
          className="flowchart-node-tooltip"
          style={{ left: tooltipInfo.x, top: tooltipInfo.y }}
        >
          <div className="tooltip-title">{tooltipInfo.label}</div>
          <div style={{ fontSize: 10, opacity: 0.6 }}>ID: {tooltipInfo.nodeId}</div>
          {tooltipInfo.claimedBy && (
            <div className="tooltip-claimed">⚡ {tooltipInfo.claimedBy}</div>
          )}
        </div>
      )}
    </>
  )
}
