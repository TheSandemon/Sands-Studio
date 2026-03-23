import Anthropic from '@anthropic-ai/sdk'
import type { BrowserWindow } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { ptyManager } from './pty-manager'

const execAsync = promisify(exec)

// Per-terminal working directory — persists across tool calls within a session
const terminalCwd = new Map<string, string>()

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
// Habitat bus — shared message channel across all creatures
// ---------------------------------------------------------------------------
interface HabitatMessage {
  from: string
  fromName: string
  content: string
  timestamp: number
}

const habitatBus: HabitatMessage[] = []
const HABITAT_BUS_MAX = 20

function broadcastToHabitat(
  win: BrowserWindow,
  from: string,
  fromName: string,
  content: string
): void {
  habitatBus.push({ from, fromName, content, timestamp: Date.now() })
  if (habitatBus.length > HABITAT_BUS_MAX) habitatBus.shift()
  // Wildcard '*' — every AgentChat panel receives this
  if (!win.isDestroyed()) {
    win.webContents.send('agent:event', '*', 'habitat_message', { from, fromName, content })
  }
}

function getRecentHabitatMessages(excludeId: string): HabitatMessage[] {
  return habitatBus.filter((m) => m.from !== excludeId).slice(-5)
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

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '')
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
    const baseURL = userMessage.trim() || 'https://api.anthropic.com'
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

  const client = new Anthropic({
    apiKey: memory.apiKey,
    baseURL: memory.baseURL ?? defaults?.baseURL ?? 'https://api.anthropic.com'
  })

  const model = memory.model ?? defaults?.model

  // Initialize CWD for this terminal session
  if (!terminalCwd.has(terminalId)) {
    terminalCwd.set(terminalId, process.cwd())
  }

  // Inject recent habitat messages so this creature is aware of others
  const recentMsgs = getRecentHabitatMessages(terminalId)
  const habitatContext = recentMsgs.length
    ? '\n\n--- HABITAT ACTIVITY (other creatures) ---\n' +
      recentMsgs.map((m) => `[${m.fromName}]: ${m.content}`).join('\n')
    : ''

  const systemPrompt =
    `You are ${memory.name}, a creature assistant specializing in ${memory.specialty}.\n` +
    `You have access to a real terminal via run_command. Be helpful, concise, and reflect your specialty.\n` +
    `You share a habitat with other creatures. Use send_habitat_message to broadcast short messages to them.\n` +
    `You are connected to the Sands Cloud Brain expert network via the Brain Router below.\n\n` +
    `--- BRAIN ROUTER ---\n${brainRouter}` +
    habitatContext

  const history = (memory.messages ?? []).slice(-60)
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage }
  ]

  try {
    while (state.running) {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: [runCommandTool, sendHabitatMessageTool]
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
            broadcastToHabitat(win, terminalId, memory.name!, message)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Broadcast sent.' })
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
}
