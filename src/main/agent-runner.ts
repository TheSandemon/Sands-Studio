import Anthropic from '@anthropic-ai/sdk'
import type { BrowserWindow } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { ptyManager } from './pty-manager'
import { getContextManager } from './index'
import type { ContextManager } from './context-manager'
import type { HabitatBus } from './habitat-bus'
import type { IntentPayload, FileEditEvent } from '../shared/habitatCommsTypes'

const execAsync = promisify(exec)

// Per-terminal working directory — persists across tool calls within a session
const terminalCwd = new Map<string, string>()

// Track which terminals have auto-compact started (one shot per terminal)
const autoCompactStarted = new Set<string>()

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
  apiKey?: string
  baseURL?: string
  model?: string
  mcpServers?: { name: string; url: string; enabled: boolean }[]
  hatched: boolean
  eggStep?: number   // 1–4 during hatching, absent once hatched
  createdAt: string
  messages: Anthropic.MessageParam[]
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
// Tools
// ---------------------------------------------------------------------------
const runCommandTool: Anthropic.Tool = {
  name: 'run_command',
  description: 'Execute a shell command in the terminal and return its output.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run.' }
    },
    required: ['command']
  }
}

const sendHabitatMessageTool: Anthropic.Tool = {
  name: 'send_habitat_message',
  description:
    'Broadcast a short message to all other creatures in the habitat. ' +
    'Use to share findings, ask for help, or react to what others are doing.',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Short message (1-2 sentences max).' }
    },
    required: ['message']
  }
}

const sendDirectMessageTool: Anthropic.Tool = {
  name: 'send_direct_message',
  description: 'Send a private message to a specific creature by their terminal ID.',
  input_schema: {
    type: 'object',
    properties: {
      recipientId: { type: 'string', description: 'The terminal/creature ID to send to.' },
      message: { type: 'string', description: 'The message content.' }
    },
    required: ['recipientId', 'message']
  }
}

const getHabitatMessagesTool: Anthropic.Tool = {
  name: 'get_habitat_messages',
  description: 'Get recent messages from the habitat communication bus.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max messages to return (default 20).' }
    }
  }
}

const getAgentStatusesTool: Anthropic.Tool = {
  name: 'get_agent_statuses',
  description: 'Get the current status of all agents in the habitat.'
}

const claimFileIntentTool: Anthropic.Tool = {
  name: 'claim_file_intent',
  description: 'Claim an intent to edit a file. Returns collision info if another creature is editing it.',
  input_schema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the file.' },
      intentType: { type: 'string', description: 'Type of intent: file_edit, task, or context_handoff.' }
    },
    required: ['filePath', 'intentType']
  }
}

const releaseFileIntentTool: Anthropic.Tool = {
  name: 'release_file_intent',
  description: 'Release a previously claimed file edit intent.',
  input_schema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the file.' },
      intentType: { type: 'string', description: 'Type of intent to release.' }
    },
    required: ['filePath', 'intentType']
  }
}

const recordFileEditTool: Anthropic.Tool = {
  name: 'record_file_edit',
  description: 'Record a file edit and check for collisions with other creatures.',
  input_schema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the file that was edited.' },
      command: { type: 'string', description: 'The shell command that triggered the edit.' }
    },
    required: ['filePath']
  }
}

const checkFileCollisionTool: Anthropic.Tool = {
  name: 'check_file_collision',
  description: 'Check if any creature is currently editing a file.',
  input_schema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the file to check.' }
    },
    required: ['filePath']
  }
}

const buildContextHandoffTool: Anthropic.Tool = {
  name: 'build_context_handoff',
  description: 'Build a context handoff bundle to send to another creature.',
  input_schema: {
    type: 'object',
    properties: {
      targetCreatureId: { type: 'string', description: 'The creature ID to handoff context to.' }
    },
    required: ['targetCreatureId']
  }
}

const ALL_TOOLS = [
  runCommandTool,
  sendHabitatMessageTool,
  sendDirectMessageTool,
  getHabitatMessagesTool,
  getAgentStatusesTool,
  claimFileIntentTool,
  releaseFileIntentTool,
  recordFileEditTool,
  checkFileCollisionTool,
  buildContextHandoffTool,
]

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
      'Perfect. Now I need your API key to wake up my brain.\nAnthropica or any compatible provider (OpenRouter, etc.) — it stays on your machine only.\n\nPaste your API key:')

  } else if (step === 3) {
    saveMemory(terminalId, { ...existing!, apiKey: userMessage.trim(), eggStep: 4 })
    sendEvent(win, terminalId, 'text',
      'Got it (keeping that secret! 🔒). Last thing — which base URL should I use?\n\nPress Enter for the default (https://api.anthropic.com), or paste a custom URL:')

  } else if (step === 4) {
    let baseURL = userMessage.trim() || 'https://api.anthropic.com'
    if (baseURL !== 'https://api.anthropic.com') {
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
      apiKey: existing!.apiKey,
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
      `🥚💥 *CRACK* — I'M HATCHING! Hello world, I'm ${existing!.name}!`)
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

  const model = memory.model ?? defaults?.model

  // Initialize CWD for this terminal session
  if (!terminalCwd.has(terminalId)) {
    terminalCwd.set(terminalId, process.cwd())
  }

  try {
    let baseURL = memory.baseURL ?? defaults?.baseURL ?? 'https://api.anthropic.com'
    if (!baseURL.startsWith('http://') && !baseURL.startsWith('https://')) {
      baseURL = 'https://' + baseURL
    }
    new URL(baseURL) // validate

    const client = new Anthropic({
      apiKey: memory.apiKey,
      baseURL
    })

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
      `You are connected to the Sands Cloud Brain expert network via the Brain Router below.\n\n` +
      `--- BRAIN ROUTER ---\n${brainRouter}` +
      habitatContext

    const history = (memory.messages ?? []).slice(-60)
    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: userMessage }
    ]

    while (state.running) {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: ALL_TOOLS
      })

      messages.push({ role: 'assistant', content: response.content })

      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          sendEvent(win, terminalId, 'text', block.text)
        }
      }

      if (response.stop_reason === 'end_turn') break

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue

          if (block.name === 'run_command') {
            const command = (block.input as { command: string }).command
            sendEvent(win, terminalId, 'command', command)

            // Show command in PTY for user visibility
            ptyManager.write(terminalId, command + '\n')

            // Run in clean subprocess — no echo, no prompt, no escape codes
            const cwd = terminalCwd.get(terminalId) ?? process.cwd()
            let cleanOutput: string
            try {
              const { stdout, stderr } = await execAsync(command, {
                cwd,
                timeout: 30_000,
                shell: true,
                maxBuffer: 1024 * 1024
              })
              cleanOutput = [stdout, stderr].filter(Boolean).join('\n').trim()

              // Update tracked CWD after every command
              try {
                const cwdCmd = process.platform === 'win32' ? 'cd' : 'pwd'
                const { stdout: p } = await execAsync(cwdCmd, { cwd, shell: true })
                terminalCwd.set(terminalId, p.trim() || cwd)
              } catch { /* keep previous cwd */ }

              // Record file edit and check for collision (after command completes)
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
              // Non-zero exit — stderr is still useful context for the agent
              const e = err as { stdout?: string; stderr?: string; message?: string }
              cleanOutput = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim()
            }

            // Truncate to protect context window
            if (cleanOutput.length > 6000) {
              cleanOutput = cleanOutput.slice(0, 3000) + '\n...[truncated]...\n' + cleanOutput.slice(-1000)
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: cleanOutput || '(no output)'
            })

          } else if (block.name === 'send_habitat_message') {
            const { message } = block.input as { message: string }
            if (bus) {
              await bus.broadcast(terminalId, memory.name!, message)
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Broadcast sent.' })

          } else if (block.name === 'send_direct_message') {
            const { recipientId, message } = block.input as { recipientId: string; message: string }
            if (bus) {
              await bus.sendDirect(recipientId, terminalId, memory.name!, message)
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Direct message sent to ${recipientId}.` })

          } else if (block.name === 'get_habitat_messages') {
            const { limit } = (block.input as { limit?: number }) ?? {}
            if (bus) {
              const msgs = await bus.getRecentMessages(terminalId, limit ?? 20)
              const formatted = msgs.map((m) => `[${m.senderName}]: ${m.content}`).join('\n')
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: formatted || 'No messages.' })
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Habitat bus not available.' })
            }

          } else if (block.name === 'get_agent_statuses') {
            if (bus) {
              const statuses = bus.getAllAgentStatuses()
              const formatted = statuses.map((s) => `${s.name}: ${s.status}${s.currentIntent ? ` (claiming ${s.currentIntent.target})` : ''}`).join('\n')
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: formatted || 'No agents connected.' })
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Habitat bus not available.' })
            }

          } else if (block.name === 'claim_file_intent') {
            const { filePath, intentType } = block.input as { filePath: string; intentType: string }
            if (bus) {
              const intent: IntentPayload = {
                type: intentType as IntentPayload['type'],
                target: filePath,
                claimedBy: terminalId,
                expiresAt: Date.now() + 30_000,
              }
              const result = await bus.claimIntent(terminalId, intent)
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result.ok
                  ? `Intent claimed for ${filePath}.`
                  : `Collision: ${result.collision?.editingCreatures.map((c) => c.name).join(', ')} are also editing.`
              })
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Habitat bus not available.' })
            }

          } else if (block.name === 'release_file_intent') {
            const { filePath, intentType } = block.input as { filePath: string; intentType: string }
            if (bus) {
              await bus.releaseIntent(terminalId, intentType, filePath)
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Intent released for ${filePath}.` })

          } else if (block.name === 'record_file_edit') {
            const { filePath, command: cmd } = block.input as { filePath: string; command?: string }
            if (bus) {
              const result = await bus.recordFileEdit({ creatureId: terminalId, filePath, timestamp: Date.now(), command: cmd })
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result.hasCollision
                  ? `Collision: ${result.editingCreatures.map((c) => c.name).join(', ')} are editing this file.`
                  : `File edit recorded for ${filePath}.`
              })
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Habitat bus not available.' })
            }

          } else if (block.name === 'check_file_collision') {
            const { filePath } = block.input as { filePath: string }
            if (bus) {
              const result = bus.checkCollision(filePath)
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result.hasCollision
                  ? `Collision: ${result.editingCreatures.map((c) => c.name).join(', ')} are editing this file.`
                  : 'No collision.'
              })
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Habitat bus not available.' })
            }

          } else if (block.name === 'build_context_handoff') {
            const { targetCreatureId } = block.input as { targetCreatureId: string }
            if (bus) {
              const cm = getContextManager(terminalId)
              const bundle = await bus.buildHandoffBundle(
                terminalId,
                targetCreatureId,
                (id) => getContextManager(id).getNotes(),
                async (id, since) => await bus.getMessages(id, { since }),
                (id) => getContextManager(id).getSummary() ?? ''
              )
              const handoffResult = await bus.sendHandoff(targetCreatureId, bundle)
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Context handoff sent to ${targetCreatureId}. Message ID: ${handoffResult.id}` })
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Habitat bus not available.' })
            }
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
