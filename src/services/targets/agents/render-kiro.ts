/**
 * Renderers: canonical AgentDefinition → each Kiro surface.
 *
 *   renderKiroIde   → Markdown `.kiro/agents/*.md`   (DEFAULT; body = system prompt)
 *   renderKiroCliV3 → Markdown (same container; validated for the v3 harness)
 *   renderKiroCliV2 → JSON `.kiro/agents/*.json`     (legacy: prompt/tools/model)
 *
 * MCP refs are resolved against a registry; unresolved refs become warnings.
 */
import { stringifyFrontmatter } from '../frontmatter';
import type { AgentDefinition } from './agent-definition';
import { mapModel, resolveMcpRef } from './mappings';

export interface RenderedAgent {
  content: string;
  /** New file extension for the destination ("md" or "json"). */
  extension: 'md' | 'json';
  warnings: string[];
}

/** Resolve capabilities + MCP refs into a single Kiro `tools` list. */
function resolveTools(agent: AgentDefinition, mcpRegistry: Record<string, string>): { tools: string[]; warnings: string[] } {
  const tools = [...agent.capabilities];
  const warnings: string[] = [];
  for (const ref of agent.mcpRefs) {
    const { resolved, warning } = resolveMcpRef(ref, mcpRegistry);
    if (resolved) {
      tools.push(resolved);
    }
    if (warning) {
      warnings.push(warning);
    }
  }
  return { tools, warnings };
}

/** Markdown renderer shared by the IDE and CLI v3 surfaces. */
function renderMarkdown(agent: AgentDefinition, mcpRegistry: Record<string, string>): RenderedAgent {
  const warnings = [...agent.warnings];
  const { tools, warnings: toolWarnings } = resolveTools(agent, mcpRegistry);
  warnings.push(...toolWarnings);

  const { model, warning: modelWarning } = mapModel(agent.model);
  if (modelWarning) {
    warnings.push(modelWarning);
  }

  const frontmatter: Record<string, unknown> = { name: agent.name };
  if (agent.description) {
    frontmatter.description = agent.description;
  }
  if (model) {
    frontmatter.model = model;
  }
  if (tools.length > 0) {
    frontmatter.tools = tools;
  }

  return { content: stringifyFrontmatter(frontmatter, agent.systemPrompt), extension: 'md', warnings };
}

/** Kiro IDE unified agent (Markdown). Default target. */
export function renderKiroIde(agent: AgentDefinition, mcpRegistry: Record<string, string> = {}): RenderedAgent {
  return renderMarkdown(agent, mcpRegistry);
}

/** Kiro CLI v3 unified agent (Markdown). Same container as the IDE. */
export function renderKiroCliV3(agent: AgentDefinition, mcpRegistry: Record<string, string> = {}): RenderedAgent {
  // CLI v3 accepts the same Markdown model; field support may differ during
  // early access, so we keep output identical to the IDE for now.
  return renderMarkdown(agent, mcpRegistry);
}

/** Kiro CLI 2.x legacy agent (JSON). */
export function renderKiroCliV2(agent: AgentDefinition, mcpRegistry: Record<string, string> = {}): RenderedAgent {
  const warnings = [...agent.warnings];
  const { tools, warnings: toolWarnings } = resolveTools(agent, mcpRegistry);
  warnings.push(...toolWarnings);

  const { model, warning: modelWarning } = mapModel(agent.model);
  if (modelWarning) {
    warnings.push(modelWarning);
  }

  const json: Record<string, unknown> = {
    name: agent.name,
    prompt: agent.systemPrompt
  };
  if (agent.description) {
    json.description = agent.description;
  }
  if (model) {
    json.model = model;
  }
  if (tools.length > 0) {
    json.tools = tools;
  }

  return { content: `${JSON.stringify(json, null, 2)}\n`, extension: 'json', warnings };
}
