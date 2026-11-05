import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { ToolResult } from './tools';

export interface GraphNode {
  id: string;
  label: string;
  cluster: string;
  ext: string;
  lines: number;
  symbols: string[];
  imports: string[];
  importedBy: string[];
  score: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: 'import' | 'asset' | 'reference';
}

export interface CodeGraphData {
  workspaceName: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: Array<{ name: string; count: number }>;
  hubs: GraphNode[];
  cycles: string[][];
  orphans: GraphNode[];
  healthScore: number;
  totalLines: number;
  totalSymbols: number;
}

export interface GraphifyParams {
  action?: string;
  target?: string;
  query?: string;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'out', 'out-test', 'dist', 'build', '.next', '.nuxt', '.svelte-kit',
  '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode-test', 'coverage', '.cache', '.turbo',
  '.parcel-cache', 'bower_components'
]);

const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h',
  '.html', '.css', '.scss', '.sql', '.md', '.json'
]);

const MAX_GRAPH_FILES = 350;

const toPosix = (p: string) => p.split(path.sep).join('/');

async function collectWorkspaceFiles(dir: string, root: string, out: string[]): Promise<void> {
  if (out.length >= MAX_GRAPH_FILES) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_GRAPH_FILES) return;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await collectWorkspaceFiles(path.join(dir, entry.name), root, out);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (CODE_EXTS.has(ext) && !entry.name.endsWith('.vsix') && entry.name !== 'package-lock.json') {
        out.push(toPosix(path.relative(root, path.join(dir, entry.name))));
      }
    }
  }
}

function extractSymbols(text: string, ext: string): string[] {
  const found = new Set<string>();
  const add = (prefix: string, name: string) => {
    if (name && name.length > 1 && found.size < 25) {
      found.add(`${prefix} ${name}`);
    }
  };

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    const re = /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum|const)\s+([A-Za-z_$][\w$]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      add(m[1], m[2]);
    }
  } else if (ext === '.py') {
    const re = /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      add(m[1], m[2]);
    }
  } else if (['.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h'].includes(ext)) {
    const re = /\b(func|fn|struct|class|interface|enum)\s+([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      add(m[1], m[2]);
    }
  } else if (ext === '.html') {
    const idRe = /\bid=["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = idRe.exec(text)) !== null) {
      if (!m[1].startsWith('__sov_')) add('#', m[1]);
    }
  } else if (ext === '.sql') {
    const tableRe = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w.]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = tableRe.exec(text)) !== null) {
      add('table', m[1]);
    }
  } else if (ext === '.md') {
    const hRe = /^#{1,2}\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = hRe.exec(text)) !== null) {
      add('doc', m[1].trim().slice(0, 40));
    }
  }
  return [...found];
}

function extractRawImports(text: string, ext: string): Array<{ spec: string; kind: 'import' | 'asset' | 'reference' }> {
  const results: Array<{ spec: string; kind: 'import' | 'asset' | 'reference' }> = [];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    const importRe = /\b(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(text)) !== null) {
      const spec = (m[1] ?? m[2] ?? '').trim();
      if (spec) results.push({ spec, kind: 'import' });
    }
  } else if (ext === '.py') {
    const pyRe = /^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.,\s]+))/gm;
    let m: RegExpExecArray | null;
    while ((m = pyRe.exec(text)) !== null) {
      const raw = (m[1] ?? m[2] ?? '').split(',')[0].trim();
      if (raw) results.push({ spec: raw, kind: 'import' });
    }
  } else if (ext === '.go') {
    // Go single import: import "package/path"
    const goSingleRe = /import\s+["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = goSingleRe.exec(text)) !== null) {
      results.push({ spec: m[1].trim(), kind: 'import' });
    }
    // Go block import: import ( "..." \n "..." )
    const goBlockRe = /import\s*\(([\s\S]*?)\)/g;
    while ((m = goBlockRe.exec(text)) !== null) {
      const block = m[1];
      const lines = block.split('\n');
      for (const line of lines) {
        const itemMatch = line.match(/["']([^"']+)["']/);
        if (itemMatch) {
          results.push({ spec: itemMatch[1].trim(), kind: 'import' });
        }
      }
    }
  } else if (ext === '.rs') {
    const rsRe = /\b(?:use|mod)\s+([a-zA-Z0-9_:]+)/g;
    let m: RegExpExecArray | null;
    while ((m = rsRe.exec(text)) !== null) {
      results.push({ spec: m[1].replace(/::/g, '/'), kind: 'import' });
    }
  } else if (ext === '.html') {
    const assetRe = /\b(?:src|href)=["']([^"':]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = assetRe.exec(text)) !== null) {
      const spec = m[1].trim();
      if (spec && !spec.startsWith('#') && !spec.startsWith('//')) {
        results.push({ spec, kind: 'asset' });
      }
    }
  }
  return results;
}

function resolveImportTarget(fromFile: string, spec: string, fileSet: Set<string>): string | undefined {
  const baseDir = path.posix.dirname(fromFile);
  const candidates: string[] = [];

  if (spec.startsWith('.')) {
    const joined = path.posix.normalize(path.posix.join(baseDir, spec));
    candidates.push(
      joined,
      `${joined}.ts`,
      `${joined}.tsx`,
      `${joined}.js`,
      `${joined}.jsx`,
      `${joined}.py`,
      `${joined}.go`,
      `${joined}.rs`,
      `${joined}/index.ts`,
      `${joined}/index.js`,
      `${joined}/__init__.py`
    );
  } else {
    const dotted = spec.replace(/\./g, '/');
    candidates.push(
      spec,
      dotted,
      `${dotted}.py`,
      `${dotted}.ts`,
      `${dotted}.js`,
      `${dotted}.go`,
      `${dotted}.rs`,
      path.posix.normalize(path.posix.join(baseDir, spec)),
      path.posix.normalize(path.posix.join(baseDir, `${spec}.go`)),
      path.posix.normalize(path.posix.join(baseDir, `${dotted}.py`))
    );
  }

  for (const c of candidates) {
    const clean = c.replace(/^\.\//, '');
    if (fileSet.has(clean) && clean !== fromFile) {
      return clean;
    }
  }

  // Sibling and package match for Go and other languages
  const specBase = path.posix.basename(spec).replace(/\.[a-zA-Z0-9]+$/, '');
  for (const f of fileSet) {
    if (f !== fromFile) {
      if (f.endsWith('/' + spec) || f.endsWith('/' + spec + '.go') || f.endsWith('/' + spec + '.ts') || f.endsWith('/' + spec + '.js')) {
        return f;
      }
      const fBase = path.posix.basename(f, path.posix.extname(f));
      if (fBase === specBase && path.posix.dirname(f) === baseDir) {
        return f;
      }
    }
  }

  // Segment subpaths for Go module paths (e.g. github.com/user/aztu-assistant/db -> db or db.go)
  const segments = spec.split('/');
  for (let sIdx = 1; sIdx < segments.length; sIdx++) {
    const sub = segments.slice(sIdx).join('/');
    for (const f of fileSet) {
      if (f !== fromFile) {
        if (f.endsWith('/' + sub) || f.endsWith('/' + sub + '.go') || f.endsWith('/' + sub + '/index.ts') || f.endsWith('/' + sub + '.ts')) {
          return f;
        }
      }
    }
  }

  return undefined;
}

function getClusterName(relPath: string): string {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 1) return 'root';

  const srcIdx = parts.indexOf('src');
  if (srcIdx !== -1 && srcIdx + 1 < parts.length - 1) {
    return `src/${parts[srcIdx + 1]}`;
  }
  if (srcIdx !== -1) {
    return 'src';
  }

  for (const seg of ['media', 'tests', 'test', 'lib', 'docs', 'public', 'i18n', 'scripts', 'app', 'components', 'routes', 'services']) {
    const idx = parts.indexOf(seg);
    if (idx !== -1) {
      if (idx + 1 < parts.length - 1 && parts[idx + 1] !== parts[parts.length - 1]) {
        return `${seg}/${parts[idx + 1]}`;
      }
      return seg;
    }
  }

  // If path is e.g. sovereign-agent/package.json or root files
  if (parts.length === 2 && /\.(json|md|txt|yml|yaml|toml|lock|ts|js|html|css)$/i.test(parts[1])) {
    return 'root';
  }

  if (parts.length >= 3) {
    return `${parts[1]}`;
  }

  return parts[0] || 'root';
}

export async function buildCodeGraph(root: string): Promise<CodeGraphData> {
  const files: string[] = [];
  await collectWorkspaceFiles(root, root, files);
  const fileSet = new Set(files);

  const nodesMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let totalLines = 0;
  let totalSymbols = 0;

  for (const rel of files) {
    const full = path.join(root, rel);
    let text = '';
    try {
      const stat = await fs.stat(full);
      if (stat.size <= 512 * 1024) {
        text = await fs.readFile(full, 'utf8');
      }
    } catch {
      continue;
    }
    const ext = path.extname(rel).toLowerCase();
    const lines = text ? text.split(/\r?\n/).length : 0;
    const symbols = extractSymbols(text, ext);
    totalLines += lines;
    totalSymbols += symbols.length;

    const rawImports = extractRawImports(text, ext);
    const resolvedImports = new Set<string>();
    for (const item of rawImports) {
      const target = resolveImportTarget(rel, item.spec, fileSet);
      if (target && !resolvedImports.has(target)) {
        resolvedImports.add(target);
        edges.push({ from: rel, to: target, kind: item.kind });
      }
    }

    nodesMap.set(rel, {
      id: rel,
      label: path.posix.basename(rel),
      cluster: getClusterName(rel),
      ext,
      lines,
      symbols,
      imports: [...resolvedImports],
      importedBy: [],
      score: 1
    });
  }

  for (const edge of edges) {
    const targetNode = nodesMap.get(edge.to);
    if (targetNode && !targetNode.importedBy.includes(edge.from)) {
      targetNode.importedBy.push(edge.from);
    }
  }

  const nodes = [...nodesMap.values()];
  for (const node of nodes) {
    node.score = node.importedBy.length * 2 + node.imports.length + Math.min(5, Math.floor(node.symbols.length / 3));
  }

  // Detect circular dependencies
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();
  for (const a of nodes) {
    for (const bId of a.imports) {
      const b = nodesMap.get(bId);
      if (!b) continue;
      if (b.imports.includes(a.id)) {
        const key = [a.id, b.id].sort().join('<->');
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push([a.id, b.id]);
        }
      }
    }
  }

  const clusterCounts = new Map<string, number>();
  for (const n of nodes) {
    clusterCounts.set(n.cluster, (clusterCounts.get(n.cluster) ?? 0) + 1);
  }
  const clusters = [...clusterCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const hubs = [...nodes].sort((a, b) => b.score - a.score).slice(0, 8);
  const orphans = nodes.filter((n) => n.imports.length === 0 && n.importedBy.length === 0 && !n.id.endsWith('.d.ts'));

  const oversizedCount = nodes.filter((n) => n.lines > 900).length;
  const healthScore = Math.max(50, Math.min(100, 100 - cycles.length * 6 - oversizedCount * 3));

  return {
    workspaceName: path.basename(root),
    nodes,
    edges,
    clusters,
    hubs,
    cycles,
    orphans,
    healthScore,
    totalLines,
    totalSymbols
  };
}

export function generateArchitectureReportMarkdown(data: CodeGraphData): string {
  const topHubs = data.hubs.slice(0, 8).map((h, i) =>
    `| ${i + 1} | \`${h.id}\` | \`${h.cluster}\` | ${h.importedBy.length} | ${h.imports.length} | ${h.lines} |`
  ).join('\n');

  const clusterRows = data.clusters.map((c) =>
    `| \`${c.name}\` | ${c.count} file(s) |`
  ).join('\n');

  const cycleSection = data.cycles.length > 0
    ? data.cycles.map(([a, b]) => `- ⚠️ \`${a}\` ⟷ \`${b}\``).join('\n')
    : '_None detected (Architecture has clean unidirectional dependency flow)._';

  const orphanSection = data.orphans.length > 0
    ? data.orphans.slice(0, 15).map((o) => `- \`${o.id}\` (${o.lines} lines)`).join('\n')
    : '_None detected._';

  const mermaidEdges = data.edges.slice(0, 45).map((e) => {
    const fromSafe = e.from.replace(/[\/\.-]/g, '_');
    const toSafe = e.to.replace(/[\/\.-]/g, '_');
    return `    ${fromSafe}["${path.basename(e.from)}"] --> ${toSafe}["${path.basename(e.to)}"]`;
  }).join('\n');

  return `# 🏛️ Architecture & Knowledge Graph: ${data.workspaceName}
> Generated automatically by **Sovereign Agent Graphify Studio** on ${new Date().toLocaleDateString()}.

## 📊 Executive Summary & Health
| Metric | Value | Status |
| :--- | :--- | :--- |
| **Architecture Health Score** | **${data.healthScore} / 100** | ${data.healthScore >= 85 ? '🟢 Excellent' : data.healthScore >= 70 ? '🟡 Good' : '🔴 Refactor Recommended'} |
| **Total Analyzed Files** | **${data.nodes.length}** | — |
| **Dependency Connections** | **${data.edges.length}** | — |
| **Exported / Defined Symbols** | **${data.totalSymbols}** | — |
| **Total Code Lines** | **${data.totalLines.toLocaleString()}** | — |
| **Circular Dependencies** | **${data.cycles.length}** | ${data.cycles.length === 0 ? '✓ Zero cycles' : '⚠️ Refactor loops'} |

---

## 🗺️ Module Clusters
| Cluster Directory | File Count |
| :--- | :--- |
${clusterRows}

---

## 👑 Top Architectural Hubs (High Coupling)
These files are the critical backbone of the workspace:

| # | Module File | Cluster | Dependents (In) | Dependencies (Out) | Lines |
| :- | :--- | :--- | :- | :- | :- |
${topHubs}

---

## 🔄 Circular Dependency Warnings
${cycleSection}

---

## 🗑️ Orphan Files (Dead Code Candidates)
${orphanSection}

---

## 📈 Visual Architecture Map
\`\`\`mermaid
flowchart TD
${mermaidEdges || '    subgraph Workspace\n        empty["No explicit internal imports"]\n    end'}
\`\`\`
`;
}

export function formatGraphSummary(data: CodeGraphData, query?: string, target?: string): string {
  if (target) {
    const clean = target.replace(/^\.\//, '').trim();
    const node =
      data.nodes.find((n) => n.id.toLowerCase() === clean.toLowerCase()) ||
      data.nodes.find((n) => n.id.toLowerCase().endsWith(clean.toLowerCase()));
    if (!node) {
      return `Node "${target}" was not found in the codebase knowledge graph.`;
    }
    return [
      `[Graphify Node Impact Analysis: ${node.id}]`,
      `Cluster: ${node.cluster} | Lines: ${node.lines} | Architectural Score: ${node.score}`,
      `Exported/Defined Symbols (${node.symbols.length}):\n  ${node.symbols.join('\n  ') || '(none)'}`,
      `Direct Dependents (Files that import this — ${node.importedBy.length}):\n  ${node.importedBy.join('\n  ') || '(none)'}`,
      `Direct Dependencies (Files imported by this — ${node.imports.length}):\n  ${node.imports.join('\n  ') || '(none)'}`
    ].join('\n');
  }

  if (query) {
    const q = query.toLowerCase().trim();
    const matches = data.nodes.filter(
      (n) => n.id.toLowerCase().includes(q) || n.symbols.some((s) => s.toLowerCase().includes(q))
    );
    if (!matches.length) {
      return `No modules or symbols matching "${query}" found in knowledge graph.`;
    }
    return [
      `[Graphify Search Results for "${query}" (${matches.length} matches)]:`,
      ...matches.slice(0, 15).map((m) =>
        `- ${m.id} (${m.cluster}) [${m.lines} lines, ${m.importedBy.length} dependents]\n  Symbols: ${m.symbols.slice(0, 8).join(', ') || 'none'}`
      )
    ].join('\n');
  }

  const clusterLines = data.clusters.map((c) => `  - ${c.name}: ${c.count} file(s)`).join('\n');
  const hubLines = data.hubs
    .map(
      (h, i) =>
        `  ${i + 1}. ${h.id} [${h.cluster}] — imported by ${h.importedBy.length}, imports ${h.imports.length} | symbols: ${h.symbols.slice(0, 6).join(', ') || 'n/a'}`
    )
    .join('\n');
  const edgeLines = data.edges
    .slice(0, 35)
    .map((e) => `  ${e.from} --> ${e.to}`)
    .join('\n');
  const cycleLines =
    data.cycles.length > 0
      ? `\nCircular Dependencies (${data.cycles.length}):\n  ${data.cycles.map((c) => c.join(' <-> ')).join('\n  ')}`
      : '\nCircular Dependencies: None (0)';

  return [
    `[Graphify Codebase Knowledge Graph — ${data.workspaceName}]`,
    `Files: ${data.nodes.length} | Dependency Edges: ${data.edges.length} | Symbols: ${data.totalSymbols} | Lines: ${data.totalLines} | Architecture Health: ${data.healthScore}/100`,
    `\nModule Clusters:\n${clusterLines}`,
    `\nTop Architectural Hubs (God-Nodes):\n${hubLines}`,
    `\nKey Dependency Graph Edges:\n${edgeLines || '  (no explicit imports detected)'}`,
    cycleLines
  ].join('\n');
}

export class GraphifyManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly onAskAgent?: (prompt: string) => void) {}

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  async execute(params: GraphifyParams, root: string | undefined): Promise<ToolResult> {
    if (!root) {
      return { ok: false, output: 'No workspace folder is open.' };
    }
    const action = (params.action || 'map').toLowerCase().trim();
    const data = await buildCodeGraph(root);

    if (action === 'open' || action === 'map' || action === 'visualize') {
      this.showPanel(data, root);
    }

    if (action === 'impact' && (params.target || params.query)) {
      return { ok: true, output: formatGraphSummary(data, undefined, params.target || params.query) };
    }
    if (action === 'query' && (params.query || params.target)) {
      return { ok: true, output: formatGraphSummary(data, params.query || params.target) };
    }
    return { ok: true, output: formatGraphSummary(data, params.query, params.target) };
  }

  async openInteractive(root: string | undefined): Promise<CodeGraphData | undefined> {
    if (!root) {
      void vscode.window.showWarningMessage('Sovereign Agent: Open a workspace folder to generate its Knowledge Graph.');
      return undefined;
    }
    const data = await buildCodeGraph(root);
    this.showPanel(data, root);
    return data;
  }

  private showPanel(data: CodeGraphData, root: string): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'sovereignAgent.graphify',
        `🕸️ Graphify Studio: ${data.workspaceName}`,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.onDidDispose(() => {
        this.panel = undefined;
      });
      panel.webview.onDidReceiveMessage(async (msg: { type?: string; file?: string; prompt?: string }) => {
        if (msg.type === 'openFile' && msg.file) {
          try {
            const full = path.resolve(root, msg.file);
            const doc = await vscode.workspace.openTextDocument(full);
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
          } catch {
            // ignore
          }
        } else if (msg.type === 'refreshGraph') {
          const fresh = await buildCodeGraph(root);
          panel.webview.html = this.buildWebviewHtml(fresh);
        } else if (msg.type === 'askAgent' && msg.prompt && this.onAskAgent) {
          this.onAskAgent(msg.prompt);
        } else if (msg.type === 'exportArchitectureReport') {
          await this.exportArchitectureReport(data, root);
        }
      });
      this.panel = panel;
    }
    this.panel.title = `🕸️ Graphify Studio: ${data.workspaceName}`;
    this.panel.webview.html = this.buildWebviewHtml(data);
  }

  private async exportArchitectureReport(data: CodeGraphData, root: string): Promise<void> {
    try {
      const reportMd = generateArchitectureReportMarkdown(data);
      const targetPath = path.join(root, 'ARCHITECTURE.md');
      await fs.writeFile(targetPath, reportMd, 'utf8');
      const doc = await vscode.workspace.openTextDocument(targetPath);
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      void vscode.window.showInformationMessage('✓ Sovereign Graphify Architecture Report saved to ARCHITECTURE.md');
    } catch (err) {
      void vscode.window.showErrorMessage(`Failed to export architecture report: ${String(err)}`);
    }
  }

  private buildWebviewHtml(data: CodeGraphData): string {
    const serialized = JSON.stringify(data).replace(/</g, '\\u003c');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Graphify Architecture Studio</title>
<style>
  :root {
    color-scheme: dark;
    --serif: "Tiempos Headline", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    --sans: var(--vscode-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
    --mono: var(--vscode-editor-font-family, ui-monospace, Consolas, monospace);
  }
  body {
    --bg: #171716;
    --surface: #1f1f1e;
    --surface-2: #2a2a28;
    --surface-3: #373735;
    --menu: #262624;
    --line: #3a3a37;
    --line-soft: #2e2e2c;
    --text: #ece9e4;
    --muted: #8f8d87;
    --faint: #66655f;
    --accent: #d97757;
    --accent-ink: #ffffff;
    --danger: #f0746a;
    --ok: #73c991;
    --warn: #e0a952;
    --code: #232322;
    --shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
  }
  body.theme-light,
  body.vscode-light:not(.theme-dark) {
    color-scheme: light;
    --bg: #faf9f5;
    --surface: #ffffff;
    --surface-2: #f0eee6;
    --surface-3: #e5e2d8;
    --menu: #ffffff;
    --line: #dcd9ce;
    --line-soft: #e9e6dc;
    --text: #1f1e1d;
    --muted: #6f6d66;
    --faint: #9b988f;
    --accent: #d97757;
    --accent-ink: #ffffff;
    --danger: #c0392b;
    --ok: #2e7d4f;
    --warn: #b47818;
    --code: #f2f0e8;
    --shadow: 0 12px 30px rgba(0, 0, 0, 0.14);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    background: var(--bg); color: var(--text);
    font-family: var(--sans); font-size: var(--vscode-font-size, 13px);
    line-height: 1.45; overflow: hidden;
  }
  header {
    display: flex; align-items: center; gap: 10px; padding: 8px 14px;
    background: var(--surface); border-bottom: 1px solid var(--line); flex-wrap: wrap;
    z-index: 10;
  }
  .brand {
    display: flex; align-items: center; gap: 8px;
    font: 500 14.5px/1.2 var(--serif); letter-spacing: -0.01em; color: var(--text);
  }
  .brand-mark {
    display: inline-grid; place-items: center;
    width: 24px; height: 24px; border-radius: 7px;
    background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--line));
    color: var(--accent); font-size: 13px;
  }
  .stats { display: flex; gap: 6px; flex-wrap: wrap; }
  .stat-pill {
    padding: 3px 8px; border-radius: 7px; background: var(--surface-2);
    border: 1px solid var(--line-soft); font-size: 11px; color: var(--muted);
  }
  .stat-pill strong { color: var(--text); font-weight: 600; }
  .stat-pill.health {
    border-color: color-mix(in srgb, var(--ok) 45%, var(--line));
    background: color-mix(in srgb, var(--ok) 10%, var(--surface-2));
    color: var(--ok);
  }
  .search-input {
    margin-left: auto; width: 200px; padding: 5px 10px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text);
    font: inherit; font-size: 12px; outline: none; transition: border-color 0.15s ease;
  }
  .search-input:focus { border-color: var(--accent); }
  .btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--surface-2); color: var(--text);
    font: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .btn:hover { background: var(--surface-3); border-color: var(--faint); }
  .btn.primary {
    background: var(--accent); border-color: var(--accent);
    color: var(--accent-ink); font-weight: 600;
  }
  .btn.primary:hover { filter: brightness(1.08); }
  .workspace { flex: 1; display: grid; grid-template-columns: 1fr 340px; min-height: 0; }
  .canvas-wrap {
    position: relative; overflow: hidden;
    background: radial-gradient(circle at center, var(--surface) 0%, var(--bg) 100%);
  }
  canvas { width: 100%; height: 100%; display: block; cursor: grab; }
  canvas:active { cursor: grabbing; }

  /* Floating Layout and Filter Toolbar */
  .canvas-controls {
    position: absolute; top: 12px; left: 12px; display: flex; align-items: center; gap: 6px;
    padding: 4px 6px; border-radius: 10px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    border: 1px solid var(--line); box-shadow: var(--shadow); backdrop-filter: blur(8px);
    z-index: 5;
  }
  .segmented { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--surface-2); gap: 2px; }
  .seg-btn {
    padding: 4px 10px; border: 0; border-radius: 6px; background: transparent;
    color: var(--muted); font-size: 11.5px; font-weight: 500; cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px;
  }
  .seg-btn:hover { color: var(--text); }
  .seg-btn.active {
    background: var(--surface-3); color: var(--accent); font-weight: 600;
  }
  .filter-toggle {
    padding: 3px 8px; border-radius: 6px; border: 1px solid var(--line-soft);
    background: var(--surface-2); color: var(--muted); font-size: 11px; cursor: pointer;
  }
  .filter-toggle:hover { color: var(--text); }
  .filter-toggle.active {
    background: color-mix(in srgb, var(--accent) 18%, var(--surface-2));
    border-color: var(--accent); color: var(--accent); font-weight: 600;
  }
  .filter-toggle.warn.active {
    background: color-mix(in srgb, var(--danger) 18%, var(--surface-2));
    border-color: var(--danger); color: var(--danger); font-weight: 600;
  }

  /* Zoom controls */
  .zoom-controls {
    position: absolute; right: 12px; bottom: 12px; display: flex; align-items: center; gap: 3px;
    padding: 3px 5px; border-radius: 9px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    border: 1px solid var(--line); box-shadow: var(--shadow); backdrop-filter: blur(8px);
    z-index: 5;
  }
  .zoom-btn {
    width: 26px; height: 26px; display: grid; place-items: center; border: 0;
    border-radius: 6px; background: transparent; color: var(--text); font-size: 12px;
    cursor: pointer;
  }
  .zoom-btn:hover { background: var(--surface-2); color: var(--accent); }
  .zoom-label { font-size: 10.5px; font-family: var(--mono); color: var(--muted); padding: 0 4px; }

  /* Legend */
  .legend {
    position: absolute; left: 12px; bottom: 12px; display: flex; flex-wrap: wrap; gap: 6px;
    max-width: 60%; padding: 6px 10px; border-radius: 10px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    border: 1px solid var(--line); box-shadow: var(--shadow); backdrop-filter: blur(8px);
    z-index: 5;
  }
  .legend-item {
    display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted);
    cursor: pointer; padding: 2px 5px; border-radius: 5px;
  }
  .legend-item:hover { background: var(--surface-2); color: var(--text); }
  .legend-item.active { background: var(--surface-3); color: var(--accent); font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }

  /* Tooltip */
  .node-tooltip {
    position: absolute; pointer-events: none; padding: 6px 10px; border-radius: 8px;
    background: var(--menu); border: 1px solid var(--line); box-shadow: var(--shadow);
    font-size: 11px; z-index: 20; display: none; max-width: 250px;
  }
  .node-tooltip strong { color: var(--text); display: block; margin-bottom: 2px; }
  .node-tooltip span { color: var(--muted); }

  /* Sidebar Tabs */
  aside {
    border-left: 1px solid var(--line); background: var(--surface);
    display: flex; flex-direction: column; min-height: 0;
  }
  .sidebar-tabs {
    display: flex; border-bottom: 1px solid var(--line); background: var(--surface-2);
  }
  .tab-btn {
    flex: 1; padding: 8px 6px; border: 0; background: transparent; color: var(--muted);
    font-size: 11.5px; font-weight: 500; cursor: pointer; text-align: center;
    border-bottom: 2px solid transparent; transition: all 0.15s ease;
  }
  .tab-btn:hover { color: var(--text); }
  .tab-btn.active {
    color: var(--accent); border-bottom-color: var(--accent); background: var(--surface);
    font-weight: 600;
  }
  .tab-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .tab-pane[hidden] { display: none !important; }

  h3 { margin: 0; font: 500 14px/1.3 var(--serif); color: var(--text); word-break: break-all; }
  .sub { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
  .section-title {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--muted); margin: 8px 0 4px;
  }
  .chip-list { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    padding: 3px 7px; border-radius: 6px; background: var(--surface-2);
    border: 1px solid var(--line-soft); font-family: var(--mono); font-size: 11px; color: var(--text);
    cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease;
  }
  .chip:hover { background: var(--surface-3); border-color: var(--accent); color: var(--accent); }
  .hub-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 8px; border-radius: 7px; background: var(--surface-2);
    border: 1px solid var(--line-soft); margin-bottom: 4px; cursor: pointer; font-size: 11.5px; color: var(--text);
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .hub-row strong {
    padding: 1px 6px; border-radius: 5px; background: var(--surface-3);
    color: var(--accent); font-size: 11px; font-family: var(--mono);
  }
  .hub-row:hover { background: var(--surface-3); border-color: var(--accent); }
  .cycle-row {
    padding: 6px 8px; border-radius: 7px; background: color-mix(in srgb, var(--danger) 10%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--line));
    margin-bottom: 5px; cursor: pointer; font-size: 11px; color: var(--text);
  }
  .cycle-row strong { color: var(--danger); }
  .cycle-row:hover { border-color: var(--danger); }
  .gauge-box {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; border-radius: 9px;
    background: color-mix(in srgb, var(--ok) 8%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--ok) 35%, var(--line));
  }
  .gauge-val { font: 700 20px/1 var(--mono); color: var(--ok); }
</style>
</head>
<body>
  <header>
    <div class="brand"><span class="brand-mark">🕸️</span><span>Graphify Architecture Studio</span></div>
    <div class="stats">
      <span class="stat-pill"><strong id="statNodes">0</strong> Files</span>
      <span class="stat-pill"><strong id="statEdges">0</strong> Edges</span>
      <span class="stat-pill"><strong id="statSymbols">0</strong> Symbols</span>
      <span class="stat-pill health">Health <strong id="statHealth">100</strong>/100</span>
    </div>
    <input id="search" class="search-input" type="search" placeholder="Search file or symbol..." />
    <button id="injectBtn" class="btn primary" type="button">🤖 Send to Agent</button>
    <button id="exportBtn" class="btn" type="button" title="Generate ARCHITECTURE.md in workspace">📝 Export Report</button>
    <button id="refreshBtn" class="btn" type="button" title="Re-scan codebase">↻ Refresh</button>
    <button id="themeBtn" class="btn" type="button" title="Toggle Dark / Light Theme">◐</button>
  </header>
  <div class="workspace">
    <div class="canvas-wrap">
      <div class="canvas-controls">
        <div class="segmented" id="layoutSegmented">
          <button type="button" class="seg-btn active" data-layout="star" title="Ana Yıldız ve Kollar: Çekirdek yıldızdan dallanan temiz takımyıldız mimarisi">⭐ Yıldız & Kollar</button>
          <button type="button" class="seg-btn" data-layout="diagram" title="Bileşen Blok Diyagramı: Temiz modül kutuları ve kartlar">📦 Blok Diyagramı</button>
          <button type="button" class="seg-btn" data-layout="hierarchy" title="Yukarıdan aşağıya katmanlı mimari hiyerarşisi">🏛️ Hiyerarşi</button>
        </div>
        <button type="button" id="focusModeBtn" class="filter-toggle" title="Isolate 1-hop neighborhood of selected node">🎯 1-Hop Focus</button>
        <button type="button" id="cyclesBtn" class="filter-toggle warn" title="Highlight circular dependencies">⚠️ Cycles (<span id="cycleCountBadge">0</span>)</button>
      </div>

      <div class="zoom-controls">
        <button type="button" id="zoomInBtn" class="zoom-btn" title="Zoom In">+</button>
        <span id="zoomPercent" class="zoom-label">100%</span>
        <button type="button" id="zoomOutBtn" class="zoom-btn" title="Zoom Out">−</button>
        <button type="button" id="zoomFitBtn" class="zoom-btn" title="Fit to Viewport">⛶</button>
      </div>

      <canvas id="graphCanvas"></canvas>
      <div id="legend" class="legend"></div>
      <div id="tooltip" class="node-tooltip"></div>
    </div>
    <aside id="inspector">
      <div class="sidebar-tabs">
        <button type="button" class="tab-btn active" data-tab="tabSelected">🔍 Inspector</button>
        <button type="button" class="tab-btn" data-tab="tabHealth">📊 Health & Hubs</button>
        <button type="button" class="tab-btn" data-tab="tabExport">📝 Export</button>
      </div>
      <div class="tab-body">
        <div id="tabSelected" class="tab-pane"></div>
        <div id="tabHealth" class="tab-pane" hidden></div>
        <div id="tabExport" class="tab-pane" hidden></div>
      </div>
    </aside>
  </div>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  const data = ${serialized};
  const canvas = document.getElementById('graphCanvas');
  const ctx = canvas.getContext('2d');
  const searchEl = document.getElementById('search');
  const tooltipEl = document.getElementById('tooltip');

  let themeState = (vscode.getState() || {}).theme || 'auto';
  function applyTheme() {
    document.body.classList.toggle('theme-dark', themeState === 'dark');
    document.body.classList.toggle('theme-light', themeState === 'light');
  }
  applyTheme();
  document.getElementById('themeBtn').addEventListener('click', () => {
    themeState = themeState === 'dark' ? 'light' : (themeState === 'light' ? 'auto' : 'dark');
    applyTheme();
    vscode.setState({ ...(vscode.getState() || {}), theme: themeState });
  });

  document.getElementById('statNodes').textContent = data.nodes.length;
  document.getElementById('statEdges').textContent = data.edges.length;
  document.getElementById('statSymbols').textContent = data.totalSymbols;
  document.getElementById('statHealth').textContent = data.healthScore;
  document.getElementById('cycleCountBadge').textContent = data.cycles.length;

  const PALETTE = ['#d97757', '#73c991', '#e0a952', '#7ba3b8', '#b888c4', '#e07a6a', '#6eb5a5', '#c7926b', '#94a3b8'];
  const clusterColors = {};
  data.clusters.forEach((c, idx) => { clusterColors[c.name] = PALETTE[idx % PALETTE.length]; });

  let activeClusterFilter = null;
  const legendEl = document.getElementById('legend');
  data.clusters.slice(0, 10).forEach((c) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = '<i class="dot" style="background:' + clusterColors[c.name] + '"></i>' + c.name + ' (' + c.count + ')';
    item.addEventListener('click', () => {
      if (activeClusterFilter === c.name) {
        activeClusterFilter = null;
        item.classList.remove('active');
      } else {
        document.querySelectorAll('.legend-item').forEach(el => el.classList.remove('active'));
        activeClusterFilter = c.name;
        item.classList.add('active');
      }
    });
    legendEl.appendChild(item);
  });

  // Group files by cluster
  const filesByCluster = new Map();
  data.clusters.forEach(c => filesByCluster.set(c.name, []));
  data.nodes.forEach(n => {
    if (!filesByCluster.has(n.cluster)) filesByCluster.set(n.cluster, []);
    filesByCluster.get(n.cluster).push(n);
  });

  // Central Star Definition
  const coreStar = {
    id: '__core__',
    label: '⭐ ' + data.workspaceName,
    cluster: 'core',
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    radius: 32,
    isCore: true
  };

  // Module Hub Stars (The planetary branches / major arms)
  const totalClusters = Math.max(1, data.clusters.length);
  const moduleHubs = data.clusters.map((c, i) => {
    const angle = (i / totalClusters) * Math.PI * 2 - Math.PI / 2;
    const r = Math.max(260, 48 * Math.min(10, totalClusters));
    return {
      name: c.name,
      count: c.count,
      angle,
      color: clusterColors[c.name] || '#d97757',
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      targetX: Math.cos(angle) * r,
      targetY: Math.sin(angle) * r,
      radius: 20
    };
  });
  const moduleHubByName = new Map(moduleHubs.map(m => [m.name, m]));

  // Create simulation nodes for all files
  const simNodes = data.nodes.map((n, i) => {
    const isHub = data.hubs.some(h => h.id === n.id);
    return {
      ...n,
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      radius: Math.max(7, Math.min(20, 6 + Math.sqrt(n.score) * 2.5)),
      color: clusterColors[n.cluster] || '#d97757',
      isHub
    };
  });
  const nodeById = new Map(simNodes.map(n => [n.id, n]));

  // Build cycle lookup set
  const cyclePairs = new Set();
  data.cycles.forEach(c => {
    cyclePairs.add(c.join('<->'));
    cyclePairs.add(c.slice().reverse().join('<->'));
  });

  let camX = 0, camY = 0, zoom = 1;
  let selectedNode = simNodes[0] || null;
  let hoveredNode = null;
  let draggingNode = null;
  let panning = false;
  let lastMouse = { x: 0, y: 0 };
  let filterQuery = '';
  let currentLayout = 'star'; // Default to user-requested Star & Constellation Arms
  let focus1HopMode = false;
  let cyclesHighlightMode = false;

  // Block Diagram Card layout metrics
  const clusterBoxes = [];

  function updateZoomLabel() {
    const el = document.getElementById('zoomPercent');
    if (el) el.textContent = Math.round(zoom * 100) + '%';
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Relaxation pass to push any overlapping nodes apart
  function relaxNodeCollisions() {
    for (let pass = 0; pass < 25; pass++) {
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const a = simNodes[i];
          const b = simNodes[j];
          const dx = b.targetX - a.targetX;
          const dy = b.targetY - a.targetY;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minDist = (a.radius || 10) + (b.radius || 10) + 24;
          if (dist < minDist) {
            const overlap = (minDist - dist) * 0.5;
            const nx = dx / dist;
            const ny = dy / dist;
            a.targetX -= nx * overlap;
            a.targetY -= ny * overlap;
            b.targetX += nx * overlap;
            b.targetY += ny * overlap;
          }
        }
      }
    }
  }

  // Compute Layout Positions
  function applyLayout(layout) {
    currentLayout = layout;

    if (layout === 'star') {
      // 1. STAR CONSTELLATION: Central Star at (0,0), Module Arms at R=260+, Files in spacious concentric rings
      coreStar.targetX = 0;
      coreStar.targetY = 0;

      moduleHubs.forEach((m, i) => {
        const angle = (i / totalClusters) * Math.PI * 2 - Math.PI / 2;
        const r = Math.max(260, 48 * Math.min(10, totalClusters));
        m.targetX = Math.cos(angle) * r;
        m.targetY = Math.sin(angle) * r;
        m.angle = angle;

        // Position satellite files on this module's arm in concentric orbital layers
        const files = (filesByCluster.get(m.name) || []).map(f => nodeById.get(f.id)).filter(Boolean);
        const count = files.length;
        
        // Multi-ring distribution so nodes never crowd into a single arc
        const ringCaps = [3, 5, 7, 9, 12];
        let fIdx = 0;
        let ring = 0;

        while (fIdx < count) {
          const cap = ringCaps[ring] || 10;
          const filesInRing = Math.min(cap, count - fIdx);
          const ringDist = 85 + ring * 65;
          const fanSpan = Math.min(Math.PI * 0.9, 0.22 * filesInRing + 0.15);

          for (let j = 0; j < filesInRing; j++) {
            const f = files[fIdx++];
            const subAngle = filesInRing === 1 ? angle : (angle - fanSpan / 2 + (j / (filesInRing - 1)) * fanSpan);
            f.targetX = m.targetX + Math.cos(subAngle) * ringDist;
            f.targetY = m.targetY + Math.sin(subAngle) * ringDist;
            f.radius = Math.max(8, Math.min(18, 6 + Math.sqrt(f.score) * 2.2));
          }
          ring++;
        }
      });

      relaxNodeCollisions();

    } else if (layout === 'diagram') {
      // 2. BLOCK ARCHITECTURE DIAGRAM: Neat architectural cards arranged in a grid with columns
      clusterBoxes.length = 0;
      const cols = Math.min(3, Math.max(2, Math.ceil(Math.sqrt(totalClusters))));
      const boxW = 320;
      const spacingX = 380;

      // Group clusters into rows to calculate dynamic row heights
      const rows = [];
      data.clusters.forEach((c, idx) => {
        const r = Math.floor(idx / cols);
        if (!rows[r]) rows[r] = [];
        const files = (filesByCluster.get(c.name) || []).map(f => nodeById.get(f.id)).filter(Boolean);
        const colsInside = files.length > 8 ? 2 : 1;
        const rowsInside = Math.ceil(files.length / colsInside);
        const boxH = Math.max(90, 48 + rowsInside * 26 + 14);
        rows[r].push({ cluster: c, files, colsInside, boxH });
      });

      // Calculate total height to center the layout
      let totalGridH = 0;
      rows.forEach(r => {
        const maxH = Math.max(...r.map(item => item.boxH), 120);
        totalGridH += maxH + 70;
      });

      let currentY = -totalGridH / 2;
      rows.forEach(rowClusters => {
        const maxH = Math.max(...rowClusters.map(item => item.boxH), 120);
        const countInRow = rowClusters.length;

        rowClusters.forEach((item, cIdx) => {
          const bx = (cIdx - (countInRow - 1) / 2) * spacingX;
          const by = currentY + item.boxH / 2;

          const box = {
            name: item.cluster.name,
            color: clusterColors[item.cluster.name] || '#d97757',
            x: bx - boxW / 2,
            y: by - item.boxH / 2,
            w: boxW,
            h: item.boxH,
            files: item.files
          };
          clusterBoxes.push(box);

          // Position files cleanly inside the card box
          const colWidth = (boxW - 36) / item.colsInside;
          item.files.forEach((f, fi) => {
            const inCol = fi % item.colsInside;
            const inRow = Math.floor(fi / item.colsInside);
            f.targetX = box.x + 22 + inCol * colWidth;
            f.targetY = box.y + 44 + inRow * 26;
            f.radius = 6.5; // compact sleek dot in diagram card mode!
          });
        });

        currentY += maxH + 70;
      });

    } else if (layout === 'hierarchy') {
      // 3. LAYERED ARCHITECTURE: Top-down tiers
      const levels = new Map();
      simNodes.forEach(n => {
        let lvl = 1;
        if (n.importedBy.length === 0) lvl = 0; // Entrypoints / controllers
        else if (n.imports.length === 0) lvl = 3; // Core utilities / leaves
        else if (n.isHub) lvl = 1; // Core hubs
        else lvl = 2; // Mid services
        levels.set(n.id, lvl);
      });
      const levelGroups = [[], [], [], []];
      simNodes.forEach(n => {
        const lvl = levels.get(n.id) || 1;
        levelGroups[lvl].push(n);
      });
      levelGroups.forEach((group, lvlIdx) => {
        const y = (lvlIdx - 1.5) * 200;
        const count = group.length;
        const wrap = count > 7;
        const colsTotal = wrap ? Math.ceil(count / 2) : count;
        group.forEach((node, i) => {
          node.radius = Math.max(8, Math.min(18, 6 + Math.sqrt(node.score) * 2.2));
          if (wrap) {
            const subRow = i % 2;
            const colIdx = Math.floor(i / 2);
            node.targetX = (colIdx - (colsTotal - 1) / 2) * 140;
            node.targetY = y + subRow * 46;
          } else {
            node.targetX = (i - (count - 1) / 2) * 140;
            node.targetY = y;
          }
        });
      });

      relaxNodeCollisions();
    }
  }

  // Initial layout calculation
  applyLayout('star');
  simNodes.forEach(n => {
    n.x = n.targetX;
    n.y = n.targetY;
  });
  moduleHubs.forEach(m => {
    m.x = m.targetX;
    m.y = m.targetY;
  });

  function matchesFilter(n) {
    if (activeClusterFilter && n.cluster !== activeClusterFilter) return false;
    if (cyclesHighlightMode) {
      const inCycle = data.cycles.some(c => c.includes(n.id));
      if (!inCycle) return false;
    }
    if (focus1HopMode && selectedNode) {
      const isNeighbor = selectedNode.id === n.id ||
        selectedNode.imports.includes(n.id) ||
        selectedNode.importedBy.includes(n.id);
      if (!isNeighbor) return false;
    }
    if (!filterQuery) return true;
    return n.id.toLowerCase().includes(filterQuery) ||
      n.cluster.toLowerCase().includes(filterQuery) ||
      n.symbols.some(s => s.toLowerCase().includes(filterQuery));
  }

  function screenToWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (sx - rect.width / 2 - camX) / zoom,
      y: (sy - rect.height / 2 - camY) / zoom
    };
  }

  function fitToViewport() {
    if (simNodes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    simNodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    });
    if (currentLayout === 'star') {
      minX = Math.min(minX, -280);
      maxX = Math.max(maxX, 280);
      minY = Math.min(minY, -280);
      maxY = Math.max(maxY, 280);
    } else if (currentLayout === 'diagram') {
      clusterBoxes.forEach(b => {
        if (b.x < minX) minX = b.x;
        if (b.x + b.w > maxX) maxX = b.x + b.w;
        if (b.y < minY) minY = b.y;
        if (b.y + b.h > maxY) maxY = b.y + b.h;
      });
    }
    const graphW = Math.max(260, maxX - minX + 120);
    const graphH = Math.max(260, maxY - minY + 120);
    const fitZoom = Math.max(0.25, Math.min(1.2, Math.min(rect.width / graphW, rect.height / graphH) * 0.88));
    zoom = fitZoom;
    camX = -((minX + maxX) / 2) * zoom;
    camY = -((minY + maxY) / 2) * zoom;
    updateZoomLabel();
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(rect.width / 2 + camX, rect.height / 2 + camY);
    ctx.scale(zoom, zoom);

    const isLight = document.body.classList.contains('theme-light');

    // Smooth lerp transition to target positions
    for (const n of simNodes) {
      if (n !== draggingNode) {
        n.x += (n.targetX - n.x) * 0.14;
        n.y += (n.targetY - n.y) * 0.14;
      }
    }
    for (const m of moduleHubs) {
      m.x += (m.targetX - m.x) * 0.14;
      m.y += (m.targetY - m.y) * 0.14;
    }

    // ----------------------------------------------------
    // 1. STAR & CONSTELLATION ARMS RENDERING (The User's Request!)
    // ----------------------------------------------------
    if (currentLayout === 'star') {
      // Central Star Solar Corona / Radiance
      const corona = ctx.createRadialGradient(0, 0, 8, 0, 0, 75);
      corona.addColorStop(0, 'rgba(217, 119, 87, 0.45)');
      corona.addColorStop(0.5, 'rgba(217, 119, 87, 0.15)');
      corona.addColorStop(1, 'rgba(217, 119, 87, 0)');
      ctx.beginPath();
      ctx.arc(0, 0, 75, 0, Math.PI * 2);
      ctx.fillStyle = corona;
      ctx.fill();

      // Major Stellar Arms (Beams from Central Star to Module Stars)
      for (const m of moduleHubs) {
        ctx.save();
        const isModuleActive = (selectedNode && selectedNode.cluster === m.name) || (hoveredNode && hoveredNode.cluster === m.name);

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(m.x, m.y);
        ctx.strokeStyle = m.color;
        ctx.lineWidth = isModuleActive ? 5.2 : 3.2;
        if (isModuleActive) {
          ctx.shadowColor = m.color;
          ctx.shadowBlur = 18;
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = activeClusterFilter && activeClusterFilter !== m.name ? 0.15 : 0.65;
        }
        ctx.stroke();

        if (isModuleActive) {
          // Luminous laser core
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(m.x, m.y);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8;
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 6;
          ctx.stroke();
        }

        // Branch Rays from Module Star to its Satellite Files
        const files = (filesByCluster.get(m.name) || []).map(f => nodeById.get(f.id)).filter(Boolean);
        for (const f of files) {
          const isSelectedFile = (selectedNode && selectedNode.id === f.id);
          const isHoveredFile = (hoveredNode && hoveredNode.id === f.id);

          ctx.save();
          if (isSelectedFile || isHoveredFile) {
            // Luminous glowing beam for the clicked/selected file!
            const glowColor = isSelectedFile ? '#38bdf8' : '#67e8f9';
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(f.x, f.y);
            ctx.strokeStyle = glowColor;
            ctx.lineWidth = 4.2;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 20;
            ctx.globalAlpha = 1;
            ctx.stroke();

            // Core laser beam
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(f.x, f.y);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.8;
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 6;
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(f.x, f.y);
            ctx.strokeStyle = isLight ? 'rgba(31, 30, 29, 0.22)' : 'rgba(236, 233, 228, 0.2)';
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = matchesFilter(f) ? 0.6 : 0.08;
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.restore();
      }

      // Draw Central Star Body
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fillStyle = '#d97757';
      ctx.fill();
      ctx.strokeStyle = isLight ? '#ffffff' : '#faf9f5';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.font = '600 12.5px var(--serif, Georgia)';
      ctx.fillStyle = isLight ? '#1f1e1d' : '#ece9e4';
      ctx.textAlign = 'center';
      ctx.fillText('⭐ ' + data.workspaceName, 0, 40);
      ctx.restore();

      // Draw Module Hub Stars
      for (const m of moduleHubs) {
        ctx.save();
        ctx.globalAlpha = activeClusterFilter && activeClusterFilter !== m.name ? 0.2 : 1;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = m.color;
        ctx.fill();
        ctx.strokeStyle = isLight ? '#ffffff' : '#1f1f1e';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = '600 11.5px var(--sans, system-ui)';
        ctx.fillStyle = isLight ? '#1f1e1d' : '#ece9e4';
        ctx.textAlign = 'center';
        ctx.fillText('📦 ' + m.name + ' (' + m.count + ')', m.x, m.y + (m.y >= 0 ? 24 : -18));
        ctx.restore();
      }
    } else if (currentLayout === 'diagram') {
      // ----------------------------------------------------
      // 2. BLOCK ARCHITECTURE DIAGRAM (Grouped Component Boxes)
      // ----------------------------------------------------
      for (const box of clusterBoxes) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, 10);
        ctx.fillStyle = isLight ? '#ffffff' : '#1f1f1e';
        ctx.fill();
        ctx.strokeStyle = isLight ? '#dcd9ce' : '#3a3a37';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // Box Header Banner
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, 28, [10, 10, 0, 0]);
        ctx.fillStyle = box.color;
        ctx.fill();

        ctx.font = '600 11.5px var(--sans, system-ui)';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('📦 ' + box.name + ' (' + box.files.length + ')', box.x + 10, box.y + 18);
        ctx.restore();
      }
    }

    // Collect active connected IDs to highlight targets and dim unrelated nodes
    const outgoingTargets = new Set();
    const incomingSources = new Set();
    if (selectedNode) {
      for (const e of data.edges) {
        if (e.from === selectedNode.id) {
          outgoingTargets.add(e.to);
        } else if (e.to === selectedNode.id) {
          incomingSources.add(e.from);
        }
      }
    }

    // ----------------------------------------------------
    // Inter-file dependencies (Import Arcs)
    // ----------------------------------------------------
    for (const edge of data.edges) {
      const a = nodeById.get(edge.from);
      const b = nodeById.get(edge.to);
      if (!a || !b) continue;

      const aVis = matchesFilter(a);
      const bVis = matchesFilter(b);
      const isCycle = cyclePairs.has(edge.from + '<->' + edge.to);
      const isOutgoing = selectedNode && selectedNode.id === a.id;
      const isIncoming = selectedNode && selectedNode.id === b.id;
      const active = isOutgoing || isIncoming;
      const hovered = hoveredNode && (hoveredNode.id === a.id || hoveredNode.id === b.id);

      // Keep canvas serene and readable: only draw import lines when actively selected, hovered, or in a circular dependency
      if (!active && !hovered && !isCycle) continue;

      ctx.save();
      ctx.globalAlpha = (aVis && bVis) ? (active || hovered || isCycle ? 1 : 0.25) : 0.05;

      ctx.beginPath();
      const midX = (a.x + b.x) / 2 + (b.y - a.y) * 0.12;
      const midY = (a.y + b.y) / 2 + (a.x - b.x) * 0.12;
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(midX, midY, b.x, b.y);

      if (isCycle) {
        ctx.strokeStyle = '#f0746a';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
      } else if (active) {
        // RADIANT LASER ILLUMINATION FOR CLICKED/SELECTED NODE!
        const beamColor = isOutgoing ? '#38bdf8' : '#4ade80';

        // 1st pass: intense neon glow aura
        ctx.strokeStyle = beamColor;
        ctx.lineWidth = 3.8;
        ctx.shadowColor = beamColor;
        ctx.shadowBlur = 18;
        ctx.stroke();

        // 2nd pass: crisp white laser core
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(midX, midY, b.x, b.y);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6;
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 6;
        ctx.stroke();
      } else if (hovered) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.2;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 12;
        ctx.stroke();
      } else {
        ctx.strokeStyle = isLight ? 'rgba(31, 30, 29, 0.25)' : 'rgba(236, 233, 228, 0.22)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Arrowhead
      const dx = b.x - midX, dy = b.y - midY;
      const angle = Math.atan2(dy, dx);
      const arrowDist = b.radius + 3;
      const ax = b.x - Math.cos(angle) * arrowDist;
      const ay = b.y - Math.sin(angle) * arrowDist;

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - Math.cos(angle - 0.4) * 8, ay - Math.sin(angle - 0.4) * 8);
      ctx.lineTo(ax - Math.cos(angle + 0.4) * 8, ay - Math.sin(angle + 0.4) * 8);
      if (active) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = isOutgoing ? '#38bdf8' : '#4ade80';
        ctx.shadowBlur = 14;
      } else {
        ctx.fillStyle = ctx.strokeStyle;
      }
      ctx.fill();
      ctx.restore();
    }

    // ----------------------------------------------------
    // Draw File Nodes
    // ----------------------------------------------------
    for (const n of simNodes) {
      const visible = matchesFilter(n);
      const isSelected = selectedNode && selectedNode.id === n.id;
      const isHovered = hoveredNode && hoveredNode.id === n.id;
      const isTarget = outgoingTargets.has(n.id);
      const isSource = incomingSources.has(n.id);

      if (selectedNode) {
        ctx.globalAlpha = (isSelected || isTarget || isSource) ? 1 : 0.22;
      } else {
        ctx.globalAlpha = visible ? 1 : 0.12;
      }

      // Outgoing Target Halo (laser cyan ring)
      if (isTarget) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.4;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.restore();
      }

      // Incoming Source Halo (emerald ring)
      if (isSource) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2.4;
        ctx.shadowColor = '#4ade80';
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.restore();
      }

      // Outer Selection Ring
      if (isSelected || isHovered) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 7, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? '#38bdf8' : '#67e8f9';
        ctx.lineWidth = 2.6;
        ctx.shadowColor = isSelected ? '#38bdf8' : '#67e8f9';
        ctx.shadowBlur = 16;
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.28)' : 'rgba(56, 189, 248, 0.18)';
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // God-Node Crown Halo
      if (n.isHub) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(224, 169, 82, 0.6)';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      // Node Circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.strokeStyle = isSelected ? (isLight ? '#1f1e1d' : '#ffffff') : (isLight ? '#faf9f5' : '#171716');
      ctx.lineWidth = isSelected ? 2.6 : 1.2;
      ctx.stroke();

      // Node Label
      ctx.font = (isSelected || n.isHub ? '600 ' : '') + (currentLayout === 'diagram' ? '10.5px var(--sans, system-ui)' : '11px var(--sans, system-ui)');
      ctx.fillStyle = isLight ? '#1f1e1d' : '#ece9e4';
      ctx.textAlign = 'left';
      let labelText = (n.isHub ? '👑 ' : '') + n.label;
      if (currentLayout === 'diagram' && labelText.length > 18) {
        labelText = labelText.slice(0, 16) + '…';
      }
      ctx.fillText(labelText, n.x + n.radius + 5, n.y + 3.5);
    }

    ctx.restore();
    requestAnimationFrame(draw);
  }

  function renderInspector(node) {
    const tabSelected = document.getElementById('tabSelected');
    const tabHealth = document.getElementById('tabHealth');
    const tabExport = document.getElementById('tabExport');

    // 1. Render Health & Hubs tab
    tabHealth.replaceChildren();
    const gauge = document.createElement('div');
    gauge.className = 'gauge-box';
    gauge.innerHTML = '<div><strong>Architecture Health</strong><div class="sub">Cycles, god-nodes & coupling metric</div></div><span class="gauge-val">' + data.healthScore + '</span>';
    tabHealth.appendChild(gauge);

    const hubTitle = document.createElement('div');
    hubTitle.className = 'section-title';
    hubTitle.textContent = 'Architectural Hubs (God-Nodes)';
    tabHealth.appendChild(hubTitle);
    data.hubs.forEach((h) => {
      const row = document.createElement('div');
      row.className = 'hub-row';
      row.innerHTML = '<span>' + h.id + '</span><strong>' + h.score + '</strong>';
      row.addEventListener('click', () => {
        const target = nodeById.get(h.id);
        if (target) {
          selectedNode = target;
          camX = -target.x * zoom;
          camY = -target.y * zoom;
          renderInspector(target);
          switchTab('tabSelected');
        }
      });
      tabHealth.appendChild(row);
    });

    if (data.cycles.length > 0) {
      const cycleTitle = document.createElement('div');
      cycleTitle.className = 'section-title';
      cycleTitle.textContent = 'Circular Dependencies (' + data.cycles.length + ')';
      tabHealth.appendChild(cycleTitle);
      data.cycles.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'cycle-row';
        row.innerHTML = '<strong>⚠️ Loop:</strong> ' + c.join(' ⟷ ');
        row.addEventListener('click', () => {
          const target = nodeById.get(c[0]);
          if (target) {
            selectedNode = target;
            camX = -target.x * zoom;
            camY = -target.y * zoom;
            cyclesHighlightMode = true;
            document.getElementById('cyclesBtn').classList.add('active');
            renderInspector(target);
          }
        });
        tabHealth.appendChild(row);
      });
    }

    if (data.orphans.length > 0) {
      const orphanTitle = document.createElement('div');
      orphanTitle.className = 'section-title';
      orphanTitle.textContent = 'Orphan Files (Dead Code Candidates - ' + data.orphans.length + ')';
      tabHealth.appendChild(orphanTitle);
      data.orphans.slice(0, 10).forEach((o) => {
        const row = document.createElement('div');
        row.className = 'hub-row';
        row.innerHTML = '<span>' + o.id + '</span><span class="sub">' + o.lines + ' lines</span>';
        row.addEventListener('click', () => {
          const target = nodeById.get(o.id);
          if (target) {
            selectedNode = target;
            camX = -target.x * zoom;
            camY = -target.y * zoom;
            renderInspector(target);
            switchTab('tabSelected');
          }
        });
        tabHealth.appendChild(row);
      });
    }

    // 2. Render Export tab
    tabExport.replaceChildren();
    const exportCard = document.createElement('div');
    exportCard.innerHTML = '<div class="section-title">Knowledge Graph Export</div><p class="sub">Generate an ARCHITECTURE.md file in the root of your workspace with complete metrics, Mermaid dependency flowcharts, and coupling tables.</p>';
    const exportMdBtn = document.createElement('button');
    exportMdBtn.className = 'btn primary';
    exportMdBtn.style.width = '100%';
    exportMdBtn.textContent = '📝 Generate ARCHITECTURE.md';
    exportMdBtn.addEventListener('click', () => vscode.postMessage({ type: 'exportArchitectureReport' }));
    tabExport.append(exportCard, exportMdBtn);

    // 3. Render Selected node tab
    tabSelected.replaceChildren();
    if (!node) {
      const placeholder = document.createElement('div');
      placeholder.innerHTML = '<div class="sub" style="text-align:center;padding:24px 0;">Click on any node in the canvas to inspect its symbols, dependencies, and dependents.</div>';
      tabSelected.appendChild(placeholder);
      return;
    }

    const header = document.createElement('div');
    header.innerHTML = '<h3>' + (node.isHub ? '👑 ' : '') + node.id + '</h3><div class="sub">Cluster: ' + node.cluster + ' · ' + node.lines + ' lines · Score: ' + node.score + '</div>';
    tabSelected.appendChild(header);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.marginTop = '8px';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn primary';
    openBtn.textContent = '📂 Open File';
    openBtn.addEventListener('click', () => vscode.postMessage({ type: 'openFile', file: node.id }));

    const askBtn = document.createElement('button');
    askBtn.className = 'btn';
    askBtn.textContent = '🤖 Analyze Impact';
    askBtn.addEventListener('click', () => {
      vscode.postMessage({
        type: 'askAgent',
        prompt: 'Analyze the architecture and dependency impact of ' + node.id + ' using <code_graph><action>impact</action><target>' + node.id + '</target></code_graph>.'
      });
    });
    actions.append(openBtn, askBtn);
    tabSelected.appendChild(actions);

    const addChipSection = (titleText, items, clickable) => {
      const st = document.createElement('div');
      st.className = 'section-title';
      st.textContent = titleText + ' (' + items.length + ')';
      tabSelected.appendChild(st);
      const list = document.createElement('div');
      list.className = 'chip-list';
      if (!items.length) {
        const empty = document.createElement('span');
        empty.className = 'sub';
        empty.textContent = '(none)';
        list.appendChild(empty);
      } else {
        items.forEach((item) => {
          const c = document.createElement('span');
          c.className = 'chip';
          c.textContent = item;
          if (clickable) {
            c.addEventListener('click', () => {
              const target = nodeById.get(item);
              if (target) {
                selectedNode = target;
                camX = -target.x * zoom;
                camY = -target.y * zoom;
                renderInspector(target);
              }
            });
          }
          list.appendChild(c);
        });
      }
      tabSelected.appendChild(list);
    };

    addChipSection('Symbols / Definitions', node.symbols, false);
    addChipSection('Imported By (Dependents)', node.importedBy, true);
    addChipSection('Imports (Dependencies)', node.imports, true);
  }

  function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.hidden = pane.id !== tabId;
    });
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Layout switcher buttons
  document.querySelectorAll('#layoutSegmented .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#layoutSegmented .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyLayout(btn.dataset.layout);
      fitToViewport();
    });
  });

  // Filter mode buttons
  document.getElementById('focusModeBtn').addEventListener('click', () => {
    focus1HopMode = !focus1HopMode;
    document.getElementById('focusModeBtn').classList.toggle('active', focus1HopMode);
  });

  document.getElementById('cyclesBtn').addEventListener('click', () => {
    cyclesHighlightMode = !cyclesHighlightMode;
    document.getElementById('cyclesBtn').classList.toggle('active', cyclesHighlightMode);
    if (cyclesHighlightMode && data.cycles.length > 0) {
      switchTab('tabHealth');
    }
  });

  // Zoom buttons
  document.getElementById('zoomInBtn').addEventListener('click', () => {
    zoom = Math.min(3.5, zoom * 1.25);
    updateZoomLabel();
  });
  document.getElementById('zoomOutBtn').addEventListener('click', () => {
    zoom = Math.max(0.2, zoom * 0.8);
    updateZoomLabel();
  });
  document.getElementById('zoomFitBtn').addEventListener('click', fitToViewport);

  // Mouse interaction
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w = screenToWorld(sx, sy);
    const hit = simNodes.find(n => Math.hypot(n.x - w.x, n.y - w.y) <= n.radius + 4);
    if (hit) {
      draggingNode = hit;
      selectedNode = hit;
      renderInspector(hit);
      switchTab('tabSelected');
    } else {
      panning = true;
    }
    lastMouse = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w = screenToWorld(sx, sy);
    if (draggingNode) {
      draggingNode.x = w.x;
      draggingNode.y = w.y;
      draggingNode.targetX = w.x;
      draggingNode.targetY = w.y;
    } else if (panning) {
      camX += e.clientX - lastMouse.x;
      camY += e.clientY - lastMouse.y;
      lastMouse = { x: e.clientX, y: e.clientY };
    } else {
      hoveredNode = simNodes.find(n => Math.hypot(n.x - w.x, n.y - w.y) <= n.radius + 4) || null;
      if (hoveredNode) {
        tooltipEl.style.display = 'block';
        tooltipEl.style.left = (sx + 14) + 'px';
        tooltipEl.style.top = (sy - 10) + 'px';
        tooltipEl.innerHTML = '<strong>' + hoveredNode.label + '</strong><span>' + hoveredNode.cluster + ' · ' + hoveredNode.lines + ' lines<br>' + hoveredNode.importedBy.length + ' dependents · ' + hoveredNode.imports.length + ' imports</span>';
      } else {
        tooltipEl.style.display = 'none';
      }
    }
  });

  window.addEventListener('mouseup', () => {
    draggingNode = null;
    panning = false;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    zoom = Math.max(0.2, Math.min(3.5, zoom * factor));
    updateZoomLabel();
  }, { passive: false });

  searchEl.addEventListener('input', () => {
    filterQuery = searchEl.value.trim().toLowerCase();
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshGraph' });
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'exportArchitectureReport' });
  });

  document.getElementById('injectBtn').addEventListener('click', () => {
    vscode.postMessage({
      type: 'askAgent',
      prompt: '/graphify Analyze the workspace architecture, cluster coupling, and any circular dependencies.'
    });
  });

  fitToViewport();
  renderInspector(selectedNode);
  requestAnimationFrame(draw);
})();
</script>
</body>
</html>`;
  }
}
