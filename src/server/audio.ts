import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { getConfig, getAgentModel } from './config';

const pythonDir = path.join(__dirname, '..', '..', 'python');

export class AudioPipeline {
  private tempDir: string;

  constructor() {
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yukiweb-'));
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const config = getConfig();

    if (config.stt.provider === 'whisper') {
      return this.transcribeWithWhisper(audioBuffer);
    }

    if (config.stt.provider === 'openai') {
      return this.transcribeWithOpenAI(audioBuffer);
    }

    throw new Error(`Unknown STT provider: ${config.stt.provider}`);
  }

  private async transcribeWithWhisper(audioBuffer: Buffer): Promise<string> {
    const audioPath = path.join(this.tempDir, `input_${Date.now()}.wav`);
    fs.writeFileSync(audioPath, audioBuffer);

    const config = getConfig();
    const sttPath = path.join(pythonDir, 'stt.py');
    const args = [sttPath, audioPath, config.stt.model, config.stt.language, String(config.stt.beamSize || 2)];
    if (config.stt.device) args.push(config.stt.device);
    if (config.stt.computeType) args.push(config.stt.computeType);

    return new Promise((resolve, reject) => {
      const proc = spawn('python', args);

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        console.error('STT stderr:', data.toString());
      });

      proc.on('close', (code) => {
        try {
          fs.unlinkSync(audioPath);
        } catch {
          // ignore
        }

        if (code !== 0) {
          reject(new Error(`STT process exited with code ${code}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          resolve(result.text || '');
        } catch {
          reject(new Error(`Failed to parse STT output: ${output}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start STT: ${err.message}`));
      });
    });
  }

  private async transcribeWithOpenAI(audioBuffer: Buffer): Promise<string> {
    const agentCfg = getAgentModel();
    const config = getConfig();
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', config.stt.model || 'whisper-1');

    const response = await fetch(`${agentCfg.endpoint}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentCfg.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`OpenAI STT error: ${response.statusText}`);
    }

    const data: any = await response.json();
    return data.text || '';
  }

  async synthesize(text: string): Promise<Buffer> {
    const config = getConfig();

    if (config.tts.provider === 'local') {
      return this.synthesizeLocal(text);
    }

    if (config.tts.provider === 'openai') {
      return this.synthesizeOpenAI(text);
    }

    throw new Error(`Unknown TTS provider: ${config.tts.provider}`);
  }

  private async synthesizeLocal(text: string): Promise<Buffer> {
    const config = getConfig();
    const outputPath = path.join(this.tempDir, `output_${Date.now()}.wav`);
    const ttsPath = path.join(pythonDir, 'tts.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [ttsPath, text, config.tts.voice, outputPath]);

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        console.error('TTS stderr:', data.toString());
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`TTS process exited with code ${code}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          const audioPath = result.output || outputPath;

          if (fs.existsSync(audioPath)) {
            const audioData = fs.readFileSync(audioPath);
            fs.unlinkSync(audioPath);
            resolve(audioData);
          } else {
            reject(new Error('TTS output file not found'));
          }
        } catch {
          reject(new Error(`Failed to parse TTS output: ${output}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start TTS: ${err.message}`));
      });
    });
  }

  private async synthesizeOpenAI(text: string): Promise<Buffer> {
    const agentCfg = getAgentModel();
    const config = getConfig();

    const response = await fetch(`${agentCfg.endpoint}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentCfg.apiKey}`,
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: config.tts.voice || 'alloy',
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS error: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  cleanup(): void {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
