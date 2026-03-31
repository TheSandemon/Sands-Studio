// Shared types for the Habitat system — terminal/shell configurations
// Used by both main process and renderer. Cross-process safe.

export interface ColorScheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface CreatureConfig {
  id: string;
  name?: string;
  specialty?: string;
  description?: string;
  hatched: boolean;
  eggStep?: number;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  mcpServers?: { name: string; url: string; enabled: boolean }[];
  createdAt?: string;
  /** Which spritesheet this creature uses (e.g. 'slime', 'goblin'). Omitted = default blob. */
  spriteId?: string;
}

export interface SavedAgent {
  id: string;
  name: string;
  description?: string;
  creature: CreatureConfig;
  memory?: object;
  createdAt: number;
  updatedAt: number;
}

export interface ShellConfig {
  id: string;
  name: string;
  // Shell execution
  shell: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  // Display overrides (fall back to global settings if undefined)
  fontSize?: number;
  fontFamily?: string;
  scrollback?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
  colorScheme?: ColorScheme;
  bellSound?: boolean;
  /** If true, the PTY was already created by the main process (e.g. habitat:apply) */
  preCreated?: boolean;
  /** Creature/agent state snapshot — embedded when habitat is saved so it survives across sessions */
  creature?: CreatureConfig;
}

export interface HabitatLayout {
  panelHeight?: number;
  paneWidths?: number[];
}

export interface Habitat {
  id: string;
  name: string;
  description?: string;
  shells: ShellConfig[];
  layout?: HabitatLayout;
  createdAt: number;
  updatedAt: number;
}
