import { describe, expect, it } from "vitest";

import { destinationCatalog } from "@/lib/discovery/catalog";
import { selectDestinations } from "@/lib/discovery/select";
import type { DiscoveryQuery, VibeTag } from "@/lib/discovery/schema";

function query(overrides: Partial<DiscoveryQuery> = {}): DiscoveryQuery {
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
    ...overrides,
  };
}

describe("offline destination selection", () => {
  it("selects seasonal seaside destinations for a September sea query", () => {
    const candidates = selectDestinations(query());

    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates.length).toBeLessThanOrEqual(8);
    expect(
      candidates.every(
        ({ locationTypes, seasonMonths }) =>
          locationTypes.includes("sea") && seasonMonths.includes(9),
      ),
    ).toBe(true);
  });

  it("fills to the minimum with marked fallbacks when fewer than 3 match the category", () => {
    const candidates = selectDestinations(
      query({
        vibeTags: ["mountains"],
        budget: { ...query().budget, amount: 60_000 },
      }),
    );
    const matching = candidates.filter(({ locationTypes }) =>
      locationTypes.includes("mountains"),
    );
    const fallbacks = candidates.filter(({ locationTypes }) =>
      !locationTypes.includes("mountains"),
    );

    expect(candidates).toHaveLength(3);
    expect(matching).toHaveLength(2);
    expect(matching.every(({ isFallback }) => !isFallback)).toBe(true);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks.every(({ isFallback }) => isFallback)).toBe(true);
  });

  it("excludes the departure city from candidates", () => {
    const candidates = selectDestinations(
      query({
        origin: "Казань",
        vibeTags: ["city"],
        budget: { ...query().budget, amount: 150_000 },
      }),
    );

    expect(candidates.map(({ name }) => name)).not.toContain("Казань");
  });

  it("keeps the cheapest candidates and marks them when every class is over budget", () => {
    const candidates = selectDestinations(
      query({ budget: { ...query().budget, amount: 1_000 } }),
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(({ priceClass }) => priceClass === "low")).toBe(
      true,
    );
    expect(candidates.every(({ aboveBudget }) => aboveBudget)).toBe(true);
  });

  it.each([
    ["sea", "2026-01-15", 20_000],
    ["mountains", "2026-07-01", 60_000],
    ["city", "2026-11-20", 150_000],
    ["nature", "2026-05-01", 45_000],
    ["quiet", "2026-03-12", 1_000],
  ] satisfies Array<[VibeTag, string, number]>)(
    "always returns 3–8 candidates for %s",
    (vibe, startDate, amount) => {
      const candidates = selectDestinations(
        query({
          dateWindow: { startDate, nights: 7 },
          budget: { ...query().budget, amount },
          vibeTags: [vibe],
        }),
      );

      expect(candidates.length).toBeGreaterThanOrEqual(3);
      expect(candidates.length).toBeLessThanOrEqual(8);
    },
  );

  it("returns identical candidates in identical order for identical input", () => {
    const input = query({
      origin: "Санкт-Петербург",
      vibeTags: ["culture", "quiet"],
    });

    expect(selectDestinations(input)).toEqual(selectDestinations(input));
  });

  it("produces different sets for mountain and city tags", () => {
    const mountains = selectDestinations(
      query({
        vibeTags: ["mountains"],
        budget: { ...query().budget, amount: 150_000 },
      }),
    ).map(({ name }) => name);
    const cities = selectDestinations(
      query({
        vibeTags: ["city"],
        budget: { ...query().budget, amount: 150_000 },
      }),
    ).map(({ name }) => name);

    expect(mountains).not.toEqual(cities);
  });

  it("contains 40–60 valid destinations with unique names", () => {
    expect(destinationCatalog.length).toBeGreaterThanOrEqual(40);
    expect(destinationCatalog.length).toBeLessThanOrEqual(60);
    expect(new Set(destinationCatalog.map(({ name }) => name)).size).toBe(
      destinationCatalog.length,
    );

    for (const destination of destinationCatalog) {
      expect(destination.name.trim()).not.toBe("");
      expect(destination.locationTypes.length).toBeGreaterThan(0);
      expect(destination.seasonMonths.length).toBeGreaterThan(0);
      expect(destination.priceClass).toMatch(/^(low|medium|high)$/);
      expect(Object.values(destination.reachability).flat().length).toBe(6);
    }
  });

  it("F25: puts a named destination first even when it is above budget", () => {
    const withoutNamed = selectDestinations(
      query({ budget: { ...query().budget, amount: 1_000 } }),
    );
    const candidates = selectDestinations(
      query({
        budget: { ...query().budget, amount: 1_000 },
        namedDestinations: ["Горно-Алтайск"],
      }),
    );

    expect(candidates).toHaveLength(withoutNamed.length);
    expect(candidates[0]).toMatchObject({
      name: "Горно-Алтайск",
      aboveBudget: true,
      isFallback: false,
    });
  });

  it("F25: preserves named order and removes duplicates from regular selection", () => {
    const candidates = selectDestinations(
      query({
        vibeTags: ["city"],
        budget: { ...query().budget, amount: 150_000 },
        namedDestinations: ["Казань", "Сочи", "Казань"],
      }),
    );
    const names = candidates.map(({ name }) => name);

    expect(names.slice(0, 2)).toEqual(["Казань", "Сочи"]);
    expect(new Set(names).size).toBe(names.length);
  });
});
