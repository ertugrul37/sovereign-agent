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
  'mcp_call'
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
  mcp_call: ['server', 'tool', 'arguments']
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

function extractParam(body: string, param: string): string | undefined {
  // "content" is greedy so code that mentions tags inside it survives.
  const re =
    param === 'content'
      ? new RegExp(`<content>([\\s\\S]*)</content>`)
      : new RegExp(`<${param}>([\\s\\S]*?)</${param}>`);
  const m = re.exec(body);
  if (!m) {
    return undefined;
  }
  if (param === 'content') {
    return m[1].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  }
  return m[1].trim();
}

/** Returns the first complete tool call in the text, if any. */
export function parseToolCall(text: string): ToolCall | null {
  const re = new RegExp(`<(${NAMES_PATTERN})>([\\s\\S]*?)</\\1>`);
  const m = re.exec(text);
  if (!m) {
    return null;
  }
  const name = m[1] as ToolName;
  const params: Record<string, string> = {};
  for (const p of TOOL_PARAMS[name]) {
    const value = extractParam(m[2], p);
    if (value !== undefined) {
      params[p] = value;
    }
  }
  return { name, params, startIndex: m.index, endIndex: m.index + m[0].length };
}

/**
 * The part of a (possibly still streaming) reply that should be shown to
 * the user: everything before the first tool tag. A trailing partial tag
 * such as "<read_f" is held back so it never flashes on screen.
 */
export function visibleText(full: string): string {
  const open = new RegExp(`<(${NAMES_PATTERN})>`).exec(full);
  if (open) {
    return full.slice(0, open.index);
  }
  const lt = full.lastIndexOf('<');
  if (lt >= 0) {
    const tail = full.slice(lt);
    if (TOOL_NAMES.some((n) => `<${n}>`.startsWith(tail))) {
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
  }
}
