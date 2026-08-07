import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { getConfig } from './config';

export class BrowserAutomation {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async initialize(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: true,
    });
    this.context = await this.browser.newContext();
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

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}
