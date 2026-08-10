import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FanOutSearchEvent } from "@/lib/search/fanout";
import type { SearchStreamPreparation } from "@/lib/usecases/search-stream";

type PrepareSearchStream =
  typeof import("@/lib/usecases/search-stream").prepareSearchStream;

const prepareSearchStreamMock = vi.hoisted(() =>
  vi.fn<PrepareSearchStream>(),
);

vi.mock("@/lib/usecases/search-stream", () => ({
  prepareSearchStream: prepareSearchStreamMock,
  SEARCH_STREAM_QUERY_EVENT_ID: "query",
  streamEventId: (event: FanOutSearchEvent) =>
    event.type === "card" ? event.eventId : event.type,
}));

import { POST } from "@/app/api/search/route";

function request(receivedEventIds: string[] = []) {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
    },
    body: JSON.stringify({ input: "поездка", receivedEventIds }),
  });
}

function cardEvent(eventId: string): FanOutSearchEvent {
  return {
    type: "card",
    eventId,
    destination: "Сочи",
    card: { destination: "Сочи" } as never,
    source: "snapshot",
    update: "append",
  };
}

describe("streaming POST /api/search", () => {
  beforeEach(() => {
    prepareSearchStreamMock.mockReset();
  });

  it("AC8: flushes a card before the fan-out finishes", async () => {
    let finish!: () => void;
    const waitForFinish = new Promise<void>((resolve) => {
      finish = resolve;
    });
    async function* events(): AsyncGenerator<FanOutSearchEvent> {
      yield cardEvent("snapshot-1");
      await waitForFinish;
      yield { type: "done", pool: [] };
    }
    prepareSearchStreamMock.mockResolvedValue({
      status: "ready",
      query: {} as never,
      assumedFields: [],
      events: events(),
    } satisfies SearchStreamPreparation);

    const response = await POST(request());
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    const reader = response.body!.getReader();
    const first = await reader.read();

    expect(new TextDecoder().decode(first.value)).toContain('"type":"card"');
    finish();
    await reader.cancel();
  });

  it("AC11: skips event IDs the client already acknowledged", async () => {
    async function* events(): AsyncGenerator<FanOutSearchEvent> {
      yield cardEvent("snapshot-1");
      yield cardEvent("snapshot-2");
      yield { type: "done", pool: [] };
    }
    prepareSearchStreamMock.mockResolvedValue({
      status: "ready",
      query: {} as never,
      assumedFields: [],
      events: events(),
    } satisfies SearchStreamPreparation);

    const response = await POST(request(["snapshot-1"]));
    const body = await response.text();

    expect(body).not.toContain("snapshot-1");
    expect(body).toContain("snapshot-2");
    expect(body).toContain('"eventId":"done"');
  });

  it("F23: leads the stream with the parsed query and its assumed fields", async () => {
    async function* events(): AsyncGenerator<FanOutSearchEvent> {
      yield cardEvent("snapshot-1");
      yield { type: "done", pool: [] };
    }
    prepareSearchStreamMock.mockResolvedValue({
      status: "ready",
      query: { origin: "Москва" } as never,
      assumedFields: ["travellers", "budget"],
      events: events(),
    } satisfies SearchStreamPreparation);

    const response = await POST(request());
    const [firstLine] = (await response.text()).split("\n");
    const parsed = JSON.parse(firstLine) as {
      type: string;
      eventId: string;
      assumedFields: string[];
      query: { origin: string };
    };

    expect(parsed.type).toBe("query");
    expect(parsed.eventId).toBe("query");
    expect(parsed.assumedFields).toEqual(["travellers", "budget"]);
    expect(parsed.query.origin).toBe("Москва");
  });

  it("F23: skips the query event once the client acknowledged it", async () => {
    async function* events(): AsyncGenerator<FanOutSearchEvent> {
      yield cardEvent("snapshot-1");
      yield { type: "done", pool: [] };
    }
    prepareSearchStreamMock.mockResolvedValue({
      status: "ready",
      query: { origin: "Москва" } as never,
      assumedFields: ["budget"],
      events: events(),
    } satisfies SearchStreamPreparation);

    const response = await POST(request(["query"]));
    const body = await response.text();

    expect(body).not.toContain('"type":"query"');
    expect(body).toContain("snapshot-1");
  });
});
