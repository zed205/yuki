import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';

/**
 * Default application configuration.
 */
const defaultConfig: AppConfig = {
  llm: {
    provider: 'ollama',
    model: 'qwen2.5-coder',
    baseUrl: 'http://localhost:11434'
  },
  speech: {
    enabled: false,
    serviceUrl: 'http://localhost:8000',
    sttModel: 'whisper',
    ttsModel: 'vits'
  },
  desktop: {
    enabled: false,
    serviceUrl: 'http://localhost:8001'
  },
  systemPrompt: 'You are Yuki, a helpful personal AI assistant. You have access to tools to help the user with tasks. Be concise and helpful.'
};

/** Path to the configuration directory. */
const CONFIG_DIR = path.join(require('os').homedir(), '.config', 'yukiweb');

/** Path to the configuration file. */
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * Loads the application configuration from the config file.
 * If the file doesn't exist, it creates it with default values.
 * @returns The application configuration.
 */
export function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
      console.log(`Configuration file created at ${CONFIG_FILE}`);
      return defaultConfig;
    }

    const configData = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(configData) as AppConfig;
    
    // Merge with defaults to ensure all fields exist
    return {
      llm: { ...defaultConfig.llm, ...config.llm },
      speech: { ...defaultConfig.speech, ...config.speech },
      desktop: { ...defaultConfig.desktop, ...config.desktop },
      systemPrompt: config.systemPrompt || defaultConfig.systemPrompt
    };
  } catch (error) {
    console.error(`Error loading configuration: ${error}`);
    console.log('Using default configuration.');
    return defaultConfig;
  }
}

/**
 * Saves the application configuration to the config file.
 * @param config The configuration to save.
 */
export function saveConfig(config: AppConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`Configuration saved to ${CONFIG_FILE}`);
  } catch (error) {
    console.error(`Error saving configuration: ${error}`);
  }
}
