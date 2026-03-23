// =============================================================================
// Module Engine — Agent Pool
// Manages per-role AI client instances supporting multiple providers.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk'
import type { AgentRole, AIProvider } from '../../shared/types'

export interface AIProviderClient {
  name: string
  provider: AIProvider
  model: string
  baseURL: string

  createMessage(params: {
    model: string
    system: string
    messages: Anthropic.MessageParam[]
    tools: Anthropic.Tool[]
    maxTokens?: number
  }): Promise<{
    content: Anthropic.ContentBlock[]
    stopReason: string
    usage?: { inputTokens: number; outputTokens: number }
  }>
}

// ── Anthropic Provider ────────────────────────────────────────────────────────

class AnthropicProvider implements AIProviderClient {
  name = 'anthropic'
  provider: AIProvider = 'anthropic'
  model: string
  baseURL: string
  private client: Anthropic

  constructor(apiKey: string, baseURL?: string, model?: string) {
    this.baseURL = baseURL ?? 'https://api.anthropic.com'
    this.model = model ?? ''
    this.client = new Anthropic({ apiKey, baseURL: this.baseURL })
  }

  async createMessage(params: {
    model: string
    system: string
    messages: Anthropic.MessageParam[]
    tools: Anthropic.Tool[]
    maxTokens?: number
  }): Promise<{ content: Anthropic.ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const response = await this.client.messages.create({
      model: params.model ?? this.model,
      system: params.system,
      messages: params.messages,
      tools: params.tools as any,
      max_tokens: params.maxTokens ?? 4096,
    })

    return {
      content: response.content as Anthropic.ContentBlock[],
      stopReason: response.stop_reason ?? 'end_turn',
      usage: response.usage ? {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      } : undefined,
    }
  }
}

// ── OpenAI-compatible Provider (MiniMax, OpenRouter, custom) ─────────────────

class OpenAICompatibleProvider implements AIProviderClient {
  name: string
  provider: AIProvider
  model: string
  baseURL: string
  private apiKey: string

  constructor(name: string, provider: AIProvider, apiKey: string, baseURL: string, model: string) {
    this.name = name
    this.provider = provider
    this.apiKey = apiKey
    this.baseURL = baseURL
    this.model = model
  }

  async createMessage(params: {
    model: string
    system: string
    messages: Anthropic.MessageParam[]
    tools: Anthropic.Tool[]
    maxTokens?: number
  }): Promise<{ content: Anthropic.ContentBlock[]; stopReason: string }> {
    // Convert Anthropic format to OpenAI-compatible format
    const messages = [
      { role: 'system', content: params.system },
      ...params.messages.map((m) => ({ role: m.role, content: m.content })),
    ]

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model ?? this.model,
        messages,
        tools: params.tools.length > 0 ? params.tools.map((t: any) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        })) : undefined,
        max_tokens: params.maxTokens ?? 4096,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`AI provider error (${response.status}): ${text}`)
    }

    const json = await response.json() as {
      choices: Array<{
        message: { role: string; content?: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> }
        finish_reason: string
      }>
    }

    const choice = json.choices[0]
    const message = choice.message

    // Convert back to Anthropic-like content blocks
    const content: Anthropic.ContentBlock[] = []

    if (message.content) {
      content.push({ type: 'text', text: message.content } as Anthropic.TextBlock)
    }

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let parsedInput: Record<string, unknown>
        try {
          parsedInput = JSON.parse(tc.function.arguments)
        } catch {
          // Return an error block instead of crashing the entire turn
          content.push({
            type: 'tool_use',
            name: tc.function.name,
            input: { _parseError: `Malformed JSON: ${tc.function.arguments.slice(0, 200)}` },
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          } as Anthropic.ToolUseBlock)
          continue
        }
        content.push({
          type: 'tool_use',
          name: tc.function.name,
          input: parsedInput,
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        } as Anthropic.ToolUseBlock)
      }
    }

    return {
      content,
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    }
  }
}

// ── Agent Pool ───────────────────────────────────────────────────────────────

export class AgentPool {
  private clients = new Map<string, AIProviderClient>()
  private defaults: { model?: string; apiKey?: string; baseURL?: string }

  constructor(defaults: { model?: string; apiKey?: string; baseURL?: string } = {}) {
    this.defaults = defaults
  }

  async createClient(role: AgentRole): Promise<AIProviderClient> {
    if (this.clients.has(role.id)) {
      return this.clients.get(role.id)!
    }

    const apiKey = role.apiKey
      ?? (role.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : undefined)
      ?? this.defaults.apiKey
      ?? ''
    if (!apiKey) {
      throw new Error(
        `Agent role '${role.id}' (${role.provider}) has no API key. ` +
        `Set apiKey in Settings → Agent tab, in the agent JSON, or via ANTHROPIC_API_KEY in the environment.`
      )
    }

    const model = role.model || this.defaults.model || ''
    const baseURL = role.baseURL || this.defaults.baseURL

    let client: AIProviderClient

    switch (role.provider) {
      case 'anthropic':
        client = new AnthropicProvider(apiKey, baseURL, model)
        break

      case 'minimax':
        client = new OpenAICompatibleProvider(
          'minimax',
          'minimax',
          apiKey,
          baseURL ?? 'https://api.minimax.chat/v1',
          model
        )
        break

      case 'openrouter':
        client = new OpenAICompatibleProvider(
          'openrouter',
          'openrouter',
          apiKey,
          baseURL ?? 'https://openrouter.ai/api/v1',
          model
        )
        break

      case 'openai':
        client = new OpenAICompatibleProvider(
          'openai',
          'openai',
          apiKey,
          baseURL ?? 'https://api.openai.com/v1',
          model
        )
        break

      case 'custom':
        if (!baseURL) throw new Error(`Agent role '${role.id}' has no baseURL for custom provider`)
        client = new OpenAICompatibleProvider('custom', 'custom', apiKey, baseURL, model)
        break

      default:
        throw new Error(`Unknown AI provider: ${(role as AgentRole).provider}`)
    }

    this.clients.set(role.id, client)
    return client
  }

  getClient(roleId: string): AIProviderClient | undefined {
    return this.clients.get(roleId)
  }

  close(): void {
    this.clients.clear()
  }
}
