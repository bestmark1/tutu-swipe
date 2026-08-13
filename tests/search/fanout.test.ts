import { describe, expect, it, vi } from "vitest";

import type { DiscoveryQuery } from "@/lib/discovery/schema";
import type {
  HotelSearchDto,
  McpCallOutcome,
  TransportSearchDto,
} from "@/lib/mcp";
import {
  fanOutSearch,
  type SearchCallOutcome,
  type SearchClient,
  type SearchEvent,
} from "@/lib/search";
import { extractFeatures, FEATURE_NAMES } from "@/lib/ranking";

const query: DiscoveryQuery = {
  origin: "Москва",
  travellers: { adults: 2, childrenAges: [] },
  dateWindow: { startDate: "2026-09-10", nights: 4 },
  budget: { amount: 60_000, currency: "RUB", scope: "group_trip_total" },
  vibeTags: ["sea"],
};

const transport: TransportSearchDto = {
  type: "transport",
  variants: [
    {
      id: "transport-1",
      transport: "railway",
      price: { amount: 5_000, currency: "RUB" },
      durationMinutes: 600,
      carriers: [],
      departureAt: "2026-09-10T08:00:00+03:00",
      arrivalAt: "2026-09-10T18:00:00+03:00",
      legs: [],
    },
  ],
  meta: { unavailable: [] },
};

const hotel: HotelSearchDto = {
  type: "hotel",
  hotels: [
    {
      id: "hotel-1",
      name: "Отель",
      photos: [],
      bestOffer: {
        price: { amount: 20_000, currency: "RUB" },
        priceBasis: "stay_total",
      },
    },
  ],
  stay: { checkIn: "2026-09-10", checkOut: "2026-09-14", nights: 4 },
  meta: {},
};

function success(name: string): McpCallOutcome {
  return {
    status: "success",
    data: name === "search_hotels" ? hotel : transport,
    attempts: 1,
  };
}

function candidates(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `Город ${index + 1}`,
  }));
}

async function collect(stream: AsyncIterable<SearchEvent>) {
  const events: SearchEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("fanOutSearch", () => {
  it("carries the candidate location type into the card and ranking features", async () => {
    const events = await collect(
      fanOutSearch({
        candidates: [{ name: "Сочи", locationTypes: ["sea", "mountains"] }],
        query,
        client: { callTool: vi.fn(async ({ name }) => success(name)) },
        snapshotPath: "/missing-snapshot.json",
      }),
    );
    const cardEvent = events.find((event) => event.type === "card");

    expect(cardEvent?.card.locationType).toBe("sea mountains");
    const features = extractFeatures(cardEvent!.card, { budget: 60_000 });
    expect(features[FEATURE_NAMES.indexOf("urbanLocation")]).toBe(0);
    expect(features[FEATURE_NAMES.indexOf("leisureLocation")]).toBe(1);
  });

  it("AC9: yields five cards and three candidate_error events when three of eight candidates miss their deadline", async () => {
    vi.useFakeTimers();
    try {
      const client: SearchClient = {
        callTool: vi.fn<SearchClient["callTool"]>(
          ({ name, arguments: args, budgetMs }) => {
          const destination = String(args?.destination ?? args?.city_name);
          if (!["Город 6", "Город 7", "Город 8"].includes(destination)) {
            return Promise.resolve(success(name));
          }
          return new Promise<SearchCallOutcome>((resolve) => {
            setTimeout(
              () =>
                resolve({
                  status: "source_unavailable",
                  failure: { kind: "timeout" },
                  attempts: 1,
                }),
              budgetMs,
            );
          });
          },
        ),
      };

      const pending = collect(
        fanOutSearch({
          candidates: candidates(8),
          query,
          client,
          concurrency: 4,
          targetPoolSize: 8,
          totalBudgetMs: 200,
          candidateBudgetRatio: 0.5,
        }),
      );
      await vi.advanceTimersByTimeAsync(100);
      const events = await pending;

      const cards = events.filter((event) => event.type === "card");
      const errors = events.filter(
        (event) => event.type === "candidate_error",
      );
      expect(cards).toHaveLength(5);
      expect(new Set(cards.map(({ eventId }) => eventId)).size).toBe(5);
      expect(errors).toHaveLength(3);
      expect(errors.every(({ reason }) => reason === "timed_out")).toBe(true);
      expect(events.at(-1)).toMatchObject({
        type: "done",
        pool: cards.map(({ card }) => card),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC8: yields the first card before the rest of the fan-out completes", async () => {
    const controller = new AbortController();
    const slowResolvers: Array<(outcome: SearchCallOutcome) => void> = [];
    const client: SearchClient = {
      callTool: vi.fn<SearchClient["callTool"]>(({ name, arguments: args }) => {
        const destination = args?.destination ?? args?.city_name;
        if (destination === "Город 1") return Promise.resolve(success(name));
        return new Promise<SearchCallOutcome>((resolve) =>
          slowResolvers.push(resolve),
        );
      }),
    };
    const iterator = fanOutSearch({
      candidates: candidates(2),
      query,
      client,
      signal: controller.signal,
      concurrency: 2,
      targetPoolSize: 2,
      totalBudgetMs: 1_000,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "card", card: { destination: "Город 1" } },
    });
    expect(slowResolvers).toHaveLength(2);

    controller.abort();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "aborted", reason: "request_aborted" },
    });
  });

  it("returns done with an empty pool when every candidate validly times out", async () => {
    const client: SearchClient = {
      callTool: vi.fn().mockResolvedValue({
        status: "source_unavailable",
        failure: { kind: "timeout" },
        attempts: 1,
      }),
    };

    const events = await collect(
      fanOutSearch({ candidates: candidates(3), query, client }),
    );

    expect(events.filter(({ type }) => type === "candidate_error")).toHaveLength(
      3,
    );
    expect(events.at(-1)).toEqual({ type: "done", pool: [] });
  });

  it("AC10a: returns unavailable instead of empty done when the whole source is down", async () => {
    const client: SearchClient = {
      callTool: vi.fn().mockResolvedValue({
        status: "source_unavailable",
        failure: { kind: "network" },
        attempts: 1,
      }),
    };

    const events = await collect(
      fanOutSearch({ candidates: candidates(3), query, client }),
    );

    expect(events.at(-1)).toEqual({ type: "unavailable", pool: [] });
    expect(events.some(({ type }) => type === "done")).toBe(false);
  });

  it("CONSTITUTION 16: cancellation yields aborted, stops tail calls and ignores late work", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let lateEffects = 0;
      const receivedSignals = new Set<AbortSignal>();
      const client: SearchClient = {
        callTool: vi.fn<SearchClient["callTool"]>(({ signal, name }) => {
          receivedSignals.add(signal!);
          return new Promise<SearchCallOutcome>((resolve) => {
            const timeout = setTimeout(() => {
              lateEffects += 1;
              resolve(success(name));
            }, 500);
            signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timeout);
                resolve({
                  status: "source_unavailable",
                  failure: { kind: "aborted" },
                  attempts: 1,
                });
              },
              { once: true },
            );
          });
        }),
      };

      const pending = collect(
        fanOutSearch({
          candidates: candidates(8),
          query,
          client,
          signal: controller.signal,
          concurrency: 3,
          totalBudgetMs: 1_000,
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await vi.advanceTimersByTimeAsync(1_000);
      const events = await pending;

      expect(events).toEqual([
        { type: "aborted", reason: "request_aborted", pool: [] },
      ]);
      expect(client.callTool).toHaveBeenCalledTimes(6);
      expect(receivedSignals.size).toBe(1);
      expect([...receivedSignals][0].aborted).toBe(true);
      expect(lateEffects).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("KTD8: starts transport and hotel calls for a candidate in parallel", async () => {
    const started: string[] = [];
    const resolvers = new Map<string, (outcome: SearchCallOutcome) => void>();
    const client: SearchClient = {
      callTool: vi.fn<SearchClient["callTool"]>(({ name }) => {
        started.push(name);
        return new Promise<SearchCallOutcome>((resolve) =>
          resolvers.set(name, resolve),
        );
      }),
    };
    const iterator = fanOutSearch({
      candidates: candidates(1),
      query,
      client,
      totalBudgetMs: 1_000,
    })[Symbol.asyncIterator]();
    const first = iterator.next();
    await vi.waitFor(() => expect(started).toEqual([
      "search_multitransport",
      "search_hotels",
    ]));

    resolvers.get("search_multitransport")!(success("search_multitransport"));
    resolvers.get("search_hotels")!(success("search_hotels"));
    await expect(first).resolves.toMatchObject({ value: { type: "card" } });
  });

  it("F27: requests the selected hotel page during a refill", async () => {
    const client: SearchClient = {
      callTool: vi.fn(async ({ name }) => success(name)),
    };

    await collect(
      fanOutSearch({
        candidates: candidates(1),
        query,
        client,
        hotelPage: 3,
      }),
    );

    expect(client.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "search_hotels",
        arguments: expect.objectContaining({ page: 3 }),
      }),
    );
  });

  it("CONSTITUTION 18: does not retry a 429 whose Retry-After exceeds the candidate deadline", async () => {
    const client: SearchClient = {
      callTool: vi.fn().mockResolvedValue({
        status: "rate_limited",
        retryAfterMs: 1_000,
      }),
    };

    const events = await collect(
      fanOutSearch({
        candidates: candidates(1),
        query,
        client,
        totalBudgetMs: 200,
        candidateBudgetRatio: 0.5,
      }),
    );

    expect(client.callTool).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      {
        type: "candidate_error",
        destination: "Город 1",
        reason: "rate_limited",
      },
      { type: "done", pool: [] },
    ]);
  });

  it("KTD7: caps a queued candidate deadline by the remaining request budget", async () => {
    vi.useFakeTimers();
    try {
      const budgets: number[] = [];
      const client: SearchClient = {
        callTool: vi.fn<SearchClient["callTool"]>(({ name, budgetMs }) => {
          if (name === "search_multitransport") budgets.push(budgetMs!);
          if (budgets.length <= 1) {
            return new Promise<SearchCallOutcome>((resolve) =>
              setTimeout(() => resolve(success(name)), 70),
            );
          }
          return new Promise<SearchCallOutcome>(() => undefined);
        }),
      };

      const pending = collect(
        fanOutSearch({
          candidates: candidates(2),
          query,
          client,
          concurrency: 1,
          targetPoolSize: 2,
          totalBudgetMs: 100,
          candidateBudgetRatio: 0.8,
        }),
      );
      await vi.advanceTimersByTimeAsync(100);
      const events = await pending;

      expect(budgets[0]).toBe(80);
      expect(budgets[1]).toBeGreaterThan(0);
      expect(budgets[1]).toBeLessThanOrEqual(30);
      expect(events.at(-1)).toMatchObject({
        type: "aborted",
        reason: "budget_exhausted",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops in-flight tails after reaching the requested pool size", async () => {
    const receivedSignals: AbortSignal[] = [];
    const client: SearchClient = {
      callTool: vi.fn<SearchClient["callTool"]>(
        ({ name, arguments: args, signal }) => {
        receivedSignals.push(signal!);
        const destination = args?.destination ?? args?.city_name;
        if (destination === "Город 1") return Promise.resolve(success(name));
        return new Promise<SearchCallOutcome>((resolve) =>
          signal?.addEventListener(
            "abort",
            () =>
              resolve({
                status: "source_unavailable",
                failure: { kind: "aborted" },
                attempts: 1,
              }),
            { once: true },
          ),
        );
        },
      ),
    };

    const events = await collect(
      fanOutSearch({
        candidates: candidates(4),
        query,
        client,
        concurrency: 4,
        targetPoolSize: 1,
        totalBudgetMs: 1_000,
      }),
    );

    expect(events.filter(({ type }) => type === "card")).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === "candidate_error" &&
          event.reason === "tail_cancelled",
      ),
    ).toHaveLength(3);
    expect(receivedSignals.every(({ aborted }) => aborted)).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });
});
