import { useEffect, useRef, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import type { ModuleManifest, AgentRole, SchedulingMode, WorldType } from '../../shared/types'
import './ModuleSettingsDialog.css'

// ── Available tools (grouped for UI) ────────────────────────────────────────

const TOOL_GROUPS: Record<string, string[]> = {
  'World Queries': [
    'get_world_state', 'get_entity', 'get_entities_by_type', 'get_entities_nearby',
    'get_tile', 'describe_scene', 'get_world_properties',
  ],
  'Entity Actions': [
    'move_entity', 'create_entity', 'remove_entity', 'update_entity',
    'damage_entity', 'heal_entity', 'kill_entity', 'set_entity_state',
    'trigger_animation', 'spawn_entity', 'set_entity_facing', 'update_entity_property',
    'set_tile', 'set_world_property',
  ],
  'Visual / Speech': [
    'show_speech_bubble', 'show_effect', 'narrate',
  ],
  'Orchestrator': [
    'give_turn', 'end_round', 'pause_module', 'resume_module',
  ],
  'Sequencing': [
    'wait_for_animations',
  ],
  'Timers': [
    'create_timer', 'cancel_timer', 'get_timers',
  ],
  'Triggers': [
    'create_trigger', 'remove_trigger', 'get_triggers',
  ],
  'Status Effects': [
    'apply_status_effect', 'remove_status_effect', 'get_status_effects',
  ],
  'Inventory': [
    'give_item', 'remove_item', 'get_inventory', 'equip_item',
    'unequip_item', 'transfer_item', 'use_item',
  ],
  'Groups': [
    'create_group', 'add_to_group', 'remove_from_group',
    'get_group', 'get_groups', 'get_entity_groups',
  ],
  'Pathfinding': [
    'find_path', 'get_path_distance',
  ],
  'State Machines': [
    'create_state_machine', 'transition_state', 'get_state_machine', 'get_state_machines',
  ],
  'Relationships': [
    'create_relationship', 'remove_relationship', 'get_relationships', 'get_related_entities',
  ],
  'Other': [
    'respawn_entity', 'attack_entity', 'use_ability',
    'give_experience', 'level_up_entity', 'grant_ability',
  ],
}

const ALL_TOOLS = Object.values(TOOL_GROUPS).flat()

// ── Types ───────────────────────────────────────────────────────────────────

type Tab = 'general' | 'pacing' | 'renderer' | 'agents'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'pacing', label: 'Pacing' },
  { id: 'renderer', label: 'Renderer' },
  { id: 'agents', label: 'Agents' },
]

// ── General Panel ───────────────────────────────────────────────────────────

function GeneralPanel({
  manifest,
  onChange,
}: {
  manifest: ModuleManifest
  onChange: (patch: Partial<ModuleManifest>) => void
}) {
  return (
    <>
      <div className="msettings-section-title">Identity</div>
      <div className="msettings-row">
        <span className="msettings-label">Name</span>
        <input
          type="text"
          className="msettings-input msettings-input-wide"
          value={manifest.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">Description</span>
        <textarea
          className="msettings-textarea"
          value={manifest.description}
          rows={3}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">Version</span>
        <input
          type="text"
          className="msettings-input"
          value={manifest.version ?? ''}
          placeholder="1.0.0"
          onChange={(e) => onChange({ version: e.target.value || undefined })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">Author</span>
        <input
          type="text"
          className="msettings-input msettings-input-wide"
          value={manifest.author ?? ''}
          placeholder="Author name"
          onChange={(e) => onChange({ author: e.target.value || undefined })}
        />
      </div>

      <div className="msettings-section-title">Game Mode</div>
      <div className="msettings-row">
        <span className="msettings-label">
          World type
          <span className="msettings-label-sub">Grid, freeform, or hybrid positioning</span>
        </span>
        <div className="msettings-radio-group">
          {(['grid', 'freeform', 'hybrid'] as WorldType[]).map((wt) => (
            <label key={wt} className="msettings-radio-label">
              <input
                type="radio"
                name="worldType"
                value={wt}
                checked={manifest.worldType === wt}
                onChange={() => onChange({ worldType: wt })}
              />
              {wt}
            </label>
          ))}
        </div>
      </div>
      <div className="msettings-row">
        <span className="msettings-label">
          Scheduling
          <span className="msettings-label-sub">How agents take turns</span>
        </span>
        <div className="msettings-radio-group">
          {(['orchestrated', 'round-robin', 'free-for-all'] as SchedulingMode[]).map((sm) => (
            <label key={sm} className="msettings-radio-label">
              <input
                type="radio"
                name="scheduling"
                value={sm}
                checked={manifest.scheduling === sm}
                onChange={() => onChange({ scheduling: sm })}
              />
              {sm}
            </label>
          ))}
        </div>
      </div>
      <div className="msettings-row">
        <span className="msettings-label">Has orchestrator</span>
        <input
          type="checkbox"
          className="msettings-checkbox"
          checked={manifest.hasOrchestrator}
          onChange={(e) => onChange({ hasOrchestrator: e.target.checked })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">
          Agent memory
          <span className="msettings-label-sub">Conversation turns retained per agent (0 = none)</span>
        </span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={0}
          max={50}
          value={manifest.agentMemory ?? 0}
          onChange={(e) => onChange({ agentMemory: Number(e.target.value) })}
        />
      </div>
    </>
  )
}

// ── Pacing Panel ────────────────────────────────────────────────────────────

function PacingPanel({
  manifest,
  onChange,
}: {
  manifest: ModuleManifest
  onChange: (patch: Partial<ModuleManifest>) => void
}) {
  const pacing = manifest.pacing
  const setPacing = (patch: Partial<typeof pacing>) => {
    onChange({ pacing: { ...pacing, ...patch } })
  }

  return (
    <>
      <div className="msettings-section-title">Rate Limiting</div>
      <div className="msettings-row">
        <span className="msettings-label">
          Burst window (ms)
          <span className="msettings-label-sub">Time window for burst rate limiting</span>
        </span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={1000}
          max={120000}
          step={1000}
          value={pacing.burstWindowMs}
          onChange={(e) => setPacing({ burstWindowMs: Number(e.target.value) })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">
          Burst cooldown (ms)
          <span className="msettings-label-sub">Pause after burst window is exhausted</span>
        </span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={0}
          max={30000}
          step={500}
          value={pacing.burstCooldownMs}
          onChange={(e) => setPacing({ burstCooldownMs: Number(e.target.value) })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">
          Max requests per agent
          <span className="msettings-label-sub">Per-agent request cap within burst window</span>
        </span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={1}
          max={200}
          value={pacing.maxRequestsPerAgent}
          onChange={(e) => setPacing({ maxRequestsPerAgent: Number(e.target.value) })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">
          Global RPM limit
          <span className="msettings-label-sub">Total requests/min across all agents (0 = unlimited)</span>
        </span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={0}
          max={10000}
          step={10}
          value={pacing.globalRpmLimit ?? 0}
          onChange={(e) => setPacing({ globalRpmLimit: Number(e.target.value) || undefined })}
        />
      </div>
    </>
  )
}

// ── Renderer Panel ──────────────────────────────────────────────────────────

function RendererPanel({
  manifest,
  onChange,
}: {
  manifest: ModuleManifest
  onChange: (patch: Partial<ModuleManifest>) => void
}) {
  const renderer = manifest.renderer
  const setRenderer = (patch: Partial<typeof renderer>) => {
    onChange({ renderer: { ...renderer, ...patch } })
  }

  const bgHex = '#' + (renderer.backgroundColor >>> 0).toString(16).padStart(6, '0')

  return (
    <>
      <div className="msettings-section-title">Canvas</div>
      <div className="msettings-row">
        <span className="msettings-label">Canvas width</span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={320}
          max={3840}
          step={10}
          value={renderer.canvasWidth}
          onChange={(e) => setRenderer({ canvasWidth: Number(e.target.value) })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">Canvas height</span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={240}
          max={2160}
          step={10}
          value={renderer.canvasHeight}
          onChange={(e) => setRenderer({ canvasHeight: Number(e.target.value) })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">Background color</span>
        <input
          type="color"
          className="msettings-color"
          value={bgHex}
          onChange={(e) => setRenderer({ backgroundColor: parseInt(e.target.value.slice(1), 16) })}
        />
      </div>

      <div className="msettings-section-title">Grid</div>
      <div className="msettings-row">
        <span className="msettings-label">Show grid</span>
        <input
          type="checkbox"
          className="msettings-checkbox"
          checked={renderer.showGrid ?? false}
          onChange={(e) => setRenderer({ showGrid: e.target.checked })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">Grid size (px)</span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={8}
          max={128}
          value={renderer.gridSize ?? 32}
          onChange={(e) => setRenderer({ gridSize: Number(e.target.value) })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">Tile width (px)</span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={8}
          max={128}
          value={renderer.tileWidth ?? 48}
          onChange={(e) => setRenderer({ tileWidth: Number(e.target.value) })}
        />
      </div>
      <div className="msettings-row">
        <span className="msettings-label">Tile height (px)</span>
        <input
          type="number"
          className="msettings-input msettings-number"
          min={8}
          max={128}
          value={renderer.tileHeight ?? 48}
          onChange={(e) => setRenderer({ tileHeight: Number(e.target.value) })}
        />
      </div>
    </>
  )
}

// ── Agent Panel ─────────────────────────────────────────────────────────────

function AgentPanel({
  agents,
  onChangeAgent,
}: {
  agents: AgentRole[]
  onChangeAgent: (idx: number, patch: Partial<AgentRole>) => void
}) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const agent = agents[selectedIdx]

  if (agents.length === 0) {
    return <div className="msettings-empty">No agents configured</div>
  }

  return (
    <>
      {/* Agent selector tabs */}
      <div className="msettings-agent-tabs">
        {agents.map((a, i) => (
          <button
            key={a.id}
            className={`msettings-agent-tab${i === selectedIdx ? ' active' : ''}${a.isOrchestrator ? ' orchestrator' : ''}`}
            onClick={() => setSelectedIdx(i)}
            title={a.isOrchestrator ? 'Orchestrator' : 'Agent'}
          >
            {a.isOrchestrator && <span className="msettings-orch-badge">DM</span>}
            {a.name || a.id}
          </button>
        ))}
      </div>

      {agent && (
        <div className="msettings-agent-detail">
          <div className="msettings-section-title">Identity</div>
          <div className="msettings-row">
            <span className="msettings-label">ID</span>
            <span className="msettings-value-ro">{agent.id}</span>
          </div>
          <div className="msettings-row">
            <span className="msettings-label">Name</span>
            <input
              type="text"
              className="msettings-input msettings-input-wide"
              value={agent.name}
              onChange={(e) => onChangeAgent(selectedIdx, { name: e.target.value })}
            />
          </div>
          <div className="msettings-row">
            <span className="msettings-label">Is orchestrator</span>
            <input
              type="checkbox"
              className="msettings-checkbox"
              checked={agent.isOrchestrator}
              onChange={(e) => onChangeAgent(selectedIdx, { isOrchestrator: e.target.checked })}
            />
          </div>
          <div className="msettings-row">
            <span className="msettings-label">Entity ID</span>
            <input
              type="text"
              className="msettings-input msettings-input-wide"
              value={agent.entityId ?? ''}
              placeholder="(none)"
              onChange={(e) => onChangeAgent(selectedIdx, { entityId: e.target.value || undefined })}
            />
          </div>

          <div className="msettings-section-title">Personality</div>
          <div className="msettings-row-full">
            <textarea
              className="msettings-textarea msettings-textarea-tall"
              value={agent.personality}
              rows={3}
              onChange={(e) => onChangeAgent(selectedIdx, { personality: e.target.value })}
            />
          </div>

          <div className="msettings-section-title">System Prompt Template</div>
          <div className="msettings-row-full">
            <textarea
              className="msettings-textarea msettings-textarea-code"
              value={agent.systemPromptTemplate}
              rows={8}
              onChange={(e) => onChangeAgent(selectedIdx, { systemPromptTemplate: e.target.value })}
            />
          </div>

          <div className="msettings-section-title">AI Model (optional overrides)</div>
          <div className="msettings-row">
            <span className="msettings-label">
              Provider
              <span className="msettings-label-sub">Leave blank to use global default</span>
            </span>
            <select
              className="msettings-select"
              value={agent.provider ?? ''}
              onChange={(e) => onChangeAgent(selectedIdx, { provider: (e.target.value || undefined) as AgentRole['provider'] })}
            >
              <option value="">(global default)</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="minimax">MiniMax</option>
              <option value="openrouter">OpenRouter</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="msettings-row">
            <span className="msettings-label">Model</span>
            <input
              type="text"
              className="msettings-input msettings-input-wide"
              value={agent.model ?? ''}
              placeholder="(global default)"
              onChange={(e) => onChangeAgent(selectedIdx, { model: e.target.value || undefined })}
            />
          </div>
          <div className="msettings-row">
            <span className="msettings-label">Base URL</span>
            <input
              type="text"
              className="msettings-input msettings-input-wide"
              value={agent.baseURL ?? ''}
              placeholder="(global default)"
              onChange={(e) => onChangeAgent(selectedIdx, { baseURL: e.target.value || undefined })}
            />
          </div>

          <div className="msettings-section-title">
            Tools
            <span className="msettings-tool-count">{agent.tools.length} selected</span>
          </div>
          <div className="msettings-tools-grid">
            {Object.entries(TOOL_GROUPS).map(([group, tools]) => {
              const relevantTools = tools.filter((t) => ALL_TOOLS.includes(t))
              if (relevantTools.length === 0) return null
              const groupSelected = relevantTools.filter((t) => agent.tools.includes(t)).length
              return (
                <div key={group} className="msettings-tool-group">
                  <div
                    className="msettings-tool-group-header"
                    onClick={() => {
                      // Toggle all tools in this group
                      const allSelected = groupSelected === relevantTools.length
                      const newTools = allSelected
                        ? agent.tools.filter((t) => !relevantTools.includes(t))
                        : [...new Set([...agent.tools, ...relevantTools])]
                      onChangeAgent(selectedIdx, { tools: newTools })
                    }}
                  >
                    <span className="msettings-tool-group-name">{group}</span>
                    <span className="msettings-tool-group-count">
                      {groupSelected}/{relevantTools.length}
                    </span>
                  </div>
                  <div className="msettings-tool-list">
                    {relevantTools.map((tool) => (
                      <label key={tool} className="msettings-tool-item">
                        <input
                          type="checkbox"
                          checked={agent.tools.includes(tool)}
                          onChange={(e) => {
                            const newTools = e.target.checked
                              ? [...agent.tools, tool]
                              : agent.tools.filter((t) => t !== tool)
                            onChangeAgent(selectedIdx, { tools: newTools })
                          }}
                        />
                        <span className="msettings-tool-name">{tool}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

// ── Main Dialog ─────────────────────────────────────────────────────────────

interface Props {
  moduleId: string
  onClose: () => void
}

export default function ModuleSettingsDialog({ moduleId, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [manifest, setManifest] = useState<ModuleManifest | null>(null)
  const [agents, setAgents] = useState<AgentRole[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Load module config
  useEffect(() => {
    setLoading(true)
    window.moduleAPI
      .getModuleConfig(moduleId)
      .then(({ manifest: m, agents: a }) => {
        setManifest(m as ModuleManifest)
        setAgents(a as AgentRole[])
        setDirty(false)
      })
      .catch((err) => {
        console.error('Failed to load module config:', err)
        alert(`Failed to load module config: ${err}`)
        onClose()
      })
      .finally(() => setLoading(false))
  }, [moduleId, onClose])

  const handleManifestChange = useCallback((patch: Partial<ModuleManifest>) => {
    setManifest((prev) => (prev ? { ...prev, ...patch } : prev))
    setDirty(true)
  }, [])

  const handleAgentChange = useCallback((idx: number, patch: Partial<AgentRole>) => {
    setAgents((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }
      return next
    })
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!manifest) return
    setSaving(true)
    try {
      await window.moduleAPI.saveConfigChanges(moduleId, {
        manifest: manifest as unknown as object,
        agents: agents as unknown as Array<{ id: string; [key: string]: unknown }>,
      })
      setDirty(false)
    } catch (err) {
      alert(`Failed to save: ${err}`)
    } finally {
      setSaving(false)
    }
  }, [moduleId, manifest, agents])

  // Focus trap + Escape
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dirty) {
          if (confirm('You have unsaved changes. Discard?')) onClose()
        } else {
          onClose()
        }
        return
      }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSave()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      prev?.focus()
    }
  }, [onClose, dirty, handleSave])

  const handleClose = useCallback(() => {
    if (dirty) {
      if (confirm('You have unsaved changes. Discard?')) onClose()
    } else {
      onClose()
    }
  }, [dirty, onClose])

  return ReactDOM.createPortal(
    <div className="msettings-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="msettings-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Module Settings">
        <div className="msettings-header">
          <h2>
            {manifest?.name ?? moduleId}
            <span className="msettings-header-id">{moduleId}</span>
          </h2>
          <button className="msettings-close-btn" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="msettings-body">
          <div className="msettings-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`msettings-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="msettings-panel">
            {loading ? (
              <div className="msettings-loading">Loading module config...</div>
            ) : manifest ? (
              <>
                {activeTab === 'general' && (
                  <GeneralPanel manifest={manifest} onChange={handleManifestChange} />
                )}
                {activeTab === 'pacing' && (
                  <PacingPanel manifest={manifest} onChange={handleManifestChange} />
                )}
                {activeTab === 'renderer' && (
                  <RendererPanel manifest={manifest} onChange={handleManifestChange} />
                )}
                {activeTab === 'agents' && (
                  <AgentPanel agents={agents} onChangeAgent={handleAgentChange} />
                )}
              </>
            ) : (
              <div className="msettings-loading">Failed to load</div>
            )}
          </div>
        </div>

        <div className="msettings-footer">
          <span className="msettings-dirty-indicator">
            {dirty ? 'Unsaved changes' : ''}
          </span>
          <div className="msettings-footer-actions">
            <button className="msettings-btn" onClick={handleClose}>
              Cancel
            </button>
            <button
              className="msettings-btn msettings-btn-primary"
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
