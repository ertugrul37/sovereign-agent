import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { ToolResult } from './tools';

export interface TestExecutionResult {
  ok: boolean;
  framework: string;
  command: string;
  durationMs: number;
  totalPassed: number;
  totalFailed: number;
  rawOutput: string;
  summary: string;
}

export class TddRunner {
  constructor(private readonly getRoot: () => string | undefined) {}

  /**
   * Detects the test framework and runnable command for the given workspace.
   */
  async detectTestCommand(): Promise<{ framework: string; command: string } | null> {
    const root = this.getRoot();
    if (!root) return null;

    // 1. Node / JavaScript / TypeScript
    try {
      const pkgPath = path.join(root, 'package.json');
      const raw = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      if (pkg.scripts && pkg.scripts.test && !pkg.scripts.test.includes('no test specified')) {
        return { framework: 'npm', command: 'npm test' };
      }
    } catch {}

    // 2. Python
    try {
      const entries = await fs.readdir(root);
      if (entries.includes('pytest.ini') || entries.includes('pyproject.toml') || entries.some((e) => e.startsWith('test_') || e.endsWith('_test.py'))) {
        return { framework: 'pytest', command: 'pytest' };
      }
    } catch {}

    // 3. Rust
    try {
      await fs.access(path.join(root, 'Cargo.toml'));
      return { framework: 'cargo', command: 'cargo test' };
    } catch {}

    // 4. Go
    try {
      await fs.access(path.join(root, 'go.mod'));
      return { framework: 'go', command: 'go test ./...' };
    } catch {}

    // 5. Fallback npm test if package.json exists
    try {
      await fs.access(path.join(root, 'package.json'));
      return { framework: 'npm', command: 'npm test' };
    } catch {}

    return null;
  }

  /**
   * Executes the test command with a strict timeout and parses output.
   */
  async runTests(customCommand?: string, timeoutMs = 25000): Promise<TestExecutionResult> {
    const root = this.getRoot();
    if (!root) {
      return {
        ok: false,
        framework: 'unknown',
        command: '',
        durationMs: 0,
        totalPassed: 0,
        totalFailed: 1,
        rawOutput: 'No workspace folder is open.',
        summary: 'Cannot run tests: No open workspace.'
      };
    }

    let cmdInfo = await this.detectTestCommand();
    let commandToRun = customCommand || cmdInfo?.command;
    let framework = cmdInfo?.framework || 'custom';

    if (!commandToRun) {
      return {
        ok: false,
        framework: 'none',
        command: '',
        durationMs: 0,
        totalPassed: 0,
        totalFailed: 0,
        rawOutput: 'No recognized test configuration found (e.g. package.json scripts.test, pytest, Cargo.toml).',
        summary: 'No test runner configured in this workspace.'
      };
    }

    const start = Date.now();
    return new Promise<TestExecutionResult>((resolve) => {
      exec(commandToRun!, { cwd: root, timeout: timeoutMs, env: process.env }, (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        const out = `${stdout || ''}\n${stderr || ''}`.trim();
        const ok = !error;

        // Parse pass/fail counts
        let totalPassed = 0;
        let totalFailed = 0;

        const passMatches = out.match(/(\d+)\s*(?:passed|pass|ok|✔)/gi) || [];
        for (const m of passMatches) {
          const num = parseInt(m.match(/\d+/)?.[0] || '0', 10);
          if (num > totalPassed) totalPassed = num;
        }

        const failMatches = out.match(/(\d+)\s*(?:failed|fail|errors|✕)/gi) || [];
        for (const m of failMatches) {
          const num = parseInt(m.match(/\d+/)?.[0] || '0', 10);
          if (num > totalFailed) totalFailed = num;
        }

        if (error && totalFailed === 0) {
          totalFailed = 1;
        }

        const statusIcon = ok ? '✓' : '✕';
        const summary = `${statusIcon} [TDD Runner: ${framework}] ${ok ? 'All tests passed' : 'Test suite failed'} (${totalPassed} pass, ${totalFailed} fail in ${(durationMs / 1000).toFixed(2)}s)`;

        resolve({
          ok,
          framework,
          command: commandToRun!,
          durationMs,
          totalPassed,
          totalFailed,
          rawOutput: out.slice(0, 15000),
          summary
        });
      });
    });
  }

  /**
   * Tool execution wrapper for the agent loop.
   */
  async executeTool(params: { command?: string }): Promise<ToolResult> {
    const res = await this.runTests(params.command);
    const body = [
      res.summary,
      `Command: ${res.command}`,
      `Duration: ${res.durationMs}ms`,
      '--- Test Output ---',
      res.rawOutput || '(no output)'
    ].join('\n');

    return {
      ok: res.ok,
      output: body
    };
  }
}

