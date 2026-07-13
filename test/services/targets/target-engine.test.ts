/**
 * Multi-IDE target engine tests (v2 architecture).
 *
 * Covers: manifest-aware classification, kind-based layout routing, Copilot→Kiro
 * agent conversion (IDE markdown + CLI v2 JSON), instruction→steering,
 * prompt stripping, and full TargetDeployer runs — including an "existing
 * collection" shaped like 3-Agent PR Review (agents under prompts/).
 */
import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';

import { LayoutResolver } from '../../../src/services/targets/layout-resolver';
import type { LayoutConfig } from '../../../src/services/targets/layout-resolver';
import { classifyFile, parseManifest } from '../../../src/services/targets/manifest';
import { parseCopilotAgent } from '../../../src/services/targets/agents/agent-definition';
import { renderKiroIde, renderKiroCliV2 } from '../../../src/services/targets/agents/render-kiro';
import { instructionToKiroSteering } from '../../../src/services/targets/transformers/instructions';
import { promptToKiro } from '../../../src/services/targets/transformers/prompts';
import { TargetDeployer } from '../../../src/services/targets/target-deployer';
import type { BundleFile, FileSystemPort } from '../../../src/services/targets/target-deployer';
import { detectTargetFromAppName } from '../../../src/services/targets/ide-detector';
import type { Target } from '../../../src/services/targets/target-types';
import layoutsData from '../../../src/services/targets/layouts.json';

const layouts = (layoutsData as { layouts: LayoutConfig }).layouts;

function memFs(): { fs: FileSystemPort; files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    fs: {
      async ensureDir() {
        /* no-op */
      },
      async writeFile(abs: string, content: string) {
        files.set(abs, content);
      }
    }
  };
}

// A bundle shaped like a real hub collection: agents live under prompts/,
// disambiguated by the manifest's type fields.
const MANIFEST = `id: demo-pr
name: Demo PR
prompts:
  - id: orchestrator
    file: prompts/orchestrator.prompt.md
    type: prompt
  - id: Hunter
    file: prompts/Hunter.agent.md
    type: agent
`;
const AGENT_MD = `---
name: Hunter
description: "Aggressive bug finder"
tools: ["vscode", "execute", "read", "agent", "edit", "search", "web", "todo"]
---
You are a bug-finding agent.`;

suite('manifest classification', () => {
  const manifest = parseManifest(MANIFEST);
  test('agent under prompts/ is classified as agent (manifest type wins)', () => {
    const c = classifyFile('prompts/Hunter.agent.md', AGENT_MD, manifest);
    assert.strictEqual(c.kind, 'agent');
    assert.strictEqual(c.remainder, 'Hunter.agent.md');
  });
  test('prompt under prompts/ stays prompt', () => {
    const c = classifyFile('prompts/orchestrator.prompt.md', 'x', manifest);
    assert.strictEqual(c.kind, 'prompt');
  });
  test('extension fallback works with no manifest', () => {
    assert.strictEqual(classifyFile('prompts/x.agent.md', 'x', new Map()).kind, 'agent');
    assert.strictEqual(classifyFile('skills/demo/SKILL.md', 'x', new Map()).kind, 'skill');
  });
});

suite('LayoutResolver (route by kind)', () => {
  const r = new LayoutResolver(layouts);
  const vars = { HOME: '/home/u', workspaceRoot: '/ws' };

  test('kiro-ide: agent → .kiro/agents (user)', () => {
    const t: Target = { type: 'kiro-ide', scope: 'user' };
    assert.strictEqual(r.resolve(t, 'agent', 'Hunter.md', 'prompts/Hunter.agent.md', vars)?.dest,
      path.join('/home/u', '.kiro', 'agents/', 'Hunter.md'));
  });
  test('kiro-ide: prompt → .kiro/prompts (fixed, was steering)', () => {
    const t: Target = { type: 'kiro-ide', scope: 'user' };
    assert.strictEqual(r.resolve(t, 'prompt', 'go.md', 'prompts/go.prompt.md', vars)?.dest,
      path.join('/home/u', '.kiro', 'prompts/', 'go.md'));
  });
  test('kiro-ide: instruction → .kiro/steering', () => {
    const t: Target = { type: 'kiro-ide', scope: 'repository', workspaceRoot: '/ws' };
    assert.strictEqual(r.resolve(t, 'instruction', 'style.md', 'instructions/style.instructions.md', vars)?.dest,
      path.join('/ws', '.kiro/steering/', 'style.md'));
  });
  test('copilot-cli repo prompt → .github/prompts (parity with main)', () => {
    const t: Target = { type: 'copilot-cli', scope: 'repository', workspaceRoot: '/ws' };
    assert.strictEqual(r.resolve(t, 'prompt', 'x.prompt.md', 'prompts/x.prompt.md', vars)?.dest,
      path.join('/ws', '.github/prompts/', 'x.prompt.md'));
  });
  test('claude-code user prompt → commands/', () => {
    const t: Target = { type: 'claude-code', scope: 'user' };
    assert.strictEqual(r.resolve(t, 'prompt', 'x.prompt.md', 'prompts/x.prompt.md', vars)?.dest,
      path.join('/home/u', '.claude', 'commands/', 'x.prompt.md'));
  });
  test('README is skipped', () => {
    const t: Target = { type: 'kiro-ide', scope: 'user' };
    assert.strictEqual(r.isSkipped(t, 'README.md'), true);
  });
});

suite('Copilot → Kiro agent conversion', () => {
  test('kiro-ide markdown: injects name, maps tools, drops unknown with warning', () => {
    const agent = parseCopilotAgent(AGENT_MD, 'Hunter');
    const out = renderKiroIde(agent);
    assert.match(out.content, /name: Hunter/);
    // tools mapped: execute→shell, edit→write, search/read→read, web, agent→subagent, todo→todo_list
    assert.match(out.content, /shell/);
    assert.match(out.content, /write/);
    assert.match(out.content, /subagent/);
    assert.match(out.content, /todo_list/);
    // body preserved as system prompt
    assert.match(out.content, /You are a bug-finding agent\./);
    // "vscode" is unknown → warning, not silently kept
    assert.ok(out.warnings.some((w) => /vscode/.test(w)));
    assert.ok(!/tools:[\s\S]*vscode/.test(out.content));
  });

  test('kiro-cli-v2 emits JSON with prompt + tools', () => {
    const agent = parseCopilotAgent(AGENT_MD, 'Hunter');
    const out = renderKiroCliV2(agent);
    assert.strictEqual(out.extension, 'json');
    const json = JSON.parse(out.content);
    assert.strictEqual(json.name, 'Hunter');
    assert.match(json.prompt, /bug-finding agent/);
    assert.ok(Array.isArray(json.tools) && json.tools.includes('shell'));
  });

  test('unresolved MCP tool warns instead of dropping silently', () => {
    const md = `---\nname: gh\ntools: ["github/*"]\n---\nbody`;
    const agent = parseCopilotAgent(md, 'gh');
    const out = renderKiroIde(agent, {}); // empty registry
    assert.ok(out.warnings.some((w) => /Unresolved MCP tool "github\/\*"/.test(w)));
  });

  test('MCP tool resolves when registry provides the server', () => {
    const md = `---\nname: gh\ntools: ["github/*"]\n---\nbody`;
    const agent = parseCopilotAgent(md, 'gh');
    const out = renderKiroIde(agent, { github: 'github' });
    assert.match(out.content, /@github\/\*/);
  });
});

suite('instruction & prompt transforms', () => {
  test('applyTo → inclusion: fileMatch + fileMatchPattern', () => {
    const src = `---\nname: py\napplyTo: "**/*.py"\n---\nUse PEP8.`;
    const { content } = instructionToKiroSteering(src);
    assert.match(content, /inclusion: fileMatch/);
    assert.match(content, /fileMatchPattern: '\*\*\/\*\.py'|fileMatchPattern: "\*\*\/\*\.py"|fileMatchPattern: \*\*\/\*\.py/);
    assert.ok(!/applyTo/.test(content));
  });
  test('bare instruction becomes inclusion: always', () => {
    const { content } = instructionToKiroSteering(`---\nname: base\n---\nUse types.`);
    assert.match(content, /inclusion: always/);
  });
  test('prompt strips Copilot-only execution fields', () => {
    const { content, warnings } = promptToKiro(`---\ndescription: d\nagent: backend\nmodel: gpt\ntools: [x]\n---\nBody`);
    assert.ok(!/agent:/.test(content) && !/model:/.test(content) && !/tools:/.test(content));
    assert.match(content, /description: d/);
    assert.ok(warnings.length >= 3);
  });
});

suite('TargetDeployer end-to-end', () => {
  const bundle: BundleFile[] = [
    { relPath: 'deployment-manifest.yml', content: MANIFEST },
    { relPath: 'prompts/Hunter.agent.md', content: AGENT_MD },
    { relPath: 'prompts/orchestrator.prompt.md', content: '---\nagent: x\n---\nOrchestrate.' },
    { relPath: 'README.md', content: 'readme' }
  ];

  test('kiro-ide: agent-under-prompts routes to .kiro/agents as .md with conversion', async () => {
    const { fs, files } = memFs();
    const res = await new TargetDeployer(fs).deploy(bundle, { type: 'kiro-ide', scope: 'user' });

    const agentDest = path.join(os.homedir(), '.kiro', 'agents/', 'Hunter.md');
    const promptDest = path.join(os.homedir(), '.kiro', 'prompts/', 'orchestrator.md');
    assert.ok(files.has(agentDest), 'agent should land in .kiro/agents');
    assert.ok(files.has(promptDest), 'prompt should land in .kiro/prompts');
    assert.match(files.get(agentDest)!, /name: Hunter/);
    assert.match(files.get(agentDest)!, /shell/);
    assert.ok(res.skipped.includes('README.md'));
    assert.ok(res.written.find((w) => w.relPath === 'prompts/Hunter.agent.md')?.kind === 'agent');
  });

  test('claude-code: agent kept as Copilot markdown, routed to agents/', async () => {
    const { fs, files } = memFs();
    await new TargetDeployer(fs).deploy(bundle, { type: 'claude-code', scope: 'user' });
    const dest = path.join(os.homedir(), '.claude', 'agents/', 'Hunter.agent.md');
    assert.ok(files.has(dest), 'claude-code keeps .agent.md filename + passthrough content');
    assert.strictEqual(files.get(dest), AGENT_MD);
  });

  test('kiro-cli-v2: agent emitted as JSON in .kiro/agents', async () => {
    const { fs, files } = memFs();
    await new TargetDeployer(fs).deploy(bundle, { type: 'kiro-cli-v2', scope: 'user' });
    const dest = path.join(os.homedir(), '.kiro', 'agents/', 'Hunter.json');
    assert.ok(files.has(dest));
    assert.strictEqual(JSON.parse(files.get(dest)!).name, 'Hunter');
  });

  test('repository scope requires workspaceRoot', async () => {
    const { fs } = memFs();
    await assert.rejects(() => new TargetDeployer(fs).deploy(bundle, { type: 'kiro-ide', scope: 'repository' }));
  });
});

suite('ide-detector', () => {
  test('kiro → kiro-ide; others', () => {
    assert.strictEqual(detectTargetFromAppName('Kiro'), 'kiro-ide');
    assert.strictEqual(detectTargetFromAppName('Windsurf'), 'windsurf');
    assert.strictEqual(detectTargetFromAppName('Visual Studio Code - Insiders'), 'vscode-insiders');
    assert.strictEqual(detectTargetFromAppName('Cursor'), 'vscode');
  });
});
