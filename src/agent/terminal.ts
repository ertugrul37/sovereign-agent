import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

export interface CommandResult {
  ok: boolean;
  output: string;
}

function toTerminalText(chunk: string): string {
  // A pty expects \r\n for new lines, plain stdout/stderr only has \n.
  return chunk.replace(/\r?\n/g, '\r\n');
}

function clip(text: string, max = 40000): string {
  return text.length > max ? text.slice(0, max) + `\n…(${text.length - max} more bytes clipped)` : text;
}

/**
 * Discovers installed Python directories on Windows so commands like
 * `python script.py` work out-of-the-box even when Python wasn't added
 * to the global system PATH or is shadowed by the WindowsApps Store stub.
 */
function buildCommandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  };

  if (process.platform !== 'win32') {
    return env;
  }

  const extraPaths: string[] = [];
  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Python') : '',
    'C:\\'
  ].filter(Boolean);

  for (const base of candidates) {
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^Python\d+/i.test(entry.name)) {
          const fullDir = path.join(base, entry.name);
          const exe = path.join(fullDir, 'python.exe');
          if (fs.existsSync(exe)) {
            extraPaths.push(fullDir);
            const scriptsDir = path.join(fullDir, 'Scripts');
            if (fs.existsSync(scriptsDir)) {
              extraPaths.push(scriptsDir);
            }
          }
        }
      }
    } catch {
      // ignore inaccessible directories
    }
  }

  if (process.env.LOCALAPPDATA) {
    const localPyBin = path.join(process.env.LOCALAPPDATA, 'Python', 'bin');
    if (fs.existsSync(localPyBin)) {
      extraPaths.push(localPyBin);
    }
  }

  if (extraPaths.length > 0) {
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const currentPath = env[pathKey] ?? '';
    env[pathKey] = [...extraPaths.reverse(), currentPath].filter(Boolean).join(path.delimiter);
  }

  return env;
}

/**
 * Runs agent shell commands in a visible, interactive VS Code terminal
 * so the user can see live output, provide stdin input when prompted,
 * and still return captured stdout/stderr/exit code back to the agent.
 */
export class AgentTerminal implements vscode.Disposable {
  private terminal?: vscode.Terminal;
  private writeEmitter?: vscode.EventEmitter<string>;
  private closeListener?: vscode.Disposable;
  private isOpen = false;
  private pendingWrites: string[] = [];
  private activeChild?: ChildProcess;
  private inputBuffer = '';
  private queue: Promise<unknown> = Promise.resolve();

  private ensureTerminal(): { terminal: vscode.Terminal; write: (s: string) => void } {
    if (!this.terminal) {
      const writeEmitter = new vscode.EventEmitter<string>();
      const closeEmitter = new vscode.EventEmitter<number | void>();
      this.isOpen = false;
      this.pendingWrites = [];

      const pty: vscode.Pseudoterminal = {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open: () => {
          this.isOpen = true;
          if (this.pendingWrites.length > 0) {
            for (const chunk of this.pendingWrites) {
              writeEmitter.fire(chunk);
            }
            this.pendingWrites = [];
          }
        },
        close: () => {
          this.isOpen = false;
          this.activeChild?.kill();
        },
        handleInput: (data: string) => {
          if (!this.activeChild || !this.activeChild.stdin || this.activeChild.stdin.destroyed) {
            return;
          }
          if (data === '\x03') {
            // Ctrl+C
            writeEmitter.fire('^C\r\n');
            this.inputBuffer = '';
            this.activeChild.kill();
            return;
          }
          for (const ch of data) {
            if (ch === '\r' || ch === '\n') {
              writeEmitter.fire('\r\n');
              this.activeChild.stdin.write(this.inputBuffer + '\n');
              this.inputBuffer = '';
            } else if (ch === '\x7f' || ch === '\b') {
              if (this.inputBuffer.length > 0) {
                this.inputBuffer = this.inputBuffer.slice(0, -1);
                writeEmitter.fire('\b \b');
              }
            } else if (ch >= ' ' || ch === '\t') {
              this.inputBuffer += ch;
              writeEmitter.fire(ch);
            }
          }
        }
      };

      this.writeEmitter = writeEmitter;
      this.terminal = vscode.window.createTerminal({
        name: 'Sovereign Agent',
        pty,
        iconPath: new vscode.ThemeIcon('robot')
      });
      this.closeListener = vscode.window.onDidCloseTerminal((closed) => {
        if (closed === this.terminal) {
          this.terminal = undefined;
          this.writeEmitter = undefined;
          this.isOpen = false;
          this.pendingWrites = [];
          this.closeListener?.dispose();
          this.closeListener = undefined;
        }
      });
    }

    const write = (s: string) => {
      if (this.isOpen && this.writeEmitter) {
        this.writeEmitter.fire(s);
      } else {
        this.pendingWrites.push(s);
      }
    };

    return { terminal: this.terminal, write };
  }

  /** Runs `command` in `cwd`, streaming output live into the visible terminal. */
  run(command: string, cwd: string, signal: AbortSignal, timeoutMs = 120000): Promise<CommandResult> {
    const task = this.queue.then(() => this.runNow(command, cwd, signal, timeoutMs));
    // Keep the queue alive even if this command fails, so later commands still run.
    this.queue = task.catch(() => undefined);
    return task;
  }

  private runNow(command: string, cwd: string, signal: AbortSignal, timeoutMs: number): Promise<CommandResult> {
    const { terminal, write } = this.ensureTerminal();
    terminal.show(true);
    write(`\r\n\x1b[36m$ ${command}\x1b[0m\r\n`);

    return new Promise<CommandResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      this.inputBuffer = '';

      const child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: buildCommandEnv()
      });
      this.activeChild = child;

      const timer = setTimeout(() => {
        write('\r\n\x1b[31m(timed out, stopping command)\x1b[0m\r\n');
        child.kill();
      }, timeoutMs);

      const onAbort = () => {
        write('\r\n\x1b[31m(cancelled)\x1b[0m\r\n');
        child.kill();
      };
      signal.addEventListener('abort', onAbort, { once: true });

      const finish = (ok: boolean, output: string) => {
        if (settled) return;
        settled = true;
        if (this.activeChild === child) {
          this.activeChild = undefined;
        }
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve({ ok, output: clip(output) });
      };

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        stdout += text;
        write(toTerminalText(text));
      });
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        stderr += text;
        write(toTerminalText(`\x1b[31m${text}\x1b[0m`));
      });

      child.on('error', (err) => {
        write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`);
        finish(false, `Command failed to start: ${err.message}`);
      });

      child.on('close', (code) => {
        const body = [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
        const color = code === 0 ? '32' : '31';
        write(`\r\n\x1b[2;${color}m(exit ${code ?? 'unknown'})\x1b[0m\r\n`);
        if (code === 0) {
          finish(true, body);
        } else {
          finish(false, `Command failed (exit ${code ?? 'unknown'}).\n${body}`);
        }
      });
    });
  }

  dispose(): void {
    this.activeChild?.kill();
    this.closeListener?.dispose();
    this.terminal?.dispose();
    this.terminal = undefined;
    this.writeEmitter = undefined;
    this.isOpen = false;
    this.pendingWrites = [];
  }
}
