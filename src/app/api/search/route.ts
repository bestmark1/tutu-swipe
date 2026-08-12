import {
  prepareSearchStream,
  SEARCH_STREAM_QUERY_EVENT_ID,
  streamEventId,
  type SearchStreamQueryEvent,
} from "@/lib/usecases/search-stream";

export const maxDuration = 60;

const STREAM_MEDIA_TYPE = "application/x-ndjson";
const MAX_RESUME_EVENT_IDS = 256;

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) {
    return Response.json(
      {
        status: "error",
        code: "invalid_json",
        message: "Тело запроса должно быть JSON-объектом.",
      },
      { status: 400 },
    );
  }

  const input = body.input;
  if (typeof input !== "string" || input.trim().length === 0) {
    return Response.json(
      {
        status: "error",
        code: "empty_input",
        message: "Опишите поездку одной фразой.",
      },
      { status: 400 },
    );
  }

  const receivedEventIds = readReceivedEventIds(body.receivedEventIds);
  if (!receivedEventIds) {
    return Response.json(
      {
        status: "error",
        code: "invalid_resume_cursor",
        message: "Список полученных событий имеет неверный формат.",
      },
      { status: 400 },
    );
  }
  return streamSearch(input, receivedEventIds, request.signal);
}

async function streamSearch(
  input: string,
  receivedEventIds: Set<string>,
  signal: AbortSignal,
): Promise<Response> {
  const prepared = await prepareSearchStream(input, {
    fanOut: { signal },
  });
  if (prepared.status !== "ready") {
    return Response.json(prepared, { status: 422 });
  }

  // Событие нужно и когда подставлены умолчания, и когда названное человеком
  // направление подобрать нельзя: молчать о втором так же нечестно, как о первом.
  const hasUnknownDestinations =
    (prepared.unknownDestinations?.length ?? 0) > 0;
  const queryEvent =
    prepared.assumedFields.length > 0 || hasUnknownDestinations
      ? ({
          type: "query",
          eventId: SEARCH_STREAM_QUERY_EVENT_ID,
          query: prepared.query,
          assumedFields: prepared.assumedFields,
          ...(hasUnknownDestinations
            ? { unknownDestinations: prepared.unknownDestinations }
            : {}),
        } satisfies SearchStreamQueryEvent)
      : undefined;
  let querySent =
    queryEvent === undefined ||
    receivedEventIds.has(SEARCH_STREAM_QUERY_EVENT_ID);

  const iterator = prepared.events[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      if (!querySent && queryEvent) {
        querySent = true;
        controller.enqueue(encoder.encode(`${JSON.stringify(queryEvent)}\n`));
        return;
      }
      try {
        let next = await iterator.next();
        while (!next.done && receivedEventIds.has(streamEventId(next.value))) {
          next = await iterator.next();
        }
        if (next.done) {
          closed = true;
          controller.close();
          return;
        }
        const event = next.value;
        const streamEvent =
          event.type === "card"
            ? event
            : { ...event, eventId: streamEventId(event) };
        controller.enqueue(
          encoder.encode(`${JSON.stringify(streamEvent)}\n`),
        );
      } catch (error) {
        closed = true;
        controller.error(error);
      }
    },
    async cancel() {
      closed = true;
      await iterator.return?.(undefined);
    },
  });

  return new Response(body, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": `${STREAM_MEDIA_TYPE}; charset=utf-8`,
      "x-accel-buffering": "no",
    },
  });
}

async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readReceivedEventIds(value: unknown): Set<string> | undefined {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.length > MAX_RESUME_EVENT_IDS) {
    return undefined;
  }
  const eventIds = new Set<string>();
  for (const eventId of value) {
    if (
      typeof eventId !== "string" ||
      eventId.length === 0 ||
      eventId.length > 512
    ) {
      return undefined;
    }
    eventIds.add(eventId);
  }
  return eventIds;
}
