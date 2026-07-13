/**
 * Prompt → Kiro prompt transform.
 *
 * Copilot `.prompt.md` files carry executable-template frontmatter (agent,
 * model, tools, mode…). Kiro file prompts are simpler reusable instructions,
 * so we strip the Copilot-only execution keys and keep the body (+ description).
 */
import { parseFrontmatter, stringifyFrontmatter } from '../frontmatter';

const COPILOT_ONLY_PROMPT_KEYS = ['agent', 'model', 'tools', 'mode'] as const;

export interface TransformOutput {
  content: string;
  warnings: string[];
}

export function promptToKiro(content: string): TransformOutput {
  const { data, body } = parseFrontmatter(content);
  const warnings: string[] = [];

  if (!data) {
    return { content, warnings };
  }

  const fm = { ...data };
  for (const key of COPILOT_ONLY_PROMPT_KEYS) {
    if (fm[key] !== undefined) {
      delete fm[key];
      warnings.push(`Dropped Copilot-only prompt field "${key}" (unsupported in Kiro file prompts).`);
    }
  }

  return { content: stringifyFrontmatter(fm, body), warnings };
}
