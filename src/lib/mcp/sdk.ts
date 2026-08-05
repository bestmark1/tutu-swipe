import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { McpToolInvoker } from "./types";

export const TUTU_MCP_ENDPOINT = "https://mcp.tutu.ru/mcp";

export interface SdkToolInvokerOptions {
  endpoint?: string | URL;
}

/**
 * Creates an isolated SDK session per attempt. This keeps cancellation local to
 * one request and prevents parallel user calls from closing each other's transport.
 */
export function createSdkToolInvoker(
  options: SdkToolInvokerOptions = {},
): McpToolInvoker {
  const endpoint = new URL(options.endpoint ?? TUTU_MCP_ENDPOINT);

  return async ({ name, arguments: args, signal, timeoutMs }) => {
    const client = new Client({ name: "tutu-swipe", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: {
        headers: { Accept: "application/json, text/event-stream" },
      },
    });
    const requestOptions = {
      signal,
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    };

    try {
      await client.connect(transport, requestOptions);
      return await client.callTool(
        { name, arguments: args ?? {} },
        undefined,
        requestOptions,
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  };
}
