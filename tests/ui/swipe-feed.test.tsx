import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SwipeFeed,
  type SwipeSessionClient,
} from "@/app/swipe/swipe-feed";
import type { SearchStreamEvent } from "@/lib/usecases/search-stream";
import type {
  SessionReaction,
  SignedSessionState,
} from "@/lib/session";

const encoder = new TextEncoder();

afterEach(() => {
  localStorage.clear();
});

function session(reactions: SessionReaction[] = []): SignedSessionState {
  return {
    state: {
      version: 1,
      metadata: {
        sessionId: "session-ui",
        createdAt: "2026-08-06T09:00:00.000Z",
      },
      reactions,
    },
    signature: `signature-${reactions.length}`,
  };
}

function card(destination: string, amount = 50_000) {
  return {
    destination,
    source: "snapshot" as const,
    snapshotBuiltAt: "2026-08-06T08:00:00.000Z",
    priceAgeMs: 3_600_000,
    priceIsStale: false,
    transport: {
      id: `transport-${destination}`,
      transport: "train",
      price: { amount: 20_000, currency: "RUB" },
      durationMinutes: 600,
      carriers: ["Туту"],
      departureAt: "2026-09-10T09:00:00+03:00",
      arrivalAt: "2026-09-10T19:00:00+03:00",
      legs: [
        {
          label: "outbound",
          from: "Москва",
          to: destination,
          departureAt: "2026-09-10T09:00:00+03:00",
          arrivalAt: "2026-09-10T19:00:00+03:00",
          durationMinutes: 600,
          segments: [
            {
              from: "Москва",
              to: destination,
              departureAt: "2026-09-10T09:00:00+03:00",
              arrivalAt: "2026-09-10T19:00:00+03:00",
              durationMinutes: 600,
              carrier: "Туту",
            },
          ],
        },
      ],
    },
    hotel: {
      id: `hotel-${destination}`,
      name: `Отель ${destination}`,
      stars: 4,
      rating: 8.7,
      reviewCount: 120,
      address: "В центре",
      photos: [],
      bestOffer: {
        roomName: "Стандарт",
        price: { amount: 30_000, currency: "RUB" },
        priceBasis: "stay_total",
      },
    },
    stay: { checkIn: "2026-09-10", checkOut: "2026-09-14", nights: 4 },
    price: {
      total: { amount, currency: "RUB", computed: true as const },
      breakdown: {
        transport: {
          amount: 20_000,
          currency: "RUB",
          label: "Дорога",
        },
        accommodation: {
          amount: 30_000,
          currency: "RUB",
          label: "Жильё за 4 ночи",
          priceBasis: "stay_total" as const,
        },
      },
    },
    warnings: [],
  };
}

function appendEvent(
  eventId: string,
  destination: string,
): SearchStreamEvent {
  return {
    type: "card",
    eventId,
    destination,
    card: card(destination),
    source: "snapshot",
    update: "append",
  };
}

function doneEvent(pool = [card("Сочи")]): SearchStreamEvent {
  return { type: "done", eventId: "done", pool };
}

function responseFor(events: SearchStreamEvent[]): Response {
  return new Response(
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    { headers: { "content-type": "application/x-ndjson" } },
  );
}

function sessionClient(): SwipeSessionClient {
  return {
    createSession: vi.fn(async () => session()),
    addReaction: vi.fn(async (signed, reaction) =>
      session([...signed.state.reactions, reaction]),
    ),
    undoLastReaction: vi.fn(async (signed) =>
      session(signed.state.reactions.slice(0, -1)),
    ),
  };
}

describe("swipe feed", () => {
  it("AC8: renders the first card before the stream completes", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const fetcher = vi.fn(async () =>
      new Response(stream, {
        headers: { "content-type": "application/x-ndjson" },
      }),
    );

    render(
      <SwipeFeed
        initialQuery="Из Москвы вдвоём 10 сентября на 4 ночи до 80к к морю"
        initialSession={session()}
        fetcher={fetcher}
        sessionClient={sessionClient()}
        storageKey="first-card"
      />,
    );

    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller!.enqueue(
      encoder.encode(`${JSON.stringify(appendEvent("snapshot-1", "Сочи"))}\n`),
    );

    expect(await screen.findByRole("heading", { name: "Сочи" })).toBeVisible();
    expect(screen.getByText("Подбираем ещё варианты…")).toBeVisible();

    controller!.enqueue(encoder.encode(`${JSON.stringify(doneEvent())}\n`));
    controller!.close();
  });

  it("F24: presents the trip as a compact Tutu-style offer", async () => {
    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([appendEvent("snapshot-1", "Сочи"), doneEvent()]),
        )}
        sessionClient={sessionClient()}
        storageKey="tutu-style"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    expect(screen.getByText("Поезд · 10 ч · без пересадок")).toBeVisible();
    expect(screen.getByText("4 ★ · 8,7 из 10 · 120 отзывов")).toBeVisible();
    expect(screen.getByText(/Почему этот вариант:/u).parentElement).toHaveClass(
      "bg-action-soft",
    );
    expect(screen.getByText("50 000 ₽")).toHaveClass("text-price", "text-3xl");
    expect(screen.getByRole("button", { name: "Нравится" })).toHaveClass(
      "bg-action",
      "text-white",
    );
    expect(screen.getByRole("button", { name: "Не нравится" })).toHaveClass(
      "bg-field",
    );
  });

  it("AC7a: replaces a snapshot card in place instead of appending a duplicate", async () => {
    const live = {
      ...card("Сочи", 47_000),
      source: "live" as const,
      isNewDestination: undefined,
    };
    const fetcher = vi.fn(async () =>
      responseFor([
        appendEvent("snapshot-1", "Сочи"),
        {
          type: "card",
          eventId: "live-1",
          destination: "Сочи",
          card: live,
          source: "live",
          update: "replace",
          replacesEventId: "snapshot-1",
        },
        { type: "done", eventId: "done", pool: [live] },
      ]),
    );

    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={fetcher}
        sessionClient={sessionClient()}
        storageKey="replacement"
      />,
    );

    await screen.findByText("47 000 ₽");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Данные обновлены")).toBeVisible();
  });

  it.each([
    [
      "AC10 empty",
      { type: "done", eventId: "done", pool: [] } satisfies SearchStreamEvent,
      "Ничего не нашли",
    ],
    [
      "AC10a unavailable",
      { type: "unavailable", eventId: "unavailable", pool: [] } satisfies SearchStreamEvent,
      "Источник временно недоступен",
    ],
  ])("shows a distinct %s state", async (_case, terminal, expected) => {
    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={vi.fn(async () => responseFor([terminal]))}
        sessionClient={sessionClient()}
        storageKey={expected}
      />,
    );

    expect(await screen.findByRole("heading", { name: expected })).toBeVisible();
  });

  it("AC11: reconnects with received event IDs and does not duplicate cards", async () => {
    const first = responseFor([appendEvent("snapshot-1", "Сочи")]);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          receivedEventIds: string[];
        };
        expect(body.receivedEventIds).toContain("snapshot-1");
        return responseFor([
          appendEvent("snapshot-1", "Сочи"),
          appendEvent("snapshot-2", "Казань"),
          doneEvent([card("Сочи"), card("Казань")]),
        ]);
      });

    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={fetcher}
        sessionClient={sessionClient()}
        reconnectDelayMs={0}
        storageKey="resume"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await screen.findByText("2 варианта в ленте");
    expect(screen.getAllByRole("article")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
    expect(await screen.findByRole("heading", { name: "Казань" })).toBeVisible();
  });

  it("AC11: reload restores the signed journal, cards, and feed position", async () => {
    const client = sessionClient();
    const fetcher = vi.fn(async () =>
      responseFor([
        appendEvent("snapshot-1", "Сочи"),
        appendEvent("snapshot-2", "Казань"),
        doneEvent([card("Сочи"), card("Казань")]),
      ]),
    );
    const firstRender = render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={fetcher}
        sessionClient={client}
        storageKey="reload"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
    await screen.findByRole("heading", { name: "Казань" });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("reload") ?? "{}")).toMatchObject({
        position: 1,
        session: { state: { reactions: [{ type: "like" }] } },
      }),
    );
    firstRender.unmount();

    render(
      <SwipeFeed
        initialSession={session()}
        fetcher={fetcher}
        sessionClient={client}
        storageKey="reload"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Казань" })).toBeVisible();
    expect(screen.getByText("1 реакция")).toBeVisible();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["button", () => fireEvent.click(screen.getByRole("button", { name: "Нравится" }))],
    ["swipe", (article: HTMLElement) => {
      fireEvent.pointerDown(article, { clientX: 20 });
      fireEvent.pointerUp(article, { clientX: 140 });
    }],
  ])("AC24: a like by %s has the same effect", async (mode, react) => {
    const client = sessionClient();
    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            appendEvent("snapshot-1", "Сочи"),
            appendEvent("snapshot-2", "Казань"),
            doneEvent([card("Сочи"), card("Казань")]),
          ]),
        )}
        sessionClient={client}
        storageKey={`reaction-${mode}`}
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    react(screen.getByRole("article"));

    expect(await screen.findByRole("heading", { name: "Казань" })).toBeVisible();
    expect(client.addReaction).toHaveBeenCalledOnce();
    expect(vi.mocked(client.addReaction).mock.calls[0][1]).toMatchObject({
      cardId: "snapshot-1",
      type: "like",
    });
  });

  it("AC22: undo restores the previous card, journal, and position", async () => {
    const client = sessionClient();
    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            appendEvent("snapshot-1", "Сочи"),
            appendEvent("snapshot-2", "Казань"),
            doneEvent([card("Сочи"), card("Казань")]),
          ]),
        )}
        sessionClient={client}
        storageKey="undo"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));
    await screen.findByRole("heading", { name: "Казань" });
    fireEvent.click(screen.getByRole("button", { name: "Отменить реакцию" }));

    expect(await screen.findByRole("heading", { name: "Сочи" })).toBeVisible();
    expect(screen.getByText("0 реакций")).toBeVisible();
    expect(client.undoLastReaction).toHaveBeenCalledOnce();
  });

  it("AC23: a gesture and click racing on one card count once", async () => {
    let resolveReaction!: (value: SignedSessionState) => void;
    const client = sessionClient();
    vi.mocked(client.addReaction).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveReaction = resolve;
      }),
    );
    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            appendEvent("snapshot-1", "Сочи"),
            appendEvent("snapshot-2", "Казань"),
            doneEvent([card("Сочи"), card("Казань")]),
          ]),
        )}
        sessionClient={client}
        storageKey="dedupe"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    const article = screen.getByRole("article");
    fireEvent.pointerDown(article, { clientX: 20 });
    fireEvent.pointerUp(article, { clientX: 140 });
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));

    expect(client.addReaction).toHaveBeenCalledOnce();
    resolveReaction(session([
      vi.mocked(client.addReaction).mock.calls[0][1],
    ]));
    expect(await screen.findByRole("heading", { name: "Казань" })).toBeVisible();
  });

  it("F23: shows what the parse substituted and lets the query be corrected", async () => {
    const queryEvent: SearchStreamEvent = {
      type: "query",
      eventId: "query",
      query: {
        origin: "Москва",
        travellers: { adults: 1, childrenAges: [] },
        dateWindow: { startDate: "2026-09-10", nights: 4 },
        budget: {
          amount: 80_000,
          currency: "RUB",
          scope: "group_trip_total",
        },
        vibeTags: ["sea"],
      },
      assumedFields: ["travellers", "vibeTags"],
    };
    render(
      <SwipeFeed
        initialQuery="на море из Москвы"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            queryEvent,
            appendEvent("snapshot-1", "Сочи"),
            doneEvent(),
          ]),
        )}
        sessionClient={sessionClient()}
        storageKey="assumed-chips"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    expect(screen.getByText("1 взрослый")).toBeVisible();
    expect(screen.getByText("море")).toBeVisible();
    expect(screen.getAllByText("· подставлено")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /1 взрослый/u }));
    expect(await screen.findByLabelText("Опишите поездку")).toBeVisible();
  });

  it("F23: no assumed chips when everything came from the phrase", async () => {
    const queryEvent: SearchStreamEvent = {
      type: "query",
      eventId: "query",
      query: {
        origin: "Москва",
        travellers: { adults: 2, childrenAges: [] },
        dateWindow: { startDate: "2026-09-10", nights: 4 },
        budget: {
          amount: 80_000,
          currency: "RUB",
          scope: "group_trip_total",
        },
        vibeTags: ["sea"],
      },
      assumedFields: [],
    };
    render(
      <SwipeFeed
        initialQuery="полная фраза"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            queryEvent,
            appendEvent("snapshot-1", "Сочи"),
            doneEvent(),
          ]),
        )}
        sessionClient={sessionClient()}
        storageKey="no-assumed-chips"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    expect(screen.queryByText("· подставлено")).not.toBeInTheDocument();
  });
});
