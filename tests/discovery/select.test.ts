import { describe, expect, it } from "vitest";

import { destinationCatalog } from "@/lib/discovery/catalog";
import {
  selectDestinationPage,
  selectDestinations,
} from "@/lib/discovery/select";
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
        budget: { currency: "RUB" as const, scope: "group_trip_total" as const, ...query().budget, amount: 60_000 },
      }),
    );
    const matching = candidates.filter(({ locationTypes }) =>
      locationTypes.includes("mountains"),
    );
    const fallbacks = candidates.filter(({ locationTypes }) =>
      !locationTypes.includes("mountains"),
    );

    // Проверяем именно правило добора, а не точное число: после того как
    // пороги ценовых классов привели к фактическим данным, подходящих
    // направлений в выдаче стало больше.
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.every(({ isFallback }) => !isFallback)).toBe(true);
    expect(fallbacks.every(({ isFallback }) => isFallback)).toBe(true);
    // Подходящие идут первыми, запасные — только после них.
    const firstFallback = candidates.findIndex(({ isFallback }) => isFallback);
    const lastMatching = candidates.reduce(
      (last, { isFallback }, index) => (isFallback ? last : index),
      -1,
    );
    if (firstFallback >= 0) expect(firstFallback).toBeGreaterThan(lastMatching);
  });

  it("excludes the departure city from candidates", () => {
    const candidates = selectDestinations(
      query({
        origin: "Казань",
        vibeTags: ["city"],
        budget: { currency: "RUB" as const, scope: "group_trip_total" as const, ...query().budget, amount: 150_000 },
      }),
    );

    expect(candidates.map(({ name }) => name)).not.toContain("Казань");
  });

  it("keeps the cheapest candidates and marks them when every class is over budget", () => {
    const candidates = selectDestinations(
      query({ budget: { currency: "RUB" as const, scope: "group_trip_total" as const, ...query().budget, amount: 1_000 } }),
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
          budget: { currency: "RUB" as const, scope: "group_trip_total" as const, ...query().budget, amount },
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
        budget: { currency: "RUB" as const, scope: "group_trip_total" as const, ...query().budget, amount: 150_000 },
      }),
    ).map(({ name }) => name);
    const cities = selectDestinations(
      query({
        vibeTags: ["city"],
        budget: { currency: "RUB" as const, scope: "group_trip_total" as const, ...query().budget, amount: 150_000 },
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

  it("F25: названное направление показывается даже дороже бюджета", () => {
    const candidates = selectDestinations(
      query({
        budget: { currency: "RUB" as const, scope: "group_trip_total" as const, ...query().budget, amount: 1_000 },
        namedDestinations: ["Горно-Алтайск"],
      }),
    );

    expect(candidates[0]).toMatchObject({
      name: "Горно-Алтайск",
      aboveBudget: true,
      isFallback: false,
    });
  });

  // Человек, назвавший город, выбор уже сделал. Прежде к названному Сочи
  // подмешивались Туапсе и Ейск — формально похожие, но не то, о чём просили.
  it("F25: названное направление не разбавляется подбором", () => {
    const candidates = selectDestinations(
      query({ namedDestinations: ["Сочи"] }),
    );

    expect(candidates.map(({ name }) => name)).toEqual(["Сочи"]);
  });

  it("F25: несколько названных направлений идут все и в своём порядке", () => {
    const candidates = selectDestinations(
      query({ namedDestinations: ["Иркутск", "Улан-Удэ"] }),
    );

    expect(candidates.map(({ name }) => name)).toEqual(["Иркутск", "Улан-Удэ"]);
  });

  it("F25: если названного нет в каталоге, работает обычный подбор", () => {
    const candidates = selectDestinations(
      query({ namedDestinations: ["Суздаль"] }),
    );

    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.map(({ name }) => name)).not.toContain("Суздаль");
  });

  it("F25: preserves named order and removes duplicates from regular selection", () => {
    const candidates = selectDestinations(
      query({
        vibeTags: ["city"],
        budget: { currency: "RUB" as const, scope: "group_trip_total" as const, ...query().budget, amount: 150_000 },
        namedDestinations: ["Казань", "Сочи", "Казань"],
      }),
    );
    const names = candidates.map(({ name }) => name);

    expect(names.slice(0, 2)).toEqual(["Казань", "Сочи"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("F27: continuation advances through the catalog and omits excluded cities", () => {
    const first = selectDestinationPage(query(), { page: 0 });
    const excluded = first.candidates[0]!.name;
    const second = selectDestinationPage(query(), {
      page: 1,
      excludedDestinations: [excluded],
    });
    const firstNames = new Set(first.candidates.map(({ name }) => name));

    expect(second.candidates.map(({ name }) => name)).not.toContain(excluded);
    expect(
      second.candidates.every(({ name }) => !firstNames.has(name)),
    ).toBe(true);
  });

  it("F27: a named city advances hotel pages instead of adding other cities", () => {
    const second = selectDestinationPage(
      query({ namedDestinations: ["Сочи"] }),
      { page: 1 },
    );

    expect(second.candidates.map(({ name }) => name)).toEqual(["Сочи"]);
    expect(second.hotelPage).toBe(2);
  });

  it("F27: an excluded named city is not replaced with unrelated cities", () => {
    const next = selectDestinationPage(
      query({ namedDestinations: ["Сочи"] }),
      { page: 1, excludedDestinations: ["Сочи"] },
    );

    expect(next.candidates).toEqual([]);
  });

  // Зарубежные направления не подмешиваются в подбор без спроса: на «хочу на
  // море» в ленте оказывался Баку, куда нужен загранпаспорт.
  it("не подмешивает зарубежные направления без явной просьбы", () => {
    const candidates = selectDestinations(query({ vibeTags: ["sea"] }));

    expect(candidates.map(({ name }) => name)).not.toContain("Баку");
  });

  it("возвращает зарубежные, когда человек позвал за границу", () => {
    const candidates = selectDestinations(
      query({ vibeTags: ["sea"], abroadRequested: true }),
    );

    expect(candidates.map(({ name }) => name)).toContain("Баку");
  });

  it("показывает названное зарубежное направление всегда", () => {
    const candidates = selectDestinations(
      query({ vibeTags: [], namedDestinations: ["Баку"] }),
    );

    expect(candidates.map(({ name }) => name)).toEqual(["Баку"]);
  });
});
