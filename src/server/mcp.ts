import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPServerConfig } from '../shared/types';

interface MCPToolInfo {
  fullName: string;
  serverName: string;
  originalName: string;
  description: string;
  parameters: any;
}

interface MCPServerState {
  config: MCPServerConfig;
  client: Client | null;
  transport: StdioClientTransport | null;
  connected: boolean;
  serverEnabled: boolean;
  error?: string;
  tools: MCPToolInfo[];
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function toolFullName(serverName: string, toolName: string): string {
  return `mcp_${sanitizeName(serverName)}_${sanitizeName(toolName)}`;
}

function resultToString(result: any): string {
  if (!result) return '';
  if (result.content && Array.isArray(result.content)) {
    const parts: string[] = [];
    for (const c of result.content) {
      if (c && c.type === 'text' && c.text) parts.push(c.text);
      else if (c && c.type === 'resource' && c.resource) {
        parts.push(`[resource ${c.resource.uri}${c.resource.text ? ': ' + c.resource.text : ''}]`);
      } else if (c && typeof c.text === 'string') parts.push(c.text);
    }
    if (result.isError) return `[MCP error]\n${parts.join('\n')}`;
    return parts.join('\n');
  }
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export class MCPManager {
  private servers: Map<string, MCPServerState> = new Map();

  constructor(serverConfigs: MCPServerConfig[]) {
    for (const cfg of serverConfigs || []) {
      this.servers.set(cfg.name, {
        config: cfg,
        client: null,
        transport: null,
        connected: false,
        serverEnabled: false,
        tools: [],
      });
    }
  }

  getServerNames(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Enables or disables an MCP server. When enabled, attempts to connect.
   * When disabled, disconnects the server.
   */
  async setServerEnabled(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    const s = this.servers.get(name);
    if (!s) return { success: false, error: 'Unknown server' };
    s.serverEnabled = enabled;
    if (enabled) {
      const ok = await this.connectServer(name);
      return ok ? { success: true } : { success: false, error: s.error };
    } else {
      await this.disconnectServer(name);
      return { success: true };
    }
  }

  /**
   * Returns a Set of enabled MCP tool names (only connected + enabled servers).
   */
  getEnabledToolNames(): Set<string> {
    const names = new Set<string>();
    for (const s of this.servers.values()) {
      if (!s.connected || !s.serverEnabled) continue;
      for (const t of s.tools) names.add(t.fullName);
    }
    return names;
  }

  getStatus() {
    return Array.from(this.servers.values()).map((s) => ({
      name: s.config.name,
      command: s.config.command,
      args: s.config.args || [],
      enabled: !!s.config.enabled,
      serverEnabled: s.serverEnabled,
      connected: s.connected,
      error: s.error,
      toolCount: s.tools.length,
      tools: s.tools.map((t) => ({
        name: t.fullName,
        originalName: t.originalName,
        description: t.description,
      })),
    }));
  }

  getToolDefinitions(): any[] {
    const defs: any[] = [];
    for (const s of this.servers.values()) {
      if (!s.connected) continue;
      for (const t of s.tools) {
        defs.push({
          type: 'function',
          function: {
            name: t.fullName,
            description: t.description || `MCP tool ${t.originalName} from ${s.config.name}`,
            parameters: t.parameters && t.parameters.type === 'object' ? t.parameters : { type: 'object', properties: {}, additionalProperties: true },
          },
        });
      }
    }
    return defs;
  }

  isMCPTool(name: string): boolean {
    for (const s of this.servers.values()) {
      if (!s.connected) continue;
      if (s.tools.some((t) => t.fullName === name)) return true;
    }
    return false;
  }

  async callTool(fullName: string, params: any): Promise<string | null> {
    for (const s of this.servers.values()) {
      if (!s.connected || !s.client) continue;
      const tool = s.tools.find((t) => t.fullName === fullName);
      if (!tool) continue;
      try {
        const result = await s.client.callTool({ name: tool.originalName, arguments: params || {} });
        return resultToString(result);
      } catch (err: any) {
        return `MCP tool ${tool.originalName} failed: ${err?.message || err}`;
      }
    }
    return null;
  }

  async connectServer(name: string): Promise<boolean> {
    const s = this.servers.get(name);
    if (!s) return false;
    if (s.connected && s.client) return true;

    try {
      // Merge custom env vars with the parent process environment so
      // PATH, SYSTEMROOT, etc. are inherited. Custom vars take precedence.
      const mergedEnv: Record<string, string> = { ...process.env } as any;
      if (s.config.env) {
        for (const [k, v] of Object.entries(s.config.env)) {
          mergedEnv[k] = v;
        }
      }
      const transport = new StdioClientTransport({
        command: s.config.command,
        args: s.config.args || [],
        env: mergedEnv,
        stderr: 'pipe',
      });
      const client = new Client({ name: 'yukiweb', version: '0.1.0' });
      await client.connect(transport);

      s.client = client;
      s.transport = transport;
      s.connected = true;
      s.error = undefined;

      const toolsResult = await client.listTools();
      const toolInfos: MCPToolInfo[] = (toolsResult.tools || []).map((t: any) => ({
        fullName: toolFullName(name, t.name),
        serverName: name,
        originalName: t.name,
        description: (t as any).description || '',
        parameters: (t as any).inputSchema || {},
      }));
      s.tools = toolInfos;

      transport.onclose = () => {
        s.connected = false;
        s.client = null;
        s.transport = null;
        s.tools = [];
      };
      return true;
    } catch (err: any) {
      s.connected = false;
      s.client = null;
      s.transport = null;
      s.tools = [];
      s.error = err?.message || String(err);
      console.error(`MCP connect failed for ${name}:`, err?.message || err);
      return false;
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const s = this.servers.get(name);
    if (!s) return;
    try {
      if (s.client) await s.client.close();
    } catch {
      // ignore
    }
    s.client = null;
    s.transport = null;
    s.connected = false;
    s.tools = [];
    s.error = undefined;
  }

  async setEnabled(name: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    const s = this.servers.get(name);
    if (!s) return { success: false, error: 'Unknown server' };
    s.config.enabled = enabled;
    if (enabled) {
      const ok = await this.connectServer(name);
      return ok ? { success: true } : { success: false, error: s.error };
    } else {
      await this.disconnectServer(name);
      return { success: true };
    }
  }

  async shutdown(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.disconnectServer(name);
    }
  }
}
