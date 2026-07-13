/**
 * Converter — "HOW does this primitive need to change for the target?"
 *
 * Dispatches by (target family, kind). For Kiro targets it performs the real
 * semantic conversions (agents via the canonical model, instructions→steering,
 * prompt frontmatter stripping) and may rename the output file (e.g. an agent
 * `.agent.md` becomes `<name>.md` for the IDE or `<name>.json` for CLI v2).
 *
 * For Copilot-family targets (vscode/copilot-cli/claude-code/windsurf) the
 * source is already Copilot format, so content is passed through unchanged.
 */
import type { ClassifiedFile } from './manifest';
import { isKiroTarget } from './target-types';
import type { Target } from './target-types';
import { parseCopilotAgent } from './agents/agent-definition';
import { renderKiroCliV2, renderKiroCliV3, renderKiroIde } from './agents/render-kiro';
import { instructionToKiroSteering } from './transformers/instructions';
import { promptToKiro } from './transformers/prompts';

export interface ConversionResult {
  /** Final path within the kind (filename may have changed). */
  remainder: string;
  content: string;
  warnings: string[];
}

/** Strip a compound markdown extension (.agent.md/.prompt.md/…) or a plain .md. */
function stemOf(remainder: string): string {
  return remainder.replace(/\.(agent|prompt|instructions|chatmode)\.md$/i, '').replace(/\.md$/i, '');
}

/** Rename the file part of a remainder to a new extension, preserving any dir. */
function withExtension(remainder: string, ext: string): string {
  const slash = remainder.lastIndexOf('/');
  const dir = slash === -1 ? '' : remainder.slice(0, slash + 1);
  const file = slash === -1 ? remainder : remainder.slice(slash + 1);
  return `${dir}${stemOf(file)}.${ext}`;
}

/** Render an agent for whichever Kiro surface is targeted. */
function renderAgentForKiro(agent: ReturnType<typeof parseCopilotAgent>, target: Target, mcp: Record<string, string>) {
  switch (target.type) {
    case 'kiro-cli-v2':
      return renderKiroCliV2(agent, mcp);
    case 'kiro-cli-v3':
      return renderKiroCliV3(agent, mcp);
    default:
      return renderKiroIde(agent, mcp);
  }
}

/**
 * Convert one classified file for a target.
 * @param file - classified bundle file.
 * @param target - deploy target.
 * @param mcpRegistry - MCP server name registry for tool resolution.
 */
export function convert(file: ClassifiedFile, target: Target, mcpRegistry: Record<string, string> = {}): ConversionResult {
  // Unclassified → passthrough (deployer will fallback-route it).
  if (file.kind === null) {
    return { remainder: file.remainder, content: file.content, warnings: [] };
  }

  if (isKiroTarget(target.type)) {
    switch (file.kind) {
      case 'agent': {
        const agent = parseCopilotAgent(file.content, stemOf(file.remainder));
        const rendered = renderAgentForKiro(agent, target, mcpRegistry);
        return {
          remainder: withExtension(file.remainder, rendered.extension),
          content: rendered.content,
          warnings: rendered.warnings
        };
      }
      case 'instruction': {
        const { content, warnings } = instructionToKiroSteering(file.content);
        return { remainder: withExtension(file.remainder, 'md'), content, warnings };
      }
      case 'prompt': {
        const { content, warnings } = promptToKiro(file.content);
        return { remainder: withExtension(file.remainder, 'md'), content, warnings };
      }
      case 'chatmode': {
        // Chatmodes have no Kiro equivalent; keep as a steering-style markdown.
        return {
          remainder: withExtension(file.remainder, 'md'),
          content: file.content,
          warnings: ['Chatmode has no native Kiro equivalent; deployed as steering markdown.']
        };
      }
      case 'hook': {
        return {
          remainder: file.remainder,
          content: file.content,
          warnings: ['Hook format differs in Kiro (JSON); deployed as-is without conversion.']
        };
      }
      default:
        // skill, plugin → passthrough (SKILL.md is a shared standard).
        return { remainder: file.remainder, content: file.content, warnings: [] };
    }
  }

  // Copilot-family targets: source is already in the right format.
  return { remainder: file.remainder, content: file.content, warnings: [] };
}
