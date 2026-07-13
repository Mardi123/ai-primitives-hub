/**
 * Integration tests for the Kiro install bridge — the glue the Install button
 * uses when the host is Kiro: deploy an extracted bundle to `.kiro/**` and
 * merge/remove MCP servers in `.kiro/settings/mcp.json`.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  deployDirectoryToTarget,
  removeKiroMcpServers,
  syncKiroMcpServers
} from '../../../src/services/target-install-bridge';
import type { Target } from '../../../src/services/targets/target-types';

const MANIFEST = `id: demo-pr
name: Demo PR
prompts:
  - id: Hunter
    file: prompts/Hunter.agent.md
    type: agent
`;
const AGENT = `---
name: Hunter
description: "Bug finder"
tools: ["search", "edit", "terminal"]
---
You are a bug hunter.`;

suite('target-install-bridge (Kiro install integration)', () => {
  let tmp: string;
  let bundleDir: string;
  let ws: string;

  suiteSetup(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'aiph-bridge-'));
    bundleDir = path.join(tmp, 'bundle');
    ws = path.join(tmp, 'workspace');
    await fs.mkdir(path.join(bundleDir, 'prompts'), { recursive: true });
    await fs.mkdir(ws, { recursive: true });
    await fs.writeFile(path.join(bundleDir, 'deployment-manifest.yml'), MANIFEST);
    await fs.writeFile(path.join(bundleDir, 'prompts', 'Hunter.agent.md'), AGENT);
    await fs.writeFile(path.join(bundleDir, 'README.md'), 'readme');
  });

  suiteTeardown(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test('deploys agent-under-prompts to <ws>/.kiro/agents as converted .md', async () => {
    const target: Target = { type: 'kiro-ide', scope: 'repository', workspaceRoot: ws };
    const result = await deployDirectoryToTarget(bundleDir, target);

    const dest = path.join(ws, '.kiro', 'agents', 'Hunter.md');
    const content = await fs.readFile(dest, 'utf8');
    assert.match(content, /name: Hunter/);
    assert.match(content, /shell/); // terminal→shell
    assert.match(content, /write/); // edit→write
    assert.match(content, /You are a bug hunter\./);
    assert.ok(result.skipped.includes('README.md'));
    assert.ok(result.written.some((w) => w.kind === 'agent' && w.destPath === dest));
  });

  test('syncKiroMcpServers writes then removeKiroMcpServers cleans mcp.json', async () => {
    const target: Target = { type: 'kiro-ide', scope: 'repository', workspaceRoot: ws };
    const servers = { 'demo-server': { command: 'node', args: ['server.js'] } };

    const written = await syncKiroMcpServers(target, servers);
    assert.deepStrictEqual(written, ['demo-server']);

    const mcpPath = path.join(ws, '.kiro', 'settings', 'mcp.json');
    let doc = JSON.parse(await fs.readFile(mcpPath, 'utf8'));
    assert.ok(doc.mcpServers['demo-server'], 'server merged into mcp.json');

    await removeKiroMcpServers(target, ['demo-server']);
    doc = JSON.parse(await fs.readFile(mcpPath, 'utf8'));
    assert.ok(!doc.mcpServers['demo-server'], 'server removed from mcp.json');
  });

  test('syncKiroMcpServers preserves pre-existing servers', async () => {
    const target: Target = { type: 'kiro-ide', scope: 'repository', workspaceRoot: ws };
    const mcpPath = path.join(ws, '.kiro', 'settings', 'mcp.json');
    await fs.writeFile(mcpPath, JSON.stringify({ mcpServers: { existing: { url: 'x' } } }, null, 2));

    await syncKiroMcpServers(target, { added: { command: 'c' } });
    const doc = JSON.parse(await fs.readFile(mcpPath, 'utf8'));
    assert.ok(doc.mcpServers.existing, 'existing server preserved');
    assert.ok(doc.mcpServers.added, 'new server added');
  });

  test('no MCP servers → no-op (returns empty)', async () => {
    const target: Target = { type: 'kiro-ide', scope: 'user' };
    assert.deepStrictEqual(await syncKiroMcpServers(target, undefined), []);
    assert.deepStrictEqual(await syncKiroMcpServers(target, {}), []);
  });
});
