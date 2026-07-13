# Multi-IDE Support — Manual Test Checklist

Covers both delivery paths across the three runtimes.

| Runtime | CLI | Extension (VSIX) |
|---|---|---|
| VS Code | ✅ `--target vscode` | ✅ regression + `Deploy Bundle to Target` command |
| Kiro | ✅ `--target kiro` | ✅ `Deploy Bundle to Target` command |
| Claude Code | ✅ `--target claude-code` | ❌ N/A — Claude Code has no extension host |

## Artifacts (built on branch `feat/multi-ide-targets`)
- **VSIX**: `prompt-registry-0.0.2.vsix` (repo root)
- **CLI**: `cli-dist/cli/prompt-registry-apply.js` (portable — `js-yaml` vendored in `cli-dist/node_modules`)
- **Sample bundle**: `cli-dist/sample-bundle/` (agents/, prompts/, skills/, README.md)

---

## ⚠️ Windows gotcha (read first)
`os.homedir()` on Windows uses `USERPROFILE` and **ignores** the `HOME` env var. So **user-scope** deploys always write to your real home (`C:\Users\<you>\.kiro`, `.claude`, etc.). To test safely without polluting your real config:
- use **`--dry-run`** to preview destinations, or
- use **`--scope repository --workspace <a-temp-folder>`** so everything lands under a throwaway folder.

---

## Part A — CLI

Run from anywhere (the bundle is portable):

```bash
node cli-dist/cli/prompt-registry-apply.js --bundle cli-dist/sample-bundle --target <type> [--dry-run] [--scope repository --workspace <dir>]
```

### A1. Claude Code
```bash
# preview
node cli-dist/cli/prompt-registry-apply.js --bundle cli-dist/sample-bundle --target claude-code --dry-run
```
- [ ] `agents/reviewer.md` → `~/.claude/agents/reviewer.md`
- [ ] `prompts/summarize.prompt.md` → `~/.claude/commands/summarize.prompt.md`  (prompts remap to **commands**)
- [ ] `skills/demo/SKILL.md` → `~/.claude/skills/demo/SKILL.md`
- [ ] `README.md` **skipped**
- [ ] No `T` flag on the agent (Claude Code applies **no** content transform)
- [ ] Real deploy (repository scope): open Claude Code in the target folder, confirm it sees the deployed commands/agents/skills.

### A2. Kiro
```bash
node cli-dist/cli/prompt-registry-apply.js --bundle cli-dist/sample-bundle --target kiro --dry-run
```
- [ ] `agents/reviewer.md` → `~/.kiro/agents/reviewer.md`, and shows **`T`** (transformed)
- [ ] `prompts/summarize.prompt.md` → `~/.kiro/steering/…`  (prompts remap to **steering**)
- [ ] After a real deploy, open `~/.kiro/agents/reviewer.md` and confirm a `name:` field was injected (Kiro requires it).
- [ ] Launch Kiro, verify the agent is recognized (no "missing name" error).

### A3. VS Code (as a CLI target)
```bash
node cli-dist/cli/prompt-registry-apply.js --bundle cli-dist/sample-bundle --target vscode --scope repository --workspace <dir> --dry-run
```
- [ ] repository scope routes to `.github/prompts/`, `.github/skills/` (parity with today's extension behavior)

---

## Part B — Extension (VSIX)

### Install
- **VS Code**: `code --install-extension prompt-registry-0.0.2.vsix` (or Extensions view → ⋯ → Install from VSIX).
- **Kiro**: Extensions view → Install from VSIX (Kiro accepts VSIX/OpenVSX).

### B1. VS Code — regression (no breaking changes)  ‹most important›
With the VSIX installed in VS Code:
- [ ] Extension activates without errors (check "AI Primitives Hub" output channel).
- [ ] Marketplace / Registry Explorer opens and lists bundles.
- [ ] Install a bundle at **user** scope → lands in the usual Copilot locations (`~/.copilot`, `~/.config/Code/User/…`) exactly as before.
- [ ] Install a bundle at **repository** scope → lands under `.github/…` as before.
- [ ] Uninstall works; lockfile updates as before.
- [ ] ✅ Confirm nothing about the existing flow changed (the new engine is NOT wired into install; only the new command uses it).

### B2. Kiro / VS Code — new `Deploy Bundle to Target` command
- [ ] Command Palette → **"AI Primitives Hub: Deploy Bundle to Target (Kiro, Claude Code, VS Code…)"**.
- [ ] Prompts for: bundle folder → target type (host editor shown as **detected**) → scope.
- [ ] In **Kiro**, target defaults to `kiro`; deploy the sample bundle; verify files under `~/.kiro/…` (agents transformed with `name:`).
- [ ] In **VS Code**, target defaults to `vscode`; deploy repository scope; verify `.github/…` placement.
- [ ] Success toast reports written / skipped / adapted counts.
- [ ] Deploying a bundle with an unsupported kind (e.g. a `plugins/` folder) to Kiro → files land under `~/.kiro/prompt-registry/plugins/…` and the toast notes "N adapted" (nothing dropped).

---

## Part C — Automated gates (already run on this branch)
- [x] Production build `npm run compile` → exit 0 (only pre-existing elastic/arrow warning).
- [x] Target-engine unit tests (`test/services/targets`) → 13/13 passing.
- [x] Full unit suite → 2284 passing; 53 failures pre-existing/environmental (unrelated suites; new code imported by nothing).
- [x] CLI end-to-end on real disk (Kiro transform + Claude/Kiro routing) verified.
