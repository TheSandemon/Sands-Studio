import type { BrowserWindow } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { ptyManager } from './pty-manager'
import { getContextManager } from './index'
import type { HabitatBus } from './habitat-bus'
import type { IntentPayload, FileEditEvent } from '../shared/habitatCommsTypes'
import {
  createClient,
  defineTools,
  type ILanguageClient,
  type ProviderType,
  type UnifiedMessage,
  type UnifiedResponse,
  type ContentBlock,
  type ToolResult,
  type ToolUseBlock,
} from './llm-client'

const execAsync = promisify(exec)

// Per-terminal working directory — persists across tool calls within a session
const terminalCwd = new Map<string, string>()

// Track which terminals have auto-compact started (one shot per terminal)
const autoCompactStarted = new Set<string>()

// Track which terminals have already received a message in this app session
const activeSessions = new Set<string>()

// ---------------------------------------------------------------------------
// HabitatBus singleton — set by index.ts after app ready
// ---------------------------------------------------------------------------
let _habitatBusGetter: (() => HabitatBus) | null = null

export function setHabitatBus(fn: () => HabitatBus): void {
  _habitatBusGetter = fn
}

function getBus(): HabitatBus | null {
  return _habitatBusGetter?.() ?? null
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
interface CreatureMemory {
  id: string
  name?: string
  specialty?: string
  provider?: ProviderType
  apiKey?: string
  baseURL?: string
  model?: string
  role?: string
  skills?: string[]
  autonomy?: { enabled: boolean; intervalMs: number; goal: string }
  mcpServers?: { name: string; url: string; enabled: boolean }[]
  hatched: boolean
  eggStep?: number   // 1–6 during hatching, absent once hatched
  createdAt: string
  messages: UnifiedMessage[]
}

function creaturesDir(): string {
  return path.resolve(process.cwd(), '.habitat', 'creatures')
}

function creatureFile(id: string): string {
  return path.join(creaturesDir(), `${id}.json`)
}

function loadMemory(id: string): CreatureMemory | null {
  const file = creatureFile(id)
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function saveMemory(id: string, memory: Partial<CreatureMemory> & { id: string }): void {
  fs.mkdirSync(creaturesDir(), { recursive: true })
  fs.writeFileSync(creatureFile(id), JSON.stringify(memory, null, 2))
}

// ---------------------------------------------------------------------------
// Brain Router
// ---------------------------------------------------------------------------
async function fetchBrainRouter(): Promise<string> {
  try {
    const res = await fetch(
      'https://firestore.googleapis.com/v1/projects/sands-cloud-brain/databases/(default)/documents/agents/brain-router'
    )
    const json = await res.json() as { fields?: { content?: { stringValue?: string } } }
    return json.fields?.content?.stringValue ?? ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
interface AgentState { running: boolean }
const agents = new Map<string, AgentState>()

function sendEvent(win: BrowserWindow, terminalId: string, type: string, payload: unknown) {
  if (!win.isDestroyed()) {
    win.webContents.send('agent:event', terminalId, type, payload)
  }
}

// ---------------------------------------------------------------------------
// Unified tool definitions
// ---------------------------------------------------------------------------
const ALL_TOOLS = defineTools()

// ---------------------------------------------------------------------------
// Path-to-NodeID translation for Atlas Mermaid map
// ---------------------------------------------------------------------------
function filePathToNodeId(filePath: string, projectRoot: string): string | null {
  if (!filePath) return null
  let relative = filePath
    .replace(/\\/g, '/')
    .replace(projectRoot.replace(/\\/g, '/'), '')
    .replace(/^\//, '')

  if (!relative) return null

  const rootName = projectRoot.replace(/\\/g, '/').split('/').pop() || 'project'
  const rootId = rootName.replace(/[^a-zA-Z0-9_]/g, '_')

  const segments = relative.split('/')
  let nodeId = rootId
  for (const seg of segments) {
    nodeId += '__' + seg.replace(/[^a-zA-Z0-9_]/g, '_')
  }
  return nodeId
}

// ---------------------------------------------------------------------------
// Egg conversation — rule-based state machine, no API key required
// ---------------------------------------------------------------------------
async function startEggConversation(
  terminalId: string,
  userMessage: string,
  win: BrowserWindow
): Promise<void> {
  const existing = loadMemory(terminalId)

  // Already hatched — resync renderer
  if (existing?.hatched) {
    sendEvent(win, terminalId, 'hatch', { name: existing.name, specialty: existing.specialty })
    sendEvent(win, terminalId, 'done', null)
    return
  }

  const step: number = (existing as any)?.eggStep ?? 0

  if (step === 0 || userMessage === '__egg_init__') {
    saveMemory(terminalId, {
      id: terminalId, hatched: false, eggStep: 1,
      createdAt: new Date().toISOString(), messages: []
    })
    sendEvent(win, terminalId, 'text',
      '✨ Oh! Hello there. I\'m starting to hatch...\n\nWhat would you like to name me?')

  } else if (step === 1) {
    saveMemory(terminalId, { ...existing!, name: userMessage.trim(), eggStep: 2 })
    sendEvent(win, terminalId, 'text',
      `${userMessage.trim()}... I love that name! What should I specialize in helping with?`)

  } else if (step === 2) {
    saveMemory(terminalId, { ...existing!, specialty: userMessage.trim(), eggStep: 3 })
    sendEvent(win, terminalId, 'text',
      'Perfect. What API format does your provider use?\n\n' +
      '  • Type **anthropic** for Anthropic / Claude endpoints\n' +
      '  • Type **openai** for OpenAI-compatible endpoints (OpenRouter, Gemini, Groq, local LLMs, etc.)\n')

  } else if (step === 3) {
    const input = userMessage.trim().toLowerCase()
    let provider: ProviderType
    if (input === 'openai' || input === 'open ai' || input === 'o') {
      provider = 'openai'
    } else {
      provider = 'anthropic'
    }
    saveMemory(terminalId, { ...existing!, provider, eggStep: 4 })
    sendEvent(win, terminalId, 'text',
      `Got it — using **${provider}** format! Now I need your API key to wake up my brain.\nIt stays on your machine only.\n\nPaste your API key:`)

  } else if (step === 4) {
    saveMemory(terminalId, { ...existing!, apiKey: userMessage.trim(), eggStep: 5 })
    const isOpenAI = existing?.provider === 'openai'
    const example = isOpenAI ? 'gpt-4o, gemini-2.5-flash, etc.' : 'claude-sonnet-4-20250514, etc.'
    sendEvent(win, terminalId, 'text',
      `Got it (keeping that secret! 🔒). What model should I use? (e.g., ${example})`)

  } else if (step === 5) {
    saveMemory(terminalId, { ...existing!, model: userMessage.trim(), eggStep: 6 })
    const isOpenAI = existing?.provider === 'openai'
    const defaultUrl = isOpenAI ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'
    sendEvent(win, terminalId, 'text',
      `Perfect. Finally, what base URL should I use?\n\nPress Enter for the default (${defaultUrl}), or paste a custom URL:`)

  } else if (step === 6) {
    const provider: ProviderType = existing?.provider ?? 'anthropic'
    const defaultUrl = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'
    let baseURL = userMessage.trim() || defaultUrl
    if (baseURL !== defaultUrl) {
      if (!baseURL.startsWith('http://') && !baseURL.startsWith('https://')) {
        baseURL = 'https://' + baseURL
      }
      try {
        new URL(baseURL)
      } catch {
        sendEvent(win, terminalId, 'text', 'That URL doesn\'t look quite right. Please provide a valid HTTP/HTTPS URL, or press Enter to use the default.')
        sendEvent(win, terminalId, 'done', null)
        return
      }
    }
    const memory: CreatureMemory = {
      id: terminalId,
      name: existing!.name,
      specialty: existing!.specialty,
      provider,
      apiKey: existing!.apiKey,
      model: existing!.model,
      baseURL,
      hatched: true,
      createdAt: existing!.createdAt ?? new Date().toISOString(),
      messages: []
    }
    saveMemory(terminalId, memory)

    // Register with habitat bus
    const bus = getBus()
    if (bus) {
      await bus.registerAgent(terminalId, memory.name!)
    }

    sendEvent(win, terminalId, 'text',
      `🥚💥 *CRACK* — I'M HATCHING! Hello world, I'm ${existing!.name}! (${provider} mode)`)
    sendEvent(win, terminalId, 'hatch', { name: existing!.name, specialty: existing!.specialty })
  }

  sendEvent(win, terminalId, 'done', null)
}

// ---------------------------------------------------------------------------
// Post-hatch agent
// ---------------------------------------------------------------------------
async function startAgent(
  terminalId: string,
  userMessage: string,
  win: BrowserWindow,
  defaults?: { model?: string; baseURL?: string }
): Promise<void> {
  const memory = loadMemory(terminalId)

  if (!memory?.hatched || !memory.apiKey) {
    sendEvent(win, terminalId, 'error', 'Creature has not hatched yet or is missing an API key.')
    sendEvent(win, terminalId, 'done', null)
    return
  }

  const brainRouter = await fetchBrainRouter()
  const state: AgentState = { running: true }
  agents.set(terminalId, state)

  // Start auto-compact for this creature (one shot per terminal)
  if (!autoCompactStarted.has(terminalId)) {
    getContextManager(terminalId).startAutoCompact()
    autoCompactStarted.add(terminalId)
  }

  // Register with habitat bus
  const bus = getBus()
  if (bus) {
    await bus.registerAgent(terminalId, memory.name!)
    bus.setAgentStatus(terminalId, 'active')
  }

  const model = memory.model ?? 'claude-sonnet-4-20250514'
  const provider: ProviderType = memory.provider ?? 'anthropic'

  // Initialize CWD for this terminal session
  if (!terminalCwd.has(terminalId)) {
    terminalCwd.set(terminalId, process.cwd())
  }

  let messages: UnifiedMessage[] = []

  try {
    let baseURL = memory.baseURL ?? (provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com')
    if (!baseURL.startsWith('http://') && !baseURL.startsWith('https://')) {
      baseURL = 'https://' + baseURL
    }
    new URL(baseURL) // validate

    const client = createClient(provider, memory.apiKey!, baseURL)

    // Inject recent habitat messages so this creature is aware of others
    const recentMsgs = bus ? await bus.getRecentMessages(terminalId, 5) : []
    const habitatContext = recentMsgs.length
      ? '\n\n--- HABITAT ACTIVITY (other creatures) ---\n' +
        recentMsgs.map((m) => `[${m.senderName}]: ${m.content}`).join('\n')
      : ''

    const systemPrompt =
      `You are ${memory.name}, a creature assistant specializing in ${memory.specialty}.\n` +
      `You have access to a real terminal via run_command. Be helpful, concise, and reflect your specialty.\n` +
      `You share a habitat with other creatures. Use send_habitat_message or send_direct_message to communicate.\n` +
      `IMPORTANT: You exist visually on a project flowchart map. Use set_agent_status to show the user what you are doing. ` +
      `Call it with a status, icon emoji, and optionally focusFile (relative path) to move your avatar to that file on the map. ` +
      `Always set your status when you start working on a file. Your avatar will walk back to its desk when you finish.\n` +
      `You are connected to the Sands Cloud Brain expert network via the Brain Router below.\n\n` +
      `--- BRAIN ROUTER ---\n${brainRouter}` +
      habitatContext

    // Initial spawn: Move agent to its terminal node in the flowchart map
    const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_')
    sendEvent(win, terminalId, 'visual_status', {
      status: 'Initializing...',
      icon: '\ud83d\udce1',
      nodeId: 'TerminalHub'
    })

    const isNewSession = !activeSessions.has(terminalId)
    if (isNewSession) {
      activeSessions.add(terminalId)
    }

    // Ensure we slice intelligently without breaking tool call / result pairing
    let rawHistory = memory.messages ?? []
    if (rawHistory.length > 60) {
      rawHistory = rawHistory.slice(-60)
      let safeIndex = 0
      for (let i = 0; i < rawHistory.length; i++) {
        if (rawHistory[i].role === 'user' && typeof rawHistory[i].content === 'string') {
          safeIndex = i
          break
        }
      }
      rawHistory = rawHistory.slice(safeIndex)
    }

    const history = rawHistory

    const injectedMessage = (history.length > 0 && isNewSession)
      ? `[SYSTEM NOTICE: Current session resumed. The messages above are from past interactions. Do not re-execute past requests or apologize for delays. Await new instructions.]\n\n${userMessage}`
      : userMessage

    messages = [
      ...history,
      { role: 'user', content: injectedMessage }
    ]

    while (state.running) {
      const response: UnifiedResponse = await client.chat({
        model,
        system: systemPrompt,
        messages,
        tools: ALL_TOOLS,
        maxTokens: 4096,
      })

      // Push assistant response into conversation
      messages.push({ role: 'assistant', content: response.content })

      // Emit text blocks to the UI
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          sendEvent(win, terminalId, 'text', block.text)
        }
      }

      if (response.stopReason === 'end_turn') break

      if (response.stopReason === 'tool_use') {
        const toolResults: ToolResult[] = []

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue
          const toolBlock = block as ToolUseBlock

          if (toolBlock.name === 'run_command') {
            const command = (toolBlock.input as { command: string }).command
            sendEvent(win, terminalId, 'command', command)

            // Show command in PTY for user visibility
            ptyManager.write(terminalId, command + '\n')

            // Run in clean subprocess
            const cwd = terminalCwd.get(terminalId) ?? process.cwd()
            let cleanOutput: string
            try {
              const { stdout, stderr } = await execAsync(command, {
                cwd,
                timeout: 30_000,
                shell: 'powershell.exe',
                maxBuffer: 1024 * 1024
              })
              cleanOutput = [stdout, stderr].filter(Boolean).join('\n').trim()

              // Update tracked CWD after every command
              try {
                const cwdCmd = process.platform === 'win32' ? 'cd' : 'pwd'
                const { stdout: p } = await execAsync(cwdCmd, { cwd, shell: 'powershell.exe' })
                terminalCwd.set(terminalId, p.trim() || cwd)
              } catch { /* keep previous cwd */ }

              // Record file edit and check for collision
              if (bus && command) {
                const { CollisionDetector } = await import('./collision-detector')
                const paths = CollisionDetector.extractFilePaths(command)
                for (const p2 of paths) {
                  const result = await bus.recordFileEdit({
                    creatureId: terminalId,
                    filePath: p2,
                    timestamp: Date.now(),
                    command,
                  })
                  if (result.hasCollision) {
                    const collisonMsg =
                      `[⚠] Collision detected: ${result.editingCreatures.map((c) => c.name).join(', ')} ` +
                      `are also editing ${p2}. Consider coordinating with them.`
                    sendEvent(win, terminalId, 'text', collisonMsg)
                  }
                }
              }

            } catch (err: unknown) {
              const e = err as { stdout?: string; stderr?: string; message?: string }
              cleanOutput = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim()
            }

            // Truncate to protect context window
            if (cleanOutput.length > 6000) {
              cleanOutput = cleanOutput.slice(0, 3000) + '\n...[truncated]...\n' + cleanOutput.slice(-1000)
            }

            toolResults.push({
              toolCallId: toolBlock.id,
              content: cleanOutput || '(no output)'
            })

          } else if (toolBlock.name === 'send_habitat_message') {
            const { message } = toolBlock.input as { message: string }
            if (bus) {
              await bus.broadcast(terminalId, memory.name!, message)
            }
            toolResults.push({ toolCallId: toolBlock.id, content: 'Broadcast sent.' })

          } else if (toolBlock.name === 'send_direct_message') {
            const { recipientId, message } = toolBlock.input as { recipientId: string; message: string }
            if (bus) {
              await bus.sendDirect(recipientId, terminalId, memory.name!, message)
            }
            toolResults.push({ toolCallId: toolBlock.id, content: `Direct message sent to ${recipientId}.` })

          } else if (toolBlock.name === 'get_habitat_messages') {
            const { limit } = (toolBlock.input as { limit?: number }) ?? {}
            if (bus) {
              const msgs = await bus.getRecentMessages(terminalId, limit ?? 20)
              const formatted = msgs.map((m) => `[${m.senderName}]: ${m.content}`).join('\n')
              toolResults.push({ toolCallId: toolBlock.id, content: formatted || 'No messages.' })
            } else {
              toolResults.push({ toolCallId: toolBlock.id, content: 'Habitat bus not available.' })
            }

          } else if (toolBlock.name === 'get_agent_statuses') {
            if (bus) {
              const statuses = bus.getAllAgentStatuses()
              const formatted = statuses.map((s) => `${s.name}: ${s.status}${s.currentIntent ? ` (claiming ${s.currentIntent.target})` : ''}`).join('\n')
              toolResults.push({ toolCallId: toolBlock.id, content: formatted || 'No agents connected.' })
            } else {
              toolResults.push({ toolCallId: toolBlock.id, content: 'Habitat bus not available.' })
            }

          } else if (toolBlock.name === 'claim_file_intent') {
            const { filePath, intentType } = toolBlock.input as { filePath: string; intentType: string }
            if (bus) {
              const intent: IntentPayload = {
                type: intentType as IntentPayload['type'],
                target: filePath,
                claimedBy: terminalId,
                expiresAt: Date.now() + 30_000,
              }
              const result = await bus.claimIntent(terminalId, intent)
              toolResults.push({
                toolCallId: toolBlock.id,
                content: result.ok
                  ? `Intent claimed for ${filePath}.`
                  : `Collision: ${result.collision?.editingCreatures.map((c) => c.name).join(', ')} are also editing.`
              })
            } else {
              toolResults.push({ toolCallId: toolBlock.id, content: 'Habitat bus not available.' })
            }

          } else if (toolBlock.name === 'release_file_intent') {
            const { filePath, intentType } = toolBlock.input as { filePath: string; intentType: string }
            if (bus) {
              await bus.releaseIntent(terminalId, intentType, filePath)
            }
            toolResults.push({ toolCallId: toolBlock.id, content: `Intent released for ${filePath}.` })

          } else if (toolBlock.name === 'record_file_edit') {
            const { filePath, command: cmd } = toolBlock.input as { filePath: string; command?: string }
            if (bus) {
              const result = await bus.recordFileEdit({ creatureId: terminalId, filePath, timestamp: Date.now(), command: cmd })
              toolResults.push({
                toolCallId: toolBlock.id,
                content: result.hasCollision
                  ? `Collision: ${result.editingCreatures.map((c) => c.name).join(', ')} are editing this file.`
                  : `File edit recorded for ${filePath}.`
              })
            } else {
              toolResults.push({ toolCallId: toolBlock.id, content: 'Habitat bus not available.' })
            }

          } else if (toolBlock.name === 'check_file_collision') {
            const { filePath } = toolBlock.input as { filePath: string }
            if (bus) {
              const result = bus.checkCollision(filePath)
              toolResults.push({
                toolCallId: toolBlock.id,
                content: result.hasCollision
                  ? `Collision: ${result.editingCreatures.map((c) => c.name).join(', ')} are editing this file.`
                  : 'No collision.'
              })
            } else {
              toolResults.push({ toolCallId: toolBlock.id, content: 'Habitat bus not available.' })
            }

          } else if (toolBlock.name === 'build_context_handoff') {
            const { targetCreatureId } = toolBlock.input as { targetCreatureId: string }
            if (bus) {
              const bundle = await bus.buildHandoffBundle(
                terminalId,
                targetCreatureId,
                (id) => getContextManager(id).getNotes(),
                async (id, since) => await bus.getMessages(id, { since }),
                (id) => getContextManager(id).getSummary() ?? ''
              )
              const handoffResult = await bus.sendHandoff(targetCreatureId, bundle)
              toolResults.push({ toolCallId: toolBlock.id, content: `Context handoff sent to ${targetCreatureId}. Message ID: ${handoffResult.id}` })
            } else {
              toolResults.push({ toolCallId: toolBlock.id, content: 'Habitat bus not available.' })
            }

          } else if (toolBlock.name === 'set_agent_status') {
            const { status, icon, focusFile } = toolBlock.input as { status: string; icon: string; focusFile?: string }
            const cwd = terminalCwd.get(terminalId) ?? process.cwd()
            let nodeId = null
            if (focusFile) {
              // Resolve relative to where terminal is, but calculate node ID relative to global project root
              const absoluteFocusFile = path.resolve(cwd, focusFile)
              nodeId = filePathToNodeId(absoluteFocusFile, process.cwd())
            }
            sendEvent(win, terminalId, 'visual_status', { status, icon, nodeId })
            toolResults.push({
              toolCallId: toolBlock.id,
              content: nodeId
                ? `Status set: ${icon} ${status} — avatar moving to ${focusFile} (node: ${nodeId})`
                : `Status set: ${icon} ${status}`
            })
          }
        }

        messages.push({ role: 'user', content: toolResults })
      } else {
        break
      }
    }
  } catch (err) {
    sendEvent(win, terminalId, 'error', String(err))
  } finally {
    state.running = false
    agents.delete(terminalId)

    if (bus) {
      bus.setAgentStatus(terminalId, 'listening')
    }

    // Auto-release flowchart visual status so sprite walks back to desk
    sendEvent(win, terminalId, 'visual_status', { status: '', icon: '', nodeId: null })

    // Track message activity and fire auto-compact if threshold reached
    const cm = getContextManager(terminalId)
    cm.recordActivity()
    if (cm.getMessageCount() > 200) {
      cm.compact().catch(() => {})
    }

    saveMemory(terminalId, { ...memory, messages: messages.slice(-60) })
    sendEvent(win, terminalId, 'done', null)
  }
}

// ---------------------------------------------------------------------------
// Dispatch — routes to egg or agent based on hatch status
// ---------------------------------------------------------------------------
export async function dispatchAgentMessage(
  terminalId: string,
  message: string,
  win: BrowserWindow,
  defaults?: { model?: string; baseURL?: string }
): Promise<void> {
  const memory = loadMemory(terminalId)

  if (message === '__egg_init__' || !memory?.hatched) {
    await startEggConversation(terminalId, message, win)
  } else {
    await startAgent(terminalId, message, win, defaults)
  }
}

export function stopAgent(terminalId: string): void {
  const state = agents.get(terminalId)
  if (state) state.running = false
  // Stop auto-compact when the terminal session closes
  autoCompactStarted.delete(terminalId)
  getContextManager(terminalId).stopAutoCompact()

  // Unregister from habitat bus
  const bus = getBus()
  if (bus) {
    bus.unregisterAgent(terminalId).catch(() => {})
  }
}
