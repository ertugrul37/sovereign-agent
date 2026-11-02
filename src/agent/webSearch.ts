import { ToolResult } from './tools';

export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(str: string): string {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * Executes a privacy-preserving web search (DuckDuckGo HTML or custom local SearXNG URL)
 * without sending any workspace files or code context.
 */
export async function performWebSearch(
  query: string,
  signal: AbortSignal,
  customEndpoint = ''
): Promise<ToolResult> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return { ok: false, output: 'Empty search query.' };
  }

  try {
    // 1. Optional custom/local SearXNG JSON endpoint (e.g. http://localhost:8888/search?q={query}&format=json)
    if (customEndpoint.trim()) {
      const targetUrl = customEndpoint.includes('{query}')
        ? customEndpoint.replace('{query}', encodeURIComponent(cleanQuery))
        : `${customEndpoint.replace(/\/+$/, '')}?q=${encodeURIComponent(cleanQuery)}&format=json`;
      const res = await fetch(targetUrl, { signal });
      if (!res.ok) {
        return { ok: false, output: `Search endpoint returned HTTP ${res.status}.` };
      }
      const data = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      const items: WebSearchItem[] = (data.results ?? []).slice(0, 6).map((r) => ({
        title: (r.title ?? 'Result').trim(),
        url: (r.url ?? '').trim(),
        snippet: (r.content ?? '').trim()
      }));
      return formatSearchResults(cleanQuery, items);
    }

    // 2. Built-in zero-config DuckDuckGo HTML search
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8'
      },
      signal
    });

    if (!response.ok) {
      return { ok: false, output: `Web search failed with HTTP ${response.status}.` };
    }

    const html = await response.text();
    const blocks = html.split(/class="result\s+results_links/i).slice(1, 8);
    const items: WebSearchItem[] = [];

    for (const block of blocks) {
      const aMatch = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      if (!aMatch) continue;

      let href = decodeEntities(aMatch[1]);
      const uddg = /[?&]uddg=([^&]+)/.exec(href);
      if (uddg) {
        try {
          href = decodeURIComponent(uddg[1]);
        } catch {
          // keep original href
        }
      }
      if (!href.startsWith('http://') && !href.startsWith('https://')) {
        continue;
      }

      const title = stripTags(aMatch[2]);
      const sMatch =
        /class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
      const snippet = stripTags((sMatch && (sMatch[1] || sMatch[2])) || '');

      items.push({ title, url: href, snippet });
      if (items.length >= 6) break;
    }

    return formatSearchResults(cleanQuery, items);
  } catch (err) {
    return {
      ok: false,
      output: `Web search error: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

function formatSearchResults(query: string, items: WebSearchItem[]): ToolResult {
  if (items.length === 0) {
    return { ok: true, output: `No web search results found for "${query}".` };
  }
  const formatted = items
    .map((item, idx) => `[${idx + 1}] ${item.title}\nURL: ${item.url}\nSnippet: ${item.snippet || '(no snippet)'}`)
    .join('\n\n');
  return { ok: true, output: formatted };
}
