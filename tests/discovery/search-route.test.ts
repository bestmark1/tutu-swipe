import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchOnceResult } from "@/lib/usecases/search-once";

type SearchOnce = typeof import("@/lib/usecases/search-once").searchOnce;

const searchOnceMock = vi.hoisted(() => vi.fn<SearchOnce>());

vi.mock("@/lib/usecases/search-once", () => ({
  searchOnce: searchOnceMock,
}));

import { POST } from "@/app/api/search/route";

function requestWithBody(body: BodyInit) {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

const sourceUnavailableResult = {
  status: "source_unavailable",
  query: {
    origin: "Москва",
    travellers: { adults: 2, childrenAges: [] },
    dateWindow: { startDate: "2026-09-10", nights: 4 },
    budget: { amount: 100_000, currency: "RUB", scope: "group_trip_total" },
    vibeTags: ["sea"],
  },
  message: "Туту сейчас не отвечает. Попробуйте повторить поиск позже.",
} satisfies SearchOnceResult;

describe("POST /api/search", () => {
  beforeEach(() => {
    searchOnceMock.mockReset();
  });

  it("returns 400 for an empty input without calling the scenario", async () => {
    const response = await POST(
      requestWithBody(JSON.stringify({ input: "   " })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "empty_input",
      message: "Опишите поездку одной фразой.",
    });
    expect(searchOnceMock).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{"],
    ["a JSON array", JSON.stringify(["trip"])],
    ["a JSON primitive", JSON.stringify("trip")],
  ])("returns 400 for %s", async (_case, body) => {
    const response = await POST(requestWithBody(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "invalid_json",
      message: "Тело запроса должно быть JSON-объектом.",
    });
    expect(searchOnceMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing input", {}],
    ["an unexpected input type", { input: 42 }],
  ])("returns 400 for %s", async (_case, body) => {
    const response = await POST(requestWithBody(JSON.stringify(body)));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      code: "empty_input",
    });
    expect(searchOnceMock).not.toHaveBeenCalled();
  });

  it("passes the input and request signal to the scenario", async () => {
    searchOnceMock.mockResolvedValue(sourceUnavailableResult);
    const request = requestWithBody(JSON.stringify({ input: "  море  " }));

    await POST(request);

    expect(searchOnceMock).toHaveBeenCalledWith("  море  ", {
      signal: request.signal,
    });
  });

  it.each([
    ["source_unavailable", sourceUnavailableResult, 503],
    [
      "needs_clarification",
      {
        status: "needs_clarification",
        source: "rules",
        blockingFields: ["origin"],
        clarifications: [
          { field: "origin", question: "Из какого города выезжаете?" },
        ],
      } satisfies SearchOnceResult,
      422,
    ],
    [
      "rejected",
      {
        status: "rejected",
        source: "rules",
        code: "unrecognized",
        message: "Не удалось распознать запрос.",
        hint: "Укажите город, даты и бюджет.",
        missingFields: ["origin"],
        blockingFields: ["origin"],
      } satisfies SearchOnceResult,
      422,
    ],
    [
      "success/default",
      {
        ...sourceUnavailableResult,
        status: "no_offers",
        message: "По этим параметрам ничего не нашли.",
      } satisfies SearchOnceResult,
      200,
    ],
  ] as const)("maps %s to its HTTP status", async (_case, result, expectedStatus) => {
    searchOnceMock.mockResolvedValue(result);

    const response = await POST(
      requestWithBody(JSON.stringify({ input: "море" })),
    );

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual(result);
  });
});
