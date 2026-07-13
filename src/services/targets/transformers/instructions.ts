/**
 * Instruction → Kiro steering transform.
 *
 * Copilot instructions use `applyTo: "<glob>"` for path scoping. Kiro steering
 * uses inclusion modes: `inclusion: fileMatch` + `fileMatchPattern: "<glob>"`,
 * or `inclusion: always` for project-wide rules. This rewrites the frontmatter
 * so the instruction actually takes effect in Kiro.
 */
import { parseFrontmatter, stringifyFrontmatter } from '../frontmatter';

export interface TransformOutput {
  content: string;
  warnings: string[];
}

export function instructionToKiroSteering(content: string): TransformOutput {
  const { data, body } = parseFrontmatter(content);
  const fm = { ...(data ?? {}) };
  const warnings: string[] = [];

  const applyTo = fm.applyTo;
  delete fm.applyTo;

  if (applyTo !== undefined) {
    fm.inclusion = 'fileMatch';
    // Kiro's fileMatchPattern is a glob; keep a single string where possible.
    fm.fileMatchPattern = Array.isArray(applyTo) ? applyTo : String(applyTo);
  } else if (fm.inclusion === undefined) {
    // A bare instruction with no scoping becomes an always-on steering file.
    fm.inclusion = 'always';
  }

  return { content: stringifyFrontmatter(fm, body), warnings };
}
