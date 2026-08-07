import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getConfig } from './config';

const pythonDir = path.join(__dirname, '..', '..', 'python');

export class DesktopAutomation {
  private tempDir: string;

  constructor() {
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yukiweb-desktop-'));
  }

  isEnabled(): boolean {
    return getConfig().desktop.enableAutomation;
  }

  async screenshot(): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Desktop automation is not enabled in config');
    }

    const config = getConfig();
    const outputPath = path.join(this.tempDir, `screenshot_${Date.now()}.png`);
    const desktopPath = path.join(pythonDir, 'desktop.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [desktopPath, 'screenshot', outputPath]);

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        console.error('Desktop stderr:', data.toString());
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Screenshot failed with code ${code}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          resolve(result.path || outputPath);
        } catch {
          resolve(outputPath);
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to capture screenshot: ${err.message}`));
      });
    });
  }

  async getScreenshotBase64(): Promise<string> {
    const screenshotPath = await this.screenshot();
    const data = fs.readFileSync(screenshotPath);
    return data.toString('base64');
  }

  async getViewport(): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Desktop automation is not enabled in config');
    }

    const desktopPath = path.join(pythonDir, 'desktop.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [desktopPath, 'viewport']);

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { console.error('Desktop stderr:', data.toString()); });

      proc.on('close', (code) => {
        if (code !== 0) { reject(new Error(`Viewport failed with code ${code}`)); return; }
        try { resolve(JSON.parse(output)); }
        catch { reject(new Error('Failed to parse viewport output')); }
      });

      proc.on('error', (err) => reject(new Error(`Failed to get viewport: ${err.message}`)));
    });
  }

  async screenshotRegion(left: number, top: number, width: number, height: number): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Desktop automation is not enabled in config');
    }

    const outputPath = path.join(this.tempDir, `region_${Date.now()}.png`);
    const desktopPath = path.join(pythonDir, 'desktop.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [desktopPath, 'screenshot_region', outputPath, String(left), String(top), String(width), String(height)]);

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { console.error('Desktop stderr:', data.toString()); });

      proc.on('close', (code) => {
        if (code !== 0) { reject(new Error(`Region screenshot failed with code ${code}`)); return; }
        const data = fs.readFileSync(outputPath);
        resolve(data.toString('base64'));
      });

      proc.on('error', (err) => reject(new Error(`Failed to capture region: ${err.message}`)));
    });
  }

  async mouseClick(x: number, y: number): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Desktop automation is not enabled in config');
    }

    const desktopPath = path.join(pythonDir, 'desktop.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [desktopPath, 'click', String(x), String(y)]);

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        console.error('Desktop stderr:', data.toString());
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Mouse click failed with code ${code}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          resolve(result.result || 'Click executed');
        } catch {
          resolve('Click executed');
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to execute click: ${err.message}`));
      });
    });
  }

  async mouseMove(x: number, y: number): Promise<string> {
    if (!this.isEnabled()) throw new Error('Desktop automation is not enabled in config');

    const desktopPath = path.join(pythonDir, 'desktop.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [desktopPath, 'move', String(x), String(y)]);

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { console.error('Desktop stderr:', data.toString()); });

      proc.on('close', (code) => {
        if (code !== 0) { reject(new Error(`Mouse move failed with code ${code}`)); return; }
        try { const r = JSON.parse(output); resolve(r.result || 'Move executed'); }
        catch { resolve('Move executed'); }
      });

      proc.on('error', (err) => reject(new Error(`Failed to execute move: ${err.message}`)));
    });
  }

  async mouseDrag(x: number, y: number, button: string = 'left'): Promise<string> {
    if (!this.isEnabled()) throw new Error('Desktop automation is not enabled in config');

    const desktopPath = path.join(pythonDir, 'desktop.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [desktopPath, 'drag', String(x), String(y), button]);

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { console.error('Desktop stderr:', data.toString()); });

      proc.on('close', (code) => {
        if (code !== 0) { reject(new Error(`Mouse drag failed with code ${code}`)); return; }
        try { const r = JSON.parse(output); resolve(r.result || 'Drag executed'); }
        catch { resolve('Drag executed'); }
      });

      proc.on('error', (err) => reject(new Error(`Failed to execute drag: ${err.message}`)));
    });
  }

  async scroll(clicks: number): Promise<string> {
    if (!this.isEnabled()) throw new Error('Desktop automation is not enabled in config');

    const desktopPath = path.join(pythonDir, 'desktop.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [desktopPath, 'scroll', String(clicks)]);

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { console.error('Desktop stderr:', data.toString()); });

      proc.on('close', (code) => {
        if (code !== 0) { reject(new Error(`Scroll failed with code ${code}`)); return; }
        try { const r = JSON.parse(output); resolve(r.result || 'Scroll executed'); }
        catch { resolve('Scroll executed'); }
      });

      proc.on('error', (err) => reject(new Error(`Failed to execute scroll: ${err.message}`)));
    });
  }

  async keyboardInput(text: string): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Desktop automation is not enabled in config');
    }

    const desktopPath = path.join(pythonDir, 'desktop.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [desktopPath, 'type', text]);

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        console.error('Desktop stderr:', data.toString());
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Keyboard input failed with code ${code}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          resolve(result.result || 'Text typed');
        } catch {
          resolve('Text typed');
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to execute keyboard input: ${err.message}`));
      });
    });
  }

  async keyPress(key: string): Promise<string> {
    if (!this.isEnabled()) throw new Error('Desktop automation is not enabled in config');

    const desktopPath = path.join(pythonDir, 'desktop.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [desktopPath, 'press', key]);

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { console.error('Desktop stderr:', data.toString()); });

      proc.on('close', (code) => {
        if (code !== 0) { reject(new Error(`Key press failed with code ${code}`)); return; }
        try { const r = JSON.parse(output); resolve(r.result || 'Key pressed'); }
        catch { resolve('Key pressed'); }
      });

      proc.on('error', (err) => reject(new Error(`Failed to execute key press: ${err.message}`)));
    });
  }

  cleanup(): void {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}
