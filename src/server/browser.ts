import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { getConfig } from './config';

export class BrowserAutomation {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async initialize(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: false,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        '--window-size=1920,1080',
      ],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    this.page = await this.context.newPage();
  }

  async navigate(url: string): Promise<string> {
    if (!this.page) await this.initialize();

    try {
      await this.page!.goto(url);
      const title = await this.page!.title();
      const currentUrl = this.page!.url();
      return `Navigated to ${currentUrl} - Page title: ${title}`;
    } catch (err: any) {
      return `Navigation error: ${err.message}`;
    }
  }

  async click(selector: string): Promise<string> {
    if (!this.page) await this.initialize();

    try {
      await this.page!.click(selector);
      return `Clicked element: ${selector}`;
    } catch (err: any) {
      return `Click error: ${err.message}`;
    }
  }

  async fill(selector: string, value: string): Promise<string> {
    if (!this.page) await this.initialize();

    try {
      await this.page!.fill(selector, value);
      return `Filled ${selector} with: ${value}`;
    } catch (err: any) {
      return `Fill error: ${err.message}`;
    }
  }

  async screenshot(): Promise<string> {
    if (!this.page) await this.initialize();

    try {
      const buffer = await this.page!.screenshot();
      return buffer.toString('base64');
    } catch (err: any) {
      return `Screenshot error: ${err.message}`;
    }
  }

  async getPageContent(): Promise<string> {
    if (!this.page) await this.initialize();

    try {
      const content = await this.page!.content();
      const text = await this.page!.textContent('body');
      return text?.substring(0, 5000) || content.substring(0, 5000);
    } catch (err: any) {
      return `Content error: ${err.message}`;
    }
  }

  async getLinks(): Promise<string> {
    if (!this.page) await this.initialize();

    try {
      const links = await this.page!.$$('a[href]');
      const result = await Promise.all(
        links.map(async (el) => {
          const href = await el.getAttribute('href');
          const text = await el.textContent();
          return `${text?.trim() || '(no text)'} -> ${href}`;
        }),
      );
      return result.slice(0, 50).join('\n');
    } catch (err: any) {
      return `Links error: ${err.message}`;
    }
  }

  async evaluate(script: string): Promise<string> {
    if (!this.page) await this.initialize();

    try {
      const result = await this.page!.evaluate(script);
      return JSON.stringify(result);
    } catch (err: any) {
      return `Evaluate error: ${err.message}`;
    }
  }

  /**
   * Extract the browser accessibility tree (AXTree) — much richer than textContent,
   * especially for React/SPA apps where role, name, and state are exposed.
   */
  async getAccessibilityTree(): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const tree = await (this.page! as any).accessibility.snapshot({
        interesting_only: true,
      });
      if (!tree) return 'No accessibility snapshot available.';
      const formatted = this.formatAXTree(tree);
      return formatted.substring(0, 12000);
    } catch (err: any) {
      return `AXTree error: ${err.message}`;
    }
  }

  private formatAXTree(node: any, indent: number = 0): string {
    const pad = '  '.repeat(indent);
    let result = '';
    const role = node.role || 'unknown';
    const name = node.name?.value || node.name || '';
    const value = node.value?.value ?? '';
    const description = node.description?.value || '';
    const children = node.childObjects || [];

    const parts: string[] = [];
    if (name) parts.push(`name:"${name}"`);
    if (value) parts.push(`value:"${value}"`);
    if (description) parts.push(`desc:"${description}"`);
    const extras = Object.entries(node)
      .filter(([k]) => !['role', 'name', 'value', 'description', 'childObjects', 'children', 'ignored'].includes(k))
      .slice(0, 6)
      .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
      .join(', ');
    if (extras) parts.push(extras);

    result += `${pad}[${role}]${parts.length ? ' ' + parts.join(' ') : ''}\n`;
    for (const child of children) {
      result += this.formatAXTree(child, indent + 1);
    }
    return result;
  }

  /**
   * Extract visible elements with position info — useful for coordinate-based
   * clicking when selectors fail on React apps like Confluence.
   */
  async getVisibleElements(): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const elements = await this.page!.evaluate(() => {
        const items: Array<{
          text: string; tag: string; x: number; y: number;
          width: number; height: number; role?: string; ariaLabel?: string;
        }> = [];
        // Target interactive and meaningful elements
        const all = document.querySelectorAll(
          '[role="button"], [role="menuitem"], [role="combobox"], ' +
          '[role="textbox"], [role="listbox"], [role="option"], ' +
          'button, a, input, textarea, [tabindex="0"], [data-testid], ' +
          '[data-test-id], .cq-DropletWrapper, .cq-Dropplet'
        );
        for (const el of Array.from(all)) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width < 5 || rect.height < 5) continue;
          const text = (el as HTMLElement).textContent?.trim().slice(0, 200) || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          const hasLabel = text || ariaLabel;
          if (!hasLabel) continue;
          items.push({
            text: text.slice(0, 100),
            tag: el.tagName.toLowerCase(),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            role: el.getAttribute('role') || undefined,
            ariaLabel: ariaLabel || undefined,
          });
        }
        return items;
      });
      const result = elements.map((e, i) =>
        `#${i}: <${e.tag}> at (${e.x},${e.y}) ${e.width}x${e.height} text:"${e.text}" role="${e.role || 'none'}" aria-label="${e.ariaLabel || 'none'}"`
      ).join('\n');
      return result.substring(0, 8000);
    } catch (err: any) {
      return `Visible elements error: ${err.message}`;
    }
  }

  /**
   * Try to extract React component tree from the page. Works for React 16+
   * via __reactFiber introspection. Useful for understanding Confluence's
   * React-based editor and page structure.
   */
  async getReactComponentTree(): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const tree = await this.page!.evaluate(() => {
        const components: string[] = [];
        const getReactNode = (el: Element) => {
          const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
          return key ? (el as any)[key] : null;
        };

        const traverse = (
          node: any,
          depth: number = 0,
          maxDepth: number = 5,
        ): string[] => {
          if (!node || depth > maxDepth) return [];
          const type = node.type || node.elementType || '?';
          const key = node.key ?? '';
          const props = node.memoizedProps || {};
          const usefulProps: string[] = [];
          for (const [k, v] of Object.entries(props)) {
            if (['type', 'value', 'placeholder', 'aria-label', 'role', 'title', 'href', 'name', 'id', 'className', 'children', 'onClick', 'disabled', 'checked', 'readOnly'].includes(k)) {
              const sv = typeof v === 'function' ? '[fn]' : (typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v));
              usefulProps.push(`${k}=${sv}`);
            }
          }
          const propStr = usefulProps.length ? ` {${usefulProps.join(', ')}}` : '';
          const name = typeof type === 'string' ? type : (type?.displayName || type?.name || '?');
          components.push(`${'  '.repeat(depth)}<${name}${key ? ` key="${key}"` : ''}${propStr}>`);
          if (node.child) {
            let child = node.child;
            while (child) {
              const childNode = child.stateNode || (child.type ? null : null);
              components.push(...traverse(child, depth + 1, maxDepth));
              child = child.sibling;
            }
          }
          return components;
        };

        // Find React root fibers
        const root = document.body;
        const roots = Object.keys(root).filter(k => k.startsWith('__reactFiber'));
        let result: string[] = [];
        for (const k of roots) {
          const fiber = (root as any)[k];
          if (fiber.child) {
            let child = fiber.child;
            while (child) {
              components.push(...traverse(child, 0, 6));
              child = child.sibling;
            }
          }
        }
        return result.join('\n').slice(0, 8000);
      });
      return tree || 'No React component tree found. Page may not use React or React DevTools introspection is blocked.';
    } catch (err: any) {
      return `React tree error: ${err.message}`;
    }
  }

  /**
   * Execute JavaScript code in the page context.
   */
  async evaluateJs(script: string): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const result = await this.page!.evaluate(script);
      const str = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return str.substring(0, 5000);
    } catch (err: any) {
      return `Evaluate JS error: ${err.message}`;
    }
  }

  /**
   * Find elements using XPath selectors. Playwright supports XPath via locator('xpath=...').
   * Returns a list of matching elements with their text content and attributes.
   */
  async xpath(xpath: string): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const elements = await this.page!.locator(`xpath=${xpath}`).all();
      const results: string[] = [];
      for (let i = 0; i < Math.min(elements.length, 50); i++) {
        const el = elements[i];
        const text = await el.textContent() || '';
        const tag = await el.evaluate(e => e.tagName.toLowerCase());
        const id = await el.evaluate(e => (e as HTMLElement).id || '');
        const cls = await el.evaluate(e => (e as HTMLElement).className || '');
        const rect = await el.evaluate(e => {
          const r = (e as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        const attrs: string[] = [];
        const href = await el.evaluate(e => (e as any).href || '');
        const src = await el.evaluate(e => (e as any).src || '');
        const role = await el.evaluate(e => (e as HTMLElement).getAttribute('role') || '');
        const ariaLabel = await el.evaluate(e => (e as HTMLElement).getAttribute('aria-label') || '');
        if (href) attrs.push(`href="${href}"`);
        if (src) attrs.push(`src="${src}"`);
        if (role) attrs.push(`role="${role}"`);
        if (ariaLabel) attrs.push(`aria-label="${ariaLabel}"`);
        if (id) attrs.push(`id="${id}"`);
        if (cls) attrs.push(`class="${cls}"`);
        results.push(`#${i}: <${tag}> text="${text.trim().slice(0, 200)}" ${attrs.join(' ')} at (${rect.x},${rect.y}) ${rect.width}x${rect.height}`);
      }
      return results.length > 0 ? results.join('\n') : `No elements found matching XPath: ${xpath}`;
    } catch (err: any) {
      return `XPath error: ${err.message}`;
    }
  }

  /**
   * Scroll the page by amount or to an element.
   */
  async scroll(direction: string, amount?: number): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const pixels = amount || (direction === 'up' || direction === 'uppage' ? -200 : direction === 'left' ? -200 : direction === 'right' ? 200 : 500);
      await this.page!.evaluate(({ dir, px }: { dir: string; px: number }) => {
        if (dir === 'up') window.scrollBy(0, -px);
        else if (dir === 'down') window.scrollBy(0, px);
        else if (dir === 'left') window.scrollBy(-px, 0);
        else if (dir === 'right') window.scrollBy(px, 0);
        else if (dir === 'top') window.scrollTo(0, 0);
        else if (dir === 'bottom') window.scrollTo(0, document.body.scrollHeight);
        else if (dir === 'uppage') window.scrollBy(0, -window.innerHeight);
        else if (dir === 'downpage') window.scrollBy(0, window.innerHeight);
        else window.scrollBy(0, px);
      }, { dir: direction, px: Math.abs(pixels) });
      return `Scrolled ${direction} by ${Math.abs(pixels)}px`;
    } catch (err: any) {
      return `Scroll error: ${err.message}`;
    }
  }

  /**
   * Wait for a condition: selector, network idle, or timeout.
   */
  async waitFor(condition: string, timeout?: number): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const ms = timeout || 10000;
      if (condition.startsWith('selector:')) {
        const selector = condition.slice(9);
        await this.page!.waitForSelector(selector, { timeout: ms });
        return `Waited for selector: ${selector}`;
      } else if (condition === 'networkidle') {
        await this.page!.waitForLoadState('networkidle', { timeout: ms });
        return `Waited for network idle`;
      } else if (condition === 'load') {
        await this.page!.waitForLoadState('load', { timeout: ms });
        return `Waited for page load`;
      } else if (condition === 'domcontentloaded') {
        await this.page!.waitForLoadState('domcontentloaded', { timeout: ms });
        return `Waited for DOM content loaded`;
      } else if (condition.startsWith('xpath:')) {
        const xpath = condition.slice(6);
        await this.page!.waitForSelector(`xpath=${xpath}`, { timeout: ms });
        return `Waited for XPath: ${xpath}`;
      } else {
        // Treat as a selector
        await this.page!.waitForSelector(condition, { timeout: ms });
        return `Waited for: ${condition}`;
      }
    } catch (err: any) {
      return `Wait error: ${err.message}`;
    }
  }

  /**
   * Select an option from a <select> element.
   */
  async selectOption(selector: string, value?: string, label?: string, index?: number): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const sel = this.page!.locator(selector);
      if (value !== undefined) {
        await sel.selectOption({ value });
        return `Selected option with value: ${value}`;
      } else if (label !== undefined) {
        await sel.selectOption({ label });
        return `Selected option with label: ${label}`;
      } else if (index !== undefined) {
        await sel.selectOption({ index });
        return `Selected option at index: ${index}`;
      }
      return 'Error: Must provide value, label, or index to selectOption';
    } catch (err: any) {
      return `Select option error: ${err.message}`;
    }
  }

  /**
   * Hover over an element by CSS selector.
   */
  async hover(selector: string): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      await this.page!.locator(selector).hover();
      return `Hovered over: ${selector}`;
    } catch (err: any) {
      return `Hover error: ${err.message}`;
    }
  }

  /**
   * Click an element found by XPath selector.
   */
  async clickXPath(xpath: string): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      await this.page!.locator(`xpath=${xpath}`).click();
      return `Clicked element: ${xpath}`;
    } catch (err: any) {
      return `Click XPath error: ${err.message}`;
    }
  }

  /**
   * Extract structured content from a page section.
   */
  async extractContent(selector: string, options?: { maxComments?: number; includeLinks?: boolean }): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const result = await this.page!.evaluate(({ selector, maxComments, includeLinks }: { selector: string; maxComments?: number; includeLinks?: boolean }) => {
        const maxCommentsVal = maxComments || 50;
        const includeLinksVal = includeLinks !== false;
        
        // Try to find the element
        let element: Element | null = null;
        try {
          element = document.querySelector(selector) || document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element;
        } catch {
          return { error: `Selector not found: ${selector}` };
        }
        if (!element) return { error: `Selector not found: ${selector}` };
        
        // Extract title if present
        const titleEl = element.querySelector('h1, h2, h3, [data-testid="post-title"]');
        const title = titleEl?.textContent?.trim() || '';
        
        // Extract author
        const authorEl = element.querySelector('[data-testid="post-author"], [class*="author"], [class*="username"]');
        const author = authorEl?.textContent?.trim().replace('@', '').replace('u/', '') || '';
        
        // Extract main body text
        const bodyEl = element.querySelector('[data-testid="post-body"], [class*="body"], [class*="content"], article, .post-content');
        const body = bodyEl?.textContent?.trim().slice(0, 5000) || element.textContent?.trim().slice(0, 5000);
        
        // Extract links
        const links: Array<{ text: string; href: string }> = [];
        if (includeLinks) {
          const linkEls = element.querySelectorAll('a[href]');
          for (const link of Array.from(linkEls).slice(0, 20)) {
            const text = link.textContent?.trim() || '';
            const href = link.getAttribute('href') || '';
            if (text && !text.startsWith('http')) {
              links.push({ text: text.slice(0, 200), href });
            }
          }
        }
        
        // Extract comments if present
        const comments: Array<{ author: string; text: string; score?: string; replies?: string[] }> = [];
        const commentEls = element.querySelectorAll('[data-testid="comment"], [class*="comment-main"], [class*="comment-body"]');
        for (const comment of Array.from(commentEls).slice(0, maxComments)) {
          const authorEl2 = comment.querySelector('[data-testid="comment-author"], [class*="author"], [class*="username"], a[href*="/u/"]');
          const author2 = authorEl2?.textContent?.trim().replace('@', '').replace('u/', '') || '';
          
          const textEl = comment.querySelector('[class*="comment-body"], [class*="body"], p, [data-testid="comment-text"]');
          const text = textEl?.textContent?.trim() || comment.textContent?.trim().slice(0, 1000);
          
          const scoreEl = comment.querySelector('[data-testid="comment-score"], [class*="score"], [class*="points"]');
          const score = scoreEl?.textContent?.trim() || '';
          
          // Extract replies (nested comments)
          const replies: string[] = [];
          const replyEls = comment.querySelectorAll('[class*="replies"], [class*="child"], [class*="nested"]');
          for (const reply of Array.from(replyEls).slice(0, 5)) {
            replies.push(reply.textContent?.trim().slice(0, 500) || '');
          }
          
          comments.push({ author: author2, text: text.slice(0, 2000), score, replies });
        }
        
        return {
          title,
          author,
          body: body.slice(0, 5000),
          links,
          comments,
        };
      }, { selector, ...options });
      
      return JSON.stringify(result, null, 2).substring(0, 10000);
    } catch (err: any) {
      return `Extract content error: ${err.message}`;
    }
  }

  /**
   * Get a summary of the page structure.
   */
  async getPageStructure(): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const result = await this.page!.evaluate(() => {
        const title = document.title || '';
        const url = window.location.href || '';
        
        // Extract all links
        const links: Array<{ text: string; href: string }> = [];
        const linkEls = document.querySelectorAll('a[href]');
        for (const link of Array.from(linkEls).slice(0, 50)) {
          const text = link.textContent?.trim() || '';
          const href = link.getAttribute('href') || '';
          if (text && text.length > 2) {
            links.push({ text: text.slice(0, 200), href });
          }
        }
        
        // Extract headings
        const headings: string[] = [];
        const headingEls = document.querySelectorAll('h1, h2, h3');
        for (const heading of Array.from(headingEls)) {
          headings.push(heading.textContent?.trim() || '');
        }
        
        // Detect if page has captcha
        const hasCaptcha = document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], [class*="captcha"]') !== null;
        
        return { title, url, links, headings, hasCaptcha };
      });
      
      return JSON.stringify(result, null, 2).substring(0, 10000);
    } catch (err: any) {
      return `Page structure error: ${err.message}`;
    }
  }

  /**
   * Scroll to a specific element.
   */
  async scrollToElement(selector: string): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      await this.page!.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, selector);
      return `Scrolled to element: ${selector}`;
    } catch (err: any) {
      return `Scroll to element error: ${err.message}`;
    }
  }

  /**
   * Wait for a selector to appear on the page.
   */
  async waitForSelector(selector: string, timeout?: number): Promise<string> {
    if (!this.page) await this.initialize();
    try {
      const ms = timeout || 10000;
      await this.page!.waitForSelector(selector, { timeout: ms });
      return `Waited for selector: ${selector}`;
    } catch (err: any) {
      return `Wait for selector error: ${err.message}`;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}
