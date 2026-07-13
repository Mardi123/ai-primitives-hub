/**
 * Copilot → Kiro semantic mappings for agent conversion.
 *
 * Tool names, model ids and MCP references are NOT copied verbatim — Copilot
 * and Kiro use different vocabularies. Unknown items are surfaced as warnings,
 * never silently dropped (a silently-dropped tool yields an agent that loads
 * but lacks the expected capability).
 */

/** Copilot builtin tool id → Kiro capability category. */
const TOOL_MAP: Record<string, string> = {
  search: 'read',
  'search/codebase': 'read',
  'search/files': 'read',
  read: 'read',
  edit: 'write',
  write: 'write',
  terminal: 'shell',
  shell: 'shell',
  execute: 'shell',
  web: 'web',
  'web-fetch': 'web',
  fetch: 'web',
  agent: 'subagent',
  subagent: 'subagent',
  todo: 'todo_list',
  todo_list: 'todo_list',
  context: 'context'
};

export interface MappedTools {
  /** Kiro capability categories (deduped). */
  capabilities: string[];
  /** Raw MCP-style tool references, e.g. "github/*", to be resolved by registry. */
  mcpRefs: string[];
  /** Human-readable warnings for unmapped/unknown tools. */
  warnings: string[];
}

/**
 * Map a list of Copilot tool identifiers to Kiro capabilities + MCP refs.
 */
export function mapTools(tools: string[]): MappedTools {
  const capabilities = new Set<string>();
  const mcpRefs: string[] = [];
  const warnings: string[] = [];

  for (const raw of tools) {
    const tool = raw.trim();
    if (!tool) {
      continue;
    }
    const mapped = TOOL_MAP[tool.toLowerCase()];
    if (mapped) {
      capabilities.add(mapped);
      continue;
    }
    // A "/" that isn't a known builtin subtool means an MCP server tool ref.
    if (tool.includes('/')) {
      mcpRefs.push(tool);
      continue;
    }
    warnings.push(`Unknown tool "${tool}" has no Kiro capability mapping (dropped).`);
  }

  return { capabilities: [...capabilities], mcpRefs, warnings };
}

/**
 * Resolve an MCP tool reference ("server/tool" or "server/*") to Kiro's
 * "@server/tool" form, using a configured registry of known MCP servers.
 * Unresolved servers produce a warning (and the ref is omitted).
 */
export function resolveMcpRef(
  ref: string,
  registry: Record<string, string>
): { resolved?: string; warning?: string } {
  const slash = ref.indexOf('/');
  const server = slash === -1 ? ref : ref.slice(0, slash);
  const rest = slash === -1 ? '' : ref.slice(slash);
  const known = registry[server];
  if (!known) {
    return {
      warning:
        `Unresolved MCP tool "${ref}": no Kiro MCP server named "${server}". ` +
        `Configure the server or add an MCP mapping.`
    };
  }
  return { resolved: `@${known}${rest}` };
}

/** Copilot model id → Kiro model id. Unknown ids pass through with a warning. */
const MODEL_MAP: Record<string, string> = {
  'claude sonnet': 'claude-sonnet-4',
  'claude-sonnet': 'claude-sonnet-4',
  'claude-sonnet-4': 'claude-sonnet-4',
  'claude sonnet 4': 'claude-sonnet-4'
};

/**
 * Map a Copilot model field (string or list) to a single Kiro model id.
 */
export function mapModel(model: unknown): { model?: string; warning?: string } {
  let value: string | undefined;
  if (typeof model === 'string') {
    value = model;
  } else if (Array.isArray(model) && typeof model[0] === 'string') {
    value = model[0]; // Copilot allows a preference list; take the first.
  }
  if (!value) {
    return {};
  }
  const mapped = MODEL_MAP[value.toLowerCase()];
  if (mapped) {
    return { model: mapped };
  }
  return { model: value, warning: `Model "${value}" is not a known Kiro model id; passed through unchanged.` };
}
