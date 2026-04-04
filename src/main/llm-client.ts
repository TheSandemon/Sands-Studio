// ---------------------------------------------------------------------------
// Unified LLM Client — supports Anthropic and OpenAI-compatible APIs
// ---------------------------------------------------------------------------
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export type ProviderType = 'anthropic' | 'openai'

/** Provider-agnostic tool definition */
export interface UnifiedTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** A single text block in a response */
export interface TextBlock {
  type: 'text'
  text: string
}

/** A single tool-use block in a response */
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ContentBlock = TextBlock | ToolUseBlock

/** Normalized response from any provider */
export interface UnifiedResponse {
  content: ContentBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'unknown'
}

/** A tool result to feed back into the conversation */
export interface ToolResult {
  toolCallId: string
  content: string
}

/** Provider-agnostic message. Content can be a plain string, an array of
 *  ContentBlock (assistant turn), or an array of ToolResult (user turn
 *  carrying tool responses). */
export interface UnifiedMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[] | ToolResult[]
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------
export interface ILanguageClient {
  chat(opts: {
    model: string
    system: string
    messages: UnifiedMessage[]
    tools: UnifiedTool[]
    maxTokens?: number
  }): Promise<UnifiedResponse>
}

// ---------------------------------------------------------------------------
// Anthropic adapter
// ---------------------------------------------------------------------------
class AnthropicAdapter implements ILanguageClient {
  private client: Anthropic

  constructor(apiKey: string, baseURL: string) {
    this.client = new Anthropic({ apiKey, baseURL })
  }

  async chat(opts: {
    model: string
    system: string
    messages: UnifiedMessage[]
    tools: UnifiedTool[]
    maxTokens?: number
  }): Promise<UnifiedResponse> {
    // Convert unified tools → Anthropic tools
    const tools: Anthropic.Tool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))

    // Convert unified messages → Anthropic messages
    const messages = opts.messages.map((m) => this.toAnthropicMessage(m))

    const response = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages,
      tools,
    })

    return this.fromAnthropicResponse(response)
  }

  // ── Converters ──────────────────────────────────────────────────────────

  private toAnthropicMessage(m: UnifiedMessage): Anthropic.MessageParam {
    // Plain string content
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content }
    }

    // Array content — could be ContentBlock[] or ToolResult[]
    const arr = m.content as unknown[]
    if (arr.length === 0) {
      return { role: m.role, content: '' }
    }

    // Tool results (user turn carrying tool responses)
    if ('toolCallId' in (arr[0] as unknown as Record<string, unknown>)) {
      const toolResults = arr as ToolResult[]
      return {
        role: 'user',
        content: toolResults.map((tr) => ({
          type: 'tool_result' as const,
          tool_use_id: tr.toolCallId,
          content: tr.content,
        })),
      }
    }

    // ContentBlock[] (assistant turn)
    const blocks = arr as ContentBlock[]
    return {
      role: m.role,
      content: blocks.map((b) => {
        if (b.type === 'text') {
          return { type: 'text' as const, text: b.text }
        }
        return {
          type: 'tool_use' as const,
          id: b.id,
          name: b.name,
          input: b.input,
        }
      }),
    }
  }

  private fromAnthropicResponse(r: Anthropic.Message): UnifiedResponse {
    const content: ContentBlock[] = r.content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text }
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }
      }
      // Fallback for any unexpected block types
      return { type: 'text', text: '' }
    })

    let stopReason: UnifiedResponse['stopReason'] = 'unknown'
    if (r.stop_reason === 'end_turn') stopReason = 'end_turn'
    else if (r.stop_reason === 'tool_use') stopReason = 'tool_use'
    else if (r.stop_reason === 'max_tokens') stopReason = 'max_tokens'

    return { content, stopReason }
  }
}

// ---------------------------------------------------------------------------
// OpenAI adapter
// ---------------------------------------------------------------------------
class OpenAIAdapter implements ILanguageClient {
  private client: OpenAI

  constructor(apiKey: string, baseURL: string) {
    this.client = new OpenAI({ apiKey, baseURL })
  }

  /** OpenAI requires each tool result as a separate message with role=tool,
   *  so we expand ToolResult[] arrays inline during message conversion. */
  async chat(opts: {
    model: string
    system: string
    messages: UnifiedMessage[]
    tools: UnifiedTool[]
    maxTokens?: number
  }): Promise<UnifiedResponse> {
    const tools: OpenAI.ChatCompletionTool[] = opts.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as OpenAI.FunctionParameters,
      },
    }))

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: opts.system },
    ]

    // Convert each unified message, expanding tool-result arrays
    for (const m of opts.messages) {
      if (
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.length > 0 &&
        'toolCallId' in (m.content[0] as unknown as Record<string, unknown>)
      ) {
        // Expand tool results into individual tool messages
        for (const tr of m.content as ToolResult[]) {
          messages.push({
            role: 'tool' as const,
            tool_call_id: tr.toolCallId,
            content: tr.content,
          })
        }
      } else {
        messages.push(this.toOpenAIMessage(m))
      }
    }

    const response = await this.client.chat.completions.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    })

    return this.fromOpenAIResponse(response)
  }

  // ── Converters ──────────────────────────────────────────────────────────

  private toOpenAIMessage(m: UnifiedMessage): OpenAI.ChatCompletionMessageParam {
    // Plain string content
    if (typeof m.content === 'string') {
      if (m.role === 'user') {
        return { role: 'user', content: m.content }
      }
      return { role: 'assistant', content: m.content }
    }

    // Array content
    const arr = m.content as unknown[]
    if (arr.length === 0) {
      if (m.role === 'user') {
        return { role: 'user', content: '' }
      }
      return { role: 'assistant', content: '' }
    }

    // Tool results fallback (normally handled by chat() expansion above)
    if ('toolCallId' in (arr[0] as unknown as Record<string, unknown>)) {
      const toolResults = arr as ToolResult[]
      return {
        role: 'tool' as const,
        tool_call_id: toolResults[0].toolCallId,
        content: toolResults[0].content,
      }
    }

    // ContentBlock[] (assistant response with possible tool calls)
    const blocks = arr as ContentBlock[]
    const textParts = blocks.filter((b) => b.type === 'text').map((b) => (b as TextBlock).text)
    const toolCalls = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => {
        const tu = b as ToolUseBlock
        return {
          id: tu.id,
          type: 'function' as const,
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input),
          },
        }
      })

    const msg: OpenAI.ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: textParts.length > 0 ? textParts.join('\n') : '',
    }
    if (toolCalls.length > 0) {
      msg.tool_calls = toolCalls
    }
    return msg
  }

  private fromOpenAIResponse(r: OpenAI.ChatCompletion): UnifiedResponse {
    const choice = r.choices[0]
    if (!choice) {
      return { content: [], stopReason: 'end_turn' }
    }

    const content: ContentBlock[] = []

    // Text content
    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content })
    }

    // Tool calls
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        // Skip non-function tool calls (e.g. custom tool types)
        if (tc.type !== 'function') continue
        let parsedArgs: Record<string, unknown> = {}
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}')
        } catch {
          parsedArgs = {}
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parsedArgs,
        })
      }
    }

    // Map finish reason
    let stopReason: UnifiedResponse['stopReason'] = 'unknown'
    if (choice.finish_reason === 'stop') stopReason = 'end_turn'
    else if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use'
    else if (choice.finish_reason === 'length') stopReason = 'max_tokens'

    return { content, stopReason }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createClient(
  provider: ProviderType,
  apiKey: string,
  baseURL: string
): ILanguageClient {
  if (provider === 'openai') {
    // For OpenAI-compatible endpoints, only strip /chat/completions suffix
    // and trailing slash. The OpenAI SDK appends /chat/completions itself.
    // Do NOT force-append /v1 — providers like Gemini use /v1beta/openai.
    const openaiBase = baseURL
      .replace(/\/chat\/completions\/?$/, '')
      .replace(/\/$/, '')
    return new OpenAIAdapter(apiKey, openaiBase)
  }

  // For Anthropic, strip trailing segments that would cause double-pathing
  const anthropicBase = baseURL
    .replace(/\/v1\/messages\/?$|\/v1\/?$|\/$/, '')
  return new AnthropicAdapter(apiKey, anthropicBase)
}

// ---------------------------------------------------------------------------
// Tool definition helpers — convert from old Anthropic.Tool format or
// create new UnifiedTool definitions
// ---------------------------------------------------------------------------
export function defineTools(): UnifiedTool[] {
  return [
    {
      name: 'run_command',
      description: 'Execute a shell command in the terminal and return its output.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
    },
    {
      name: 'send_habitat_message',
      description:
        'Broadcast a short message to all other creatures in the habitat. ' +
        'Use to share findings, ask for help, or react to what others are doing.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Short message (1-2 sentences max).' },
        },
        required: ['message'],
      },
    },
    {
      name: 'send_direct_message',
      description: 'Send a private message to a specific creature by their terminal ID.',
      inputSchema: {
        type: 'object',
        properties: {
          recipientId: { type: 'string', description: 'The terminal/creature ID to send to.' },
          message: { type: 'string', description: 'The message content.' },
        },
        required: ['recipientId', 'message'],
      },
    },
    {
      name: 'get_habitat_messages',
      description: 'Get recent messages from the habitat communication bus.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max messages to return (default 20).' },
        },
      },
    },
    {
      name: 'get_agent_statuses',
      description: 'Get the current status of all agents in the habitat.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'claim_file_intent',
      description: 'Claim an intent to edit a file. Returns collision info if another creature is editing it.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file.' },
          intentType: { type: 'string', description: 'Type of intent: file_edit, task, or context_handoff.' },
        },
        required: ['filePath', 'intentType'],
      },
    },
    {
      name: 'release_file_intent',
      description: 'Release a previously claimed file edit intent.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file.' },
          intentType: { type: 'string', description: 'Type of intent to release.' },
        },
        required: ['filePath', 'intentType'],
      },
    },
    {
      name: 'record_file_edit',
      description: 'Record a file edit and check for collisions with other creatures.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file that was edited.' },
          command: { type: 'string', description: 'The shell command that triggered the edit.' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'check_file_collision',
      description: 'Check if any creature is currently editing a file.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file to check.' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'build_context_handoff',
      description: 'Build a context handoff bundle to send to another creature.',
      inputSchema: {
        type: 'object',
        properties: {
          targetCreatureId: { type: 'string', description: 'The creature ID to handoff context to.' },
        },
        required: ['targetCreatureId'],
      },
    },
    {
      name: 'set_agent_status',
      description:
        'Update your visual status in the habitat UI. Sets your speech bubble and moves your avatar ' +
        'to the file or folder you are working on in the project map. Call this whenever you start ' +
        'working on a file or change focus. Omit focusFile to return to your desk.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'What you are doing right now (e.g. "Fixing auth route")' },
          icon: { type: 'string', description: 'A single emoji representing the task (e.g. "🔧")' },
          focusFile: { type: 'string', description: 'Optional. The relative file or folder path you are focusing on (e.g. "src/App.tsx").' },
        },
        required: ['status', 'icon'],
      },
    },
  ]
}
