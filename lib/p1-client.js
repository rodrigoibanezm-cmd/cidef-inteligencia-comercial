import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = 'https://cidef-motor-test-azure.calmforest-1c67ab46.chilecentral.azurecontainerapps.io/api/mcp';

export async function withP1Mcp(callback) {
  const client = new Client({ name: 'cidef-inteligencia-comercial', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  try {
    return await callback(client);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function callP1(client, name, args) {
  const started = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      const detail = result.content?.map((item) => item.text || '').filter(Boolean).join('\n');
      throw new Error(detail || `P1 ${name} failed`);
    }
    if (result.structuredContent) return result.structuredContent;
    const text = result.content?.find((item) => item.type === 'text')?.text;
    if (!text) throw new Error(`P1 ${name} returned no evidence`);
    try { return JSON.parse(text); } catch { throw new Error(`P1 ${name} returned invalid evidence`); }
  } catch (error) {
    // Only allowlisted temporal context, never full arguments, responses or SDK error data.
    const context = [`operation=${name}`];
    const period = args?.period ?? args?.filters?.month;
    const cutoff = args?.cutoff ?? args?.cutoff_date ?? args?.filters?.date_to;
    if (typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)) context.push(`period=${period}`);
    if (typeof cutoff === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cutoff)) context.push(`cutoff=${cutoff}`);
    context.push(`duration_ms=${Math.max(0, Date.now() - started)}`);
    const failure = new Error(`P1 ${context.join(' ')}: ${error?.message || String(error)}`);
    if (error?.code !== undefined) failure.code = error.code;
    throw failure;
  }
}
