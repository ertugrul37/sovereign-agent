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
      `${joined}/index.ts`,
      `${joined}/index.js`,
      `${joined}/__init__.py`
    );
  } else {
    // Non-relative local module (e.g. Python `import topla` or HTML `style.css` / `media/chat.js`)
    const dotted = spec.replace(/\./g, '/');
    candidates.push(
      spec,
      dotted,
      `${dotted}.py`,
      `${dotted}.ts`,
      `${dotted}.js`,
      path.posix.normalize(path.posix.join(baseDir, spec)),
      path.posix.normalize(path.posix.join(baseDir, `${dotted}.py`))
    );
  }

  for (const c of candidates) {
    const clean = c.replace(/^\.\//, '');
    if (fileSet.has(clean) && clean !== fromFile) {
      return clean;
    }
  }
  return undefined;
}

function getClusterName(relPath: string): string {
  const parts = relPath.split('/');
  if (parts.length === 1) return 'root';
  if (parts[0] === 'src' && parts.length > 2) return `src/${parts[1]}`;
  return parts[0];
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

  // Detect 2-node and 3-node circular dependencies
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

  const oversizedCount = nodes.filter((n) => n.lines > 900).length;
  const healthScore = Math.max(50, Math.min(100, 100 - cycles.length * 6 - oversizedCount * 3));

  return {
    workspaceName: path.basename(root),
    nodes,
    edges,
    clusters,
    hubs,
    cycles,
    healthScore,
    totalLines,
    totalSymbols
  };
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
      `[Graphify Impact & Dependency Analysis — ${node.id}]`,
      `Cluster: ${node.cluster} | Lines: ${node.lines} | Centrality Score: ${node.score}`,
      `Exported/Defined Symbols (${node.symbols.length}): ${node.symbols.join(', ') || '(none)'}`,
      `Direct Dependencies / Imports (${node.imports.length}):\n  ${node.imports.join('\n  ') || '(none)'}`,
      `Impacted Dependents / Imported By (${node.importedBy.length}):\n  ${node.importedBy.join('\n  ') || '(none)'}`
    ].join('\n');
  }

  if (query) {
    const q = query.toLowerCase().trim();
    const matched = data.nodes
      .filter(
        (n) =>
          n.id.toLowerCase().includes(q) ||
          n.cluster.toLowerCase().includes(q) ||
          n.symbols.some((s) => s.toLowerCase().includes(q))
      )
      .slice(0, 20);
    if (matched.length === 0) {
      return `No graph nodes or symbols matched query "${query}".`;
    }
    return [
      `[Graphify Knowledge Graph Query — "${query}" (${matched.length} matches)]`,
      ...matched.map(
        (n) =>
          `- ${n.id} [${n.cluster}] (${n.lines}L, in:${n.importedBy.length} out:${n.imports.length})\n  Symbols: ${n.symbols.slice(0, 10).join(', ') || '(none)'}\n  Connects: ${[...n.imports, ...n.importedBy].slice(0, 6).join(', ') || '(isolated)'}`
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
        `🕸️ Graphify: ${data.workspaceName}`,
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
        }
      });
      this.panel = panel;
    }
    this.panel.title = `🕸️ Graphify: ${data.workspaceName}`;
    this.panel.webview.html = this.buildWebviewHtml(data);
  }

  private buildWebviewHtml(data: CodeGraphData): string {
    const serialized = JSON.stringify(data).replace(/</g, '\\u003c');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Graphify Knowledge Graph</title>
<style>
  :root {
    --bg: #0b0f19;
    --surface: #111827;
    --surface-2: #1e293b;
    --line: #334155;
    --text: #f1f5f9;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --ok: #10b981;
    --warn: #f59e0b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    background: var(--bg); color: var(--text);
    font: 12.5px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    overflow: hidden;
  }
  header {
    display: flex; align-items: center; gap: 10px; padding: 8px 14px;
    background: var(--surface); border-bottom: 1px solid var(--line);
  }
  .brand { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13.5px; color: var(--accent); }
  .stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .stat-pill {
    padding: 2px 8px; border-radius: 999px; background: var(--surface-2);
    border: 1px solid var(--line); font-size: 11px; color: var(--muted);
  }
  .stat-pill strong { color: var(--text); }
  .stat-pill.health { border-color: rgba(16,185,129,0.45); color: #34d399; }
  .search-input {
    margin-left: auto; width: 210px; padding: 5px 10px; border-radius: 7px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: 12px;
  }
  .btn {
    padding: 5px 10px; border-radius: 7px; border: 1px solid var(--line);
    background: var(--surface-2); color: var(--text); font-size: 11.5px; font-weight: 600; cursor: pointer;
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn.primary { background: rgba(56,189,248,0.16); border-color: rgba(56,189,248,0.5); color: var(--accent); }
  .workspace { flex: 1; display: grid; grid-template-columns: 1fr 300px; min-height: 0; }
  .canvas-wrap { position: relative; overflow: hidden; background: radial-gradient(circle at center, #111827 0%, #0b0f19 100%); }
  canvas { width: 100%; height: 100%; display: block; cursor: grab; }
  canvas:active { cursor: grabbing; }
  .legend {
    position: absolute; left: 12px; bottom: 12px; display: flex; flex-wrap: wrap; gap: 6px;
    max-width: 70%; padding: 6px 10px; border-radius: 8px;
    background: rgba(15,23,42,0.88); border: 1px solid var(--line); backdrop-filter: blur(4px);
  }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); }
  .dot { width: 9px; height: 9px; border-radius: 50%; }
  aside {
    border-left: 1px solid var(--line); background: var(--surface);
    padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
  }
  h3 { margin: 0; font-size: 13px; color: var(--accent); word-break: break-all; }
  .sub { font-size: 11px; color: var(--muted); }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 6px 0 4px; }
  .chip-list { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    padding: 2px 7px; border-radius: 5px; background: var(--surface-2);
    border: 1px solid var(--line); font-family: monospace; font-size: 11px; color: var(--text);
    cursor: pointer;
  }
  .chip:hover { border-color: var(--accent); color: var(--accent); }
  .hub-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 5px 7px; border-radius: 6px; background: var(--surface-2);
    margin-bottom: 4px; cursor: pointer; font-size: 11.5px;
  }
  .hub-row:hover { border: 1px solid var(--accent); }
</style>
</head>
<body>
  <header>
    <div class="brand">🕸️ Graphify Knowledge Graph</div>
    <div class="stats">
      <span class="stat-pill"><strong id="statNodes">0</strong> Files</span>
      <span class="stat-pill"><strong id="statEdges">0</strong> Edges</span>
      <span class="stat-pill"><strong id="statSymbols">0</strong> Symbols</span>
      <span class="stat-pill health">Health <strong id="statHealth">100</strong>/100</span>
    </div>
    <input id="search" class="search-input" type="search" placeholder="Filter file or symbol..." />
    <button id="injectBtn" class="btn primary" type="button">🤖 Send Graph to Agent</button>
    <button id="refreshBtn" class="btn" type="button">↻ Refresh</button>
  </header>
  <div class="workspace">
    <div class="canvas-wrap">
      <canvas id="graphCanvas"></canvas>
      <div id="legend" class="legend"></div>
    </div>
    <aside id="inspector">
      <div id="inspectorContent"></div>
    </aside>
  </div>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  const data = ${serialized};
  const canvas = document.getElementById('graphCanvas');
  const ctx = canvas.getContext('2d');
  const searchEl = document.getElementById('search');
  const inspectorContent = document.getElementById('inspectorContent');

  document.getElementById('statNodes').textContent = data.nodes.length;
  document.getElementById('statEdges').textContent = data.edges.length;
  document.getElementById('statSymbols').textContent = data.totalSymbols;
  document.getElementById('statHealth').textContent = data.healthScore;

  const PALETTE = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#fb7185', '#60a5fa', '#c084fc', '#2dd4bf'];
  const clusterColors = {};
  data.clusters.forEach((c, idx) => { clusterColors[c.name] = PALETTE[idx % PALETTE.length]; });

  const legendEl = document.getElementById('legend');
  data.clusters.slice(0, 8).forEach((c) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = '<i class="dot" style="background:' + clusterColors[c.name] + '"></i>' + c.name + ' (' + c.count + ')';
    legendEl.appendChild(item);
  });

  // Initialize node positions grouped by cluster angle
  const clusterIndex = {};
  data.clusters.forEach((c, i) => { clusterIndex[c.name] = i; });
  const totalClusters = Math.max(1, data.clusters.length);

  const simNodes = data.nodes.map((n, i) => {
    const cIdx = clusterIndex[n.cluster] || 0;
    const baseAngle = (cIdx / totalClusters) * Math.PI * 2;
    const spread = ((i % 13) - 6) * 0.08;
    const dist = 130 + (i % 7) * 28;
    return {
      ...n,
      x: Math.cos(baseAngle + spread) * dist + (Math.random() - 0.5) * 40,
      y: Math.sin(baseAngle + spread) * dist + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
      radius: Math.max(6, Math.min(18, 6 + Math.sqrt(n.score) * 2.2)),
      color: clusterColors[n.cluster] || '#38bdf8'
    };
  });
  const nodeById = new Map(simNodes.map(n => [n.id, n]));

  let camX = 0, camY = 0, zoom = 1;
  let selectedNode = simNodes[0] || null;
  let hoveredNode = null;
  let draggingNode = null;
  let panning = false;
  let lastMouse = { x: 0, y: 0 };
  let filterQuery = '';

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Run 90 ticks of force-directed layout relaxation upfront
  for (let tick = 0; tick < 90; tick++) {
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i];
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy + 1;
        if (d2 < 14000) {
          const f = 900 / d2;
          a.vx -= dx * f; a.vy -= dy * f;
          b.vx += dx * f; b.vy += dy * f;
        }
      }
    }
    for (const edge of data.edges) {
      const a = nodeById.get(edge.from);
      const b = nodeById.get(edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 110) * 0.015;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    for (const n of simNodes) {
      n.vx *= 0.65; n.vy *= 0.65;
      n.x += Math.max(-18, Math.min(18, n.vx));
      n.y += Math.max(-18, Math.min(18, n.vy));
    }
  }

  function matchesFilter(n) {
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

  function draw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(rect.width / 2 + camX, rect.height / 2 + camY);
    ctx.scale(zoom, zoom);

    // Draw edges
    for (const edge of data.edges) {
      const a = nodeById.get(edge.from);
      const b = nodeById.get(edge.to);
      if (!a || !b) continue;
      const active = selectedNode && (selectedNode.id === a.id || selectedNode.id === b.id);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = active ? '#38bdf8' : 'rgba(148, 163, 184, 0.22)';
      ctx.lineWidth = active ? 1.8 : 1;
      ctx.stroke();
    }

    // Draw nodes
    for (const n of simNodes) {
      const visible = matchesFilter(n);
      const isSelected = selectedNode && selectedNode.id === n.id;
      const isHovered = hoveredNode && hoveredNode.id === n.id;
      ctx.globalAlpha = visible ? 1 : 0.16;

      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#ffffff' : '#0b0f19';
      ctx.lineWidth = isSelected ? 2.2 : 1.2;
      ctx.stroke();

      ctx.font = (isSelected ? '600 ' : '') + '11px -apple-system, Segoe UI, sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(n.label, n.x + n.radius + 5, n.y + 3.5);
    }

    ctx.restore();
    requestAnimationFrame(draw);
  }

  function renderInspector(node) {
    inspectorContent.replaceChildren();
    if (!node) {
      const title = document.createElement('div');
      title.className = 'section-title';
      title.textContent = 'Top Architectural Hubs (God-Nodes)';
      inspectorContent.appendChild(title);
      data.hubs.forEach((h) => {
        const row = document.createElement('div');
        row.className = 'hub-row';
        row.innerHTML = '<span>' + h.id + '</span><strong>' + h.score + '</strong>';
        row.addEventListener('click', () => {
          selectedNode = nodeById.get(h.id) || null;
          renderInspector(selectedNode);
        });
        inspectorContent.appendChild(row);
      });
      return;
    }

    const header = document.createElement('div');
    header.innerHTML = '<h3>' + node.id + '</h3><div class="sub">Cluster: ' + node.cluster + ' · ' + node.lines + ' lines · Score: ' + node.score + '</div>';
    inspectorContent.appendChild(header);

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
    inspectorContent.appendChild(actions);

    const addChipSection = (titleText, items, clickable) => {
      const st = document.createElement('div');
      st.className = 'section-title';
      st.textContent = titleText + ' (' + items.length + ')';
      inspectorContent.appendChild(st);
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
      inspectorContent.appendChild(list);
    };

    addChipSection('Symbols / Definitions', node.symbols, false);
    addChipSection('Imported By (Dependents)', node.importedBy, true);
    addChipSection('Imports (Dependencies)', node.imports, true);
  }

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w = screenToWorld(sx, sy);
    const hit = simNodes.find(n => Math.hypot(n.x - w.x, n.y - w.y) <= n.radius + 4);
    if (hit) {
      draggingNode = hit;
      selectedNode = hit;
      renderInspector(hit);
    } else {
      panning = true;
      selectedNode = null;
      renderInspector(null);
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
    } else if (panning) {
      camX += e.clientX - lastMouse.x;
      camY += e.clientY - lastMouse.y;
      lastMouse = { x: e.clientX, y: e.clientY };
    } else {
      hoveredNode = simNodes.find(n => Math.hypot(n.x - w.x, n.y - w.y) <= n.radius + 4) || null;
    }
  });

  window.addEventListener('mouseup', () => {
    draggingNode = null;
    panning = false;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    zoom = Math.max(0.25, Math.min(3.5, zoom * factor));
  }, { passive: false });

  searchEl.addEventListener('input', () => {
    filterQuery = searchEl.value.trim().toLowerCase();
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshGraph' });
  });

  document.getElementById('injectBtn').addEventListener('click', () => {
    vscode.postMessage({
      type: 'askAgent',
      prompt: '/graphify Analyze the workspace architecture and key module dependencies.'
    });
  });

  renderInspector(selectedNode);
  requestAnimationFrame(draw);
})();
</script>
</body>
</html>`;
  }
}

