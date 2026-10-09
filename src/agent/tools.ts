import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { ToolCall } from './protocol';

export interface ToolContext {
  root: string | undefined;
  confirmWrite(relPath: string, bytes: number): Promise<boolean>;
  confirmReplace(relPath: string): Promise<boolean>;
  confirmCommand(command: string): Promise<boolean>;
  getEditorContext(): Promise<string>;
  signal: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  /** Model-facing text, kept in English on purpose. */
  output: string;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target', '.idea'
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
  try {
    // Defeat symlinks that point outside the workspace.
    const real = await fs.realpath(abs);
    const realRoot = await fs.realpath(root);
    const rel = path.relative(realRoot, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path is outside the workspace: ${requested}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
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
  return { ok: false, output: `Missing parameter <${param}> for ${call.name}.` };
}

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.root) {
    return { ok: false, output: 'No workspace folder is open.' };
  }
  const root = ctx.root;
  const p = call.params;
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
        const bytes = Buffer.byteLength(p.content, 'utf8');
        if (!(await ctx.confirmWrite(toPosix(path.relative(root, file)), bytes))) {
          return { ok: false, output: 'The user denied this action.' };
        }
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, p.content, 'utf8');
        return { ok: true, output: `Wrote ${toPosix(path.relative(root, file))} (${bytes} bytes).` };
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
        await fs.writeFile(file, updated, 'utf8');
        return {
          ok: true,
          output: `Replaced ${replaceAll ? occurrences : 1} occurrence${occurrences === 1 ? '' : 's'} in ${toPosix(path.relative(root, file))}.`
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
      case 'run_command': {
        if (!p.command) {
          return missing(call, 'command');
        }
        if (!(await ctx.confirmCommand(p.command))) {
          return { ok: false, output: 'The user denied this action.' };
        }
        return await new Promise<ToolResult>((resolve) => {
          exec(
            p.command,
            { cwd: root, timeout: 60000, maxBuffer: 1024 * 1024, signal: ctx.signal },
            (error, stdout, stderr) => {
              const body = clip([stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)');
              if (error) {
                const code = (error as NodeJS.ErrnoException & { code?: number | string }).code;
                resolve({ ok: false, output: `Command failed (exit ${code ?? 'unknown'}).\n${body}` });
              } else {
                resolve({ ok: true, output: body });
              }
            }
          );
        });
      }
    }
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}
