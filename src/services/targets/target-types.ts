/**
 * Target types — the runtimes a bundle can be deployed to, and the canonical
 * "kinds" of primitive a bundle can contain.
 *
 * IMPORTANT: everything under src/services/targets/ MUST stay `vscode`-free so
 * the same engine runs in the extension and in the headless CLI.
 *
 * Kiro note: there is deliberately NO generic `kiro` target. Kiro has three
 * distinct agent surfaces with different formats, so we expose them explicitly:
 *   - kiro-ide      : Kiro IDE unified agents — Markdown `.kiro/agents/*.md`  (DEFAULT)
 *   - kiro-cli-v3   : Kiro CLI v3 unified harness — Markdown (early access)
 *   - kiro-cli-v2   : Kiro CLI 2.x legacy — JSON `.kiro/agents/*.json`
 */

export const TARGET_TYPES = [
  'vscode',
  'vscode-insiders',
  'copilot-cli',
  'claude-code',
  'windsurf',
  'kiro-ide',
  'kiro-cli-v3',
  'kiro-cli-v2'
] as const;

export type TargetType = (typeof TARGET_TYPES)[number];

/** Deploy scope: the user's home config, or a repository's workspace. */
export type TargetScope = 'user' | 'repository';

/**
 * Canonical primitive kinds. A file's kind is resolved from the deployment
 * manifest (authoritative), then the filename extension, then its folder —
 * NOT purely from the top-level folder (real bundles keep agents under prompts/).
 */
export const PRIMITIVE_KINDS = [
  'prompt',
  'agent',
  'instruction',
  'chatmode',
  'skill',
  'hook',
  'plugin'
] as const;

export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

/** Map a canonical kind to the folder key used in layouts.json kindRoutes. */
export const KIND_ROUTE_KEY: Record<PrimitiveKind, string> = {
  prompt: 'prompts/',
  agent: 'agents/',
  instruction: 'instructions/',
  chatmode: 'chatmodes/',
  skill: 'skills/',
  hook: 'hooks/',
  plugin: 'plugins/'
};

/** Reverse: a top-level folder name → canonical kind (fallback classification). */
export const FOLDER_TO_KIND: Record<string, PrimitiveKind> = {
  prompts: 'prompt',
  agents: 'agent',
  instructions: 'instruction',
  chatmodes: 'chatmode',
  skills: 'skill',
  hooks: 'hook',
  plugins: 'plugin'
};

/** A resolved deploy destination. */
export interface Target {
  type: TargetType;
  scope: TargetScope;
  /** Absolute workspace root — REQUIRED when scope === 'repository'. */
  workspaceRoot?: string;
  commitMode?: 'commit' | 'local-only';
}

/** Is this one of the three Kiro surfaces? */
export function isKiroTarget(type: TargetType): boolean {
  return type === 'kiro-ide' || type === 'kiro-cli-v3' || type === 'kiro-cli-v2';
}

/** Type guard for a known target type. */
export function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}
