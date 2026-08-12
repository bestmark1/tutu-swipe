import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareSearchStreamMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/usecases/search-stream", () => ({
  prepareSearchStream: prepareSearchStreamMock,
  SEARCH_STREAM_QUERY_EVENT_ID: "query",
  streamEventId: vi.fn(),
}));

import { POST } from "@/app/api/search/route";

function requestWithBody(body: BodyInit) {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("POST /api/search validation", () => {
  beforeEach(() => {
    prepareSearchStreamMock.mockReset();
  });

  it("returns 400 for an empty input without starting the stream", async () => {
    const response = await POST(
      requestWithBody(JSON.stringify({ input: "   " })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "empty_input",
      message: "Опишите поездку одной фразой.",
    });
    expect(prepareSearchStreamMock).not.toHaveBeenCalled();
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
    expect(prepareSearchStreamMock).not.toHaveBeenCalled();
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
    expect(prepareSearchStreamMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid resume cursor", async () => {
    const response = await POST(
      requestWithBody(
        JSON.stringify({ input: "море", receivedEventIds: "query" }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "invalid_resume_cursor",
      message: "Список полученных событий имеет неверный формат.",
    });
    expect(prepareSearchStreamMock).not.toHaveBeenCalled();
  });
});
