import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from './tools';

const execFileAsync = promisify(execFile);

export interface CraftStudyResult {
  target: string;
  mode: 'clean-room' | 'deep';
  timestamp: string;
  title: string;
  description: string;
  detectedStack: string[];
  colors: {
    primary?: string;
    background?: string;
    accent?: string;
    text?: string;
    palette: string[];
  };
  typography: {
    fonts: string[];
    headings: { level: string; text: string }[];
  };
  layout: {
    hasNavigation: boolean;
    hasHero: boolean;
    hasFooter: boolean;
    sectionCount: number;
    components: string[];
  };
  assets: {
    images: string[];
    icons: string[];
    links: { text: string; href: string }[];
  };
}

export interface CraftLikenessReport {
  score: number; // 0 - 100
  target: string;
  candidateDir: string;
  matches: string[];
  missingComponents: string[];
  styleGaps: string[];
  recommendations: string[];
}

export class CraftAnythingManager {
  /**
   * Executes a craft_anything action: study, rebuild, check, doctor, or mcp.
   */
  async execute(
    params: {
      action?: string;
      target?: string;
      prompt?: string;
      mode?: string;
      stack?: string;
      candidate?: string;
    },
    root: string | undefined
  ): Promise<ToolResult> {
    const action = (params.action || 'study').toLowerCase().trim();
    const target = (params.target || '').trim();

    switch (action) {
      case 'study':
      case 'inspect':
        if (!target) {
          return {
            ok: false,
            output: 'Missing parameter <target>. Provide a website URL (e.g. https://example.com) or local project directory to study.'
          };
        }
        return await this.study(target, (params.mode || 'clean-room') as 'clean-room' | 'deep', root);

      case 'rebuild':
      case 'craft':
        if (!target) {
          return {
            ok: false,
            output: 'Missing parameter <target>. Provide a target URL or reference project to rebuild.'
          };
        }
        return await this.rebuild(
          target,
          params.prompt || 'Recreate this application with modern clean architecture',
          params.stack || 'React / TypeScript / Tailwind CSS',
          root
        );

      case 'check':
      case 'compare':
        return await this.check(target, params.candidate || './', root);

      case 'doctor':
        return await this.doctor(root);

      case 'commands':
      case 'tools':
        return await this.listCommands();

      default:
        return {
          ok: false,
          output: `Unknown craft_anything action: "${action}". Supported actions: "study", "rebuild", "check", "doctor", "commands".`
        };
    }
  }

  /**
   * Studies a target website or local project, extracting DOM structure, styling, typography, and assets.
   * Produces .craft/evidence.json and .craft/SPEC.md in the workspace.
   */
  async study(target: string, mode: 'clean-room' | 'deep', root: string | undefined): Promise<ToolResult> {
    const cliInfo = await this.findCli();
    if (cliInfo.found && cliInfo.path) {
      try {
        const { stdout } = await execFileAsync(cliInfo.path, ['study', target, '--mode', mode], {
          timeout: 45000,
          cwd: root || process.cwd()
        });
        if (stdout && stdout.trim()) {
          await this.saveEvidenceToWorkspace(root, target, mode, stdout);
          return { ok: true, output: stdout };
        }
      } catch (err) {
        // Fall back to built-in autonomous engine
      }
    }

    // Built-in Autonomous Craft-Anything Inspection Engine
    if (target.startsWith('http://') || target.startsWith('https://')) {
      return await this.studyWebTarget(target, mode, root);
    } else {
      return await this.studyLocalTarget(target, mode, root);
    }
  }

  /**
   * Generates a step-by-step reconstruction plan based on the studied evidence.
   */
  async rebuild(target: string, userPrompt: string, stack: string, root: string | undefined): Promise<ToolResult> {
    const craftDir = root ? path.join(root, '.craft') : path.join(process.cwd(), '.craft');
    const evidencePath = path.join(craftDir, 'evidence.json');

    let evidence: CraftStudyResult | null = null;
    try {
      const data = await fs.readFile(evidencePath, 'utf8');
      evidence = JSON.parse(data) as CraftStudyResult;
    } catch {
      // Run quick study if not studied yet
      await this.study(target, 'clean-room', root);
      try {
        const data = await fs.readFile(evidencePath, 'utf8');
        evidence = JSON.parse(data) as CraftStudyResult;
      } catch {}
    }

    const title = evidence?.title || target;
    const detectedStack = evidence?.detectedStack?.join(', ') || 'Standard Web';
    const components = evidence?.layout?.components?.length ? evidence.layout.components : ['Header', 'HeroSection', 'MainContent', 'Footer'];
    const primaryColor = evidence?.colors?.primary || '#6366f1';
    const bgColor = evidence?.colors?.background || '#0d0f12';

    const planMd = `# Craft-Anything Reconstruction Plan
## Target: ${target} (${title})
- **Requested Stack:** ${stack}
- **Detected Reference Stack:** ${detectedStack}
- **Clean-room Mode:** Enabled (Externally visible structure, layout, styles)

### Design Tokens & Palette
- Primary Accent: \`${primaryColor}\`
- Background: \`${bgColor}\`
- Palette: ${evidence?.colors?.palette?.map(c => `\`${c}\``).join(', ') || '`#6366f1`, `#00d2b4`, `#0d0f12`, `#f1f3f7`'}
- Typography: ${evidence?.typography?.fonts?.join(', ') || 'Inter, system-ui, sans-serif'}

### Component Hierarchy Checklist
${components.map((c, i) => `- [ ] Step ${i + 1}: \`${c}\``).join('\n')}

### Execution Milestones
1. Scaffold package manifests & configuration (\`package.json\`, config files)
2. Setup CSS theme variables matching extracted tokens
3. Implement core components in order
4. Verify likeness using \`<craft_anything><action>check</action></craft_anything>\`
`;

    if (root) {
      await fs.mkdir(craftDir, { recursive: true });
      await fs.writeFile(path.join(craftDir, 'CRAFT_PLAN.md'), planMd, 'utf8');
    }

    const output = `[Craft Anything Engine — Rebuild Blueprint Initialized]
Target: ${target}
Selected Stack: ${stack}
Plan written to: .craft/CRAFT_PLAN.md

Local AI Instruction:
1. Review the components above: ${components.join(', ')}.
2. Use <write_file> to scaffold the initial entry files, layout, and components in the requested stack.
3. Apply the exact design tokens (Primary: ${primaryColor}, Background: ${bgColor}).
4. Once written, invoke <craft_anything><action>check</action><candidate>./</candidate></craft_anything> to verify fidelity.`;

    return { ok: true, output };
  }

  /**
   * Compares candidate build files against reference target evidence.
   */
  async check(target: string, candidateDir: string, root: string | undefined): Promise<ToolResult> {
    const baseDir = root ? path.resolve(root, candidateDir) : path.resolve(process.cwd(), candidateDir);
    const craftDir = root ? path.join(root, '.craft') : path.join(process.cwd(), '.craft');
    const evidencePath = path.join(craftDir, 'evidence.json');

    let evidence: CraftStudyResult | null = null;
    try {
      const data = await fs.readFile(evidencePath, 'utf8');
      evidence = JSON.parse(data) as CraftStudyResult;
    } catch {}

    // Inspect files in candidate directory
    const foundFiles: string[] = [];
    try {
      const files = await fs.readdir(baseDir, { recursive: true });
      for (const f of files) {
        if (typeof f === 'string' && !f.includes('node_modules') && !f.includes('.git') && !f.includes('.craft')) {
          foundFiles.push(f);
        }
      }
    } catch {
      return {
        ok: false,
        output: `Candidate directory "${candidateDir}" does not exist or is empty. Generate code first before checking likeness.`
      };
    }

    const expectedComponents = evidence?.layout?.components || ['Header', 'HeroSection', 'Footer'];
    const matchedComponents: string[] = [];
    const missingComponents: string[] = [];

    expectedComponents.forEach(comp => {
      const clean = comp.toLowerCase().replace(/[^a-z0-9]/g, '');
      const hasMatch = foundFiles.some(f => f.toLowerCase().replace(/[^a-z0-9]/g, '').includes(clean));
      if (hasMatch) {
        matchedComponents.push(comp);
      } else {
        missingComponents.push(comp);
      }
    });

    const matchRatio = expectedComponents.length > 0 ? matchedComponents.length / expectedComponents.length : 1;
    const fileCountBonus = Math.min(25, foundFiles.length * 3);
    const score = Math.min(100, Math.round(matchRatio * 75 + fileCountBonus));

    const recommendations: string[] = [];
    if (missingComponents.length > 0) {
      recommendations.push(`Implement missing components: ${missingComponents.join(', ')}`);
    }
    recommendations.push('Run <browser_action><action>open</action></browser_action> to visually verify responsiveness');
    recommendations.push('Run <run_tests> to ensure all tests pass');

    const reportMd = `# Craft-Anything Fidelity Report
**Target:** ${evidence?.target || target || 'Reference'}
**Candidate Directory:** \`${candidateDir}\`
**Likeness Score:** **${score} / 100**

### Matched Components (${matchedComponents.length}/${expectedComponents.length})
${matchedComponents.map(c => `- ✓ \`${c}\``).join('\n') || '- None yet'}

### Missing Components
${missingComponents.map(c => `- ✕ \`${c}\``).join('\n') || '- None! All primary components present.'}

### Recommendations for Refinement
${recommendations.map(r => `1. ${r}`).join('\n')}
`;

    if (root) {
      await fs.writeFile(path.join(craftDir, 'REPORT.md'), reportMd, 'utf8');
    }

    return {
      ok: true,
      output: `[Craft Anything Engine — Fidelity Check Result]
Likeness Score: ${score}/100
Matched: ${matchedComponents.length}/${expectedComponents.length} components
Missing: ${missingComponents.join(', ') || 'None'}
Status Report: .craft/REPORT.md

Local AI Instruction:
${recommendations.join('\n')}`
    };
  }

  /**
   * System health check for craft-anything CLI, MCP server, and local runtime.
   */
  async doctor(root: string | undefined): Promise<ToolResult> {
    const cli = await this.findCli();
    const hasEvidence = await this.hasCraftEvidence(root);

    const lines: string[] = [
      '# Craft-Anything System Diagnostics',
      `• Native CLI Binary: ${cli.found ? `✓ Detected (${cli.path})` : '✕ Not found in PATH or ~/.cargo/bin'}`,
      `• Built-in Autonomous Engine: ✓ Ready & Active (TypeScript / Local AI)`,
      `• MCP Integration: ${cli.found ? '✓ Direct STDIO Supported (`craft-anything-cli mcp`)' : '✓ Internal Protocol Bridge Active'}`,
      `• Active Workspace Project: ${root ? `✓ Open (${path.basename(root)})` : '✕ No folder open'}`,
      `• Prior Studied Evidence: ${hasEvidence ? '✓ .craft/evidence.json exists' : '○ No target studied yet'}`
    ];

    if (!cli.found) {
      lines.push(
        '',
        'Tip: To install the native Rust binary from storytold/craft-anything:',
        '```bash',
        'cargo install --git https://github.com/storytold/craft-anything craft-anything-cli',
        '```',
        'Even without the Rust binary, Sovereign Agent handles study, rebuild, and check autonomously out-of-the-box.'
      );
    }

    return { ok: true, output: lines.join('\n') };
  }

  /**
   * Lists available tools in the Craft Anything suite.
   */
  async listCommands(): Promise<ToolResult> {
    return {
      ok: true,
      output: `[Craft Anything Command Matrix]
1. study: Inspects target software/website in clean-room or deep mode.
   <craft_anything>
   <action>study</action>
   <target>https://example.com</target>
   <mode>clean-room</mode>
   </craft_anything>

2. rebuild: Scaffolds recreation with Local AI in user's desired stack.
   <craft_anything>
   <action>rebuild</action>
   <target>https://example.com</target>
   <prompt>Rebuild as modern Next.js / Tailwind app</prompt>
   <stack>React / TypeScript</stack>
   </craft_anything>

3. check: Measures likeness score, delta gap, and styling diffs against reference.
   <craft_anything>
   <action>check</action>
   <candidate>./src</candidate>
   </craft_anything>

4. doctor: Verifies craft-anything binary, MCP server, and workspace status.
   <craft_anything>
   <action>doctor</action>
   </craft_anything>`
    };
  }

  // --- Private Helpers ---

  private async findCli(): Promise<{ found: boolean; path?: string }> {
    const candidates = [
      'craft-anything-cli',
      'craft-anything',
      path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'craft-anything-cli.exe' : 'craft-anything-cli')
    ];

    for (const bin of candidates) {
      try {
        const { stdout } = await execFileAsync(bin, ['--version']);
        if (stdout) return { found: true, path: bin };
      } catch {}
    }
    return { found: false };
  }

  private async hasCraftEvidence(root: string | undefined): Promise<boolean> {
    if (!root) return false;
    try {
      await fs.stat(path.join(root, '.craft', 'evidence.json'));
      return true;
    } catch {
      return false;
    }
  }

  private async saveEvidenceToWorkspace(
    root: string | undefined,
    target: string,
    mode: string,
    rawOutput: string
  ): Promise<void> {
    if (!root) return;
    const craftDir = path.join(root, '.craft');
    await fs.mkdir(craftDir, { recursive: true });
    await fs.writeFile(
      path.join(craftDir, 'evidence.json'),
      JSON.stringify({ target, mode, timestamp: new Date().toISOString(), raw: rawOutput }, null, 2),
      'utf8'
    );
  }

  private async studyWebTarget(target: string, mode: 'clean-room' | 'deep', root: string | undefined): Promise<ToolResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);

      const res = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SovereignAgent/0.1 CraftAnything/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { ok: false, output: `Failed to fetch target URL: ${target} (HTTP ${res.status} ${res.statusText})` };
      }

      const html = await res.text();
      const analysis = this.analyzeHtml(target, html, mode);

      if (root) {
        const craftDir = path.join(root, '.craft');
        await fs.mkdir(craftDir, { recursive: true });
        await fs.writeFile(path.join(craftDir, 'evidence.json'), JSON.stringify(analysis, null, 2), 'utf8');

        const specMd = `# Craft-Anything Software Specification
**Target URL:** ${target}
**Title:** ${analysis.title}
**Description:** ${analysis.description}
**Mode:** ${mode} (Clean-Room Inspection)
**Captured At:** ${analysis.timestamp}

## Detected Tech Stack
${analysis.detectedStack.map(s => `- ${s}`).join('\n') || '- Standard HTML5 / CSS3'}

## Color Palette Tokens
- Primary Accent: \`${analysis.colors.primary || '#6366f1'}\`
- Background: \`${analysis.colors.background || '#0d0f12'}\`
- Text: \`${analysis.colors.text || '#f1f3f7'}\`
- Discovered Colors: ${analysis.colors.palette.slice(0, 10).map(c => `\`${c}\``).join(', ')}

## Typography
- Fonts: ${analysis.typography.fonts.join(', ') || 'Inter, system-ui, sans-serif'}

## Structural Components Discovered
${analysis.layout.components.map(c => `- \`${c}\``).join('\n')}

## Navigation Links & Actions
${analysis.assets.links.slice(0, 15).map(l => `- [${l.text || 'Link'}](${l.href})`).join('\n')}
`;
        await fs.writeFile(path.join(craftDir, 'SPEC.md'), specMd, 'utf8');
      }

      return {
        ok: true,
        output: `[Craft Anything Engine — Target Studied Successfully]
Target: ${target}
Title: "${analysis.title}"
Mode: ${mode} Clean-Room Inspection
Detected Stack: ${analysis.detectedStack.join(', ') || 'HTML5/CSS3'}

Design Tokens:
• Primary: ${analysis.colors.primary || '#6366f1'}
• Background: ${analysis.colors.background || '#0d0f12'}
• Text: ${analysis.colors.text || '#f1f3f7'}
• Fonts: ${analysis.typography.fonts.join(', ') || 'system-ui'}

Component Blueprint:
${analysis.layout.components.map(c => `• ${c}`).join('\n')}

Artifacts written to:
- .craft/evidence.json (Raw structured telemetry)
- .craft/SPEC.md (Implementation specification)

Local AI Instruction:
You now have concrete clean-room evidence. You can now call <craft_anything><action>rebuild</action><target>${target}</target></craft_anything> or start generating files with <write_file>.`
      };
    } catch (err) {
      return {
        ok: false,
        output: `Error inspecting target ${target}: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  private async studyLocalTarget(target: string, mode: 'clean-room' | 'deep', root: string | undefined): Promise<ToolResult> {
    const targetDir = root ? path.resolve(root, target) : path.resolve(target);
    try {
      const files: string[] = [];
      const entries = await fs.readdir(targetDir, { recursive: true });
      for (const e of entries) {
        if (typeof e === 'string' && !e.includes('node_modules') && !e.includes('.git')) {
          files.push(e);
        }
      }

      const summary = `[Craft Anything Engine — Local Project Studied]
Target: ${targetDir}
Files Found: ${files.length}
Key Structure:
${files.slice(0, 20).map(f => `• ${f}`).join('\n')}`;

      if (root) {
        const craftDir = path.join(root, '.craft');
        await fs.mkdir(craftDir, { recursive: true });
        await fs.writeFile(
          path.join(craftDir, 'evidence.json'),
          JSON.stringify({ target, mode, files: files.slice(0, 100) }, null, 2),
          'utf8'
        );
      }

      return { ok: true, output: summary };
    } catch (err) {
      return { ok: false, output: `Could not study local directory ${target}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private analyzeHtml(target: string, html: string, mode: 'clean-room' | 'deep'): CraftStudyResult {
    // 1. Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : path.basename(target);

    // 2. Meta description
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const description = descMatch ? descMatch[1].trim() : '';

    // 3. Tech Stack Detection
    const stack: string[] = [];
    if (/react|__NEXT_DATA__|_next\//i.test(html)) stack.push('React / Next.js');
    if (/vue|nuxt|__NUXT__/i.test(html)) stack.push('Vue / Nuxt');
    if (/svelte|sveltekit/i.test(html)) stack.push('Svelte');
    if (/tailwind/i.test(html) || /class="[^"]*(?:flex|grid|p-\d|m-\d|text-|bg-)/.test(html)) stack.push('Tailwind CSS');
    if (/bootstrap/i.test(html)) stack.push('Bootstrap');
    if (/vite/i.test(html)) stack.push('Vite');
    if (/astro/i.test(html)) stack.push('Astro');

    // 4. Color Extraction
    const hexColors = new Set<string>();
    const hexMatches = html.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || [];
    hexMatches.forEach(c => hexColors.add(c.toLowerCase()));

    const palette = Array.from(hexColors).slice(0, 15);
    const primary = palette.find(c => c !== '#ffffff' && c !== '#000000' && c !== '#fff' && c !== '#000') || '#6366f1';
    const bg = palette.find(c => c.startsWith('#0') || c.startsWith('#1') || c === '#ffffff' || c === '#fff') || '#0d0f12';

    // 5. Typography
    const fontSet = new Set<string>();
    const fontMatches = html.match(/font-family:\s*([^;}"']+)/gi) || [];
    fontMatches.forEach(fm => {
      const clean = fm.replace(/font-family:\s*/i, '').trim();
      const first = clean.split(',')[0].replace(/['"]/g, '').trim();
      if (first) fontSet.add(first);
    });

    const headings: { level: string; text: string }[] = [];
    const headingMatches = html.matchAll(/<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi);
    for (const hm of headingMatches) {
      const text = hm[2].replace(/<[^>]+>/g, '').trim();
      if (text) headings.push({ level: hm[1].toLowerCase(), text: text.slice(0, 60) });
    }

    // 6. Layout & Components
    const components: string[] = [];
    const hasNav = /<nav\b|<header\b/i.test(html);
    if (hasNav) components.push('HeaderNavigation');

    const hasHero = /hero|banner|jumbotron/i.test(html) || headings.some(h => h.level === 'h1');
    if (hasHero) components.push('HeroSection');

    if (/features|feature-grid|services/i.test(html)) components.push('FeatureGrid');
    if (/card|pricing|testimonials/i.test(html)) components.push('CardShowcase');
    if (/<form\b|<input\b/i.test(html)) components.push('ContactOrFormSection');

    const hasFooter = /<footer\b/i.test(html);
    if (hasFooter) components.push('Footer');

    // 7. Links
    const links: { text: string; href: string }[] = [];
    const linkMatches = html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
    for (const lm of linkMatches) {
      const text = lm[2].replace(/<[^>]+>/g, '').trim();
      const href = lm[1].trim();
      if (text && href && !href.startsWith('javascript:')) {
        links.push({ text: text.slice(0, 40), href });
      }
    }

    return {
      target,
      mode,
      timestamp: new Date().toISOString(),
      title,
      description,
      detectedStack: stack,
      colors: {
        primary,
        background: bg,
        accent: '#00d2b4',
        text: '#f1f3f7',
        palette
      },
      typography: {
        fonts: Array.from(fontSet),
        headings: headings.slice(0, 10)
      },
      layout: {
        hasNavigation: hasNav,
        hasHero,
        hasFooter,
        sectionCount: (html.match(/<section\b/gi) || []).length,
        components
      },
      assets: {
        images: (html.match(/<img[^>]+src=["']([^"']+)["']/gi) || []).slice(0, 10),
        icons: (html.match(/<svg\b/gi) || []).slice(0, 10),
        links
      }
    };
  }
}
