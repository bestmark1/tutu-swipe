import { describe, expect, it, vi } from "vitest";

import { parseTravelQuery } from "@/lib/discovery/parse";
import type { DiscoveryFallbackParser } from "@/lib/discovery/schema";

const TODAY = new Date("2026-08-05T12:00:00.000Z");
const COMPLETE_QUERY =
  "на море в сентябре вдвоём из Москвы до 60к, чтобы не шумно";

describe("rule-based discovery query parsing", () => {
  it("AC1: parses a complete phrase without calling the fallback", async () => {
    const fallback: DiscoveryFallbackParser = {
      parse: vi.fn(),
    };

    const result = await parseTravelQuery(COMPLETE_QUERY, {
      today: TODAY,
      fallback,
    });

    expect(fallback.parse).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "success",
      source: "rules",
      assumedFields: [],
      query: {
        origin: "Москва",
        travellers: { adults: 2, childrenAges: [] },
        dateWindow: { startDate: "2026-09-10", nights: 4 },
        budget: {
          amount: 60_000,
          currency: "RUB",
          scope: "group_trip_total",
        },
        vibeTags: ["sea", "quiet"],
      },
    });
  });

  it("AC4: resolves the same vague month to the same concrete window", async () => {
    const first = await parseTravelQuery(COMPLETE_QUERY, { today: TODAY });
    const second = await parseTravelQuery(COMPLETE_QUERY, { today: TODAY });

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    if (first.status !== "success" || second.status !== "success") {
      throw new Error("Expected successful parses");
    }

    expect(first.query.dateWindow).toEqual(second.query.dateWindow);
  });

  it("AC5: normalizes common ruble budget spellings", async () => {
    const phrases = [
      ["до 60к", 60_000],
      ["60000 рублей", 60_000],
      ["60 тыс", 60_000],
      ["бюджетом до 75000", 75_000],
    ] as const;
    const budgets = await Promise.all(
      phrases.map(async ([budget, expectedAmount]) => {
        const result = await parseTravelQuery(
          `на море в сентябре вдвоём из Москвы ${budget}`,
          { today: TODAY },
        );
        if (result.status !== "success") {
          throw new Error(`Expected ${budget} to be parsed`);
        }
        expect(result.query.budget.amount).toBe(expectedAmount);
        return result.query.budget;
      }),
    );

    expect(budgets.every((budget) => budget.currency === "RUB")).toBe(true);
  });

  it.each([
    "поездка до 2026-09-10 из Москвы",
    "до 2027 года",
    "до 1000 ночей",
    "7 тыс. ночей",
    "на 5 дней",
    "на 3 ночи",
    "2 года",
  ])("does not treat dates or durations as a budget: %s", async (phrase) => {
    const result = await parseTravelQuery(phrase, { today: TODAY });

    // Отсутствие бюджета больше не отказ: поиск идёт без ценового потолка.
    // Проверяем главное — число из даты или длительности не стало бюджетом.
    if (result.status === "success") {
      expect(result.query.budget).toBeUndefined();
      expect(result.assumedFields).toContain("budget");
      return;
    }
    if (result.status === "rejected") {
      expect(result.missingFields).toContain("budget");
      return;
    }
    throw new Error(`Expected ${phrase} to have no budget, got ${result.status}`);
  });

  it("AC5: marks the budget as the total for the group and trip", async () => {
    const result = await parseTravelQuery(COMPLETE_QUERY, { today: TODAY });

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.budget.scope).toBe("group_trip_total");
    expect(result.query.budget.amount).toBe(60_000);
  });

  it.each(["вдвоём", "на двоих", "2 взрослых"])(
    "normalizes traveller composition from %s",
    async (travellers) => {
      const result = await parseTravelQuery(
        `на море в сентябре ${travellers} из Москвы до 60к`,
        { today: TODAY },
      );

      expect(result.status).toBe("success");
      if (result.status !== "success") {
        throw new Error("Expected a successful parse");
      }
      expect(result.query.travellers).toEqual({
        adults: 2,
        childrenAges: [],
      });
    },
  );

  it.each([
    ["втроём", 3],
    ["втроем", 3],
    ["на троих", 3],
    ["вчетвером", 4],
    ["на четверых", 4],
    ["впятером", 5],
    ["на пятерых", 5],
    ["трое взрослых", 3],
  ])("normalizes larger traveller groups from %s", async (travellers, adults) => {
    const result = await parseTravelQuery(
      `на море в сентябре ${travellers} из Москвы до 60к`,
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.travellers).toEqual({ adults, childrenAges: [] });
  });

  it.each([
    ["нас трое", 3],
    ["3 человека", 3],
    ["на 3 человек", 3],
    ["4 чел", 4],
    ["5 чел.", 5],
    ["для троих", 3],
    ["семьёй из четырёх человек", 4],
    ["из 7 человек", 7],
    ["вшестером", 6],
    ["всемером", 7],
    ["ввосьмером", 8],
    ["вдевятером", 9],
    ["на шестерых", 6],
    ["на семерых", 7],
    ["на восьмерых", 8],
    ["на девятерых", 9],
  ])("parses common group-size form %s", async (travellers, adults) => {
    const result = await parseTravelQuery(
      `на море в сентябре ${travellers} из Москвы до 60к`,
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.travellers).toEqual({ adults, childrenAges: [] });
  });

  it.each([
    ["нас двое", 2],
    ["нас трое", 3],
    ["нас четверо", 4],
    ["нас пятеро", 5],
    ["нас шестеро", 6],
    ["нас семеро", 7],
    ["для двоих", 2],
    ["для троих", 3],
    ["для четверых", 4],
    ["для пятерых", 5],
    ["из двух человек", 2],
    ["из трёх человек", 3],
    ["из четырёх человек", 4],
    ["из пяти человек", 5],
    ["из шести человек", 6],
    ["из семи человек", 7],
  ])("parses word-based group size %s", async (travellers, adults) => {
    const result = await parseTravelQuery(
      `на море в сентябре ${travellers} из Москвы до 60к`,
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.travellers).toEqual({ adults, childrenAges: [] });
  });

  it.each([
    "на 5 дней",
    "на 3 ночи",
    "ребёнку 2 года",
    "до 30 000",
    "в 2 звезды",
    "за 3 часа",
    "на 100 человек",
    "10 взрослых",
    "вдесятером",
  ])("does not infer travellers from unrelated or oversized count: %s", async (phrase) => {
    const fallback: DiscoveryFallbackParser = {
      parse: vi.fn().mockResolvedValue(null),
    };
    const result = await parseTravelQuery(
      `на море в сентябре из Москвы ${phrase}`,
      { today: TODAY, fallback },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse with defaults");
    }
    expect(result.query.travellers).toEqual({ adults: 1, childrenAges: [] });
    expect(result.assumedFields).toContain("travellers");
  });

  it.each([
    ["до 30 000", 30_000],
    ["до 30\u00a0000", 30_000],
    ["до 30000", 30_000],
    ["30 000 рублей", 30_000],
  ])("parses grouped digits in budget: %s", async (budget, amount) => {
    const result = await parseTravelQuery(
      `на море в сентябре вдвоём из Москвы ${budget}`,
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.budget.amount).toBe(amount);
  });

  it("extracts adults and child ages without guessing them", async () => {
    const result = await parseTravelQuery(
      "на море в сентябре 2 взрослых и двое детей 5 и 9 лет из Москвы до 90 тыс",
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.travellers).toEqual({
      adults: 2,
      childrenAges: [5, 9],
    });
  });

  it("uses the city dictionary for recognition without treating it as geo validation", async () => {
    const result = await parseTravelQuery(
      "на море в сентябре на двоих из Казани до 60 тыс",
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.origin).toBe("Казань");
  });

  it("AC6: rejects unrecognized input with an actionable hint", async () => {
    const fallback: DiscoveryFallbackParser = {
      parse: vi.fn().mockResolvedValue(null),
    };

    const result = await parseTravelQuery("абракадабра 123", {
      today: TODAY,
      fallback,
    });

    expect(fallback.parse).toHaveBeenCalledOnce();
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("Expected an explicit rejection");
    }
    expect(result.code).toBe("unrecognized");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.hint).toMatch(/город|дат|бюджет/i);
  });

  it("AC4: uses the injected current date instead of the system clock", async () => {
    const in2026 = await parseTravelQuery(COMPLETE_QUERY, {
      today: new Date("2026-08-05T12:00:00.000Z"),
    });
    const in2027 = await parseTravelQuery(COMPLETE_QUERY, {
      today: new Date("2027-08-05T12:00:00.000Z"),
    });

    expect(in2026.status).toBe("success");
    expect(in2027.status).toBe("success");
    if (in2026.status !== "success" || in2027.status !== "success") {
      throw new Error("Expected successful parses");
    }
    expect(in2026.query.dateWindow).toEqual({
      startDate: "2026-09-10",
      nights: 4,
    });
    expect(in2027.query.dateWindow).toEqual({
      startDate: "2027-09-10",
      nights: 4,
    });
  });

  it("finds the next valid leap day after this year's date has passed", async () => {
    const result = await parseTravelQuery(
      "на море 29 февраля вдвоём из Москвы до 60к",
      { today: new Date("2028-03-01T12:00:00.000Z") },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.dateWindow).toEqual({
      startDate: "2032-02-29",
      nights: 4,
    });
  });

  it("finds the next valid leap day from a non-leap year", async () => {
    const result = await parseTravelQuery(
      "на море 29 февраля вдвоём из Москвы до 60к",
      { today: new Date("2026-06-01T12:00:00.000Z") },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.dateWindow).toEqual({
      startDate: "2028-02-29",
      nights: 4,
    });
  });

  it("AC6: rejects an explicitly dated trip in the past", async () => {
    const result = await parseTravelQuery(
      "на море 10 сентября 2025 вдвоём из Москвы до 60к",
      { today: TODAY },
    );

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("Expected an explicit rejection");
    }
    expect(result.missingFields).toContain("dateWindow");
  });

  it("rolls an ordinary past month and day into the next year", async () => {
    const result = await parseTravelQuery(
      "на море 10 января вдвоём из Москвы до 60к",
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.dateWindow).toEqual({
      startDate: "2027-01-10",
      nights: 4,
    });
  });

  it.each([
    ["хочу к пляжу и уединения", ["sea", "quiet"]],
    ["хочу походы в горах и активный отдых", ["mountains", "active"]],
    ["интересны музеи и архитектура", ["city", "culture"]],
  ])("extracts vibe tags from synonyms: %s", async (vibe, expectedTags) => {
    const result = await parseTravelQuery(
      `${vibe}, в сентябре вдвоём из Москвы до 60к`,
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.query.vibeTags).toEqual(expectedTags);
  });

  it("lets the fallback fill only fields that rules did not recognize", async () => {
    const fallback: DiscoveryFallbackParser = {
      parse: vi.fn().mockResolvedValue({
        origin: "Санкт-Петербург",
        vibeTags: ["culture"],
      }),
    };

    const result = await parseTravelQuery(
      "в сентябре вдвоём из Москвы до 60к",
      { today: TODAY, fallback },
    );

    expect(fallback.parse).toHaveBeenCalledOnce();
    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a successful parse");
    }
    expect(result.source).toBe("rules+fallback");
    expect(result.query.origin).toBe("Москва");
    expect(result.query.vibeTags).toEqual(["culture"]);
  });
});
