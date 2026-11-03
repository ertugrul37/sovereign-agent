/**
 * Text-based tool protocol. Works with any chat model, including ones
 * without native function calling. Tool calls look like:
 *
 *   <read_file>
 *   <path>src/index.ts</path>
 *   </read_file>
 */

export const TOOL_NAMES = [
  'list_files',
  'read_file',
  'write_file',
  'replace_in_file',
  'search_files',
  'get_editor_context',
  'run_command',
  'mcp_call',
  'web_search'
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_PARAMS: Record<ToolName, string[]> = {
  list_files: ['path', 'recursive'],
  read_file: ['path'],
  write_file: ['path', 'content'],
  replace_in_file: ['path', 'old_text', 'new_text', 'replace_all'],
  search_files: ['pattern', 'path'],
  get_editor_context: [],
  run_command: ['command'],
  mcp_call: ['server', 'tool', 'arguments'],
  web_search: ['query']
};

export interface ToolCall {
  name: ToolName;
  params: Record<string, string>;
  /** Index in the source text where the call starts. */
  startIndex: number;
  /** Index just after the closing tag. */
  endIndex: number;
}

const NAMES_PATTERN = TOOL_NAMES.join('|');
const CALL_RE = new RegExp(`<(${NAMES_PATTERN})(?:\\s+([^>]*?))?>([\\s\\S]*?)</\\1>|<(${NAMES_PATTERN})(?:\\s+([^>]*?))?\\s*/>`);
const OPEN_TAG_RE = new RegExp(`<(${NAMES_PATTERN})(?=\\s|>|/)`);
const ANY_TOOL_TAG_RE = new RegExp(`<(${NAMES_PATTERN})\\b`);

const PARAM_ALIASES: Record<string, string[]> = {
  path: ['path', 'file', 'filepath', 'filename', 'file_path', 'directory', 'dir', 'target'],
  recursive: ['recursive'],
  content: ['content', 'code', 'file_content', 'text', 'body', 'source', 'data'],
  old_text: ['old_text', 'old', 'search', 'find', 'original'],
  new_text: ['new_text', 'new', 'replace', 'replacement', 'updated'],
  replace_all: ['replace_all', 'all'],
  pattern: ['pattern', 'query', 'search', 'regex', 'text'],
  command: ['command', 'cmd', 'shell', 'bash', 'script'],
  server: ['server', 'name'],
  tool: ['tool', ' tool_name', 'method'],
  arguments: ['arguments', 'args', 'params', 'input'],
  query: ['query', 'q', 'search', 'pattern', 'text']
};

function stripOuterCodeFence(code: string, filePath?: string): string {
  const trimmed = code.trim();
  if (filePath && /\.(md|markdown|mdx)$/i.test(filePath.trim())) {
    return code;
  }
  const m = /^```[a-zA-Z0-9_+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  return m ? m[1].replace(/\r?\n$/, '') : code;
}

function extractAttr(attrs: string | undefined, param: string): string | undefined {
  if (!attrs) {
    return undefined;
  }
  const names = PARAM_ALIASES[param] ?? [param];
  for (const name of names) {
    const clean = name.trim();
    const re = new RegExp(`\\b${clean}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+))`, 'i');
    const m = re.exec(attrs);
    if (m) {
      return (m[1] ?? m[2] ?? m[3] ?? '').trim();
    }
  }
  return undefined;
}

function extractParam(body: string, param: string): string | undefined {
  const names = PARAM_ALIASES[param] ?? [param];
  for (const rawName of names) {
    const tag = rawName.trim();
    // "content" is greedy so code that mentions tags inside it survives.
    const re =
      param === 'content'
        ? new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*)</${tag}>`, 'i')
        : new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
    const m = re.exec(body);
    if (m) {
      if (param === 'content') {
        return m[1].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
      }
      return m[1].trim();
    }
  }
  // Fallback for unclosed <content> (or alias) tag right before </write_file>
  if (param === 'content') {
    for (const rawName of names) {
      const tag = rawName.trim();
      const unclosed = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]+)$`, 'i').exec(body);
      if (unclosed) {
        return unclosed[1].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
      }
    }
  }
  return undefined;
}

function extractFallbackWriteContent(body: string, fullText: string, callStart: number, callEnd: number): string | undefined {
  // 1. Strip any <path>...</path> (or file/filename alias) from the tool body and check what remains.
  let remainder = body;
  for (const alias of PARAM_ALIASES.path) {
    remainder = remainder.replace(new RegExp(`<${alias}\\b[^>]*>[\\s\\S]*?</${alias}>`, 'gi'), '');
  }
  remainder = remainder.replace(/^\s*\r?\n?/, '').replace(/\r?\n?\s*$/, '');
  if (remainder.length > 0) {
    return remainder;
  }

  // 2. Some local models write a ```lang ... ``` block right before (or after) <write_file><path>...</path></write_file>.
  const outside = `${fullText.slice(0, callStart)}\n${fullText.slice(callEnd)}`;
  const fenceRe = /```[a-zA-Z0-9_+-]*[ \t]*\r?\n([\s\S]*?)```/g;
  let lastBlock: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(outside)) !== null) {
    const candidate = match[1].replace(/\r?\n$/, '');
    if (candidate.trim().length > 0 && !ANY_TOOL_TAG_RE.test(candidate)) {
      lastBlock = candidate;
    }
  }
  return lastBlock;
}

/** Returns the first complete tool call in the text, if any. */
export function parseToolCall(text: string): ToolCall | null {
  if (!text.includes('</') && !text.includes('/>')) {
    return null;
  }
  const m = CALL_RE.exec(text);
  if (!m) {
    return null;
  }
  const name = (m[1] ?? m[4]) as ToolName;
  const attrs = m[2] ?? m[5];
  const body = m[3] ?? '';
  const params: Record<string, string> = {};
  for (const p of TOOL_PARAMS[name]) {
    const value = extractParam(body, p) ?? extractAttr(attrs, p);
    if (value !== undefined) {
      params[p] = value;
    }
  }

  // Resilient fallbacks for small local models that omit inner parameter tags
  const bareBody = body.trim();
  if (name === 'write_file') {
    if (params.content === undefined) {
      const fallback = extractFallbackWriteContent(body, text, m.index, m.index + m[0].length);
      if (fallback !== undefined) {
        params.content = fallback;
      }
    }
    if (params.content !== undefined) {
      params.content = stripOuterCodeFence(params.content, params.path);
    }
  } else if (name === 'run_command' && !params.command && bareBody && !bareBody.startsWith('<')) {
    params.command = stripOuterCodeFence(bareBody).trim();
  } else if (name === 'web_search' && !params.query && bareBody && !bareBody.startsWith('<')) {
    params.query = bareBody;
  } else if (name === 'search_files' && !params.pattern && bareBody && !bareBody.startsWith('<')) {
    params.pattern = bareBody;
  } else if ((name === 'read_file' || name === 'list_files') && !params.path && bareBody && !bareBody.includes('<') && !bareBody.includes('\n')) {
    params.path = bareBody;
  }

  return { name, params, startIndex: m.index, endIndex: m.index + m[0].length };
}

/**
 * The part of a (possibly still streaming) reply that should be shown to
 * the user: everything before the first tool tag. A trailing partial tag
 * such as "<read_f" is held back so it never flashes on screen.
 */
export function visibleText(full: string): string {
  if (!full.includes('<')) {
    return full;
  }
  const open = OPEN_TAG_RE.exec(full);
  if (open) {
    return full.slice(0, open.index);
  }
  const lt = full.lastIndexOf('<');
  if (lt >= 0) {
    const tail = full.slice(lt);
    if (TOOL_NAMES.some((n) => `<${n}>`.startsWith(tail) || `<${n} `.startsWith(tail))) {
      return full.slice(0, lt);
    }
  }
  return full;
}

/** Short human-readable description of a call for the UI. */
export function describeCall(call: ToolCall): string {
  const p = call.params;
  switch (call.name) {
    case 'list_files':
      return `list_files ${p.path ?? '.'}`;
    case 'read_file':
    case 'write_file':
    case 'replace_in_file':
      return `${call.name} ${p.path ?? ''}`;
    case 'search_files':
      return `search_files ${p.pattern ?? ''}`;
    case 'get_editor_context':
      return 'get_editor_context';
    case 'run_command':
      return `run_command ${p.command ?? ''}`;
    case 'mcp_call':
      return `mcp_call ${p.server ?? ''}/${p.tool ?? ''}`;
    case 'web_search':
      return `web_search ${p.query ?? ''}`;
  }
}
