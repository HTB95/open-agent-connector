import readline from 'node:readline';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const SERVER_INSTRUCTIONS =
  'Helper models behind this server are cheaper (often free) for the user; Claude tokens are not. ' +
  'You are the lead: delegate chores (web lookups, summaries, boilerplate drafts, image generation) to these tools, ' +
  'then verify and decide. Never delegate final architectural decisions or edits to the repo.';

/**
 * @SecondBrain
 * @Description Minimal MCP (Model Context Protocol) server over stdio: newline-delimited
 *   JSON-RPC 2.0 implementing initialize / ping / tools/list / tools/call. Hand-rolled to
 *   keep the package dependency-free (no `npm install` needed to run it).
 * @History:
 *   [2026-10-03 06] [Created] - Only the tools capability is needed; the official SDK would add
 *     ~5 MB of deps for nothing.
 *   [2026-10-03 09] [Updated] - SERVER_INSTRUCTIONS made vendor-neutral for the open-source release.
 */
export class McpServer {
  constructor({ name, version, tools, ctx, input = process.stdin, output = process.stdout, log = console.error }) {
    this.info = { name, version };
    this.tools = new Map(tools.map((t) => [t.definition.name, t]));
    this.ctx = ctx;
    this.input = input;
    this.output = output;
    this.log = log;
  }

  start() {
    const rl = readline.createInterface({ input: this.input, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (line.trim()) this.handleLine(line);
    });
    return new Promise((resolve) => rl.on('close', resolve));
  }

  send(msg) {
    this.output.write(`${JSON.stringify(msg)}\n`);
  }

  async handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const isRequest = msg.id !== undefined && msg.id !== null;
    try {
      const result = await this.dispatch(msg.method, msg.params ?? {});
      if (isRequest) this.send({ jsonrpc: '2.0', id: msg.id, result });
    } catch (err) {
      if (isRequest) this.send({ jsonrpc: '2.0', id: msg.id, error: { code: err.code ?? -32603, message: err.message } });
      else this.log(`[open-agent-connector] notification ${msg.method} failed: ${err.message}`);
    }
  }

  async dispatch(method, params) {
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        return {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.info,
          instructions: SERVER_INSTRUCTIONS,
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: [...this.tools.values()].map((t) => t.definition) };
      case 'tools/call':
        return this.callTool(params);
      default:
        if (method?.startsWith('notifications/')) return null;
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
  }

  async callTool({ name, arguments: args = {} }) {
    const tool = this.tools.get(name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
    for (const key of tool.definition.inputSchema.required ?? []) {
      if (args[key] === undefined || args[key] === '') {
        return { content: [{ type: 'text', text: `Missing required argument: ${key}` }], isError: true };
      }
    }
    try {
      const { text, content = [], isError = false } = await tool.handler(this.ctx, args);
      return { content: [{ type: 'text', text }, ...content], isError };
    } catch (err) {
      // Tool failures are reported in-band so Claude can react (retry/other provider).
      return { content: [{ type: 'text', text: `${name} failed: ${err.message}` }], isError: true };
    }
  }
}
