import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiscoveryFallbackModel } from "@/lib/discovery/fallback-model";
import { parseTravelQuery } from "@/lib/discovery/parse";

const TODAY = new Date("2026-08-05T12:00:00.000Z");
const ENV = {
  DISCOVERY_MODEL_API_KEY: "test-key",
  DISCOVERY_MODEL_BASE_URL: "https://model.test/v1",
  DISCOVERY_MODEL: "test-model",
};

function modelResponse(value: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("F22: запасной разбор через модель", () => {
  afterEach(() => vi.useRealTimers());

  it("просит модель только о полях, не найденных правилами", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      modelResponse({ vibeTags: ["culture"] }),
    );
    const fallback = createDiscoveryFallbackModel({ env: ENV, fetcher });

    await parseTravelQuery("из Москвы вдвоём в сентябре бюджет 60000", {
      today: TODAY,
      fallback,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const init = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      response_format: { json_schema: { schema: { properties: object } } };
    };
    expect(Object.keys(body.response_format.json_schema.schema.properties)).toEqual([
      "vibeTags",
    ]);
  });

  it("не переопределяет результат правил", async () => {
    const fallback = createDiscoveryFallbackModel({
      env: ENV,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        modelResponse({ origin: "Казань", vibeTags: ["culture"] }),
      ),
    });

    const result = await parseTravelQuery(
      "из Москвы вдвоём в сентябре бюджет 60000",
      { today: TODAY, fallback },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Ожидался успешный разбор");
    expect(result.query.origin).toBe("Москва");
    expect(result.query.vibeTags).toEqual(["culture"]);
  });

  it("по таймауту возвращает управление правилам и умолчаниям", async () => {
    vi.useFakeTimers();
    const fallback = createDiscoveryFallbackModel({
      env: ENV,
      timeoutMs: 3_000,
      fetcher: vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})),
    });

    const pending = parseTravelQuery("из Москвы", { today: TODAY, fallback });
    await vi.advanceTimersByTimeAsync(3_001);
    const result = await pending;

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Ожидались умолчания");
    expect(result.assumedFields).toEqual([
      "travellers",
      "dateWindow",
      "budget",
      "vibeTags",
    ]);
  });

  it.each([
    ["без ключа", {}, vi.fn<typeof fetch>()],
    [
      "ошибка API",
      ENV,
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    ],
  ] as const)("%s не роняет разбор", async (_case, env, fetcher) => {
    const fallback = createDiscoveryFallbackModel({ env, fetcher });

    const result = await parseTravelQuery("из Москвы", { today: TODAY, fallback });

    expect(result.status).toBe("success");
    if (_case === "без ключа") expect(fetcher).not.toHaveBeenCalled();
  });

  it("игнорирует лишние и неизвестные поля ответа", async () => {
    const fallback = createDiscoveryFallbackModel({
      env: ENV,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        modelResponse({
          vibeTags: ["quiet", "unknown"],
          origin: "Казань",
          inventedField: "ignored",
        }),
      ),
    });

    const result = await parseTravelQuery(
      "из Москвы вдвоём в сентябре бюджет 60000",
      { today: TODAY, fallback },
    );

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Ожидался успешный разбор");
    expect(result.query.origin).toBe("Москва");
    expect(result.query.vibeTags).toEqual(["quiet"]);
  });
});
