import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { applyPatch } from 'diff';
import TurndownService from 'turndown';
import { getConfig } from './config';
import { memorySave, memoryRead, memoryList, memoryDelete } from './memory';
import { skillList, skillLoad, skillSave, skillDelete } from './skill';

const execAsync = promisify(exec);
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  bulletListMarker: '-',
  hr: '---',
});

// Drop <img> elements that embed data URIs (base64/svg data blobs) — they
// produce enormous markdown like ![alt](data:image/svg+xml;base64,...).
turndown.addRule('dropDataImages', {
  filter: (node: any) => node.nodeName === 'IMG' && /^data:/i.test(node.getAttribute('src') || ''),
  replacement: () => '',
});

// Strip any remaining markdown image/link references to data: URIs.
function stripDataUris(markdown: string): string {
  return markdown
    .replace(/!?\[[^\]]*\]\(data:[^)]*\)/gi, '')
    .replace(/data:(?:image|audio|video|font)\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '');
}

function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      regexStr += '.*';
    } else if (c === '?') {
      regexStr += '.';
    } else if (c === '{') {
      i++;
      let alternatives = '';
      let depth = 1;
      while (i < pattern.length && depth > 0) {
        if (pattern[i] === '}') depth--;
        else if (pattern[i] === '{') depth++;
        if (depth > 0) alternatives += pattern[i];
        i++;
      }
      const parts = alternatives.split(',').map(p => {
        let s = '';
        for (const ch of p.trim()) {
          if (ch === '*') s += '.*';
          else if (ch === '?') s += '.';
          else if ('.+^${}()|[\\]'.includes(ch)) s += '\\' + ch;
          else s += ch;
        }
        return s;
      });
      regexStr += '(' + parts.join('|') + ')';
    } else if ('.+^${}()|[\\]'.includes(c)) {
      regexStr += '\\' + c;
    } else {
      regexStr += c;
    }
    i++;
  }
  return new RegExp('^' + regexStr + '$');
}

const tempOutputDir = path.join(os.tmpdir(), 'yukiweb-outputs');

function ensureTempDir(): string {
  if (!fs.existsSync(tempOutputDir)) {
    fs.mkdirSync(tempOutputDir, { recursive: true });
  }
  return tempOutputDir;
}

function saveFullOutput(content: string, suffix: string): string {
  const dir = ensureTempDir();
  const filePath = path.join(dir, `output_${Date.now()}_${suffix}.txt`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function truncateOutput(content: string, maxLines: number, label: string): string {
  if (maxLines < 0) return content;
  const suffix = label.replace(/[^a-z0-9]/gi, '_').slice(0, 20);
  // Byte-size guard: if content exceeds 100KB, save and truncate even if it's one long line
  if (content.length > 100 * 1024) {
    const savedPath = saveFullOutput(content, suffix);
    return `[Output is ${(content.length / 1024).toFixed(0)}KB but the maximum is 100KB. Full output saved to: ${savedPath}. Use read(..., offset, limit) where offset and limit are byte numbers to page through it.]`;
  }
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  const savedPath = saveFullOutput(content, suffix);
  const truncated = lines.slice(0, maxLines).join('\n');
  return `${truncated}\n\n[Output truncated at ${maxLines} lines. Full output saved to: ${savedPath}. Use read(..., offset, limit) where offset and limit are line numbers to page through it.]`;
}

function stripHTML(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAccessibilityTree(html: string): string {
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const lines: string[] = [];
  const I = '  ';

  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    lines.push(`# ${titleMatch[1].trim()}\n`);
  }

  for (const [tag, role] of Object.entries({ header: 'banner', nav: 'navigation', main: 'main', aside: 'complementary', footer: 'contentinfo', article: 'article', section: 'region', form: 'form' })) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      const al = m[0].match(/aria-label=["']([^"']*)["']/i);
      lines.push(`${I}[landmark] ${role}${al ? ` "${al[1]}"` : ''}`);
    }
  }

  for (let i = 1; i <= 6; i++) {
    const re = new RegExp(`<h${i}[^>]*>([\s\S]*?)<\\/h${i}>`, 'gi');
    let m;
    while ((m = re.exec(cleaned)) !== null) {
      const t = m[1].replace(/<[^>]+>/g, '').trim();
      if (t) lines.push(`${I.repeat(i)}h${i}: ${t}`);
    }
  }

  const linkRe = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(cleaned)) !== null) {
    const t = m[2].replace(/<[^>]+>/g, '').trim();
    if (t && !m[1].startsWith('#') && !t.startsWith('#')) lines.push(`${I}[link] "${t}" -> ${m[1]}`);
  }

  const btnRe = /<(?:button|input)\b[^>]*type=["']?button["']?[^>]*value=["']([^"']*)["'][^>]*\/?>/gi;
  while ((m = btnRe.exec(cleaned)) !== null) lines.push(`${I}[button] "${m[1]}"`);

  const btnTextRe = /<(?:button)[^>]*>([\s\S]*?)<\/button>/gi;
  while ((m = btnTextRe.exec(cleaned)) !== null) {
    const t = m[1].replace(/<[^>]+>/g, '').trim();
    if (t) lines.push(`${I}[button] "${t}"`);
  }

  const inputRe = /<(?:input|textarea|select)\b[^>]*>/gi;
  while ((m = inputRe.exec(cleaned)) !== null) {
    const tm = m[0].match(/type=["']([^"']*)["']/i);
    const nm = m[0].match(/name=["']([^"']*)["']/i);
    const pm = m[0].match(/placeholder=["']([^"']*)["']/i);
    lines.push(`${I}[input] type=${tm ? tm[1] : 'text'}${nm ? ` name="${nm[1]}"` : ''}${pm ? ` placeholder="${pm[1]}"` : ''}`);
  }

  const seenImages = new Set<string>();
  for (const re of [/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, /<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi]) {
    while ((m = re.exec(cleaned)) !== null) {
      const src = m[2] || m[1];
      const alt = m[1] || m[2];
      if (!seenImages.has(src)) {
        seenImages.add(src);
        lines.push(`${I}[image] alt="${alt || ''}" src=${src.substring(0, 80)}`);
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : stripHTML(html).substring(0, 5000);
}

export async function toolRead(filePath: string, offset?: number, limit?: number): Promise<string> {
  try {
    const absPath = path.resolve(filePath);
    const stats = fs.statSync(absPath);

    if (stats.isDirectory()) {
      const entries = fs.readdirSync(absPath, { withFileTypes: true });
      const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return lines.join('\n');
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');

    if (offset !== undefined || limit !== undefined) {
      const start = offset !== undefined ? Math.max(0, offset) : 0;
      const count = limit !== undefined ? Math.max(1, limit) : lines.length;
      const slice = lines.slice(start, start + count);
      const numbered = slice.map((line, i) => `${start + i + 1}: ${line}`);
      const end = Math.min(start + count, lines.length);
      return numbered.join('\n') + `\n\n[Showing lines ${start + 1}-${end} of ${lines.length}]`;
    }

    const maxLines = getConfig().maxToolOutputLines || 20;
    const numbered = lines.map((line, i) => `${i + 1}: ${line}`);
    const joined = numbered.join('\n');
    return truncateOutput(joined, maxLines, `file: ${path.basename(absPath)}`);
  } catch (err: any) {
    return `Error reading file: ${err.message}`;
  }
}

export async function toolWrite(
  filePath: string,
  content: string,
): Promise<string> {
  try {
    const absPath = path.resolve(filePath);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, content, 'utf-8');
    return `File written successfully: ${absPath}`;
  } catch (err: any) {
    return `Error writing file: ${err.message}`;
  }
}

export async function toolEditFile(filePath: string, oldString: string, newString: string): Promise<string> {
  try {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      return `Error: file not found: ${absPath}`;
    }
    const content = fs.readFileSync(absPath, 'utf-8');
    const idx = content.indexOf(oldString);
    if (idx === -1) {
      return `Error: oldString not found in ${absPath}`;
    }
    const updated = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
    fs.writeFileSync(absPath, updated, 'utf-8');
    return `File updated: ${absPath}`;
  } catch (err: any) {
    return `Error editing file: ${err.message}`;
  }
}

export async function toolPatchFile(filePath: string, patch: string): Promise<string> {
  try {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      return `Error: file not found: ${absPath}`;
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const result = applyPatch(content, patch);

    if (typeof result !== 'string') {
      return 'Error: patch did not apply cleanly. Check that the diff format is correct and context lines match.';
    }

    fs.writeFileSync(absPath, result, 'utf-8');
    return `Patch applied successfully: ${absPath}`;
  } catch (err: any) {
    return `Error applying patch: ${err.message}`;
  }
}

export async function toolGlob(pattern: string, rootDir?: string): Promise<string> {
  try {
    const searchDir = rootDir ? path.resolve(rootDir) : process.cwd();
    const results: string[] = [];

    function walk(currentDir: string, patternParts: string[], partIndex: number): void {
      if (partIndex >= patternParts.length) {
        results.push(currentDir);
        return;
      }

      const part = patternParts[partIndex];
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      if (part === '**') {
        for (const entry of entries) {
          const entryPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            walk(entryPath, patternParts, partIndex);
            walk(entryPath, patternParts, partIndex + 1);
          }
        }
        return;
      }

      const regex = new RegExp('^' + part.replace(/\./g, '\\.').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');

      for (const entry of entries) {
        if (entry.name === '.' || entry.name === '..') continue;
        if (regex.test(entry.name)) {
          const entryPath = path.join(currentDir, entry.name);
          if (part.includes('*') || part.includes('?')) {
            if (partIndex === patternParts.length - 1) {
              results.push(entryPath);
            } else {
              walk(entryPath, patternParts, partIndex + 1);
            }
          } else if (entry.isDirectory() && partIndex < patternParts.length - 1) {
            walk(entryPath, patternParts, partIndex + 1);
          } else if (!entry.isDirectory() || partIndex === patternParts.length - 1) {
            results.push(entryPath);
          }
        }
      }
    }

    const parts = pattern.split('/');
    walk(searchDir, parts, 0);

    if (results.length === 0) return 'No files found.';
    return results.sort().join('\n');
  } catch (err: any) {
    return `Error globbing: ${err.message}`;
  }
}

export async function toolGrep(
  pattern: string,
  rootDir?: string,
  include?: string,
): Promise<string> {
  try {
    const searchDir = rootDir ? path.resolve(rootDir) : process.cwd();
    const regex = new RegExp(pattern);
    const includeRegex = include ? globToRegex(include) : null;
    const results: string[] = [];

    function walk(currentDir: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.name === '.' || entry.name === '..') continue;
        if (entry.name === 'node_modules') continue;
        if (entry.name === '.git') continue;

        const entryPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (!includeRegex || includeRegex.test(entry.name)) {
          try {
            const content = fs.readFileSync(entryPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push(`${entryPath}:${i + 1}: ${lines[i]}`);
              }
            }
          } catch {
            // Skip binary files
          }
        }
      }
    }

    walk(searchDir);

    if (results.length === 0) return 'No matches found.';
    return results.join('\n');
  } catch (err: any) {
    return `Error grepping: ${err.message}`;
  }
}

export async function toolShell(command: string, cwd?: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd || process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    const output = stdout || '(no output)';
    const full = stderr ? `${output}\n\nSTDERR:\n${stderr}` : output;
    const maxLines = getConfig().maxToolOutputLines || 20;
    return truncateOutput(full, maxLines, 'shell output');
  } catch (err: any) {
    return `Command failed:\n${err.message}`;
  }
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchDuckDuckGo(query: string, numResults: number = 8): Promise<SearchResult[]> {
  const response = await fetch('https://html.duckduckgo.com/html', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      Accept: 'text/html',
      Referer: 'https://duckduckgo.com/',
    },
    body: new URLSearchParams({ q: query }),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned status ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const links: Array<{ url: string; title: string }> = [];
  let m;
  while ((m = resultRegex.exec(html)) !== null) {
    const linkUrl = decodeURIComponent(m[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').replace(/&rut=.*$/, ''));
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    if (title && linkUrl) links.push({ url: linkUrl, title });
  }

  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
  }

  for (let i = 0; i < Math.min(links.length, numResults); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || '',
    });
  }

  return results;
}

async function searchSerper(query: string, numResults: number = 8): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error('SERPER_API_KEY is not set. Add it to a .env file in the project root.');
  }
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: numResults }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Serper returned status ${response.status}`);
  }

  const data = await response.json();
  const results: SearchResult[] = [];

  for (const item of (data.organic || []).slice(0, numResults)) {
    results.push({
      title: item.title || '',
      url: item.link || '',
      snippet: item.snippet || '',
    });
  }

  return results;
}

function formatSearchResults(results: SearchResult[], query: string): string {
  if (results.length === 0) return `No search results found for "${query}".`;
  const lines = results.map((r, i) =>
    `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
  );
  return `Search results for "${query}":\n\n${lines.join('\n\n')}`;
}

export async function toolWebSearch(query: string, numResults?: number): Promise<string> {
  if (!query || !query.trim()) return 'Please provide a search query.';

  const count = Math.min(Math.max(numResults || 20, 1), 50);

  try {
    const results = await searchSerper(query, count);
    return formatSearchResults(results, query);
  } catch (err: any) {
    try {
      const results = await searchDuckDuckGo(query, 20);
      return formatSearchResults(results, query);
    } catch {
      return `Web search error: ${err.message}`;
    }
  }
}

function buildBrowserHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Chromium";v="132", "Google Chrome";v="132"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
  };
}

export async function toolWebFetch(url: string, format?: string): Promise<string> {
  try {
    new URL(url);
  } catch {
    return `Invalid URL: ${url}`;
  }

  try {
    const response = await fetch(url, {
      headers: buildBrowserHeaders(),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return `Fetch failed with status ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get('content-type') || '';
    const isBinary = /^(application\/(pdf|zip|gzip|x-zip|x-tar|x-gzip|octet-stream)|image\/|audio\/|video\/)/i.test(contentType);

    const html = await response.text();
    const maxInlineBytes = (getConfig().webFetchMaxInlineKB || 50) * 1024;

    // Detect binary content that wasn't caught by Content-Type (PDF magic bytes, null bytes)
    const detectedBinary = /^%PDF-/i.test(html.trim()) || html.indexOf('\x00') !== -1;

    // Save to disk if binary or too large — no inline preview
    if (isBinary || detectedBinary) {
      const urlExt = url.split('.').pop()?.split('?')[0]?.toLowerCase() || 'bin';
      const savedPath = saveFullOutput(html, `fetch_${urlExt || 'bin'}`);
      const sizeLabel = contentType || `application/${urlExt || 'octet-stream'}`;
      return `Content saved to: ${savedPath} (${sizeLabel}). Binary file — your other tools may not be able to read this.`;
    }

    if (html.length > maxInlineBytes) {
      // Process to markdown before saving so reads return clean text, not raw HTML
      const cleaned = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<link[^>]*>/gi, '')
        .replace(/<meta[^>]*>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
      const markdown = stripDataUris(turndown.turndown(cleaned) || html);
      const savedPath = saveFullOutput(markdown, 'fetch_txt');
      const totalLines = markdown.split('\n').length;
      const totalKB = (markdown.length / 1024).toFixed(0);
      return `Content saved to: ${savedPath} (${totalKB}KB, ${totalLines} lines). Start with read offset=0 limit=25 to preview, then request more if needed.`;
    }

    const mode = format || 'markdown';
    const maxLines = getConfig().maxToolOutputLines || 20;

    if (mode === 'raw') {
      return truncateOutput(html, maxLines, `fetch: ${url}`);
    }

    if (mode === 'accessibility-tree') {
      return truncateOutput(buildAccessibilityTree(html), maxLines, `a11y tree: ${url}`);
    }

    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<link[^>]*>/gi, '')
      .replace(/<meta[^>]*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    const markdown = stripDataUris(turndown.turndown(cleaned));
    if (!markdown.trim()) {
      return 'No readable content found on the page.';
    }
    return truncateOutput(markdown, maxLines, `fetch: ${url}`);
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return `Fetch timed out after 15 seconds for: ${url}`;
    }
    return `Web fetch error: ${err.message}`;
  }
}

export const tools = {
  read: toolRead,
  write: toolWrite,
  editFile: toolEditFile,
  patchFile: toolPatchFile,
  glob: toolGlob,
  grep: toolGrep,
  shell: toolShell,
  webSearch: toolWebSearch,
  webFetch: toolWebFetch,
  memorySave,
  memoryRead,
  memoryList,
  memoryDelete,
  skillList,
  skillLoad,
  skillSave,
  skillDelete,
};

export const planToolNames = ['plan_create', 'plan_update', 'plan_get', 'plan_remove'];

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read the contents of a file or directory listing. Output is truncated to the configured max lines (see environment context). Full output is saved to a temp file for later access.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file or directory' },
          offset: { type: 'number', description: 'Number of lines to skip from the start (0-indexed)' },
          limit: { type: 'number', description: 'Maximum number of lines to read' },
        },
        required: ['filePath', 'offset', 'limit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['filePath', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Performs a targeted string replacement within a file. Searches for a specific substring and replaces it with new content. Best for simple, non-structural text updates where the exact match is known.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file to edit' },
          oldString: { type: 'string', description: 'The exact text to search for and replace' },
          newString: { type: 'string', description: 'The replacement text' },
        },
        required: ['filePath', 'oldString', 'newString'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch',
      description: 'Applies a unified diff hunk to a target file using surrounding context for accurate location. Reliable for structural changes, multi-line edits, and complex refactoring without a full file rewrite.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the file to patch' },
          patch: { type: 'string', description: 'Unified diff content with @@ -line,count +line,count @@ headers. Context lines start with space, removals with -, additions with +.' },
        },
        required: ['filePath', 'patch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files matching a glob pattern',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to match' },
          rootDir: { type: 'string', description: 'Root directory to search in' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents using regex',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          rootDir: { type: 'string', description: 'Root directory to search in' },
          include: { type: 'string', description: 'File pattern to include (e.g. "*.ts")' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Execute a shell command. Output is truncated to the configured max lines (see environment context). Full output is saved to a temp file for later access. Use cwd to set the working directory (defaults to server CWD).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Navigate a live browser to a URL for interactive use (clicks, scrolling, JS). Only use when you need to interact with a page. Do NOT use for simple content retrieval — use web_search instead.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the page',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to click' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_fill',
      description: 'Fill a form field on the page',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input field' },
          value: { type: 'string', description: 'Value to fill' },
        },
        required: ['selector', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_content',
      description: 'Get the text content of the current page',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_links',
      description: 'Get all links on the current page',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_screenshot',
      description: 'Take a screenshot of the desktop',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_click',
      description: 'Click at screen coordinates',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate' },
        },
        required: ['x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_type',
      description: 'Type text on the keyboard',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'DEFAULT web search — always use this first for any online question. Returns titles, URLs, and snippets via Parallel Search API. Do NOT use web_fetch or browser_navigate unless search results are insufficient.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          numResults: { type: 'number', description: 'Number of results to return (1-50, default 8)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch full content of a URL. Binary files are saved to disk (unreadable by tools). Large text content (over 50KB) is saved to disk as clean markdown — use read on the returned path with offset=0 limit=10 for a preview. Small text content returns inline with automatic truncation.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
          format: { type: 'string', enum: ['markdown', 'raw', 'accessibility-tree'], description: 'Output format: markdown (default), raw HTML, or accessibility tree' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_move',
      description: 'Move the mouse cursor to screen coordinates without clicking',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate' },
        },
        required: ['x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_drag',
      description: 'Click and drag from current position by offset',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X offset to drag by' },
          y: { type: 'number', description: 'Y offset to drag by' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default left)' },
        },
        required: ['x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_scroll',
      description: 'Scroll the mouse wheel',
      parameters: {
        type: 'object',
        properties: {
          clicks: { type: 'number', description: 'Number of scroll clicks (positive = up, negative = down)' },
        },
        required: ['clicks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_keypress',
      description: 'Press a single keyboard key or key combination (e.g. "enter", "escape", "alt+tab", "ctrl+c", "win+d")',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name or combination with "+" separator (e.g. "enter", "alt+tab", "ctrl+shift+esc")' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_viewport',
      description: 'Get the screen dimensions (width and height). Use this first before snapshot_region to know the coordinate space.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'desktop_snapshot_region',
      description: 'Capture a screenshot of a specific rectangular region of the screen. Use after desktop_viewport to target a specific area. The image is sent back for you to analyze.',
      parameters: {
        type: 'object',
        properties: {
          left: { type: 'number', description: 'X coordinate of the left edge of the region' },
          top: { type: 'number', description: 'Y coordinate of the top edge of the region' },
          width: { type: 'number', description: 'Width of the region in pixels' },
          height: { type: 'number', description: 'Height of the region in pixels' },
        },
        required: ['left', 'top', 'width', 'height'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_save',
      description: 'Save a memory (key-value pair) that persists across sessions. Use this to remember user preferences, facts, or important information.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Memory key name' },
          value: { type: 'string', description: 'Memory value content' },
        },
        required: ['key', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_read',
      description: 'Read a saved memory by key name.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Memory key to retrieve' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_list',
      description: 'List all saved memory keys.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_delete',
      description: 'Delete a saved memory by key name.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Memory key to delete' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_list',
      description: 'List all installed skill names.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_load',
      description: 'Load a skill by name and return its full instructions.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name to load' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_save',
      description: 'Create or update a skill with name, description, and instructions.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name' },
          description: { type: 'string', description: 'Brief description of what the skill does' },
          instructions: { type: 'string', description: 'Detailed instructions for executing the skill' },
        },
        required: ['name', 'description', 'instructions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skill_delete',
      description: 'Delete a saved skill by name',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name to delete' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_create',
      description: 'Create a new plan with a title and list of steps. Use this before starting any multistep task with 3+ sequential steps.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title for the plan' },
          steps: { type: 'array', items: { type: 'string' }, description: 'Ordered list of steps to complete' },
        },
        required: ['title', 'steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_update',
      description: 'Mark a plan step as completed, in_progress, pending, or cancelled.',
      parameters: {
        type: 'object',
        properties: {
          stepIndex: { type: 'number', description: 'Index of the step to update (0-based)' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], description: 'New status for the step' },
        },
        required: ['stepIndex', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_get',
      description: 'Get the current plan with all steps and their statuses.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_remove',
      description: 'Remove the current plan. Use this once all steps are completed or if the plan is no longer needed.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attachment_list',
      description: 'List the files attached to the current user message. Returns index, filename, type, and size for each attachment. Use save_attached_file with the index to save one to disk.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_attached_file',
      description: 'Save an attached file (a pasted image or a dropped file) from the current user message to the working directory on disk. Provide the attachment index from attachment_list and an optional target filename. Use this to download attached files to the project directory.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: '0-based index of the attachment (see attachment_list)' },
          filename: { type: 'string', description: 'Optional target filename in the working directory (defaults to the original name)' },
        },
        required: ['index'],
      },
    },
  },
];

export const toolNames = toolDefinitions.map(t => t.function.name);

// Returns the list of builtin tool names (same as toolNames, exported for tools-api.ts)
export function getBuiltinToolNames(): string[] {
  return toolNames;
}
