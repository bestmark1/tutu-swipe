import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiscoveryQuery } from "@/lib/discovery/schema";
import type {
  HotelSearchDto,
  McpCallOutcome,
  TransportSearchDto,
} from "@/lib/mcp";
import {
  fanOutSearch,
  type FanOutSearchEvent,
  type SearchClient,
} from "@/lib/search/fanout";
import { loadSnapshot } from "@/lib/search/snapshot";
import { projectSnapshotEntry } from "../../scripts/build-snapshot.mjs";

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
      id: "live-transport",
      transport: "railway",
      price: { amount: 5_500, currency: "RUB" },
      durationMinutes: 590,
      carriers: ["ФПК"],
      departureAt: "2026-09-10T08:00:00+03:00",
      arrivalAt: "2026-09-10T17:50:00+03:00",
      searchResultsUrl: "https://www.tutu.ru/live-search",
      legs: [],
    },
  ],
  meta: { unavailable: [] },
};

const hotel: HotelSearchDto = {
  type: "hotel",
  hotels: [
    {
      id: "live-hotel",
      name: "Живой отель",
      photos: [],
      bestOffer: {
        price: { amount: 21_000, currency: "RUB" },
        priceBasis: "stay_total",
      },
    },
  ],
  stay: { checkIn: "2026-09-10", checkOut: "2026-09-14", nights: 4 },
  meta: {},
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("snapshot search", () => {
  it("stores search_results_url but omits expiring checkout data", () => {
    const entry = projectSnapshotEntry({
      origin: "Москва",
      destination: "Сочи",
      builtAt: "2026-08-05T10:00:00.000Z",
      transportPayload: {
        variants: [
          {
            ...snapshotDocument().entries[0].transport,
            checkout_url: "https://www.tutu.ru/expiring-transport",
            checkout_ref: { token: "large-expiring-value" },
          },
        ],
      },
      hotelPayload: {
        hotels: [
          {
            ...snapshotDocument().entries[0].hotel,
            checkout_url: "https://www.tutu.ru/expiring-hotel",
            checkout_ref: { token: "large-expiring-value" },
          },
        ],
        stay: snapshotDocument().entries[0].stay,
      },
    });

    expect(entry).toMatchObject({
      transport: {
        search_results_url: "https://www.tutu.ru/snapshot-search",
      },
    });
    expect(JSON.stringify(entry)).not.toContain("checkout");
  });

  it("AC16: snapshot card carries its build date and price age", () => {
    const builtAt = "2026-08-05T10:00:00.000Z";
    const snapshotPath = writeSnapshot(snapshotDocument(builtAt));

    const snapshot = loadSnapshot({
      filePath: snapshotPath,
      now: new Date("2026-08-05T12:00:00.000Z"),
      staleAfterMs: 3 * 60 * 60 * 1_000,
    });
    const card = snapshot.getCard("Москва", "Сочи");

    expect(card).toMatchObject({
      destination: "Сочи",
      source: "snapshot",
      snapshotBuiltAt: builtAt,
      priceAgeMs: 2 * 60 * 60 * 1_000,
      priceIsStale: false,
      transport: {
        searchResultsUrl: "https://www.tutu.ru/snapshot-search",
      },
    });
  });

  it("AC7: yields a snapshot card before making any MCP call", async () => {
    const snapshotPath = writeSnapshot(snapshotDocument());
    const client = successfulClient();
    const iterator = fanOutSearch({
      candidates: [{ name: "Сочи" }],
      query,
      client,
      snapshotPath,
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: "card",
        source: "snapshot",
        update: "append",
        card: { source: "snapshot", destination: "Сочи" },
      },
    });
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("AC7a: distinguishes a live replacement for the same destination", async () => {
    const snapshotPath = writeSnapshot(snapshotDocument());
    const events = await collect(
      fanOutSearch({
        candidates: [{ name: "Сочи" }],
        query,
        client: successfulClient(),
        snapshotPath,
      }),
    );
    const cards = events.filter((event) => event.type === "card");

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      source: "snapshot",
      update: "append",
    });
    expect(cards[1]).toMatchObject({
      source: "live",
      update: "replace",
      replacesEventId: cards[0].eventId,
      card: { source: "live", destination: "Сочи" },
    });
    expect(events.at(-1)).toMatchObject({
      type: "done",
      pool: [{ destination: "Сочи", source: "live" }],
    });
  });

  it("AC7b: marks a destination outside the snapshot as new", async () => {
    const snapshotPath = writeSnapshot(snapshotDocument());
    const events = await collect(
      fanOutSearch({
        candidates: [{ name: "Псков" }],
        query,
        client: successfulClient(),
        snapshotPath,
      }),
    );

    expect(events[0]).toMatchObject({
      type: "card",
      source: "live",
      update: "append",
      isNewDestination: true,
      card: {
        destination: "Псков",
        source: "live",
        isNewDestination: true,
      },
    });
  });

  it("falls back to live search when the snapshot is corrupted", async () => {
    const snapshotPath = writeRawSnapshot("{not json");
    const client = successfulClient();

    const events = await collect(
      fanOutSearch({
        candidates: [{ name: "Сочи" }],
        query,
        client,
        snapshotPath,
      }),
    );

    expect(client.callTool).toHaveBeenCalledTimes(2);
    expect(events[0]).toMatchObject({
      type: "card",
      source: "live",
      isNewDestination: true,
    });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("falls back to live search when the snapshot file is missing", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tutu-snapshot-"));
    temporaryDirectories.push(directory);

    const events = await collect(
      fanOutSearch({
        candidates: [{ name: "Сочи" }],
        query,
        client: successfulClient(),
        snapshotPath: path.join(directory, "missing.json"),
      }),
    );

    expect(events[0]).toMatchObject({
      type: "card",
      source: "live",
      isNewDestination: true,
    });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("falls back to live search when the snapshot is empty", async () => {
    const snapshotPath = writeSnapshot({
      schemaVersion: 1,
      entries: [],
    });

    const events = await collect(
      fanOutSearch({
        candidates: [{ name: "Сочи" }],
        query,
        client: successfulClient(),
        snapshotPath,
      }),
    );

    expect(events[0]).toMatchObject({
      type: "card",
      source: "live",
      isNewDestination: true,
    });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("uses a snapshot older than the configured threshold but marks it stale", () => {
    const snapshotPath = writeSnapshot(
      snapshotDocument("2026-08-01T10:00:00.000Z"),
    );

    const card = loadSnapshot({
      filePath: snapshotPath,
      now: new Date("2026-08-05T10:00:00.000Z"),
      staleAfterMs: 24 * 60 * 60 * 1_000,
    }).getCard("Москва", "Сочи");

    expect(card).toMatchObject({
      source: "snapshot",
      priceAgeMs: 4 * 24 * 60 * 60 * 1_000,
      priceIsStale: true,
    });
  });
});

function snapshotDocument(builtAt = "2026-08-05T10:00:00.000Z") {
  return {
    schemaVersion: 1,
    entries: [
      {
        origin: "Москва",
        destination: "Сочи",
        builtAt,
        transport: {
          offer_id: "snapshot-transport",
          transport: "railway",
          price: { amount: 5_000, currency: "RUB" },
          duration_min: 600,
          carriers: ["ФПК"],
          departure_at: "2026-09-10T08:00:00+03:00",
          arrival_at: "2026-09-10T18:00:00+03:00",
          search_results_url: "https://www.tutu.ru/snapshot-search",
          legs: [],
        },
        hotel: {
          hotel_id: "snapshot-hotel",
          name: "Снапшотный отель",
          stars: 4,
          rating: 8.7,
          review_count: 120,
          photos: [],
          best_offer: {
            room_name: "Стандарт",
            price: { amount: 20_000, currency: "RUB" },
            price_basis: "stay_total",
            breakfast_included: true,
            free_cancellation: false,
          },
        },
        stay: {
          check_in: "2026-09-10",
          check_out: "2026-09-14",
          nights: 4,
        },
      },
    ],
  };
}

function successfulClient(): SearchClient {
  return {
    callTool: vi.fn<SearchClient["callTool"]>(async ({ name }) => ({
      status: "success",
      data: name === "search_hotels" ? hotel : transport,
      attempts: 1,
    } satisfies McpCallOutcome)),
  };
}

async function collect(stream: AsyncIterable<FanOutSearchEvent>) {
  const events: FanOutSearchEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function writeSnapshot(value: unknown): string {
  return writeRawSnapshot(`${JSON.stringify(value)}\n`);
}

function writeRawSnapshot(value: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "tutu-snapshot-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "snapshot.json");
  writeFileSync(filePath, value);
  return filePath;
}
