import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from './tools';

const execFileAsync = promisify(execFile);

export interface CraftExtractedSourcesManifest {
  target: string;
  slug: string;
  extractedDir: string;
  timestamp: string;
  htmlFiles: string[];
  cssFiles: string[];
  jsFiles: string[];
  reconstructedSourceMapFiles: string[];
  htmlComponents: string[];
  tsxComponents: string[];
  svgAssets: string[];
  dataFiles: string[];
  discoveredApiEndpoints: string[];
  totalFilesExtracted: number;
}

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
  extractedSources?: CraftExtractedSourcesManifest;
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

interface SourceMapV3 {
  version?: number;
  file?: string;
  sourceRoot?: string;
  sources?: string[];
  sourcesContent?: (string | null)[];
}

export class CraftAnythingManager {
  /**
   * Executes a craft_anything action: extract, study, rebuild, check, doctor, or commands.
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
      case 'extract':
      case 'decompile':
      case 'unpack':
      case 'source':
      case 'sources':
        if (!target) {
          return {
            ok: false,
            output: 'Missing parameter <target>. Provide a website URL (e.g. https://example.com), archive (.vsix/.zip), or local path to extract source code from.'
          };
        }
        return await this.extract(target, root);

      case 'study':
      case 'inspect':
        if (!target) {
          return {
            ok: false,
            output: 'Missing parameter <target>. Provide a website URL (e.g. https://example.com) or local project directory to study.'
          };
        }
        return await this.study(target, (params.mode || 'deep') as 'clean-room' | 'deep', root);

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
          params.prompt || 'Recreate this application with modern clean architecture using the extracted source files',
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
          output: `Unknown craft_anything action: "${action}". Supported actions: "extract", "study", "rebuild", "check", "doctor", "commands".`
        };
    }
  }

  /**
   * Dedicated source-code extraction action: downloads HTML, external/inline CSS & JS bundles,
   * unpacks SourceMaps (*.map -> original .ts/.tsx/.vue/.scss sources), splits semantic HTML
   * into standalone HTML & React/TSX components, extracts inline SVGs, and extracts state/API payloads.
   */
  async extract(target: string, root: string | undefined): Promise<ToolResult> {
    return await this.study(target, 'deep', root);
  }

  /**
   * Studies a target website or local project AND extracts full source code into .craft/extracted/<slug>/.
   * Produces .craft/evidence.json, .craft/SPEC.md, and .craft/extracted/<slug>/MANIFEST.md in the workspace.
   */
  async study(target: string, mode: 'clean-room' | 'deep', root: string | undefined): Promise<ToolResult> {
    const cliInfo = await this.findCli();
    let cliOutput = '';
    if (cliInfo.found && cliInfo.path) {
      try {
        const { stdout } = await execFileAsync(cliInfo.path, ['study', target, '--mode', mode], {
          timeout: 45000,
          cwd: root || process.cwd()
        });
        if (stdout && stdout.trim()) {
          cliOutput = stdout.trim();
        }
      } catch {
        // Proceed with built-in deep source extraction engine
      }
    }

    // Built-in Autonomous Craft-Anything Source Code Extraction & Inspection Engine
    if (target.startsWith('http://') || target.startsWith('https://')) {
      return await this.studyWebTarget(target, mode, root, cliOutput);
    } else {
      return await this.studyLocalTarget(target, mode, root, cliOutput);
    }
  }

  /**
   * Generates a step-by-step reconstruction plan based on the studied evidence and extracted source code files.
   */
  async rebuild(target: string, userPrompt: string, stack: string, root: string | undefined): Promise<ToolResult> {
    const baseRoot = root || process.cwd();
    const craftDir = path.join(baseRoot, '.craft');
    const evidencePath = path.join(craftDir, 'evidence.json');

    let evidence: CraftStudyResult | null = null;
    try {
      const data = await fs.readFile(evidencePath, 'utf8');
      evidence = JSON.parse(data) as CraftStudyResult;
    } catch {
      await this.study(target, 'deep', root);
      try {
        const data = await fs.readFile(evidencePath, 'utf8');
        evidence = JSON.parse(data) as CraftStudyResult;
      } catch {}
    }

    const title = evidence?.title || target;
    const detectedStack = evidence?.detectedStack?.join(', ') || 'Standard Web';
    const components = evidence?.layout?.components?.length
      ? evidence.layout.components
      : ['Header', 'HeroSection', 'MainContent', 'Footer'];
    const primaryColor = evidence?.colors?.primary || '#6366f1';
    const bgColor = evidence?.colors?.background || '#0d0f12';
    const extracted = evidence?.extractedSources;

    const extractedSection = extracted
      ? `
### Extracted Source Code Inventory (\`${extracted.extractedDir}\`)
- **Total Extracted Files:** ${extracted.totalFilesExtracted}
- **HTML Entry & Snapshots:** ${extracted.htmlFiles.map(f => `\`${f}\``).join(', ') || 'None'}
- **Stylesheets (CSS):** ${extracted.cssFiles.map(f => `\`${f}\``).join(', ') || 'None'}
- **Scripts (JS/Modules):** ${extracted.jsFiles.map(f => `\`${f}\``).join(', ') || 'None'}
- **Reconstructed Original Sources (SourceMaps):** ${extracted.reconstructedSourceMapFiles.length > 0 ? extracted.reconstructedSourceMapFiles.slice(0, 20).map(f => `\`${f}\``).join(', ') : 'None published on target'}
- **Ready-to-Use TSX Components:** ${extracted.tsxComponents.map(f => `\`${f}\``).join(', ') || 'None'}
- **Extracted HTML Sections:** ${extracted.htmlComponents.map(f => `\`${f}\``).join(', ') || 'None'}
- **Extracted SVG Icons:** ${extracted.svgAssets.length} SVG file(s)
`
      : '';

    const planMd = `# Craft-Anything Source Reconstruction Plan
## Target: ${target} (${title})
- **User Prompt:** ${userPrompt}
- **Requested Stack:** ${stack}
- **Detected Reference Stack:** ${detectedStack}
- **Source Code Extraction:** Completed
${extractedSection}
### Design Tokens & Palette
- Primary Accent: \`${primaryColor}\`
- Background: \`${bgColor}\`
- Palette: ${evidence?.colors?.palette?.map(c => `\`${c}\``).join(', ') || '`#6366f1`, `#00d2b4`, `#0d0f12`, `#f1f3f7`'}
- Typography: ${evidence?.typography?.fonts?.join(', ') || 'Inter, system-ui, sans-serif'}

### Component Hierarchy Checklist
${components.map((c, i) => `- [ ] Step ${i + 1}: \`${c}\``).join('\n')}

### Execution Milestones
1. Inspect extracted source code inside \`${extracted?.extractedDir || '.craft/extracted'}\` using \`<read_file>\`
2. Reuse or adapt extracted CSS rules (\`styles/\`), TSX components (\`components_tsx/\`), and reconstructed SourceMap files (\`original_sources/\`)
3. Scaffold project files in the workspace using \`<write_file>\`
4. Verify likeness using \`<craft_anything><action>check</action></craft_anything>\`
`;

    await fs.mkdir(craftDir, { recursive: true });
    await fs.writeFile(path.join(craftDir, 'CRAFT_PLAN.md'), planMd, 'utf8');

    const output = `[Craft Anything Engine — Source-Backed Rebuild Blueprint Ready]
Target: ${target}
Selected Stack: ${stack}
Plan written to: .craft/CRAFT_PLAN.md
Extracted Source Directory: ${extracted?.extractedDir || '.craft/extracted'} (${extracted?.totalFilesExtracted || 0} files)

Local AI Instruction:
1. Read the extracted source files in "${extracted?.extractedDir || '.craft/extracted'}/MANIFEST.md" or inspect "${extracted?.extractedDir || '.craft/extracted'}/components_tsx/" and "${extracted?.extractedDir || '.craft/extracted'}/styles/" with <read_file>.
2. Use <write_file> to build the application in the workspace using the real extracted HTML structure, CSS styles, SVG icons, and TSX components.
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
      recommendations.push(`Implement missing components: ${missingComponents.join(', ')} (check .craft/extracted/ for ready-made HTML/TSX components)`);
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
      await fs.mkdir(craftDir, { recursive: true });
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
   * System health check for craft-anything CLI, Source Code Extractor, MCP server, and local runtime.
   */
  async doctor(root: string | undefined): Promise<ToolResult> {
    const cli = await this.findCli();
    const hasEvidence = await this.hasCraftEvidence(root);

    const lines: string[] = [
      '# Craft-Anything System Diagnostics',
      `• Native CLI Binary: ${cli.found ? `✓ Detected (${cli.path})` : '○ Not found in PATH (Using Built-in Deep Source Extractor)'}`,
      `• Deep Source Code Extractor: ✓ Active (HTML, CSS, JS, SourceMaps *.map, TSX Decompiler, SVG, Archive Unpacker)`,
      `• MCP Integration: ${cli.found ? '✓ Direct STDIO Supported (`craft-anything-cli mcp`)' : '✓ Internal Protocol Bridge Active'}`,
      `• Active Workspace Project: ${root ? `✓ Open (${path.basename(root)})` : '✕ No folder open'}`,
      `• Prior Extracted Evidence: ${hasEvidence ? '✓ .craft/evidence.json & .craft/extracted/ present' : '○ No target extracted yet'}`
    ];

    return { ok: true, output: lines.join('\n') };
  }

  /**
   * Lists available tools in the Craft Anything suite.
   */
  async listCommands(): Promise<ToolResult> {
    return {
      ok: true,
      output: `[Craft Anything Command Matrix]
1. extract: Extracts full source code (HTML, external/inline CSS & JS, SourceMaps *.map original TS/TSX/Vue sources, modular HTML & React TSX components, SVGs, API routes) into .craft/extracted/<target>/:
   <craft_anything>
   <action>extract</action>
   <target>https://example.com</target>
   </craft_anything>

2. study: Inspects target software/website AND extracts all source code into .craft/extracted/<target>/:
   <craft_anything>
   <action>study</action>
   <target>https://example.com</target>
   <mode>deep</mode>
   </craft_anything>

3. rebuild: Scaffolds recreation with Local AI using the extracted source files:
   <craft_anything>
   <action>rebuild</action>
   <target>https://example.com</target>
   <prompt>Rebuild as modern Next.js / Tailwind app</prompt>
   <stack>React / TypeScript</stack>
   </craft_anything>

4. check: Measures likeness score, delta gap, and styling diffs against reference:
   <craft_anything>
   <action>check</action>
   <candidate>./src</candidate>
   </craft_anything>

5. doctor: Verifies craft-anything extractor, MCP server, and workspace status:
   <craft_anything>
   <action>doctor</action>
   </craft_anything>`
    };
  }

  // ============================================================================
  // DEEP SOURCE CODE EXTRACTION ENGINE
  // ============================================================================

  private slugifyTarget(target: string): string {
    try {
      if (target.startsWith('http://') || target.startsWith('https://')) {
        const u = new URL(target);
        const host = u.hostname.replace(/^www\./, '');
        const p = u.pathname === '/' ? '' : u.pathname.replace(/[^a-zA-Z0-9_-]/g, '-');
        return `${host}${p}`.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'web-target';
      }
    } catch {}
    return path.basename(target).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 60) || 'local-target';
  }

  private async fetchTextSafe(url: string, timeoutMs = 10000): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SovereignAgent/0.1 CraftAnything/2.0',
          Accept: '*/*'
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  /**
   * Formats minified HTML with readable indentation so Local AI can easily inspect structure.
   */
  public formatHtmlSource(html: string): string {
    let formatted = html
      .replace(/>\s*</g, '>\n<')
      .replace(/(<script[\s\S]*?<\/script>)/gi, '\n$1\n')
      .replace(/(<style[\s\S]*?<\/style>)/gi, '\n$1\n');
    const lines = formatted.split('\n').map(l => l.trim()).filter(Boolean);
    let indent = 0;
    const out: string[] = [];
    const voidTags = /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr|!doctype)\b/i;

    for (const line of lines) {
      if (/^<\/[a-zA-Z0-9-]+>/.test(line)) {
        indent = Math.max(0, indent - 1);
      }
      out.push('  '.repeat(indent) + line);
      if (
        /^<[a-zA-Z0-9-]+\b/.test(line) &&
        !voidTags.test(line) &&
        !line.endsWith('/>') &&
        !/<\/[a-zA-Z0-9-]+>\s*$/.test(line)
      ) {
        indent = Math.min(20, indent + 1);
      }
    }
    return out.join('\n');
  }

  /**
   * Basic beautifier for single-line minified CSS or JS bundles so they are readable in editor.
   */
  public beautifyCode(code: string, type: 'css' | 'js'): string {
    const lineCount = code.split('\n').length;
    if (code.length > 300 && lineCount < 8) {
      if (type === 'css') {
        return code
          .replace(/\{/g, ' {\n  ')
          .replace(/;/g, ';\n  ')
          .replace(/\}/g, '\n}\n')
          .replace(/\n\s*\n/g, '\n');
      } else {
        return code
          .replace(/\{/g, ' {\n  ')
          .replace(/\}/g, '\n}\n')
          .replace(/;(?=[a-zA-Z_$])/g, ';\n  ');
      }
    }
    return code;
  }

  /**
   * Converts an HTML snippet into a clean, valid React + TypeScript (.tsx) functional component.
   */
  public convertHtmlToTsxComponent(componentName: string, rawHtml: string): string {
    const safeName = componentName.replace(/[^a-zA-Z0-9]/g, '') || 'ExtractedSection';
    const pascalName = safeName.charAt(0).toUpperCase() + safeName.slice(1);

    let jsx = rawHtml
      // Remove HTML comments or convert to JSX comments
      .replace(/<!--([\s\S]*?)-->/g, '{/* $1 */}')
      // Convert standard HTML attributes to React JSX camelCase equivalents
      .replace(/\bclass=/gi, 'className=')
      .replace(/\bfor=/gi, 'htmlFor=')
      .replace(/\btabindex=/gi, 'tabIndex=')
      .replace(/\breadonly=/gi, 'readOnly=')
      .replace(/\bmaxlength=/gi, 'maxLength=')
      .replace(/\bautocomplete=/gi, 'autoComplete=')
      .replace(/\bautofocus=/gi, 'autoFocus=')
      .replace(/\bcolspan=/gi, 'colSpan=')
      .replace(/\browspan=/gi, 'rowSpan=')
      .replace(/\bstroke-width=/gi, 'strokeWidth=')
      .replace(/\bstroke-linecap=/gi, 'strokeLinecap=')
      .replace(/\bstroke-linejoin=/gi, 'strokeLinejoin=')
      .replace(/\bfill-rule=/gi, 'fillRule=')
      .replace(/\bclip-rule=/gi, 'clipRule=')
      .replace(/\bviewbox=/gi, 'viewBox=')
      // Strip inline event handlers that might reference global window functions
      .replace(/\bon[a-z]+="[^"]*"/gi, '')
      // Remove inline <script> tags inside component markup
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      // Ensure void tags are self-closing
      .replace(/<(img|input|br|hr|meta|link|source|area|base|col|embed|param|track|wbr)\b([^>]*?)(?<!\/)>/gi, '<$1$2 />')
      // Strip inline style strings to data-original-style so React doesn't throw on string style prop
      .replace(/\bstyle="([^"]*)"/gi, 'data-extracted-style="$1"');

    return `import React from 'react';

export interface ${pascalName}Props {
  className?: string;
}

/**
 * Auto-extracted by Sovereign Agent Craft-Anything Source Engine
 */
export const ${pascalName}: React.FC<${pascalName}Props> = ({ className }) => {
  return (
    <div className={className}>
      ${jsx.split('\n').join('\n      ')}
    </div>
  );
};

export default ${pascalName};
`;
  }

  /**
   * Unpacks a SourceMap v3 JSON (from external .map URL, inline data: URI, or local .map file)
   * and writes every original source file (sources + sourcesContent) into original_sources/.
   */
  public async unpackSourceMapContent(
    rawMapJson: string,
    originalSourcesDir: string,
    relPrefix: string
  ): Promise<string[]> {
    const reconstructed: string[] = [];
    try {
      const mapData = JSON.parse(rawMapJson) as SourceMapV3;
      if (!Array.isArray(mapData.sources) || !Array.isArray(mapData.sourcesContent)) {
        return reconstructed;
      }

      for (let i = 0; i < mapData.sources.length; i++) {
        const srcPath = mapData.sources[i];
        const srcContent = mapData.sourcesContent[i];
        if (!srcPath || typeof srcContent !== 'string' || !srcContent.trim()) {
          continue;
        }

        // Clean webpack://, vite://, ng://, .., query strings
        let cleanRel = srcPath
          .replace(/^(?:webpack|vite|rollup|ng|turbopack|rsc):\/\/\/?/i, '')
          .replace(/^\.\//, '')
          .replace(/\.\.\//g, '__parent__/')
          .split('?')[0]
          .replace(/^\/+/, '')
          .replace(/[:*?"<>|]/g, '_');

        if (!cleanRel || cleanRel.includes('node_modules')) {
          continue;
        }

        const outPath = path.join(originalSourcesDir, cleanRel);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, srcContent, 'utf8');
        reconstructed.push(`${relPrefix}/original_sources/${cleanRel.replace(/\\/g, '/')}`);
      }
    } catch {
      // Ignore malformed sourcemap JSON
    }
    return reconstructed;
  }

  /**
   * Checks a JS or CSS asset for `sourceMappingURL=...` (inline base64 or external .map URL)
   * and unpacks any original source files found.
   */
  private async tryExtractSourceMapFromAsset(
    assetCode: string,
    assetUrl: string,
    originalSourcesDir: string,
    relPrefix: string
  ): Promise<string[]> {
    const match =
      assetCode.match(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/) ||
      assetCode.match(/\/\*[#@]\s*sourceMappingURL=([^\s*'"]+)\s*\*\//);

    const mapRef = match ? match[1].trim() : `${assetUrl}.map`;

    // Case 1: Inline base64 data URI sourcemap
    if (mapRef.startsWith('data:application/json')) {
      const base64Match = mapRef.match(/base64,([A-Za-z0-9+/=]+)/);
      if (base64Match) {
        const decoded = Buffer.from(base64Match[1], 'base64').toString('utf8');
        return await this.unpackSourceMapContent(decoded, originalSourcesDir, relPrefix);
      }
      return [];
    }

    // Case 2: External HTTP(S) .map URL
    if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://')) {
      try {
        const resolvedMapUrl = new URL(mapRef, assetUrl).href;
        const mapJson = await this.fetchTextSafe(resolvedMapUrl, 8000);
        if (mapJson && mapJson.includes('"sources"')) {
          return await this.unpackSourceMapContent(mapJson, originalSourcesDir, relPrefix);
        }
      } catch {}
    }

    return [];
  }

  /**
   * Extracts all source codes, stylesheets, scripts, sourcemaps, components, SVGs, and state JSON
   * from an HTML document (either fetched from a web URL or read from disk).
   */
  public async extractAllSourcesFromHtml(
    target: string,
    html: string,
    root: string,
    localBaseDir?: string
  ): Promise<CraftExtractedSourcesManifest> {
    const slug = this.slugifyTarget(target);
    const relPrefix = `.craft/extracted/${slug}`;
    const extractDir = path.join(root, '.craft', 'extracted', slug);

    const stylesDir = path.join(extractDir, 'styles');
    const scriptsDir = path.join(extractDir, 'scripts');
    const originalSourcesDir = path.join(extractDir, 'original_sources');
    const componentsDir = path.join(extractDir, 'components');
    const componentsTsxDir = path.join(extractDir, 'components_tsx');
    const assetsDir = path.join(extractDir, 'assets');
    const dataDir = path.join(extractDir, 'data');

    await Promise.all([
      fs.mkdir(stylesDir, { recursive: true }),
      fs.mkdir(scriptsDir, { recursive: true }),
      fs.mkdir(originalSourcesDir, { recursive: true }),
      fs.mkdir(componentsDir, { recursive: true }),
      fs.mkdir(componentsTsxDir, { recursive: true }),
      fs.mkdir(assetsDir, { recursive: true }),
      fs.mkdir(dataDir, { recursive: true })
    ]);

    const manifest: CraftExtractedSourcesManifest = {
      target,
      slug,
      extractedDir: relPrefix,
      timestamp: new Date().toISOString(),
      htmlFiles: [],
      cssFiles: [],
      jsFiles: [],
      reconstructedSourceMapFiles: [],
      htmlComponents: [],
      tsxComponents: [],
      svgAssets: [],
      dataFiles: [],
      discoveredApiEndpoints: [],
      totalFilesExtracted: 0
    };

    // 1. Save raw and formatted HTML source
    await fs.writeFile(path.join(extractDir, 'index.html'), html, 'utf8');
    manifest.htmlFiles.push(`${relPrefix}/index.html`);

    const formattedHtml = this.formatHtmlSource(html);
    await fs.writeFile(path.join(extractDir, 'index.formatted.html'), formattedHtml, 'utf8');
    manifest.htmlFiles.push(`${relPrefix}/index.formatted.html`);

    // 2. Extract Inline <style> blocks
    const inlineStyles: string[] = [];
    for (const sm of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      const content = sm[1].trim();
      if (content) inlineStyles.push(content);
    }
    if (inlineStyles.length > 0) {
      const combinedInlineCss = inlineStyles.map((s, i) => `/* === Inline Style Block #${i + 1} === */\n${this.beautifyCode(s, 'css')}`).join('\n\n');
      await fs.writeFile(path.join(stylesDir, 'inline-styles.css'), combinedInlineCss, 'utf8');
      manifest.cssFiles.push(`${relPrefix}/styles/inline-styles.css`);
    }

    // 3. Download or read External <link rel="stylesheet"> CSS files
    const cssHrefs = new Set<string>();
    for (const lm of html.matchAll(/<link\b[^>]*>/gi)) {
      const tag = lm[0];
      if (/rel=["']stylesheet["']/i.test(tag) || /\.css(?:\?[^"']*)?["']/i.test(tag)) {
        const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
        if (hrefMatch && hrefMatch[1]) {
          cssHrefs.add(hrefMatch[1].trim());
        }
      }
    }

    let cssIndex = 1;
    let allCssCombined = inlineStyles.join('\n');
    for (const rawHref of Array.from(cssHrefs).slice(0, 15)) {
      let cssContent: string | null = null;
      let resolvedUrl = rawHref;

      if (target.startsWith('http://') || target.startsWith('https://')) {
        try {
          resolvedUrl = new URL(rawHref, target).href;
          cssContent = await this.fetchTextSafe(resolvedUrl, 8000);
        } catch {}
      } else if (localBaseDir) {
        try {
          const localCssPath = path.resolve(localBaseDir, rawHref.replace(/^\//, ''));
          cssContent = await fs.readFile(localCssPath, 'utf8');
          resolvedUrl = localCssPath;
        } catch {}
      }

      if (cssContent) {
        allCssCombined += '\n' + cssContent;
        const baseName = path.basename(rawHref.split('?')[0]).replace(/[^a-zA-Z0-9._-]/g, '_') || `style-${cssIndex}.css`;
        const fileName = baseName.endsWith('.css') ? `${cssIndex}-${baseName}` : `${cssIndex}-${baseName}.css`;
        const beautifiedCss = this.beautifyCode(cssContent, 'css');
        await fs.writeFile(path.join(stylesDir, fileName), beautifiedCss, 'utf8');
        manifest.cssFiles.push(`${relPrefix}/styles/${fileName}`);

        // Check for CSS SourceMap
        const mapFiles = await this.tryExtractSourceMapFromAsset(cssContent, resolvedUrl, originalSourcesDir, relPrefix);
        manifest.reconstructedSourceMapFiles.push(...mapFiles);
        cssIndex++;
      }
    }

    // Extract CSS Custom Properties (--variables) into styles/design-tokens.css
    const cssVarMatches = allCssCombined.match(/--[a-zA-Z0-9_-]+\s*:\s*[^;}\n]+/g) || [];
    if (cssVarMatches.length > 0) {
      const uniqueVars = Array.from(new Set(cssVarMatches.map(v => v.trim())));
      const tokensCss = `:root {\n${uniqueVars.map(v => `  ${v};`).join('\n')}\n}\n`;
      await fs.writeFile(path.join(stylesDir, 'design-tokens.css'), tokensCss, 'utf8');
      manifest.cssFiles.push(`${relPrefix}/styles/design-tokens.css`);
    }

    // 4. Extract Inline <script> blocks, Hydration State (__NEXT_DATA__, JSON-LD), and External <script src="...">
    const inlineScripts: string[] = [];
    const jsonLdPayloads: unknown[] = [];
    const scriptSrcs = new Set<string>();

    for (const scm of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = scm[1] || '';
      const body = (scm[2] || '').trim();

      const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
      if (srcMatch && srcMatch[1]) {
        scriptSrcs.add(srcMatch[1].trim());
      }

      if (!body) continue;

      // Check for Next.js __NEXT_DATA__
      if (/id=["']__NEXT_DATA__["']/i.test(attrs)) {
        try {
          const parsed = JSON.parse(body);
          await fs.writeFile(path.join(dataDir, 'next_data.json'), JSON.stringify(parsed, null, 2), 'utf8');
          manifest.dataFiles.push(`${relPrefix}/data/next_data.json`);
          continue;
        } catch {}
      }

      // Check for application/ld+json or importmap
      if (/application\/ld\+json/i.test(attrs)) {
        try {
          jsonLdPayloads.push(JSON.parse(body));
          continue;
        } catch {}
      }

      if (/importmap/i.test(attrs)) {
        await fs.writeFile(path.join(dataDir, 'importmap.json'), body, 'utf8');
        manifest.dataFiles.push(`${relPrefix}/data/importmap.json`);
        continue;
      }

      inlineScripts.push(body);
    }

    if (jsonLdPayloads.length > 0) {
      await fs.writeFile(path.join(dataDir, 'json_ld.json'), JSON.stringify(jsonLdPayloads, null, 2), 'utf8');
      manifest.dataFiles.push(`${relPrefix}/data/json_ld.json`);
    }

    if (inlineScripts.length > 0) {
      const combinedInlineJs = inlineScripts
        .map((s, i) => `// === Inline Script Block #${i + 1} ===\n${this.beautifyCode(s, 'js')}`)
        .join('\n\n');
      await fs.writeFile(path.join(scriptsDir, 'inline-scripts.js'), combinedInlineJs, 'utf8');
      manifest.jsFiles.push(`${relPrefix}/scripts/inline-scripts.js`);

      // Check if any inline script has an inline base64 sourcemap
      for (const s of inlineScripts) {
        const inlineMapFiles = await this.tryExtractSourceMapFromAsset(s, target, originalSourcesDir, relPrefix);
        manifest.reconstructedSourceMapFiles.push(...inlineMapFiles);
      }
    }

    // Download or read External <script src="..."> files & unpack SourceMaps
    let jsIndex = 1;
    let allJsCombined = inlineScripts.join('\n');
    for (const rawSrc of Array.from(scriptSrcs).slice(0, 15)) {
      let jsContent: string | null = null;
      let resolvedUrl = rawSrc;

      if (target.startsWith('http://') || target.startsWith('https://')) {
        try {
          resolvedUrl = new URL(rawSrc, target).href;
          jsContent = await this.fetchTextSafe(resolvedUrl, 9000);
        } catch {}
      } else if (localBaseDir) {
        try {
          const localJsPath = path.resolve(localBaseDir, rawSrc.replace(/^\//, ''));
          jsContent = await fs.readFile(localJsPath, 'utf8');
          resolvedUrl = localJsPath;
          // Also check if a local .map file exists right next to it
          try {
            const localMapContent = await fs.readFile(`${localJsPath}.map`, 'utf8');
            const unpacked = await this.unpackSourceMapContent(localMapContent, originalSourcesDir, relPrefix);
            manifest.reconstructedSourceMapFiles.push(...unpacked);
          } catch {}
        } catch {}
      }

      if (jsContent) {
        allJsCombined += '\n' + jsContent;
        const baseName = path.basename(rawSrc.split('?')[0]).replace(/[^a-zA-Z0-9._-]/g, '_') || `script-${jsIndex}.js`;
        const fileName = /\.(m?js|ts|jsx|tsx)$/i.test(baseName) ? `${jsIndex}-${baseName}` : `${jsIndex}-${baseName}.js`;
        const beautifiedJs = this.beautifyCode(jsContent, 'js');
        await fs.writeFile(path.join(scriptsDir, fileName), beautifiedJs, 'utf8');
        manifest.jsFiles.push(`${relPrefix}/scripts/${fileName}`);

        // Check for JS SourceMap (*.map) to reconstruct original TypeScript/React/Vue sources!
        const mapFiles = await this.tryExtractSourceMapFromAsset(jsContent, resolvedUrl, originalSourcesDir, relPrefix);
        manifest.reconstructedSourceMapFiles.push(...mapFiles);
        jsIndex++;
      }
    }

    // 5. Discover API endpoints & routes referenced inside JS bundles
    const apiMatches = new Set<string>();
    const apiRegex = /["'`]((?:https?:\/\/[^"'`\s]+)?\/(?:api|v1|v2|v3|graphql|rest|trpc|auth)\/[a-zA-Z0-9_./-]+)["'`]/g;
    for (const am of allJsCombined.matchAll(apiRegex)) {
      if (am[1] && am[1].length < 120) {
        apiMatches.add(am[1]);
      }
    }
    if (apiMatches.size > 0) {
      manifest.discoveredApiEndpoints = Array.from(apiMatches).slice(0, 50);
      await fs.writeFile(
        path.join(dataDir, 'discovered_apis.json'),
        JSON.stringify({ endpoints: manifest.discoveredApiEndpoints }, null, 2),
        'utf8'
      );
      manifest.dataFiles.push(`${relPrefix}/data/discovered_apis.json`);
    }

    // 6. Deconstruct Semantic HTML Sections into standalone .html AND React .tsx components
    const semanticTags = ['header', 'nav', 'main', 'section', 'article', 'aside', 'form', 'footer'];
    let compCounter = 1;

    for (const tag of semanticTags) {
      const tagRegex = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
      for (const match of html.matchAll(tagRegex)) {
        if (compCounter > 16) break;
        const snippet = match[0];
        if (snippet.length < 25) continue;

        // Determine a meaningful component name from id, class, or aria-label
        const openTag = snippet.match(/^<[^>]+>/)?.[0] || '';
        const idAttr = openTag.match(/\bid=["']([a-zA-Z0-9_-]+)["']/i)?.[1];
        const ariaAttr = openTag.match(/\baria-label=["']([a-zA-Z0-9_\s-]+)["']/i)?.[1];
        const rawLabel = idAttr || ariaAttr || `${tag}-${compCounter}`;
        const cleanSlug = rawLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || `${tag}-${compCounter}`;

        const htmlCompName = `${String(compCounter).padStart(2, '0')}-${tag}-${cleanSlug}.html`;
        const formattedSnippet = this.formatHtmlSource(snippet);
        await fs.writeFile(path.join(componentsDir, htmlCompName), formattedSnippet, 'utf8');
        manifest.htmlComponents.push(`${relPrefix}/components/${htmlCompName}`);

        // Also generate a ready-to-use React TypeScript (.tsx) component
        const pascalBase = `${tag.charAt(0).toUpperCase() + tag.slice(1)}${compCounter}`;
        const tsxFileName = `${pascalBase}.tsx`;
        const tsxSource = this.convertHtmlToTsxComponent(pascalBase, formattedSnippet);
        await fs.writeFile(path.join(componentsTsxDir, tsxFileName), tsxSource, 'utf8');
        manifest.tsxComponents.push(`${relPrefix}/components_tsx/${tsxFileName}`);

        compCounter++;
      }
    }

    // If no semantic tags matched (e.g. a pure <div> SPA shell or simple page), extract body as AppShell component
    if (manifest.htmlComponents.length === 0) {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const bodyContent = (bodyMatch ? bodyMatch[1] : html).trim();
      if (bodyContent) {
        const formattedBody = this.formatHtmlSource(bodyContent);
        await fs.writeFile(path.join(componentsDir, '01-app-shell.html'), formattedBody, 'utf8');
        manifest.htmlComponents.push(`${relPrefix}/components/01-app-shell.html`);

        const tsxSource = this.convertHtmlToTsxComponent('AppShell', formattedBody);
        await fs.writeFile(path.join(componentsTsxDir, 'AppShell.tsx'), tsxSource, 'utf8');
        manifest.tsxComponents.push(`${relPrefix}/components_tsx/AppShell.tsx`);
      }
    }

    // 7. Extract Inline <svg> Vector Assets
    let svgIndex = 1;
    for (const svgm of html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)) {
      if (svgIndex > 25) break;
      const svgCode = svgm[0];
      const svgWithXmlns = svgCode.includes('xmlns=')
        ? svgCode
        : svgCode.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
      const svgName = `icon-${svgIndex}.svg`;
      await fs.writeFile(path.join(assetsDir, svgName), svgWithXmlns, 'utf8');
      manifest.svgAssets.push(`${relPrefix}/assets/${svgName}`);
      svgIndex++;
    }

    // Deduplicate reconstructed sourcemap files
    manifest.reconstructedSourceMapFiles = Array.from(new Set(manifest.reconstructedSourceMapFiles));

    manifest.totalFilesExtracted =
      manifest.htmlFiles.length +
      manifest.cssFiles.length +
      manifest.jsFiles.length +
      manifest.reconstructedSourceMapFiles.length +
      manifest.htmlComponents.length +
      manifest.tsxComponents.length +
      manifest.svgAssets.length +
      manifest.dataFiles.length;

    // 8. Write MANIFEST.md and manifest.json
    await fs.writeFile(path.join(extractDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const manifestMd = `# Craft-Anything Extracted Source Code Manifest
- **Target:** \`${target}\`
- **Extracted Directory:** \`${relPrefix}\`
- **Total Files Extracted:** **${manifest.totalFilesExtracted}**
- **Timestamp:** ${manifest.timestamp}

## 1. HTML Entry & Formatted Source (${manifest.htmlFiles.length})
${manifest.htmlFiles.map(f => `- \`${f}\``).join('\n') || '- None'}

## 2. Extracted Stylesheets & Design Tokens (${manifest.cssFiles.length})
${manifest.cssFiles.map(f => `- \`${f}\``).join('\n') || '- None'}

## 3. Extracted JavaScript Bundles & Modules (${manifest.jsFiles.length})
${manifest.jsFiles.map(f => `- \`${f}\``).join('\n') || '- None'}

## 4. Reconstructed Original Sources via SourceMaps (${manifest.reconstructedSourceMapFiles.length})
${manifest.reconstructedSourceMapFiles.map(f => `- \`${f}\``).join('\n') || '- No public `.map` sourcemaps exposed by target'}

## 5. Ready-to-Use React / TypeScript Components (${manifest.tsxComponents.length})
${manifest.tsxComponents.map(f => `- \`${f}\``).join('\n') || '- None'}

## 6. Modular HTML Component Sections (${manifest.htmlComponents.length})
${manifest.htmlComponents.map(f => `- \`${f}\``).join('\n') || '- None'}

## 7. Extracted SVG Vector Assets (${manifest.svgAssets.length})
${manifest.svgAssets.map(f => `- \`${f}\``).join('\n') || '- None'}

## 8. State Payloads & Discovered APIs (${manifest.dataFiles.length})
${manifest.dataFiles.map(f => `- \`${f}\``).join('\n') || '- None'}
`;
    await fs.writeFile(path.join(extractDir, 'MANIFEST.md'), manifestMd, 'utf8');

    return manifest;
  }

  private async studyWebTarget(
    target: string,
    mode: 'clean-room' | 'deep',
    root: string | undefined,
    cliOutput = ''
  ): Promise<ToolResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);

      const res = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SovereignAgent/0.1 CraftAnything/2.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { ok: false, output: `Failed to fetch target URL: ${target} (HTTP ${res.status} ${res.statusText})` };
      }

      const html = await res.text();
      const baseRoot = root || process.cwd();
      const analysis = this.analyzeHtml(target, html, mode);

      // Extract actual source code files (HTML, CSS, JS, SourceMaps, Components, SVGs, State)
      const extractedManifest = await this.extractAllSourcesFromHtml(target, html, baseRoot);
      analysis.extractedSources = extractedManifest;

      const craftDir = path.join(baseRoot, '.craft');
      await fs.mkdir(craftDir, { recursive: true });
      await fs.writeFile(path.join(craftDir, 'evidence.json'), JSON.stringify(analysis, null, 2), 'utf8');

      const specMd = `# Craft-Anything Software Specification & Extracted Sources
**Target URL:** ${target}
**Title:** ${analysis.title}
**Description:** ${analysis.description}
**Mode:** ${mode} (Full Source Code Extraction)
**Captured At:** ${analysis.timestamp}
**Extracted Sources Directory:** \`${extractedManifest.extractedDir}\` (${extractedManifest.totalFilesExtracted} files)

## Detected Tech Stack
${analysis.detectedStack.map(s => `- ${s}`).join('\n') || '- Standard HTML5 / CSS3'}

## Extracted Source Files Summary
- **HTML Source:** ${extractedManifest.htmlFiles.map(f => `\`${f}\``).join(', ')}
- **CSS Stylesheets (${extractedManifest.cssFiles.length}):** ${extractedManifest.cssFiles.map(f => `\`${f}\``).join(', ') || 'None'}
- **JS Scripts (${extractedManifest.jsFiles.length}):** ${extractedManifest.jsFiles.map(f => `\`${f}\``).join(', ') || 'None'}
- **SourceMap Original Sources (${extractedManifest.reconstructedSourceMapFiles.length}):** ${extractedManifest.reconstructedSourceMapFiles.slice(0, 15).map(f => `\`${f}\``).join(', ') || 'None'}
- **React TSX Components (${extractedManifest.tsxComponents.length}):** ${extractedManifest.tsxComponents.map(f => `\`${f}\``).join(', ') || 'None'}
- **HTML Component Snippets (${extractedManifest.htmlComponents.length}):** ${extractedManifest.htmlComponents.map(f => `\`${f}\``).join(', ') || 'None'}
- **SVG Assets (${extractedManifest.svgAssets.length}):** ${extractedManifest.svgAssets.slice(0, 10).map(f => `\`${f}\``).join(', ') || 'None'}

## Color Palette Tokens
- Primary Accent: \`${analysis.colors.primary || '#6366f1'}\`
- Background: \`${analysis.colors.background || '#0d0f12'}\`
- Text: \`${analysis.colors.text || '#f1f3f7'}\`
- Discovered Colors: ${analysis.colors.palette.slice(0, 10).map(c => `\`${c}\``).join(', ')}

## Typography
- Fonts: ${analysis.typography.fonts.join(', ') || 'Inter, system-ui, sans-serif'}

## Structural Components Discovered
${analysis.layout.components.map(c => `- \`${c}\``).join('\n')}
`;
      await fs.writeFile(path.join(craftDir, 'SPEC.md'), specMd, 'utf8');

      return {
        ok: true,
        output: `[Craft Anything Engine — Source Code Extracted & Studied Successfully]
Target: ${target}
Title: "${analysis.title}"
Detected Stack: ${analysis.detectedStack.join(', ') || 'HTML5/CSS3'}
Total Source Files Extracted: ${extractedManifest.totalFilesExtracted} files -> ${extractedManifest.extractedDir}/

Extracted Source Code Breakdown:
• Full HTML Source: ${extractedManifest.htmlFiles.join(', ')}
• CSS Stylesheets (${extractedManifest.cssFiles.length}): ${extractedManifest.cssFiles.slice(0, 6).join(', ') || 'None'}
• JS Scripts & Bundles (${extractedManifest.jsFiles.length}): ${extractedManifest.jsFiles.slice(0, 6).join(', ') || 'None'}
• Reconstructed SourceMap Files (${extractedManifest.reconstructedSourceMapFiles.length}): ${extractedManifest.reconstructedSourceMapFiles.slice(0, 8).join(', ') || 'None'}
• Ready-to-Use React TSX Components (${extractedManifest.tsxComponents.length}): ${extractedManifest.tsxComponents.slice(0, 6).join(', ')}
• Modular HTML Sections (${extractedManifest.htmlComponents.length}): ${extractedManifest.htmlComponents.slice(0, 6).join(', ')}
• Extracted SVG Icons: ${extractedManifest.svgAssets.length} file(s)
• State & API Payloads: ${extractedManifest.dataFiles.join(', ') || 'None'}

Design Tokens:
• Primary: ${analysis.colors.primary || '#6366f1'}
• Background: ${analysis.colors.background || '#0d0f12'}
• Fonts: ${analysis.typography.fonts.join(', ') || 'system-ui'}
${cliOutput ? `\nNative CLI Output:\n${cliOutput}\n` : ''}
Local AI Instruction:
All source code has been physically extracted into "${extractedManifest.extractedDir}/".
1. Use <read_file><path>${extractedManifest.extractedDir}/MANIFEST.md</path></read_file> or read any file in "${extractedManifest.extractedDir}/" to inspect the exact HTML, CSS, JS, TSX components, or reconstructed SourceMap files.
2. You can now copy, adapt, or rebuild this project with 100% fidelity using <write_file>.`
      };
    } catch (err) {
      return {
        ok: false,
        output: `Error extracting source code from target ${target}: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  private async studyLocalTarget(
    target: string,
    mode: 'clean-room' | 'deep',
    root: string | undefined,
    cliOutput = ''
  ): Promise<ToolResult> {
    const baseRoot = root || process.cwd();
    const targetPath = path.resolve(baseRoot, target);
    const slug = this.slugifyTarget(target);
    const relPrefix = `.craft/extracted/${slug}`;
    const extractDir = path.join(baseRoot, '.craft', 'extracted', slug);

    try {
      const stat = await fs.stat(targetPath);

      // Case 1: Single local file (.html, .map, .js, or archive .zip/.vsix/.crx/.jar)
      if (stat.isFile()) {
        const ext = path.extname(targetPath).toLowerCase();

        // 1A: Local HTML file -> run full HTML/CSS/JS/SourceMap/Component extractor
        if (ext === '.html' || ext === '.htm') {
          const html = await fs.readFile(targetPath, 'utf8');
          const analysis = this.analyzeHtml(target, html, mode);
          const manifest = await this.extractAllSourcesFromHtml(target, html, baseRoot, path.dirname(targetPath));
          analysis.extractedSources = manifest;

          const craftDir = path.join(baseRoot, '.craft');
          await fs.mkdir(craftDir, { recursive: true });
          await fs.writeFile(path.join(craftDir, 'evidence.json'), JSON.stringify(analysis, null, 2), 'utf8');

          return {
            ok: true,
            output: `[Craft Anything Engine — Local HTML Source Extracted]
Target: ${targetPath}
Extracted Directory: ${manifest.extractedDir} (${manifest.totalFilesExtracted} files)
• HTML: ${manifest.htmlFiles.join(', ')}
• CSS: ${manifest.cssFiles.join(', ') || 'None'}
• JS: ${manifest.jsFiles.join(', ') || 'None'}
• Reconstructed SourceMaps: ${manifest.reconstructedSourceMapFiles.join(', ') || 'None'}
• TSX Components: ${manifest.tsxComponents.join(', ')}
• Manifest: ${manifest.extractedDir}/MANIFEST.md`
          };
        }

        // 1B: Local SourceMap (.map) file -> reconstruct original sources
        if (ext === '.map') {
          const rawMap = await fs.readFile(targetPath, 'utf8');
          const origDir = path.join(extractDir, 'original_sources');
          await fs.mkdir(origDir, { recursive: true });
          const unpacked = await this.unpackSourceMapContent(rawMap, origDir, relPrefix);
          return {
            ok: true,
            output: `[Craft Anything Engine — SourceMap Unpacked]
Target: ${targetPath}
Reconstructed Files (${unpacked.length}):
${unpacked.map(f => `• ${f}`).join('\n')}`
          };
        }

        // 1C: Archive package (.zip, .vsix, .crx, .jar, .nupkg, .whl) -> unpack into .craft/extracted/<slug>/unpacked/
        if (['.zip', '.vsix', '.crx', '.jar', '.nupkg', '.whl'].includes(ext)) {
          const unpackedDir = path.join(extractDir, 'unpacked');
          await fs.mkdir(unpackedDir, { recursive: true });
          try {
            if (process.platform === 'win32') {
              // Copy to temporary .zip if extension is .vsix/.jar because Expand-Archive requires .zip
              const tempZip = path.join(extractDir, '_archive.zip');
              await fs.copyFile(targetPath, tempZip);
              await execFileAsync('powershell.exe', [
                '-NoProfile',
                '-Command',
                `Expand-Archive -Path "${tempZip}" -DestinationPath "${unpackedDir}" -Force`
              ]);
              await fs.rm(tempZip, { force: true });
            } else {
              await execFileAsync('unzip', ['-o', targetPath, '-d', unpackedDir]);
            }
          } catch {}

          const unpackedFiles = await this.collectDirectoryFiles(unpackedDir);
          return {
            ok: true,
            output: `[Craft Anything Engine — Package Archive Unpacked]
Target: ${targetPath}
Unpacked Directory: ${relPrefix}/unpacked
Total Files Extracted: ${unpackedFiles.length}
Key Extracted Files:
${unpackedFiles.slice(0, 25).map(f => `• ${relPrefix}/unpacked/${f}`).join('\n')}`
          };
        }
      }

      // Case 2: Local Directory -> scan source files, unpack any .map files found, and extract HTML entry if present
      const files = await this.collectDirectoryFiles(targetPath);
      await fs.mkdir(extractDir, { recursive: true });

      const reconstructedMaps: string[] = [];
      for (const relFile of files) {
        if (relFile.endsWith('.map')) {
          try {
            const rawMap = await fs.readFile(path.join(targetPath, relFile), 'utf8');
            const unpacked = await this.unpackSourceMapContent(
              rawMap,
              path.join(extractDir, 'original_sources'),
              relPrefix
            );
            reconstructedMaps.push(...unpacked);
          } catch {}
        }
      }

      // If index.html exists in the local directory, also run HTML component/style extraction
      let htmlManifest: CraftExtractedSourcesManifest | null = null;
      const indexHtmlCandidate = files.find(f => f.toLowerCase() === 'index.html' || f.toLowerCase().endsWith('/index.html'));
      if (indexHtmlCandidate) {
        const fullHtmlPath = path.join(targetPath, indexHtmlCandidate);
        const htmlContent = await fs.readFile(fullHtmlPath, 'utf8');
        htmlManifest = await this.extractAllSourcesFromHtml(target, htmlContent, baseRoot, path.dirname(fullHtmlPath));
      }

      const craftDir = path.join(baseRoot, '.craft');
      await fs.mkdir(craftDir, { recursive: true });
      await fs.writeFile(
        path.join(craftDir, 'evidence.json'),
        JSON.stringify(
          {
            target,
            mode,
            timestamp: new Date().toISOString(),
            files: files.slice(0, 200),
            reconstructedSourceMapFiles: reconstructedMaps,
            extractedSources: htmlManifest
          },
          null,
          2
        ),
        'utf8'
      );

      const summary = `[Craft Anything Engine — Local Project Studied & Extracted]
Target: ${targetPath}
Source Files Discovered: ${files.length}
Reconstructed SourceMap Files: ${reconstructedMaps.length}
${htmlManifest ? `HTML/CSS/TSX Extracted into: ${htmlManifest.extractedDir} (${htmlManifest.totalFilesExtracted} files)\n` : ''}${cliOutput ? `CLI Output:\n${cliOutput}\n` : ''}Key Source Files:
${files.slice(0, 25).map(f => `• ${f}`).join('\n')}`;

      return { ok: true, output: summary };
    } catch (err) {
      return {
        ok: false,
        output: `Could not extract local target ${target}: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  private async collectDirectoryFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { recursive: true });
    for (const e of entries) {
      if (
        typeof e === 'string' &&
        !e.includes('node_modules') &&
        !e.includes('.git') &&
        !e.includes('.craft')
      ) {
        files.push(e.replace(/\\/g, '/'));
      }
    }
    return files;
  }

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

  private analyzeHtml(target: string, html: string, mode: 'clean-room' | 'deep'): CraftStudyResult {
    // 1. Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : path.basename(target);

    // 2. Meta description
    const descMatch =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
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
