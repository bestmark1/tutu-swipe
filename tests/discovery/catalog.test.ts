import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import rawCatalog from "../../data/destinations.json";
import {
  applyCatalogValidation,
  catalogValidation,
  destinationCatalog,
  loadCatalogValidation,
  validateDestinationCatalog,
  type CatalogValidationReport,
} from "@/lib/discovery/catalog";
import { selectDestinations } from "@/lib/discovery/select";
import type { DiscoveryQuery } from "@/lib/discovery/schema";
import {
  classifyToolResult,
  formatCatalogSummary,
  validateCatalogDestination,
} from "../../scripts/validate-catalog.mjs";

const temporaryDirectories: string[] = [];
const catalogFixture: unknown = rawCatalog;

validateDestinationCatalog(catalogFixture);

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function report(
  destinations: CatalogValidationReport["destinations"],
  startedAt = "2026-08-05T09:00:00.000Z",
): CatalogValidationReport {
  return {
    schemaVersion: 2,
    run: {
      status: "complete",
      startedAt,
      completedAt: startedAt,
      catalogHash: "test",
      matrix: {
        origins: ["Москва", "Санкт-Петербург"],
        windowStrategy: "next-season-month-v1",
        nights: 4,
      },
    },
    destinations,
  };
}

function query(): DiscoveryQuery {
  return {
    origin: "Москва",
    travellers: { adults: 2, childrenAges: [] },
    dateWindow: { startDate: "2026-09-10", nights: 4 },
    budget: {
      amount: 80_000,
      currency: "RUB",
      scope: "group_trip_total",
    },
    vibeTags: ["sea"],
  };
}

function temporaryReport(contents?: CatalogValidationReport): string {
  const directory = mkdtempSync(path.join(tmpdir(), "catalog-validation-"));
  temporaryDirectories.push(directory);
  const file = path.join(directory, "catalog-validation.json");
  if (contents) writeFileSync(file, `${JSON.stringify(contents)}\n`);
  return file;
}

describe("catalog validation report", () => {
  it("excludes a destination marked unsuitable", () => {
    const filtered = applyCatalogValidation(
      catalogFixture,
      report({
        Сочи: {
          status: "unsuitable",
          reason: "transport_not_found_from_any_origin",
          checkedAt: "2026-08-05T09:05:00.000Z",
          window: { checkIn: "2026-09-15", checkOut: "2026-09-19" },
          transport: {
            status: "unresolved",
            byOrigin: {},
            reachableFrom: [],
          },
          hotels: { status: "unresolved" },
        },
      }),
    );

    expect(filtered.map(({ name }) => name)).not.toContain("Сочи");
  });

  it("keeps selection working when the report file is absent", () => {
    const state = loadCatalogValidation(temporaryReport(), {
      now: new Date("2026-08-05T12:00:00.000Z"),
    });

    expect(state.source).toBe("missing");
    expect(applyCatalogValidation(catalogFixture, state.report)).toHaveLength(
      catalogFixture.length,
    );
  });

  it("uses a stale report and exposes its staleness", () => {
    const staleReport = report(
      {
        Сочи: {
          status: "unsuitable",
          reason: "transport_not_found_from_any_origin",
          checkedAt: "2026-01-01T09:05:00.000Z",
          window: { checkIn: "2026-01-15", checkOut: "2026-01-19" },
          transport: {
            status: "unresolved",
            byOrigin: {},
            reachableFrom: [],
          },
          hotels: { status: "unresolved" },
        },
      },
      "2026-01-01T09:00:00.000Z",
    );
    const state = loadCatalogValidation(temporaryReport(staleReport), {
      now: new Date("2026-08-05T12:00:00.000Z"),
    });

    expect(state.stale).toBe(true);
    expect(state.runAt).toBe("2026-01-01T09:00:00.000Z");
    expect(
      applyCatalogValidation(catalogFixture, state.report),
    ).not.toContainEqual(expect.objectContaining({ name: "Сочи" }));
  });

  it("distinguishes unresolved places from empty date windows", () => {
    const unresolved = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            variants: [],
            meta: {
              unavailable: [
                {
                  mode: "railway",
                  reason: "no_route",
                  detail: "could not resolve destination='Ейск'",
                },
              ],
            },
          }),
        },
      ],
      isError: false,
    };
    const emptyTransport = {
      content: [
        {
          type: "text",
          text: JSON.stringify({ variants: [], meta: { unavailable: [] } }),
        },
      ],
      isError: false,
    };

    expect(classifyToolResult("search_multitransport", unresolved)).toBe(
      "unresolved",
    );
    expect(classifyToolResult("search_multitransport", emptyTransport)).toBe(
      "no_offers_for_dates",
    );
  });

  it("marks a destination unsuitable when transport is unresolved from every origin", async () => {
    const unresolvedTransport = toolResult({
      variants: [],
      meta: {
        unavailable: [
          {
            mode: "railway",
            reason: "no_route",
            detail: "could not resolve destination='Ейск'",
          },
        ],
      },
    });
    const hotelsFound = toolResult({ hotels: [{ id: "hotel-1" }] });
    const invoke = vi
      .fn()
      .mockImplementation(({ name }: { name: string }) =>
        Promise.resolve(
          name === "search_hotels" ? hotelsFound : unresolvedTransport,
        ),
      );

    await expect(
      validateCatalogDestination(catalogDestination("Ейск"), {
        invoke,
        origins: ["Москва", "Казань"],
        now: new Date("2026-08-05T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "unsuitable",
      reason: "transport_not_found_from_any_origin",
      transport: { reachableFrom: [] },
      hotels: { status: "offers_found" },
    });
  });

  it("keeps a destination suitable when transport is found from one origin", async () => {
    const unresolvedTransport = toolResult({
      variants: [],
      meta: {
        unavailable: [{ reason: "no_route" }],
      },
    });
    const transportFound = toolResult({ variants: [{ id: "route-1" }] });
    const unresolvedHotels = {
      content: [
        {
          type: "text",
          text: "Error executing tool search_hotels: could not resolve city_name='Белокуриха' via Tutu suggest",
        },
      ],
      isError: true,
    };
    const invoke = vi.fn().mockImplementation(
      ({ name, arguments: args }: { name: string; arguments: { origin?: string } }) =>
        Promise.resolve(
          name === "search_hotels"
            ? unresolvedHotels
            : args.origin === "Новосибирск"
              ? transportFound
              : unresolvedTransport,
        ),
    );

    const result = await validateCatalogDestination(
      catalogDestination("Белокуриха"),
      {
        invoke,
        origins: ["Москва", "Новосибирск", "Казань"],
        now: new Date("2026-08-05T12:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      status: "suitable",
      hotels: { status: "unresolved" },
    });
    expect(result).not.toHaveProperty("reason");
  });

  it("stores every origin from which the destination is reachable", async () => {
    const transportFound = toolResult({ variants: [{ id: "route-1" }] });
    const unresolvedTransport = toolResult({
      variants: [],
      meta: { unavailable: [{ reason: "no_route" }] },
    });
    const invoke = vi.fn().mockImplementation(
      ({ name, arguments: args }: { name: string; arguments: { origin?: string } }) =>
        Promise.resolve(
          name === "search_hotels"
            ? toolResult({ hotels: [] })
            : args.origin === "Казань" || args.origin === "Новосибирск"
              ? transportFound
              : unresolvedTransport,
        ),
    );

    await expect(
      validateCatalogDestination(catalogDestination("Белокуриха"), {
        invoke,
        origins: ["Москва", "Казань", "Новосибирск"],
        now: new Date("2026-08-05T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      transport: { reachableFrom: ["Казань", "Новосибирск"] },
    });
  });

  it("lists unsuitable destinations by name in the run summary", () => {
    expect(
      formatCatalogSummary({
        Суздаль: { status: "unsuitable" },
        Сочи: { status: "suitable" },
        Ейск: { status: "unsuitable" },
      }),
    ).toBe("непригодных 2 (Ейск, Суздаль)");
  });

  it("keeps the 3–8 candidate boundary after report filtering", () => {
    const candidates = selectDestinations(query());

    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates.length).toBeLessThanOrEqual(8);
    expect(catalogValidation.unavailableDestinationNames).toEqual(
      expect.not.arrayContaining(candidates.map(({ name }) => name)),
    );
    expect(destinationCatalog.length).toBeGreaterThanOrEqual(3);
  });
});

function toolResult(payload: object) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: false,
  };
}

function catalogDestination(name: string) {
  const destination = rawCatalog.find((entry) => entry.name === name);
  if (!destination) throw new Error(`${name} отсутствует в каталоге`);
  return destination;
}
