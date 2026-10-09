import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { createInterface } from 'readline';
import type { ToolResult } from './tools';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class McpManager {
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(
    private readonly servers: Record<string, McpServerConfig>,
    private readonly confirmStart: (name: string, command: string) => Promise<boolean>
  ) {}

  async call(serverName: string, tool: string, argsJson: string): Promise<ToolResult> {
    const config = this.servers[serverName];
    if (!config) {
      return { ok: false, output: `MCP server "${serverName}" is not configured.` };
    }
    let args: unknown;
    try {
      args = JSON.parse(argsJson || '{}');
    } catch {
      return { ok: false, output: 'MCP arguments must be valid JSON.' };
    }
    let child = this.processes.get(serverName);
    if (!child) {
      if (!(await this.confirmStart(serverName, [config.command, ...(config.args ?? [])].join(' ')))) {
        return { ok: false, output: 'The user denied starting the MCP server.' };
      }
      child = spawn(config.command, config.args ?? [], {
        env: { ...process.env, ...(config.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
      this.processes.set(serverName, child);
      this.attach(child);
      await this.request(child, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'sovereign-agent', version: '0.1.0' }
      });
      this.notify(child, 'notifications/initialized', {});
    }
    try {
      const result = await this.request(child, 'tools/call', { name: tool, arguments: args });
      return { ok: true, output: JSON.stringify(result) };
    } catch (error) {
      this.processes.delete(serverName);
      child.kill();
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  dispose(): void {
    for (const child of this.processes.values()) {
      child.kill();
    }
    this.processes.clear();
  }

  private attach(child: ChildProcessWithoutNullStreams): void {
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (message.id === undefined) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message ?? 'MCP request failed.'));
        else pending.resolve(message.result);
      } catch {
        // Ignore non-JSON diagnostics on stdout; MCP responses are correlated by id.
      }
    });
  }

  private request(child: ChildProcessWithoutNullStreams, method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP request timed out: ${method}`));
      }, 30000);
    });
  }

  private notify(child: ChildProcessWithoutNullStreams, method: string, params: unknown): void {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
}
