import * as fs from 'fs/promises';
import * as path from 'path';

export interface HallucinationIssue {
  type: 'missing_module' | 'missing_symbol' | 'syntax_warning';
  line: number;
  importedSource: string;
  symbol?: string;
  suggestion?: string;
  message: string;
}

export interface AntiHallucinationResult {
  valid: boolean;
  issues: HallucinationIssue[];
  warningNotice?: string;
}

const COMMON_JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', ''];

/**
 * Validates generated code content against the workspace AST and file system
 * to detect hallucinated local imports, non-existent files, and fake exported symbols
 * before saving or during agent tool execution.
 */
export async function validateCodeAgainstWorkspace(
  relTargetFile: string,
  content: string,
  root: string | undefined
): Promise<AntiHallucinationResult> {
  if (!root || !content) {
    return { valid: true, issues: [] };
  }

  const issues: HallucinationIssue[] = [];
  const lines = content.split(/\r?\n/);
  const targetDir = path.dirname(path.resolve(root, relTargetFile));
  const ext = path.extname(relTargetFile).toLowerCase();

  // 1. Check TypeScript / JavaScript / JSX / TSX
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    const importRegex = /(?:import\s+(?:(?:(?:\*\s+as\s+\w+)|(?:[\w$]+)|(?:\{\s*([\w\s,$,]+)\s*\}))\s+from\s+['"]([^'"]+)['"])|(?:(?:const|let|var)\s+(?:\{([\w\s,$,]+)\}|[\w$]+)\s*=\s*require\(['"]([^'"]+)['"]\)))/g;
    
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (/^\s*\/\//.test(line)) continue; // skip single-line comments

      let match: RegExpExecArray | null;
      importRegex.lastIndex = 0;
      while ((match = importRegex.exec(line)) !== null) {
        const namedSymbols = (match[1] || match[3] || '')
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
          .filter((s) => s.length > 0 && s !== 'type');
        const importSrc = match[2] || match[4] || '';

        // Only check relative local imports (starting with ./ or ../)
        if (!importSrc.startsWith('.')) continue;

        const resolvedBase = path.resolve(targetDir, importSrc);
        let foundFile: string | null = null;

        for (const extTry of COMMON_JS_EXTS) {
          const cand = resolvedBase + extTry;
          try {
            const stat = await fs.stat(cand);
            if (stat.isFile()) {
              foundFile = cand;
              break;
            }
          } catch {}
        }

        // Try directory index
        if (!foundFile) {
          for (const extTry of ['.ts', '.tsx', '.js', '.jsx']) {
            const cand = path.join(resolvedBase, 'index' + extTry);
            try {
              const stat = await fs.stat(cand);
              if (stat.isFile()) {
                foundFile = cand;
                break;
              }
            } catch {}
          }
        }

        if (!foundFile) {
          // Find closest matching file in targetDir or its subfolders
          let suggestion: string | undefined;
          try {
            const baseName = path.basename(importSrc).toLowerCase();
            const parentDir = path.dirname(resolvedBase);
            const parentEntries = await fs.readdir(parentDir).catch(() => []);
            const close = parentEntries.find((e) => e.toLowerCase().includes(baseName) || baseName.includes(e.toLowerCase().split('.')[0]));
            if (close) {
              suggestion = `./${close}`;
            }
          } catch {}

          issues.push({
            type: 'missing_module',
            line: lineIdx + 1,
            importedSource: importSrc,
            suggestion,
            message: `Import from non-existent local file '${importSrc}' (resolved to ${path.relative(root, resolvedBase)}).${suggestion ? ` Did you mean '${suggestion}'?` : ''}`
          });
        } else if (namedSymbols.length > 0) {
          // Check if exported symbols actually exist in foundFile
          try {
            const targetContent = await fs.readFile(foundFile, 'utf8');
            for (const sym of namedSymbols) {
              if (sym === 'default') continue;
              const exportPattern = new RegExp(`\\bexport\\s+(?:(?:default\\s+)?(?:const|let|var|function|class|interface|type|enum)\\s+)?${sym}\\b|\\bexport\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}`, 'm');
              if (!exportPattern.test(targetContent)) {
                issues.push({
                  type: 'missing_symbol',
                  line: lineIdx + 1,
                  importedSource: importSrc,
                  symbol: sym,
                  message: `Symbol '${sym}' is imported from '${importSrc}', but '${path.basename(foundFile)}' does not appear to export '${sym}'.`
                });
              }
            }
          } catch {}
        }
      }
    }
  }

  // 2. Check Python
  if (ext === '.py') {
    const pyImportRegex = /(?:from\s+(\.+[\w.]+)\s+import\s+([\w\s,]+)|import\s+(\.+[\w.]+))/g;
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (/^\s*#/.test(line)) continue;

      let match: RegExpExecArray | null;
      pyImportRegex.lastIndex = 0;
      while ((match = pyImportRegex.exec(line)) !== null) {
        const importSrc = match[1] || match[3];
        if (!importSrc || !importSrc.startsWith('.')) continue;

        // Python relative import
        const dots = importSrc.match(/^\.+/)?.[0].length || 1;
        const sub = importSrc.slice(dots).replace(/\./g, '/');
        let currentDir = targetDir;
        for (let d = 1; d < dots; d++) {
          currentDir = path.dirname(currentDir);
        }
        const pyFile = path.resolve(currentDir, sub ? sub + '.py' : '__init__.py');
        const pyDirInit = path.resolve(currentDir, sub, '__init__.py');

        let exists = false;
        try {
          const s1 = await fs.stat(pyFile);
          if (s1.isFile()) exists = true;
        } catch {}
        if (!exists) {
          try {
            const s2 = await fs.stat(pyDirInit);
            if (s2.isFile()) exists = true;
          } catch {}
        }

        if (!exists) {
          issues.push({
            type: 'missing_module',
            line: lineIdx + 1,
            importedSource: importSrc,
            message: `Python relative import '${importSrc}' could not be resolved to an existing module in the workspace.`
          });
        }
      }
    }
  }

  const valid = issues.length === 0;
  let warningNotice: string | undefined;
  if (!valid) {
    warningNotice = [
      `🛡️ [Anti-Hallucination Guard Warning for ${relTargetFile}]:`,
      ...issues.map((iss) => `  - Line ${iss.line}: ${iss.message}`)
    ].join('\n');
  }

  return { valid, issues, warningNotice };
}

