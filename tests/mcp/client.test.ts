import { describe, expect, it, vi } from "vitest";

import {
  createMcpClient,
  McpPayloadError,
  normalizeToolResult,
  type McpToolInvoker,
  type McpToolResult,
} from "@/lib/mcp";
import unknownHotelCityFixture from "../fixtures/mcp/error-unknown-hotel-city.json";
import unknownCityFixture from "../fixtures/mcp/error-unknown-city.json";
import hotelFixture from "../fixtures/mcp/search-hotels-sochi.json";
import transportFixture from "../fixtures/mcp/search-multitransport-msk-sochi.json";

const successfulToolResult = transportFixture.result as McpToolResult;
const unresolvedToolResult = unknownCityFixture.result as McpToolResult;

function toolResultWithPayload(payload: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: false,
  };
}

function decodedTransportPayload() {
  return JSON.parse(successfulToolResult.content[0].text) as {
    variants: Array<Record<string, unknown>>;
    meta: Record<string, unknown>;
  };
}

describe("MCP client", () => {
  it("parses a successful fixture into transport DTO variants", async () => {
    const client = createMcpClient({
      invoker: vi.fn().mockResolvedValue(successfulToolResult),
    });

    const result = await client.callTool({
      name: "search_multitransport",
      arguments: { from: "Москва", to: "Сочи" },
    });

    expect(result.status).toBe("success");
    if (result.status !== "success" || result.data.type !== "transport") {
      throw new Error("Expected a successful transport response");
    }
    expect(result.data.variants).toHaveLength(3);
    expect(result.data.variants[0]).toMatchObject({
      id: "10d6e3129f003210b806a2f58709a8dc",
      transport: "railway",
      price: { amount: 4955.58, currency: "RUB" },
      durationMinutes: 2149,
    });
    expect(result.data.meta.unavailable).toEqual([]);
  });

  it("classifies an unresolved direction separately from success and source failure", async () => {
    const client = createMcpClient({
      invoker: vi.fn().mockResolvedValue(unresolvedToolResult),
    });

    const result = await client.callTool({ name: "search_multitransport" });

    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") {
      throw new Error("Expected an unresolved direction");
    }
    expect(result.unavailable).toHaveLength(4);
    expect(result.unavailable.every((item) => item.reason === "no_route")).toBe(
      true,
    );
  });

  it("classifies an unresolved hotel city without treating non-JSON text as a source failure", async () => {
    const client = createMcpClient({
      invoker: vi
        .fn()
        .mockResolvedValue(unknownHotelCityFixture.result as McpToolResult),
    });

    const result = await client.callTool({ name: "search_hotels" });

    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") {
      throw new Error("Expected an unresolved hotel city");
    }
    expect(result.data).toEqual({ type: "hotel", hotels: [], meta: {} });
    expect(result.unavailable).toEqual([]);
  });

  it("keeps empty transport results with unrelated unavailable reasons successful", async () => {
    const payload = decodedTransportPayload();
    payload.variants = [];
    payload.meta.unavailable = [
      {
        mode: "avia",
        reason: "upstream_timeout",
        detail: "avia provider timed out",
      },
    ];
    const client = createMcpClient({
      invoker: vi.fn().mockResolvedValue(toolResultWithPayload(payload)),
    });

    const result = await client.callTool({ name: "search_multitransport" });

    expect(result.status).toBe("success");
    if (result.status !== "success" || result.data.type !== "transport") {
      throw new Error("Expected a successful empty transport response");
    }
    expect(result.data.variants).toEqual([]);
    expect(result.data.meta.unavailable).toEqual(payload.meta.unavailable);
  });

  it("keeps unrelated isError text as a payload parsing error", () => {
    expect(() =>
      normalizeToolResult({
        content: [
          {
            type: "text",
            text: "Error executing tool search_hotels: upstream unavailable",
          },
        ],
        isError: true,
      }),
    ).toThrow(McpPayloadError);
  });

  it("normalizes the hotel fixture without exposing MCP field names", async () => {
    const client = createMcpClient({
      invoker: vi.fn().mockResolvedValue(hotelFixture.result as McpToolResult),
    });

    const result = await client.callTool({ name: "search_hotels" });

    expect(result.status).toBe("success");
    if (result.status !== "success" || result.data.type !== "hotel") {
      throw new Error("Expected a successful hotel response");
    }
    expect(result.data.hotels[0]).toMatchObject({
      id: "7653053",
      name: "Отель Сочи Галерея Парк",
      bestOffer: {
        price: { amount: 22400, currency: "RUB" },
        priceBasis: "stay_total",
      },
    });
    expect(result.data.stay).toEqual({
      checkIn: "2026-09-10",
      checkOut: "2026-09-14",
      nights: 4,
    });
  });

  it("returns a marked timeout instead of throwing", async () => {
    vi.useFakeTimers();
    try {
      const invoker: McpToolInvoker = ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      const client = createMcpClient({ invoker, maxRetries: 0 });

      const pending = client.callTool({
        name: "search_multitransport",
        budgetMs: 100,
      });
      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toMatchObject({
        status: "source_unavailable",
        failure: { kind: "timeout" },
        attempts: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries one network failure and opens the circuit after the second failure", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const invoker = vi.fn().mockRejectedValue(new TypeError("network down"));
      const client = createMcpClient({ invoker, failureThreshold: 2 });

      const firstPending = client.callTool({ name: "search_multitransport" });
      await vi.advanceTimersByTimeAsync(100);
      const first = await firstPending;
      const second = await client.callTool({ name: "search_multitransport" });

      expect(first).toMatchObject({
        status: "source_unavailable",
        failure: { kind: "network" },
        attempts: 2,
      });
      expect(second).toMatchObject({
        status: "source_unavailable",
        failure: { kind: "circuit_open" },
        attempts: 0,
      });
      expect(invoker).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it("propagates the request AbortSignal and ignores a late result", async () => {
    const controller = new AbortController();
    let resolveInvocation!: (value: McpToolResult) => void;
    let receivedSignal: AbortSignal | undefined;
    const invoker: McpToolInvoker = ({ signal }) => {
      receivedSignal = signal;
      return new Promise((resolve) => {
        resolveInvocation = resolve;
      });
    };
    const client = createMcpClient({ invoker });

    const pending = client.callTool({
      name: "search_multitransport",
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      status: "source_unavailable",
      failure: { kind: "aborted" },
      attempts: 1,
    });
    expect(receivedSignal?.aborted).toBe(true);

    resolveInvocation(successfulToolResult);
    await Promise.resolve();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("uses exponential backoff with jitter between retries", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const startedAt: number[] = [];
      const invoker: McpToolInvoker = () => {
        startedAt.push(performance.now());
        if (startedAt.length < 3) {
          return Promise.reject(new TypeError("temporary network error"));
        }
        return Promise.resolve(successfulToolResult);
      };
      const client = createMcpClient({
        invoker,
        firstAttemptBudgetRatio: 0.5,
        maxRetries: 2,
        failureThreshold: 10,
      });

      const pending = client.callTool({
        name: "search_multitransport",
        budgetMs: 2_000,
      });
      await vi.advanceTimersByTimeAsync(99);
      expect(startedAt).toEqual([0]);

      await vi.advanceTimersByTimeAsync(1);
      expect(startedAt).toEqual([0, 100]);

      await vi.advanceTimersByTimeAsync(199);
      expect(startedAt).toEqual([0, 100]);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({
        status: "success",
        attempts: 3,
      });
      expect(startedAt).toEqual([0, 100, 300]);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps the backoff and retry inside the total call budget", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const startedAt: number[] = [];
      const invoker: McpToolInvoker = ({ signal }) => {
        startedAt.push(performance.now());
        if (startedAt.length === 1) {
          return new Promise((_, reject) => {
            setTimeout(
              () => reject(new TypeError("temporary network error")),
              250,
            );
          });
        }
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      };
      const client = createMcpClient({
        invoker,
        firstAttemptBudgetRatio: 0.6,
        failureThreshold: 10,
      });

      const pending = client.callTool({
        name: "search_multitransport",
        budgetMs: 500,
      });
      await vi.advanceTimersByTimeAsync(349);
      expect(startedAt).toEqual([0]);

      await vi.advanceTimersByTimeAsync(1);
      expect(startedAt).toEqual([0, 350]);

      await vi.advanceTimersByTimeAsync(149);
      expect(startedAt).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({
        status: "source_unavailable",
        failure: { kind: "timeout" },
        attempts: 2,
      });
      expect(performance.now()).toBe(500);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not retry when the post-backoff attempt budget is below the minimum", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const invoker = vi.fn<McpToolInvoker>(
        () =>
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new TypeError("temporary network error")),
              320,
            );
          }),
      );
      const client = createMcpClient({
        invoker,
        firstAttemptBudgetRatio: 0.8,
        failureThreshold: 10,
      });

      const pending = client.callTool({
        name: "search_multitransport",
        budgetMs: 500,
      });
      await vi.advanceTimersByTimeAsync(320);

      await expect(pending).resolves.toMatchObject({
        status: "source_unavailable",
        failure: { kind: "network" },
        attempts: 1,
      });
      expect(invoker).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it("reports timeout when the budget expires before a network failure is handled", async () => {
    vi.useFakeTimers({ now: 0 });
    let monotonicNow = 0;
    const performanceNow = vi
      .spyOn(performance, "now")
      .mockImplementation(() => monotonicNow);
    try {
      const invoker = vi.fn<McpToolInvoker>(() => {
        monotonicNow = 101;
        return Promise.reject(new TypeError("network down"));
      });
      const client = createMcpClient({ invoker, maxRetries: 0 });

      await expect(
        client.callTool({ name: "search_multitransport", budgetMs: 100 }),
      ).resolves.toMatchObject({
        status: "source_unavailable",
        failure: { kind: "timeout" },
        attempts: 1,
      });
    } finally {
      performanceNow.mockRestore();
      vi.useRealTimers();
    }
  });

  it("uses monotonic time for the call budget when the wall clock jumps", async () => {
    vi.useFakeTimers({ now: 0 });
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      const invoker = vi
        .fn<McpToolInvoker>()
        .mockRejectedValueOnce(new TypeError("temporary network error"))
        .mockResolvedValueOnce(successfulToolResult);
      const client = createMcpClient({
        invoker,
        firstAttemptBudgetRatio: 0.5,
        failureThreshold: 10,
      });

      const pending = client.callTool({
        name: "search_multitransport",
        budgetMs: 500,
      });
      dateNow.mockReturnValue(1_000_000);
      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toMatchObject({
        status: "success",
        attempts: 2,
      });
      expect(invoker).toHaveBeenCalledTimes(2);
    } finally {
      dateNow.mockRestore();
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it("ignores unknown response fields", async () => {
    const payload = decodedTransportPayload();
    payload.meta.future_server_field = { enabled: true };
    payload.variants[0].future_offer_field = "new";
    const client = createMcpClient({
      invoker: vi.fn().mockResolvedValue(toolResultWithPayload(payload)),
    });

    const result = await client.callTool({ name: "search_multitransport" });

    expect(result.status).toBe("success");
  });

  it("keeps an absent optional checkout_url empty", async () => {
    const payload = decodedTransportPayload();
    delete payload.variants[0].checkout_url;
    const client = createMcpClient({
      invoker: vi.fn().mockResolvedValue(toolResultWithPayload(payload)),
    });

    const result = await client.callTool({ name: "search_multitransport" });

    expect(result.status).toBe("success");
    if (result.status !== "success" || result.data.type !== "transport") {
      throw new Error("Expected a successful transport response");
    }
    expect(result.data.variants[0].checkoutUrl).toBeUndefined();
  });

  it("does not mix responses from ten concurrent calls", async () => {
    const invoker: McpToolInvoker = async ({ arguments: args }) => {
      const index = Number(args?.index);
      const payload = decodedTransportPayload();
      payload.variants[0].offer_id = `offer-${index}`;
      await new Promise((resolve) => setTimeout(resolve, 10 - index));
      return toolResultWithPayload(payload);
    };
    const client = createMcpClient({ invoker });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        client.callTool({
          name: "search_multitransport",
          arguments: { index },
        }),
      ),
    );

    results.forEach((result, index) => {
      expect(result.status).toBe("success");
      if (result.status !== "success" || result.data.type !== "transport") {
        throw new Error("Expected a successful transport response");
      }
      expect(result.data.variants[0].id).toBe(`offer-${index}`);
    });
  });
});
