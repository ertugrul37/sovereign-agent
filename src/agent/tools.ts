import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolCall } from './protocol';
import { validateCodeAgainstWorkspace } from './antiHallucination';
import type { SnapshotManager } from './snapshot';
import type { TddRunner } from './tddRunner';

export interface ToolContext {
  root: string | undefined;
  confirmWrite(relPath: string, bytes: number): Promise<boolean>;
  confirmReplace(relPath: string): Promise<boolean>;
  confirmCommand(command: string): Promise<boolean>;
  getEditorContext(): Promise<string>;
  checkpoint(relPath: string, content: string | undefined): Promise<void>;
  previewChange(relPath: string, original: string, updated: string): Promise<boolean>;
  callMcp(server: string, tool: string, argsJson: string): Promise<ToolResult>;
  /** Runs a shell command in the visible agent terminal; see src/agent/terminal.ts. */
  runCommand(command: string): Promise<ToolResult>;
  /** Searches the web for documentation or current information; see src/agent/webSearch.ts. */
  webSearch(query: string): Promise<ToolResult>;
  /** Opens a web page in the in-editor Live Preview, captures DOM/layout snapshot, clicks buttons, or types into inputs. */
  browserAction?(params: { action?: string; target?: string; selector?: string; text?: string }): Promise<ToolResult>;
  /** Builds, queries, or visualizes the Graphify codebase Knowledge Graph; see src/agent/graphify.ts. */
  codeGraph?(params: { action?: string; target?: string; query?: string }): Promise<ToolResult>;
  /** Executes automated test runner suite with self-healing feedback; see src/agent/tddRunner.ts. */
  runTests?(params: { command?: string }): Promise<ToolResult>;
  /** Time-travel workspace snapshot manager; see src/agent/snapshot.ts. */
  snapshotManager?: SnapshotManager;
  signal: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  /** Model-facing text, kept in English on purpose. */
  output: string;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'out', 'out-test', 'dist', 'build', '.next', '.nuxt', '.svelte-kit',
  '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode-test', 'coverage', '.cache', '.turbo',
  '.parcel-cache', 'bower_components'
]);
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.pdf',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.wasm',
  '.mp3', '.mp4', '.mov', '.avi', '.woff', '.woff2', '.ttf', '.eot',
  '.node'
]);
const MAX_READ_BYTES = 512 * 1024;
const MAX_OUTPUT_CHARS = 20000;
const MAX_LIST_ENTRIES = 300;
const MAX_SEARCH_MATCHES = 50;

export function clip(text: string, max = MAX_OUTPUT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]` : text;
}

/** Resolves a user/model supplied path and guarantees it stays inside root. */
export function resolveInside(root: string, requested: string | undefined): string {
  const abs = path.resolve(root, requested && requested.length > 0 ? requested : '.');
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path is outside the workspace: ${requested}`);
  }
  return abs;
}

async function safePath(root: string, requested: string | undefined): Promise<string> {
  const abs = resolveInside(root, requested);
  const realRoot = await fs.realpath(root);
  
  // Defeat symlinks that point outside the workspace, including parent directories for new files.
  let current = abs;
  while (true) {
    try {
      const real = await fs.realpath(current);
      const rel = path.relative(realRoot, real);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path is outside the workspace: ${requested}`);
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const parent = path.dirname(current);
        if (parent === current) {
          break;
        }
        current = parent;
      } else {
        throw err;
      }
    }
  }
  return abs;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

async function walk(dir: string, root: string, depth: number, maxDepth: number, out: string[]): Promise<void> {
  if (out.length >= MAX_LIST_ENTRIES) {
    return;
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_LIST_ENTRIES) {
      return;
    }
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      out.push(`${toPosix(path.relative(root, path.join(dir, entry.name)))}/`);
      if (depth < maxDepth) {
        await walk(path.join(dir, entry.name), root, depth + 1, maxDepth, out);
      }
    } else if (entry.isFile()) {
      out.push(toPosix(path.relative(root, path.join(dir, entry.name))));
    }
  }
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        yield* walkFiles(full);
      }
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function missing(call: ToolCall, param: string): ToolResult {
  const examples: Partial<Record<ToolCall['name'], string>> = {
    write_file:
      'Example:\n<write_file>\n<path>filename.py</path>\n<content>\n# full file code here\n</content>\n</write_file>',
    replace_in_file:
      'Example:\n<replace_in_file>\n<path>filename.py</path>\n<old_text>exact old lines</old_text>\n<new_text>new lines</new_text>\n</replace_in_file>',
    read_file: 'Example:\n<read_file>\n<path>filename.py</path>\n</read_file>',
    run_command: 'Example:\n<run_command>\n<command>python filename.py</command>\n</run_command>',
    search_files: 'Example:\n<search_files>\n<pattern>search_term</pattern>\n</search_files>',
    web_search: 'Example:\n<web_search>\n<query>search query</query>\n</web_search>'
  };
  const hint = examples[call.name] ? `\n${examples[call.name]}` : '';
  return {
    ok: false,
    output: `Missing parameter <${param}> for ${call.name}. Always include <${param}>...</${param}> inside <${call.name}>.${hint}`
  };
}

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const p = call.params;
  if (call.name === 'web_search') {
    if (!p.query) {
      return missing(call, 'query');
    }
    return await ctx.webSearch(p.query);
  }
  if (call.name === 'browser_action') {
    if (!ctx.browserAction) {
      return { ok: false, output: 'Live Browser Preview is not available in this context.' };
    }
    return await ctx.browserAction(p);
  }
  if (call.name === 'code_graph') {
    if (!ctx.codeGraph) {
      return { ok: false, output: 'Graphify Codebase Knowledge Graph is not available in this context.' };
    }
    return await ctx.codeGraph(p);
  }
  if (!ctx.root) {
    return { ok: false, output: 'No workspace folder is open.' };
  }
  const root = ctx.root;
  try {
    switch (call.name) {
      case 'list_files': {
        const dir = await safePath(root, p.path);
        const out: string[] = [];
        await walk(dir, root, 1, p.recursive === 'true' ? 4 : 1, out);
        return { ok: true, output: out.length ? out.join('\n') : '(empty)' };
      }
      case 'read_file': {
        if (!p.path) {
          return missing(call, 'path');
        }
        const file = await safePath(root, p.path);
        const stat = await fs.stat(file);
        if (stat.size > MAX_READ_BYTES) {
          return { ok: false, output: `File is too large (${stat.size} bytes). Use search_files or run_command to inspect it.` };
        }
        return { ok: true, output: clip(await fs.readFile(file, 'utf8'), 40000) };
      }
      case 'write_file': {
        if (!p.path) {
          return missing(call, 'path');
        }
        if (p.content === undefined) {
          return missing(call, 'content');
        }
        const file = await safePath(root, p.path);
        const original = await fs.readFile(file, 'utf8').catch((err: unknown) => {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw err;
        });
        const bytes = Buffer.byteLength(p.content, 'utf8');
        if (!(await ctx.confirmWrite(toPosix(path.relative(root, file)), bytes))) {
          return { ok: false, output: 'The user denied this action.' };
        }
        if (!(await ctx.previewChange(toPosix(path.relative(root, file)), original ?? '', p.content))) {
          return { ok: false, output: 'The user cancelled the diff preview.' };
        }
        await ctx.snapshotManager?.recordFileBeforeMutation(toPosix(path.relative(root, file)));
        await ctx.checkpoint(toPosix(path.relative(root, file)), original);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, p.content, 'utf8');
        const ah = await validateCodeAgainstWorkspace(toPosix(path.relative(root, file)), p.content, root);
        const out = `Wrote ${toPosix(path.relative(root, file))} (${bytes} bytes).${ah.warningNotice ? `\n\n${ah.warningNotice}` : ''}`;
        return { ok: true, output: out };
      }
      case 'replace_in_file': {
        if (!p.path) {
          return missing(call, 'path');
        }
        if (p.old_text === undefined) {
          return missing(call, 'old_text');
        }
        if (p.new_text === undefined) {
          return missing(call, 'new_text');
        }
        const file = await safePath(root, p.path);
        const original = await fs.readFile(file, 'utf8');
        const replaceAll = p.replace_all === 'true';
        const occurrences = original.split(p.old_text).length - 1;
        if (occurrences === 0) {
          return { ok: false, output: `Text was not found in ${p.path}. Read the file again before retrying.` };
        }
        if (!replaceAll && occurrences > 1) {
          return {
            ok: false,
            output: `Found ${occurrences} matches in ${p.path}. Set <replace_all>true</replace_all> or provide a more specific old_text.`
          };
        }
        if (!(await ctx.confirmReplace(toPosix(path.relative(root, file))))) {
          return { ok: false, output: 'The user denied this action.' };
        }
        const updated = replaceAll
          ? original.split(p.old_text).join(p.new_text)
          : original.replace(p.old_text, p.new_text);
        if (!(await ctx.previewChange(toPosix(path.relative(root, file)), original, updated))) {
          return { ok: false, output: 'The user cancelled the diff preview.' };
        }
        await ctx.snapshotManager?.recordFileBeforeMutation(toPosix(path.relative(root, file)));
        await ctx.checkpoint(toPosix(path.relative(root, file)), original);
        await fs.writeFile(file, updated, 'utf8');
        const ah = await validateCodeAgainstWorkspace(toPosix(path.relative(root, file)), updated, root);
        const out = `Replaced ${replaceAll ? occurrences : 1} occurrence${occurrences === 1 ? '' : 's'} in ${toPosix(path.relative(root, file))}.${ah.warningNotice ? `\n\n${ah.warningNotice}` : ''}`;
        return {
          ok: true,
          output: out
        };
      }
      case 'search_files': {
        if (!p.pattern) {
          return missing(call, 'pattern');
        }
        let re: RegExp;
        try {
          re = new RegExp(p.pattern, 'i');
        } catch {
          re = new RegExp(p.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }
        const start = await safePath(root, p.path);
        const matches: string[] = [];
        for await (const file of walkFiles(start)) {
          if (matches.length >= MAX_SEARCH_MATCHES) {
            break;
          }
          const ext = path.extname(file).toLowerCase();
          if (BINARY_EXTS.has(ext)) {
            continue;
          }
          const stat = await fs.stat(file);
          if (stat.size > 1024 * 1024) {
            continue;
          }
          const text = await fs.readFile(file, 'utf8');
          if (text.slice(0, 1000).includes('\0')) {
            continue;
          }
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length && matches.length < MAX_SEARCH_MATCHES; i++) {
            if (re.test(lines[i])) {
              matches.push(`${toPosix(path.relative(root, file))}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            }
          }
        }
        return { ok: true, output: matches.length ? matches.join('\n') : 'No matches.' };
      }
      case 'get_editor_context':
        return { ok: true, output: await ctx.getEditorContext() };
      case 'mcp_call':
        if (!p.server) return missing(call, 'server');
        if (!p.tool) return missing(call, 'tool');
        return await ctx.callMcp(p.server, p.tool, p.arguments ?? '{}');
      case 'run_command': {
        if (!p.command) {
          return missing(call, 'command');
        }
        if (!(await ctx.confirmCommand(p.command))) {
          return { ok: false, output: 'The user denied this action.' };
        }
        return await ctx.runCommand(p.command);
      }
      case 'run_tests': {
        if (ctx.runTests) {
          return await ctx.runTests({ command: p.command });
        }
        return { ok: false, output: 'TDD test runner is not configured.' };
      }
    }
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}
