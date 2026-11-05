import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { ToolResult } from './tools';

export interface FailingTestInfo {
  name: string;
  file?: string;
  line?: number;
  message?: string;
}

export interface TestExecutionResult {
  ok: boolean;
  framework: string;
  command: string;
  durationMs: number;
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  failingTests: FailingTestInfo[];
  rawOutput: string;
  summary: string;
  dashboard: string;
}

export class TddRunner {
  constructor(private readonly getRoot: () => string | undefined) {}

  /**
   * Detects the test framework and runnable command for the given workspace.
   */
  async detectTestCommand(): Promise<{ framework: string; command: string } | null> {
    const root = this.getRoot();
    if (!root) return null;

    const isWin = process.platform === 'win32';
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    const npxCmd = isWin ? 'npx.cmd' : 'npx';

    // 1. Node / JavaScript / TypeScript package.json
    try {
      const pkgPath = path.join(root, 'package.json');
      const raw = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      if (pkg.scripts && pkg.scripts.test && !pkg.scripts.test.includes('no test specified')) {
        const testScript = String(pkg.scripts.test);
        let framework = 'npm';
        if (testScript.includes('vitest')) framework = 'vitest';
        else if (testScript.includes('jest')) framework = 'jest';
        else if (testScript.includes('node --test')) framework = 'node:test';
        else if (testScript.includes('mocha')) framework = 'mocha';
        else if (testScript.includes('ava')) framework = 'ava';
        return { framework, command: `${npmCmd} test` };
      }
    } catch {}

    // 2. Python
    try {
      const entries = await fs.readdir(root);
      if (entries.includes('pytest.ini') || entries.includes('pyproject.toml') || entries.some((e) => e.startsWith('test_') || e.endsWith('_test.py') || e === 'tests')) {
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

    // 5. Bun
    try {
      await fs.access(path.join(root, 'bun.lockb'));
      return { framework: 'bun', command: 'bun test' };
    } catch {}

    // 6. Fallback npm test if package.json exists
    try {
      await fs.access(path.join(root, 'package.json'));
      return { framework: 'npm', command: `${npmCmd} test` };
    } catch {}

    return null;
  }

  /**
   * Executes the test command with a strict timeout and parses output.
   */
  async runTests(customCommand?: string, timeoutMs = 30000): Promise<TestExecutionResult> {
    const root = this.getRoot();
    if (!root) {
      return {
        ok: false,
        framework: 'unknown',
        command: '',
        durationMs: 0,
        totalPassed: 0,
        totalFailed: 1,
        totalSkipped: 0,
        failingTests: [],
        rawOutput: 'No workspace folder is open.',
        summary: 'Cannot run tests: No open workspace.',
        dashboard: '### 🧪 Sovereign Auto-TDD Runner\n\n❌ No workspace folder is currently open.'
      };
    }

    const cmdInfo = await this.detectTestCommand();
    let commandToRun = customCommand || cmdInfo?.command;
    const framework = cmdInfo?.framework || 'custom';

    if (commandToRun && process.platform === 'win32') {
      if (commandToRun.startsWith('npm ')) commandToRun = commandToRun.replace(/^npm /, 'npm.cmd ');
      if (commandToRun.startsWith('npx ')) commandToRun = commandToRun.replace(/^npx /, 'npx.cmd ');
    }

    if (!commandToRun) {
      return {
        ok: false,
        framework: 'none',
        command: '',
        durationMs: 0,
        totalPassed: 0,
        totalFailed: 0,
        totalSkipped: 0,
        failingTests: [],
        rawOutput: 'No recognized test configuration found (e.g. package.json scripts.test, pytest, Cargo.toml).',
        summary: 'No test runner configured in this workspace.',
        dashboard: '### 🧪 Sovereign Auto-TDD Runner\n\n⚠️ No recognized test runner found in this workspace. Configure a `"test"` script in `package.json` or add `pytest` / `Cargo.toml`.'
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
        let totalSkipped = 0;

        const passMatches = out.match(/(\d+)\s*(?:passed|pass|ok|✔)/gi) || [];
        for (const m of passMatches) {
          const num = parseInt(m.match(/\d+/)?.[0] || '0', 10);
          if (num > totalPassed) totalPassed = num;
        }

        const failMatches = out.match(/(\d+)\s*(?:failed|fail|errors|✕|✖)/gi) || [];
        for (const m of failMatches) {
          const num = parseInt(m.match(/\d+/)?.[0] || '0', 10);
          if (num > totalFailed) totalFailed = num;
        }

        const skipMatches = out.match(/(\d+)\s*(?:skipped|skip|todo|pending)/gi) || [];
        for (const m of skipMatches) {
          const num = parseInt(m.match(/\d+/)?.[0] || '0', 10);
          if (num > totalSkipped) totalSkipped = num;
        }

        if (error && totalFailed === 0) {
          totalFailed = 1;
        }

        // Parse individual failing tests
        const failingTests: FailingTestInfo[] = [];
        const lines = out.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (/^[✖✕✗]\s+(.+)/.test(line) || /^FAIL\s+(.+)/.test(line) || /^FAILED\s+(.+)/.test(line)) {
            const name = line.replace(/^[✖✕✗FAIL]+\s+/, '').trim();
            let file: string | undefined;
            let lineNum: number | undefined;
            let msg: string | undefined;

            // Look ahead for stack trace
            for (let k = i + 1; k < Math.min(lines.length, i + 8); k++) {
              const traceLine = lines[k].trim();
              const fMatch = traceLine.match(/(?:at\s+[^\n(]*\()?([a-zA-Z0-9_\-\.\/\\:]+?\.(?:ts|js|py|rs|go)):(\d+)/);
              if (fMatch) {
                file = fMatch[1];
                lineNum = parseInt(fMatch[2], 10);
                break;
              }
              if (!msg && (traceLine.includes('Error:') || traceLine.includes('AssertionError'))) {
                msg = traceLine;
              }
            }
            failingTests.push({ name, file, line: lineNum, message: msg });
          }
        }

        const statusIcon = ok ? '✓' : '✕';
        const summary = `${statusIcon} [TDD Runner: ${framework}] ${ok ? 'All tests passed' : 'Test suite failed'} (${totalPassed} pass, ${totalFailed} fail in ${(durationMs / 1000).toFixed(2)}s)`;

        // Build visual progress meter
        const total = totalPassed + totalFailed;
        const passPercent = total > 0 ? Math.round((totalPassed / total) * 100) : (ok ? 100 : 0);
        const barFilled = Math.round(passPercent / 10);
        const meterBar = '█'.repeat(barFilled) + '░'.repeat(10 - barFilled);

        const statusBadge = ok ? '🟢 PASSED (100% Green)' : '🔴 FAILED (Failures Detected)';

        const dashboardLines = [
          `### 🧪 Sovereign Auto-TDD Runner`,
          `**Status:** ${statusBadge} · **Framework:** \`${framework}\``,
          `**Progress:** \`[${meterBar}] ${passPercent}%\` (${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped)`,
          '',
          `| Test Metric | Value |`,
          `| :--- | :--- |`,
          `| **Command Executed** | \`${commandToRun}\` |`,
          `| **Duration** | \`${(durationMs / 1000).toFixed(2)}s\` |`,
          `| **Tests Passing** | \`${totalPassed}\` |`,
          `| **Tests Failing** | \`${totalFailed}\` |`,
          `| **Tests Skipped** | \`${totalSkipped}\` |`,
          ''
        ];

        if (!ok && failingTests.length > 0) {
          dashboardLines.push('#### ❌ Failing Tests Breakdown:');
          failingTests.forEach((t, idx) => {
            const loc = t.file ? (t.line ? ` \`${t.file}:${t.line}\`` : ` \`${t.file}\``) : '';
            dashboardLines.push(`${idx + 1}. **${t.name}**${loc}`);
            if (t.message) dashboardLines.push(`   > *${t.message}*`);
          });
          dashboardLines.push('');
        }

        dashboardLines.push('```');
        dashboardLines.push(out.slice(0, 3500));
        dashboardLines.push('```');
        dashboardLines.push('');

        if (ok) {
          dashboardLines.push('> ✨ **Test suite is completely green! Ready for production deployment.**');
          dashboardLines.push('> - To generate new unit tests for any file: Type `/tdd gen <filename>`');
        } else {
          dashboardLines.push('> ⚠️ **Tests failed.** Sovereign Agent can automatically repair the code:');
          dashboardLines.push('> - 🔧 **Auto-Fix Failures:** Type `/tdd fix` to have the Agent repair failing assertions autonomously.');
        }

        const dashboard = dashboardLines.join('\n');

        resolve({
          ok,
          framework,
          command: commandToRun!,
          durationMs,
          totalPassed,
          totalFailed,
          totalSkipped,
          failingTests,
          rawOutput: out.slice(0, 15000),
          summary,
          dashboard
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
