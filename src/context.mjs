import { loadConfig } from './config.mjs';
import { ModelResolver } from './models.mjs';
import { RouterClient } from './router-client.mjs';

/**
 * @SecondBrain
 * @Description Builds the dependency bag (config, gateway client, model resolver, fetch)
 *   handed to every tool handler. Injectable for tests.
 * @History:
 *   [2026-10-03 06] [Created] - Single wiring point shared by the MCP server and doctor CLI.
 */
export function createContext({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = loadConfig(env);
  const client = new RouterClient(config, fetchImpl);
  return { config, client, models: new ModelResolver(config, client), fetch: fetchImpl };
}
