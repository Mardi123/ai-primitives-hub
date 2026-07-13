# Multi-IDE Target Support — Architecture (Path B)

Status: **Design** · Branch: `feat/multi-ide-targets` · Scope: **Phase 0 (engine) + Kiro + Claude Code CLI**

This document describes how we add support for deploying primitives (prompts,
agents, instructions, chatmodes, skills, hooks, plugins) to multiple runtimes —
starting with **Kiro** (VS Code fork) and **Claude Code** (terminal CLI) — by
retrofitting a small, declarative *target engine* onto `main`, rather than
migrating to the `feat/cli-backup` monorepo.

We **port the proven design** from `feat/cli-backup`
(`packages/core` + `packages/app`) but land it as small, reviewable PRs inside
the current single-package layout.

---

## 1. The problem with `main` today

Deployment is hardcoded to GitHub Copilot / VS Code conventions in three places:

| Concern | Where it's hardcoded on `main` |
|---|---|
| Kind → path mapping | `src/utils/copilot-file-type-utils.ts` → `REPOSITORY_DIRECTORIES` (`.github/prompts/`, `.github/agents/`, …) |
| User-scope dirs | `src/services/user-scope-service.ts` → `getCopilotPromptsDirectory()`, `~/.copilot/skills` |
| Repo-scope dirs | `src/services/repository-scope-service.ts` → `.github/…` literals |
| Orchestration | `src/services/bundle-installer.ts` → calls the above directly |

There is no notion of a *target type*. Adding Kiro/Claude here means piling more
`if (kiro) …` branches into Copilot-shaped code. Phase 0 removes that ceiling.

---

## 2. Core idea — two orthogonal concerns

A "deploy a bundle to an IDE" operation decomposes into two independent questions:

1. **WHERE does each file go?** → **Layout** (declarative data, per target + scope).
2. **HOW must the file content change first?** → **Transformer** (code, only when a
   runtime's format differs).

Most targets need only a Layout entry (zero code). A Transformer is added *only*
for runtimes with format requirements (e.g. Kiro mandates `name:` frontmatter on
agents).

```
        Bundle (files on disk, kind-prefixed: prompts/, agents/, skills/ …)
                              │
                              ▼
                 ┌───────────────────────────┐
   per file →    │  TransformerRegistry       │   (HOW)  ── target-specific content fixups
                 │   .get(targetType)         │          NoOp fallback = copy as-is
                 └────────────┬──────────────┘
                              ▼  transformed content
                 ┌───────────────────────────┐
   per file →    │  LayoutResolver            │   (WHERE) ── kindRoutes + baseDir + skipPaths
                 │   .resolve(target, scope,  │           variable expansion (${HOME}, ${workspaceRoot})
                 │            filePath)       │
                 └────────────┬──────────────┘
                              ▼  absolute destination path
                 ┌───────────────────────────┐
                 │  Writer (fs)               │   ── ensureDir + write, per scope
                 └───────────────────────────┘
```

---

## 3. Phase 0 — the target engine (behavior-preserving refactor)

Goal: introduce the abstraction and route **existing** VS Code / Copilot installs
through it, with **no behavior change**. This is the foundation PR.

### 3.1 New domain types  — `src/types/target.ts` (new)

Ported from `feat/cli-backup`'s `packages/core/src/domain/install/target.ts`.

```ts
export const TARGET_TYPES = [
  'vscode', 'vscode-insiders', 'copilot-cli', 'kiro', 'windsurf', 'claude-code'
] as const;
export type TargetType = typeof TARGET_TYPES[number];

export type TargetScope = 'user' | 'repository';
export type PrimitiveKind =
  'prompts' | 'agents' | 'instructions' | 'chatmodes' | 'skills' | 'hooks' | 'plugins';

export interface Target {
  type: TargetType;
  scope: TargetScope;
  workspaceRoot?: string;       // required for repository scope
  commitMode?: 'commit' | 'local-only';
}
export const isTarget = (t: string): t is TargetType =>
  (TARGET_TYPES as readonly string[]).includes(t);
```

### 3.2 Layout registry — `src/services/targets/layouts.json` + `layout-resolver.ts` (new)

`layouts.json` is ported verbatim from
`feat/cli-backup:packages/infra/src/writers/default-layouts.json`. Shape per target:

```jsonc
"<targetType>": {
  "user":       { "baseDir": "<dir w/ ${HOME}>",        "kindRoutes": { "prompts/": "…", … }, "skipPaths": [ … ] },
  "repository": { "baseDir": "${workspaceRoot}", "kindRoutes": { "prompts/": ".github/…", … }, "skipPaths": [ … ] }
}
```

Resolver:

```ts
export class LayoutResolver {
  constructor(private layouts: LayoutConfig, private vars: Record<string,string>) {}

  // returns absolute destination path, or null if file should be skipped
  resolve(target: Target, bundleRelPath: string): string | null {
    const scoped = this.layouts[target.type]?.[target.scope];
    if (!scoped) return null;
    if (scoped.skipPaths.some(p => bundleRelPath === p || bundleRelPath.startsWith(p))) return null;
    const kind = firstSegment(bundleRelPath) + '/';           // "agents/foo.md" -> "agents/"
    const route = scoped.kindRoutes[kind];
    if (!route) return null;
    const rest = bundleRelPath.slice(kind.length);
    return join(expand(scoped.baseDir, this.vars), route, rest);
  }
}
```

`vars` = `{ HOME: os.homedir(), workspaceRoot: <ws> }`, plus profile-dir logic
migrated from `user-scope-service.resolveCopilotPromptsDirectory()`.

### 3.3 Transformer port — `src/services/targets/transformer.ts` (new)

Ported from `feat/cli-backup:packages/core/src/ports/resource-transformer.ts`.

```ts
export interface TransformContext { target: Target; filePath: string; content: string; }
export interface TransformResult  { content: string; modified: boolean; }
export interface ResourceTransformer { transform(ctx: TransformContext): TransformResult; }

export class TransformerRegistry {
  private map = new Map<TargetType, ResourceTransformer>();
  get(t: TargetType): ResourceTransformer { return this.map.get(t) ?? new NoOpTransformer(); }
  register(t: TargetType, x: ResourceTransformer) { this.map.set(t, x); }
  static withBuiltIns(): TransformerRegistry { /* Phase 2 registers 'kiro' */ return new TransformerRegistry(); }
}
```

Contract (from the port docs): transformers must be **idempotent**, **independent**,
and **fail-safe** (on error, return original content).

### 3.4 Refactor the install seam — `src/services/bundle-installer.ts`

Introduce a single `TargetDeployer` that both scope services delegate to:

```
bundle-installer.installBundle()
   └─ TargetDeployer.deploy(bundle, target)
        for each file in bundle:
           content'  = transformers.get(target.type).transform({target, filePath, content}).content
           dest      = layoutResolver.resolve(target, filePath)   // null → skip
           if dest:  ensureDir(dirname(dest)); write(dest, content')
```

- `UserScopeService` → `TargetDeployer.deploy(bundle, { type:'vscode'|'copilot-cli', scope:'user' })`
- `RepositoryScopeService` → `… scope:'repository'`

Phase 0 acceptance: with `vscode` + `copilot-cli` layouts, deployment output on disk
is **byte-identical** to today. `copilot-file-type-utils.REPOSITORY_DIRECTORIES` is
replaced by the `vscode` layout entry; the old constant becomes a thin shim (or is
deleted once callers migrate). Existing install/uninstall/lockfile tests must pass
unchanged — that's the proof the refactor is safe.

---

## 4. Phase 2a — Kiro (VS Code fork; layout + transformer)

Kiro runs the extension (OpenVSX), so this is extension-side only.

1. **Layout** — already in `layouts.json` (`kiro` → `~/.kiro`, repo `.kiro/…`).
2. **Transformer** — port `KiroTransformer` from
   `feat/cli-backup:packages/app/src/transform/transformers/kiro-transformer.ts`.
   It enforces Kiro's rule that **agent files must have a `name:` frontmatter field**
   (https://kiro.dev/docs/chat/subagents/): if missing, derive from `title` or the
   filename (kebab-case → Title Case). Idempotent + fail-safe. Register in
   `TransformerRegistry.withBuiltIns()` under `'kiro'`.
3. **IDE detection** — `src/services/targets/ide-detector.ts`: inspect
   `vscode.env.appName` / `appRoot` to detect Kiro and default the target type.
   (Users can still choose target explicitly.)
4. **Schema (issue #276)** — extend `collection.schema.json` / deployment-manifest so
   a collection can declare per-target compatibility / overrides (optional; default =
   all kinds allowed).

Closes #274 (deploy to Kiro locations); contributes to #244 and #276.

---

## 5. Phase 2b — Claude Code (terminal CLI; no extension host)

Claude Code has **no extension host**, so the extension cannot deploy into it. We add
a **thin CLI path** that reuses the *same* engine (LayoutResolver + TransformerRegistry).

- **Layout** — already in `layouts.json` (`claude-code`): note the kind remap
  `prompts/ → commands/` and `chatmodes/ → modes/` under `~/.claude` (user) or
  `.claude/…` (repository). This mapping matters — Claude Code calls prompts
  "commands".
- **Delivery** — smallest viable option first:
  - **Option 1 (recommended MVP): a minimal standalone CLI entry** — a single
    `bin/prompt-registry-apply.ts` (commander/clipanion) exposing
    `prompt-registry apply --target claude-code [--scope user|repository]`.
    It imports the shared engine (`targets/` module) — which is why Phase 0 keeps the
    engine free of any `vscode` imports.
  - **Option 2: a GitHub Action / CI step** wrapping the same command, for
    repository-scope deploys in pipelines.
- **Engine purity constraint:** the `src/services/targets/` module MUST NOT import
  `vscode`. That is the single most important Phase 0 rule — it's what lets the same
  code run headless in the CLI. Anything VS Code-specific stays in the scope services /
  UI layer and is injected (fs, paths, logger).

Closes the CLI half of #244/#275.

---

## 6. What is ported vs. written new

| Item | Source on `feat/cli-backup` | Action |
|---|---|---|
| `TARGET_TYPES`, `Target` types | `packages/core/src/domain/install/target.ts` | Port (trim to our fields) |
| `default-layouts.json` (incl. kiro, claude-code) | `packages/infra/src/writers/default-layouts.json` | Port verbatim |
| `ResourceTransformer` port + `TransformContext/Result` | `packages/core/src/ports/…`, `.../domain/install/transform.ts` | Port |
| `TransformerRegistry`, `NoOpTransformer` | `packages/app/src/transform/…` | Port |
| `KiroTransformer` | `packages/app/src/transform/transformers/kiro-transformer.ts` | Port |
| `LayoutResolver` | branch's layout resolver (`app-install-layout-resolver`) | Port + adapt to our fs |
| `TargetDeployer` seam | new — glue to `bundle-installer` | Write new |
| IDE detection | new (extension) | Write new |
| CLI `apply` entry | branch's `packages/cli` (heavily) | Write minimal new |

---

## 7. Delivery plan (small PRs)

1. **PR-0a** — domain types + `layouts.json` + `LayoutResolver` + unit tests (no wiring).
2. **PR-0b** — `TransformerRegistry` + port + `NoOpTransformer` + tests.
3. **PR-0c** — `TargetDeployer` seam; route `vscode`/`copilot-cli` through it;
   prove byte-identical output (existing tests green). ← **behavior-preserving**
4. **PR-2a** — Kiro layout wiring + `KiroTransformer` + IDE detection + tests. Closes #274.
5. **PR-2b** — schema extension for per-target compatibility. Closes #276.
6. **PR-2c** — minimal CLI `apply` for `claude-code`. Closes #275 (+ #244).

Rule enforced throughout: **`src/services/targets/**` has zero `vscode` imports.**
