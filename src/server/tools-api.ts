import { WebSocket } from 'ws';
import { getConfig } from './config';
import { MCPManager } from './mcp';
import { getBuiltinToolNames } from './tools';
import { toolDefinitions } from './tools';

/**
 * Handles tool discovery and MCP server management.
 * Tool enable/disable per-session is handled by Agent.enableToolForSession()
 * and Agent.disableToolForSession().
 */
export class ToolsAPI {
  private mcp: MCPManager | null;

  constructor(mcp: MCPManager | null) {
    this.mcp = mcp;
  }

  /**
   * Lists all available tools with their metadata.
   */
  listTools(): Array<{
    name: string;
    description: string;
    category: 'builtin' | 'mcp';
    mcpServer?: string;
    enabledByDefault: boolean;
  }> {
    const cfg = getConfig();
    const disabledSet = new Set<string>(cfg.disabledTools || []);
    const availableTools: Array<{
      name: string;
      description: string;
      category: 'builtin' | 'mcp';
      mcpServer?: string;
      enabledByDefault: boolean;
    }> = [];

    // Builtin tools
    for (const t of toolDefinitions) {
      const name = t.function.name;
      availableTools.push({
        name,
        description: t.function.description || '',
        category: 'builtin',
        enabledByDefault: !disabledSet.has(name),
      });
    }

    // MCP tools from connected servers
    if (this.mcp) {
      const status = this.mcp.getStatus();
      for (const server of status) {
        for (const tool of server.tools) {
          availableTools.push({
            name: tool.name,
            description: tool.description,
            category: 'mcp',
            mcpServer: server.name,
            enabledByDefault: server.serverEnabled,
          });
        }
      }
    }

    return availableTools;
  }

  /**
   * Enables an MCP server (all its tools become available).
   */
  async enableMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
    if (!this.mcp) return { success: false, error: 'MCP manager not available' };
    return this.mcp.setServerEnabled(name, true);
  }

  /**
   * Disables an MCP server (all its tools become unavailable).
   */
  async disableMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
    if (!this.mcp) return { success: false, error: 'MCP manager not available' };
    return this.mcp.setServerEnabled(name, false);
  }

  /**
   * Updates config.disabledTools (affects new sessions only).
   */
  setDefaultDisabledTools(toolNames: string[]): boolean {
    const cfg = getConfig();
    cfg.disabledTools = toolNames;
    const configModule = require('./config');
    configModule.saveConfig(cfg);
    return true;
  }
}
