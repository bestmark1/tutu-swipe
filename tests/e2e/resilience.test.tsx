import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SwipeFeed,
  type SwipeSessionClient,
} from "@/app/swipe/swipe-feed";
import type { DiscoveryQuery } from "@/lib/discovery/schema";
import type { McpCallRequest } from "@/lib/mcp";
import {
  fanOutSearch,
  type FanOutSearchEvent,
  type SearchCallOutcome,
  type SearchClient,
} from "@/lib/search/fanout";
import { loadSnapshot } from "@/lib/search/snapshot";
import {
  applySessionReaction,
  createSessionState,
  signSessionState,
  type SessionReaction,
  type SignedSessionState,
} from "@/lib/session";
import {
  toSearchStreamEvent,
  type SearchStreamEvent,
} from "@/lib/usecases/search-stream";

const SESSION_SECRET = "e2e-session-secret";
const encoder = new TextEncoder();

const query = {
  origin: "Москва",
  travellers: { adults: 2, childrenAges: [] },
  dateWindow: { startDate: "2026-09-10", nights: 4 },
  budget: { amount: 80_000, currency: "RUB", scope: "group_trip_total" },
  vibeTags: ["sea"],
} satisfies DiscoveryQuery;

afterEach(() => {
  localStorage.clear();
});

describe("end-to-end failure scenarios", () => {
  it("serves the first cold-start card from the snapshot before MCP is called", async () => {
    const callTool = vi.fn<SearchClient["callTool"]>();
    const events = fanOutSearch({
      candidates: [{ name: "Сочи" }],
      query,
      client: { callTool },
    });

    const first = await events.next();

    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "card",
      destination: "Сочи",
      source: "snapshot",
    });
    expect(callTool).not.toHaveBeenCalled();
    await events.return(undefined);
  });

  it.each(["search_multitransport", "search_hotels"] as const)(
    "keeps snapshot cards when %s fails",
    async (failedTool) => {
      const events = await collectEvents(
        componentFailureClient(failedTool),
      );

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "candidate_error",
          destination: "Сочи",
          reason: "source_unavailable",
        }),
      );
      // Снапшот держит несколько вариантов транспорта на направление, поэтому
      // карточек Сочи в пуле может быть больше одной — важно, что при упавшем
      // живом поиске они остаются и лента не пустеет.
      const terminal = events.at(-1) as { type: string; pool: unknown[] };
      expect(terminal.type).toBe("done");
      expect(terminal.pool.length).toBeGreaterThan(0);
      expect(terminal.pool).toEqual(
        terminal.pool.map(() => expect.objectContaining({ destination: "Сочи" })),
      );

      renderFeed(events, `component-${failedTool}`);
      expect(
        await screen.findByRole("heading", { name: "Сочи" }),
      ).toBeVisible();
      expect(screen.getByText(/Часть направлений не ответила/)).toBeVisible();
    },
  );

  it("keeps the screen usable after 429 with a Retry-After beyond the deadline", async () => {
    const client: SearchClient = {
      callTool: vi.fn(async () => ({
        status: "rate_limited" as const,
        retryAfterMs: 60_000,
      })),
    };
    const events = await collectEvents(client);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "candidate_error",
        reason: "rate_limited",
      }),
    );
    renderFeed(events, "rate-limit");

    expect(
      await screen.findByRole("heading", { name: "Сочи" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reconnects after a broken stream and resumes after acknowledged events", async () => {
    const firstCard = snapshotEvent("snapshot-1", "Сочи");
    const secondCard = snapshotEvent("snapshot-2", "Казань");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(interruptedResponse(firstCard))
      .mockImplementationOnce(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          receivedEventIds: string[];
        };
        expect(body.receivedEventIds).toContain(firstCard.eventId);
        return responseFor([
          firstCard,
          secondCard,
          doneEvent([firstCard.card, secondCard.card]),
        ]);
      });

    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={signedSession()}
        fetcher={fetcher}
        sessionClient={sessionClient()}
        reconnectDelayMs={0}
        storageKey="broken-stream"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("2 варианта в ленте")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
    expect(
      await screen.findByRole("heading", { name: "Казань" }),
    ).toBeVisible();
  });

  it("restores cards, position, and the signed session journal after reload", async () => {
    const firstCard = snapshotEvent("snapshot-1", "Сочи");
    const secondCard = snapshotEvent("snapshot-2", "Казань");
    const thirdCard = snapshotEvent("snapshot-3", "Тула");
    const fourthCard = snapshotEvent("snapshot-4", "Самара");
    const fetcher = vi.fn(async () =>
      responseFor([
        firstCard,
        secondCard,
        thirdCard,
        fourthCard,
        doneEvent([
          firstCard.card,
          secondCard.card,
          thirdCard.card,
          fourthCard.card,
        ]),
      ]),
    );
    const client = sessionClient();
    const initialSession = signedSession();
    const firstRender = render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={initialSession}
        fetcher={fetcher}
        sessionClient={client}
        storageKey="page-reload"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
    await screen.findByRole("heading", { name: "Казань" });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("page-reload") ?? "{}"))
        .toMatchObject({
          position: 1,
          session: { state: { reactions: [{ type: "like" }] } },
        }),
    );
    firstRender.unmount();

    render(
      <SwipeFeed
        initialSession={initialSession}
        fetcher={fetcher}
        sessionClient={client}
        storageKey="page-reload"
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Казань" }),
    ).toBeVisible();
    expect(screen.getByText("1 реакция")).toBeVisible();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

async function collectEvents(client: SearchClient): Promise<FanOutSearchEvent[]> {
  const events: FanOutSearchEvent[] = [];
  for await (const event of fanOutSearch({
    candidates: [{ name: "Сочи" }],
    query,
    client,
    totalBudgetMs: 100,
  })) {
    events.push(event);
  }
  return events;
}

function componentFailureClient(
  failedTool: "search_multitransport" | "search_hotels",
): SearchClient {
  return {
    async callTool(request: McpCallRequest): Promise<SearchCallOutcome> {
      if (request.name === failedTool) {
        return {
          status: "source_unavailable" as const,
          failure: { kind: "network" as const },
          attempts: 1,
        };
      }
      if (request.name === "search_hotels") {
        return {
          status: "success" as const,
          data: { type: "hotel" as const, hotels: [], meta: {} },
          attempts: 1,
        };
      }
      return {
        status: "success" as const,
        data: {
          type: "transport" as const,
          variants: [],
          meta: { unavailable: [] },
        },
        attempts: 1,
      };
    },
  };
}

function renderFeed(events: FanOutSearchEvent[], storageKey: string) {
  return render(
    <SwipeFeed
      initialQuery="поездка"
      initialSession={signedSession()}
      fetcher={vi.fn(async () =>
        responseFor(events.map(toSearchStreamEvent)),
      )}
      sessionClient={sessionClient()}
      storageKey={storageKey}
    />,
  );
}

function snapshotEvent(eventId: string, destination: string) {
  const card = loadSnapshot({
    now: new Date("2026-08-07T00:00:00.000Z"),
  }).getCards("Москва", destination)[0];
  if (!card) throw new Error(`Missing snapshot card for ${destination}`);

  return {
    type: "card" as const,
    eventId,
    destination,
    card,
    source: "snapshot" as const,
    update: "append" as const,
  };
}

function doneEvent(
  pool: Extract<SearchStreamEvent, { type: "card" }>["card"][],
): SearchStreamEvent {
  return { type: "done", eventId: "done", pool };
}

function responseFor(events: SearchStreamEvent[]): Response {
  return new Response(
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    { headers: { "content-type": "application/x-ndjson" } },
  );
}

function interruptedResponse(event: SearchStreamEvent): Response {
  let sent = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          return;
        }
        controller.error(new Error("connection lost"));
      },
    }),
    { headers: { "content-type": "application/x-ndjson" } },
  );
}

function signedSession(reactions: SessionReaction[] = []): SignedSessionState {
  return signSessionState(
    {
      ...createSessionState({
        sessionId: "session-e2e",
        createdAt: "2026-08-07T09:00:00.000Z",
      }),
      reactions,
    },
    SESSION_SECRET,
  );
}

function sessionClient(): SwipeSessionClient {
  return {
    createSession: vi.fn(async () => signedSession()),
    addReaction: vi.fn(async (submission, reaction) => {
      const applied = applySessionReaction(
        submission,
        reaction,
        () => null,
        SESSION_SECRET,
      );
      if (!applied.ok) throw new Error(applied.error.code);
      return {
        session: applied.signedState,
        feed: { order: [], excludedCities: [], refillRequested: false },
      };
    }),
    rankFeed: vi.fn(async () => ({
      order: [],
      excludedCities: [],
      refillRequested: false,
    })),
    undoLastReaction: vi.fn(async (submission) =>
      signedSession(submission.state.reactions.slice(0, -1)),
    ),
  };
}
