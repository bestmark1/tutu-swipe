import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const sdkMocks = vi.hoisted(() => {
  type TransportDouble = {
    close: Mock<() => Promise<void>>;
  };

  type ClientDouble = {
    connect: Mock<(transport: TransportDouble) => Promise<void>>;
    callTool: Mock<(...args: unknown[]) => Promise<unknown>>;
    close: Mock<() => Promise<void>>;
  };

  const clients: ClientDouble[] = [];
  const transports: Array<{
    instance: TransportDouble;
    options: unknown;
    url: URL;
  }> = [];

  function createClient(): ClientDouble {
    let transport: TransportDouble | undefined;
    const connect = vi.fn(async (nextTransport: TransportDouble) => {
      transport = nextTransport;
    });
    const callTool = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async () => ({ content: [] }),
    );
    const close = vi.fn(async () => {
      await transport?.close();
    });

    return { connect, callTool, close };
  }

  const clientFactory = vi.fn(createClient);
  const Client = vi.fn(function Client() {
    const client = clientFactory();
    clients.push(client);
    return client;
  });
  const StreamableHTTPClientTransport = vi.fn(function Transport(
    url: URL,
    options: unknown,
  ) {
    const instance = { close: vi.fn(async () => undefined) };
    transports.push({ instance, options, url });
    return instance;
  });

  return {
    Client,
    StreamableHTTPClientTransport,
    clientFactory,
    clients,
    createClient,
    transports,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: sdkMocks.Client,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: sdkMocks.StreamableHTTPClientTransport,
}));

import { createSdkToolInvoker, TUTU_MCP_ENDPOINT } from "@/lib/mcp/sdk";

function invocation(
  overrides: Partial<{
    arguments: Record<string, unknown>;
    name: string;
    signal: AbortSignal;
    timeoutMs: number;
  }> = {},
) {
  return {
    name: "search_multitransport",
    arguments: { from: "Москва", to: "Сочи" },
    signal: new AbortController().signal,
    timeoutMs: 12_345,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("createSdkToolInvoker", () => {
  beforeEach(() => {
    sdkMocks.Client.mockClear();
    sdkMocks.StreamableHTTPClientTransport.mockClear();
    sdkMocks.clientFactory.mockReset();
    sdkMocks.clientFactory.mockImplementation(sdkMocks.createClient);
    sdkMocks.clients.length = 0;
    sdkMocks.transports.length = 0;
  });

  it("configures the MCP-required Accept header", async () => {
    const invoke = createSdkToolInvoker();

    await invoke(invocation());

    expect(sdkMocks.transports).toHaveLength(1);
    expect(sdkMocks.transports[0]).toMatchObject({
      url: new URL(TUTU_MCP_ENDPOINT),
      options: {
        requestInit: {
          headers: { Accept: "application/json, text/event-stream" },
        },
      },
    });
  });

  it("connects before calling the tool", async () => {
    const invoke = createSdkToolInvoker();

    await invoke(invocation());

    const client = sdkMocks.clients[0];
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.callTool).toHaveBeenCalledOnce();
    expect(client.connect.mock.invocationCallOrder[0]).toBeLessThan(
      client.callTool.mock.invocationCallOrder[0],
    );
  });

  it("closes the client after both successful and failed tool calls", async () => {
    const successfulClient = sdkMocks.createClient();
    const failedClient = sdkMocks.createClient();
    const callError = new Error("tool failed");
    failedClient.callTool.mockRejectedValue(callError);
    sdkMocks.clientFactory
      .mockReturnValueOnce(successfulClient)
      .mockReturnValueOnce(failedClient);
    const invoke = createSdkToolInvoker();

    await invoke(invocation());
    await expect(invoke(invocation())).rejects.toBe(callError);

    expect(successfulClient.close).toHaveBeenCalledOnce();
    expect(failedClient.close).toHaveBeenCalledOnce();
  });

  it("passes cancellation and timeout options to connect and callTool", async () => {
    const controller = new AbortController();
    const invoke = createSdkToolInvoker();

    await invoke(
      invocation({ signal: controller.signal, timeoutMs: 7_500 }),
    );

    const client = sdkMocks.clients[0];
    const requestOptions = {
      signal: controller.signal,
      timeout: 7_500,
      maxTotalTimeout: 7_500,
    };
    expect(client.connect).toHaveBeenCalledWith(
      sdkMocks.transports[0].instance,
      requestOptions,
    );
    expect(client.callTool).toHaveBeenCalledWith(
      {
        name: "search_multitransport",
        arguments: { from: "Москва", to: "Сочи" },
      },
      undefined,
      requestOptions,
    );
  });

  it("does not let a close error mask the tool error", async () => {
    const client = sdkMocks.createClient();
    const callError = new Error("tool failed");
    client.callTool.mockRejectedValue(callError);
    client.close.mockRejectedValue(new Error("close failed"));
    sdkMocks.clientFactory.mockReturnValueOnce(client);
    const invoke = createSdkToolInvoker();

    await expect(invoke(invocation())).rejects.toBe(callError);
  });

  it("isolates clients and transports for parallel calls", async () => {
    const firstResult = deferred<unknown>();
    const secondResult = deferred<unknown>();
    const firstClient = sdkMocks.createClient();
    const secondClient = sdkMocks.createClient();
    firstClient.callTool.mockReturnValue(firstResult.promise);
    secondClient.callTool.mockReturnValue(secondResult.promise);
    sdkMocks.clientFactory
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient);
    const invoke = createSdkToolInvoker();

    const firstPending = invoke(invocation({ name: "first" }));
    const secondPending = invoke(invocation({ name: "second" }));
    await Promise.resolve();

    expect(sdkMocks.Client).toHaveBeenCalledTimes(2);
    expect(sdkMocks.StreamableHTTPClientTransport).toHaveBeenCalledTimes(2);
    expect(sdkMocks.transports[0].instance).not.toBe(
      sdkMocks.transports[1].instance,
    );

    firstResult.resolve({ content: [] });
    await firstPending;
    expect(sdkMocks.transports[0].instance.close).toHaveBeenCalledOnce();
    expect(sdkMocks.transports[1].instance.close).not.toHaveBeenCalled();

    secondResult.resolve({ content: [] });
    await secondPending;
    expect(sdkMocks.transports[1].instance.close).toHaveBeenCalledOnce();
  });
});
