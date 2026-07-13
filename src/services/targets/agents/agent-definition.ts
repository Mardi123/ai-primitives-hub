/**
 * Canonical, vendor-neutral agent model + a parser for Copilot `.agent.md`.
 *
 * We parse a Copilot agent into this neutral shape ONCE, then render it per
 * target (Kiro IDE / CLI v3 / CLI v2). We never transform one vendor's YAML
 * dict directly into another's — the fields have different meanings.
 */
import { parseFrontmatter } from '../frontmatter';
import { mapTools } from './mappings';

/** Copilot-only fields that have no Kiro equivalent (dropped, with a warning). */
const UNSUPPORTED_COPILOT_FIELDS = ['handoffs', 'agents', 'target', 'infer'] as const;

/** Fields we consume explicitly so we don't also carry them in sourceFields. */
const KNOWN_FIELDS = new Set([
  'name',
  'description',
  'model',
  'tools',
  ...UNSUPPORTED_COPILOT_FIELDS
]);

export interface AgentDefinition {
  name: string;
  description?: string;
  /** The markdown body = the agent's system prompt. */
  systemPrompt: string;
  /** Raw Copilot model field (string or list) — mapped at render time. */
  model?: unknown;
  /** Kiro capability categories mapped from Copilot tools. */
  capabilities: string[];
  /** MCP tool refs ("server/tool") to resolve against a registry at render time. */
  mcpRefs: string[];
  /** Any frontmatter fields we didn't explicitly handle. */
  sourceFields: Record<string, unknown>;
  /** Diagnostics accumulated during parsing (unknown tools, dropped fields…). */
  warnings: string[];
}

/** Coerce a frontmatter `tools` value into a string list. */
function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

/**
 * Parse a Copilot `.agent.md` file into the canonical model.
 * @param content - File content.
 * @param fallbackName - Used when frontmatter has no `name` (e.g. filename stem).
 */
export function parseCopilotAgent(content: string, fallbackName: string): AgentDefinition {
  const { data, body } = parseFrontmatter(content);
  const fm = data ?? {};
  const warnings: string[] = [];

  const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : fallbackName;
  const description = typeof fm.description === 'string' ? fm.description : undefined;

  const { capabilities, mcpRefs, warnings: toolWarnings } = mapTools(toStringList(fm.tools));
  warnings.push(...toolWarnings);

  for (const f of UNSUPPORTED_COPILOT_FIELDS) {
    if (fm[f] !== undefined) {
      warnings.push(`Copilot field "${f}" has no Kiro equivalent and was dropped.`);
    }
  }

  const sourceFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (!KNOWN_FIELDS.has(k)) {
      sourceFields[k] = v;
    }
  }

  return {
    name,
    description,
    systemPrompt: body.replace(/^\n+/, ''),
    model: fm.model,
    capabilities,
    mcpRefs,
    sourceFields,
    warnings
  };
}
