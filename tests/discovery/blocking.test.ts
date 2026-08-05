import { describe, expect, it } from "vitest";

import { parseTravelQuery } from "@/lib/discovery/parse";

const TODAY = new Date("2026-08-05T12:00:00.000Z");

describe("blocking discovery fields", () => {
  it("AC2: requests the departure city before search", async () => {
    const result = await parseTravelQuery(
      "на море в сентябре вдвоём до 60к, чтобы не шумно",
      { today: TODAY },
    );

    expect(result.status).toBe("needs_clarification");
    if (result.status !== "needs_clarification") {
      throw new Error("Expected a clarification request");
    }
    expect(result.blockingFields).toEqual(["origin"]);
    expect(result.clarifications).toEqual([
      {
        field: "origin",
        question: "Из какого города вы отправляетесь?",
      },
    ]);
  });

  it("AC3: requests a child's age when a child is mentioned without it", async () => {
    const result = await parseTravelQuery(
      "на море в сентябре вдвоём с ребёнком из Москвы до 60к, чтобы не шумно",
      { today: TODAY },
    );

    expect(result.status).toBe("needs_clarification");
    if (result.status !== "needs_clarification") {
      throw new Error("Expected a clarification request");
    }
    expect(result.blockingFields).toEqual(["childrenAges"]);
    expect(result.clarifications).toEqual([
      {
        field: "childrenAges",
        question: "Сколько лет каждому ребёнку?",
      },
    ]);
  });

  it("does not block when all mentioned children's ages are present", async () => {
    const result = await parseTravelQuery(
      "на море в сентябре вдвоём с детьми 5 и 9 лет из Москвы до 90к, чтобы не шумно",
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a search-ready query");
    }
    expect(result.query.travellers).toEqual({
      adults: 2,
      childrenAges: [5, 9],
    });
  });

  it("does not require child ages when children are not mentioned", async () => {
    const result = await parseTravelQuery(
      "на море в сентябре вдвоём из Москвы до 60к, чтобы не шумно",
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a search-ready query");
    }
    expect(result.query.travellers.childrenAges).toEqual([]);
  });

  it("returns every missing blocking field instead of only the first", async () => {
    const result = await parseTravelQuery(
      "на море в сентябре вдвоём с ребёнком до 60к, чтобы не шумно",
      { today: TODAY },
    );

    expect(result.status).toBe("needs_clarification");
    if (result.status !== "needs_clarification") {
      throw new Error("Expected a clarification request");
    }
    expect(result.blockingFields).toEqual(["origin", "childrenAges"]);
    expect(result.clarifications.map(({ field }) => field)).toEqual([
      "origin",
      "childrenAges",
    ]);
  });

  it("leaves a complete phrase ready for search", async () => {
    const result = await parseTravelQuery(
      "на море в сентябре вдвоём с детьми 5 и 9 лет из Москвы до 90к, чтобы не шумно",
      { today: TODAY },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected a search-ready query");
    }
    expect(result.query.origin).toBe("Москва");
    expect(result.query.travellers.childrenAges).toEqual([5, 9]);
  });

  it("AC6: gives every blocking field a concrete non-empty question", async () => {
    const result = await parseTravelQuery(
      "на море в сентябре вдвоём с ребёнком до 60к, чтобы не шумно",
      { today: TODAY },
    );

    expect(result.status).toBe("needs_clarification");
    if (result.status !== "needs_clarification") {
      throw new Error("Expected a clarification request");
    }
    expect(result.clarifications).toHaveLength(2);
    expect(result.clarifications[0].question).toMatch(/город/i);
    expect(result.clarifications[1].question).toMatch(/лет|возраст/i);
    expect(
      result.clarifications.every(({ question }) => question.trim().length > 0),
    ).toBe(true);
  });
});
