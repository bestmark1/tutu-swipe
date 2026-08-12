import { describe, expect, it } from "vitest";

import { assumedFieldChips } from "@/lib/discovery/assumed";
import type { DiscoveryQuery } from "@/lib/discovery/schema";

const QUERY = {
  origin: "Москва",
  travellers: { adults: 1, childrenAges: [] },
  dateWindow: { startDate: "2026-09-10", nights: 4 },
  budget: {
    amount: 80_000,
    currency: "RUB",
    scope: "group_trip_total",
  },
  vibeTags: ["sea"],
} satisfies DiscoveryQuery;

describe("assumed field chips", () => {
  it("labels every defaulted field with its substituted value", () => {
    const chips = assumedFieldChips(QUERY, [
      "travellers",
      "dateWindow",
      "budget",
      "vibeTags",
    ]);

    expect(chips.map(normalizeSpaces)).toEqual([
      { field: "travellers", label: "1 взрослый" },
      { field: "dateWindow", label: "10 сентября, 4 ночи" },
      { field: "budget", label: "до 80 000 ₽" },
      { field: "vibeTags", label: "море" },
    ]);
  });

  it("returns nothing when everything came from the phrase", () => {
    expect(assumedFieldChips(QUERY, [])).toEqual([]);
  });

  it("names children ages when a family composition is substituted", () => {
    const chips = assumedFieldChips(
      {
        ...QUERY,
        travellers: { adults: 2, childrenAges: [7, 9] },
      },
      ["travellers"],
    );

    expect(chips).toEqual([
      { field: "travellers", label: "2 взрослых, дети 7 и 9 лет" },
    ]);
  });

  it("shows the preference instead of an invented amount when budget is uncapped", () => {
    const uncapped = { ...QUERY, budget: undefined } as unknown as DiscoveryQuery;

    expect(assumedFieldChips(uncapped, ["budget"])).toEqual([
      { field: "budget", label: "без ограничения по цене" },
    ]);
    expect(
      assumedFieldChips(
        { ...uncapped, budgetPreference: "low" },
        ["budget"],
      ),
    ).toEqual([{ field: "budget", label: "недорого" }]);
  });

  it("names an empty vibe default as any type of holiday", () => {
    const chips = assumedFieldChips({ ...QUERY, vibeTags: [] }, ["vibeTags"]);

    expect(chips).toEqual([
      { field: "vibeTags", label: "любой тип отдыха" },
    ]);
  });

  it("keeps the chip order and skips unknown values without crashing", () => {
    const broken = {
      ...QUERY,
      dateWindow: { startDate: "не дата", nights: 4 },
    };

    expect(assumedFieldChips(broken, ["dateWindow", "travellers"])).toEqual([
      { field: "travellers", label: "1 взрослый" },
    ]);
  });
});

/** Intl.NumberFormat вставляет неразрывные пробелы; для сравнения они не важны. */
function normalizeSpaces(chip: { field: string; label: string }) {
  return { ...chip, label: chip.label.replace(/\s/gu, " ") };
}
