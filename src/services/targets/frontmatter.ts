/**
 * YAML frontmatter parsing/splitting/serialization shared by the transformers.
 * Uses js-yaml (already a project dependency).
 */
import * as yaml from 'js-yaml';

export interface Frontmatter {
  /** Parsed frontmatter object (null if none/invalid). */
  data: Record<string, unknown> | null;
  /** The markdown body after the frontmatter block. */
  body: string;
  /** True if a `---` frontmatter block was present. */
  hasFrontmatter: boolean;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a markdown file into frontmatter data + body. */
export function parseFrontmatter(content: string): Frontmatter {
  const match = FM_RE.exec(content);
  if (!match) {
    return { data: null, body: content, hasFrontmatter: false };
  }
  const body = content.slice(match[0].length);
  try {
    const parsed = yaml.load(match[1]);
    const data = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    return { data, body, hasFrontmatter: true };
  } catch {
    // Malformed YAML: treat as no usable frontmatter, keep original body.
    return { data: null, body, hasFrontmatter: true };
  }
}

/** Rebuild a markdown file from frontmatter data + body. */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (keys.length === 0) {
    return body.startsWith('\n') ? body.slice(1) : body;
  }
  const clean: Record<string, unknown> = {};
  for (const k of keys) {
    clean[k] = data[k];
  }
  const yamlBlock = yaml.dump(clean, { lineWidth: -1 }).replace(/\n$/, '');
  const sep = body.startsWith('\n') ? '' : '\n';
  return `---\n${yamlBlock}\n---\n${sep}${body}`;
}
