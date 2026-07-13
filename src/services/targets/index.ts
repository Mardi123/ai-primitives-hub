/**
 * Multi-IDE target engine — public surface.
 *
 * Runtime-agnostic (no `vscode` imports) so it is shared by the VS Code
 * extension and the headless Claude Code / Kiro CLI paths.
 */
export * from './target-types';
export * from './layout-resolver';
export * from './manifest';
export * from './converter';
export * from './target-deployer';
export * from './ide-detector';
export { parseFrontmatter, stringifyFrontmatter } from './frontmatter';
export { parseCopilotAgent } from './agents/agent-definition';
export type { AgentDefinition } from './agents/agent-definition';
export { renderKiroIde, renderKiroCliV3, renderKiroCliV2 } from './agents/render-kiro';
