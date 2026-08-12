import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SwipeFeed,
  type SwipeSessionClient,
} from "@/app/swipe/swipe-feed";
import type { ReactionOutcome } from "@/lib/usecases/react";
import type { SearchStreamEvent } from "@/lib/usecases/search-stream";
import type {
  SessionReaction,
  SignedSessionState,
} from "@/lib/session";

const encoder = new TextEncoder();
const SNAPSHOT_DATE_NOTICE =
  "Предварительный вариант на близкие даты — точный вариант на ваши даты уже загружается.";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
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
  amount?: number,
): SearchStreamEvent {
  return {
    type: "card",
    eventId,
    destination,
    card: amount === undefined ? card(destination) : card(destination, amount),
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
    addReaction: vi.fn(async (signed, reaction) => ({
      session: session([...signed.state.reactions, reaction]),
      feed: { order: [], excludedCities: [], refillRequested: false },
    })),
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

  it("AC12: shows the per-adult railway price composition", async () => {
    const offer = card("Сочи", 47_274);
    const event: SearchStreamEvent = {
      type: "card",
      eventId: "railway-price-composition",
      destination: "Сочи",
      card: {
        ...offer,
        price: {
          ...offer.price,
          breakdown: {
            ...offer.price.breakdown,
            transport: {
              amount: 17_274,
              currency: "RUB",
              label: "Дорога",
              adultPriceComposition: {
                adults: 3,
                pricePerAdult: 5_758,
              },
            },
          },
        },
      },
      source: "snapshot",
      update: "append",
    };

    render(
      <SwipeFeed
        initialQuery="в Сочи втроём"
        initialSession={session()}
        fetcher={vi.fn(async () => responseFor([event, doneEvent()]))}
        sessionClient={sessionClient()}
        storageKey="railway-price-composition"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    expect(screen.getByText("3 × 5 758 ₽")).toBeVisible();
  });

  it.each([
    ["railway", "Поезд"],
    ["avia", "Самолёт"],
    ["bus", "Автобус"],
    ["etrain", "Поезд"],
    ["hovercraft", "Транспорт"],
  ])("F24: labels the transport value %s in Russian", async (transport, label) => {
    const offer = card("Сочи");
    const event: SearchStreamEvent = {
      type: "card",
      eventId: `snapshot-${transport}`,
      destination: "Сочи",
      card: {
        ...offer,
        transport: { ...offer.transport, transport },
      },
      source: "snapshot",
      update: "append",
    };

    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={vi.fn(async () => responseFor([event, doneEvent()]))}
        sessionClient={sessionClient()}
        storageKey={`transport-${transport}`}
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    expect(screen.getByText(new RegExp(`^${label} ·`, "u"))).toBeVisible();
  });

  it("F24: does not present an unassigned hotel category as zero stars", async () => {
    const offer = card("Сочи");
    const event: SearchStreamEvent = {
      type: "card",
      eventId: "snapshot-zero-stars",
      destination: "Сочи",
      card: {
        ...offer,
        hotel: {
          ...offer.hotel,
          stars: 0,
          rating: undefined,
          reviewCount: undefined,
        },
      },
      source: "snapshot",
      update: "append",
    };

    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={vi.fn(async () => responseFor([event, doneEvent()]))}
        sessionClient={sessionClient()}
        storageKey="zero-stars"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    expect(screen.queryByText(/0 ★/u)).not.toBeInTheDocument();
    expect(screen.getByText("Категория и рейтинг уточняются")).toBeVisible();
    expect(screen.getByText(/маршрут без пересадок/u)).toBeVisible();
  });

  it("AC16: does not mark a snapshot whose dates match the query", async () => {
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
        vibeTags: [],
      },
      assumedFields: [],
    };

    render(
      <SwipeFeed
        initialQuery="из Москвы 10 сентября на 4 ночи"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            queryEvent,
            appendEvent("snapshot-matching-dates", "Сочи"),
            doneEvent(),
          ]),
        )}
        sessionClient={sessionClient()}
        storageKey="matching-snapshot-dates"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    expect(screen.queryByText(SNAPSHOT_DATE_NOTICE)).not.toBeInTheDocument();
  });

  it("AC16: marks a snapshot on nearby dates while exact dates load", async () => {
    const queryEvent: SearchStreamEvent = {
      type: "query",
      eventId: "query",
      query: {
        origin: "Санкт-Петербург",
        travellers: { adults: 3, childrenAges: [] },
        dateWindow: { startDate: "2026-09-16", nights: 7 },
        budget: {
          amount: 80_000,
          currency: "RUB",
          scope: "group_trip_total",
        },
        vibeTags: [],
      },
      assumedFields: [],
    };
    const offer = card("Казань");
    const snapshotEvent: SearchStreamEvent = {
      type: "card",
      eventId: "snapshot-nearby-dates",
      destination: "Казань",
      card: {
        ...offer,
        stay: {
          checkIn: "2026-09-15",
          checkOut: "2026-09-19",
          nights: 4,
        },
      },
      source: "snapshot",
      update: "append",
    };

    render(
      <SwipeFeed
        initialQuery="Из Санкт-Петербурга 16 сентября на 7 дней втроём в Казань"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([queryEvent, snapshotEvent, doneEvent()]),
        )}
        sessionClient={sessionClient()}
        storageKey="nearby-snapshot-dates"
      />,
    );

    await screen.findByRole("heading", { name: "Казань" });
    expect(screen.getByText(SNAPSHOT_DATE_NOTICE)).toBeVisible();
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

  it("HTTP deployment constraint: saves a reaction without crypto.randomUUID", async () => {
    const getRandomValues = vi.fn(<T extends ArrayBufferView | null>(array: T) => {
      if (array instanceof Uint8Array) {
        array.set(Array.from({ length: array.length }, (_, index) => index));
      }
      return array;
    });
    vi.stubGlobal("crypto", { getRandomValues });
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
        storageKey="reaction-without-random-uuid"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));

    expect(await screen.findByRole("heading", { name: "Казань" })).toBeVisible();
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(client.addReaction).toHaveBeenCalledOnce();
    expect(vi.mocked(client.addReaction).mock.calls[0][1].id).toBeTruthy();
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
    let resolveReaction!: (value: ReactionOutcome) => void;
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
    resolveReaction({
      session: session([vi.mocked(client.addReaction).mock.calls[0][1]]),
      feed: { order: [], excludedCities: [], refillRequested: false },
    });
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

  it("не падает, когда в сохранённом состоянии битая дата", async () => {
    const queryEvent: SearchStreamEvent = {
      type: "query",
      eventId: "query",
      query: {
        origin: "Москва",
        travellers: { adults: 2, childrenAges: [] },
        dateWindow: { startDate: "не-дата", nights: 4 },
        budget: {
          amount: 80_000,
          currency: "RUB",
          scope: "group_trip_total",
        },
        vibeTags: [],
      },
      assumedFields: [],
    };
    render(
      <SwipeFeed
        initialQuery="из Москвы вдвоём в сентябре"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            queryEvent,
            appendEvent("snapshot-1", "Сочи"),
            doneEvent(),
          ]),
        )}
        sessionClient={sessionClient()}
        storageKey="broken-date"
      />,
    );

    expect(await screen.findByRole("heading", { name: "Сочи" })).toBeVisible();
  });

  // F26: до подключения модели лайки сохранялись, но ни на что не влияли —
  // порядок карточек оставался тем, в каком они пришли из потока.
  it("F26: реакция переставляет ещё не показанные карточки", async () => {
    const client = sessionClient();
    vi.mocked(client.addReaction).mockImplementationOnce(async (signed, reaction) => ({
      session: session([...signed.state.reactions, reaction]),
      feed: {
        order: ["snapshot-3", "snapshot-2"],
        excludedCities: [],
        refillRequested: false,
      },
    }));
    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            appendEvent("snapshot-1", "Сочи"),
            appendEvent("snapshot-2", "Казань"),
            appendEvent("snapshot-3", "Туапсе"),
            doneEvent([card("Сочи"), card("Казань"), card("Туапсе")]),
          ]),
        )}
        sessionClient={client}
        storageKey="reorder"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    fireEvent.click(screen.getByRole("button", { name: "Нравится" }));

    // Сервер вернул порядок «Туапсе, Казань» — значит следующим идёт Туапсе,
    // хотя в потоке он пришёл последним.
    expect(await screen.findByRole("heading", { name: "Туапсе" })).toBeVisible();
  });

  it("F26: город, исключённый дизлайком, убирается из хвоста", async () => {
    const client = sessionClient();
    vi.mocked(client.addReaction).mockImplementationOnce(async (signed, reaction) => ({
      session: session([...signed.state.reactions, reaction]),
      feed: {
        order: ["snapshot-3"],
        excludedCities: ["Казань"],
        refillRequested: false,
      },
    }));
    render(
      <SwipeFeed
        initialQuery="поездка"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            appendEvent("snapshot-1", "Сочи"),
            appendEvent("snapshot-2", "Казань"),
            appendEvent("snapshot-3", "Туапсе"),
            doneEvent([card("Сочи"), card("Казань"), card("Туапсе")]),
          ]),
        )}
        sessionClient={client}
        storageKey="excluded"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    fireEvent.click(screen.getByRole("button", { name: "Не нравится" }));

    expect(await screen.findByRole("heading", { name: "Туапсе" })).toBeVisible();
    expect(screen.getByText("2 варианта в ленте")).toBeVisible();
  });

  it("F25: предупреждает, когда названное направление дороже бюджета", async () => {
    const queryEvent: SearchStreamEvent = {
      type: "query",
      eventId: "query",
      query: {
        origin: "Москва",
        travellers: { adults: 3, childrenAges: [] },
        dateWindow: { startDate: "2026-10-01", nights: 4 },
        budget: {
          amount: 30_000,
          currency: "RUB",
          scope: "group_trip_total",
        },
        vibeTags: [],
        namedDestinations: ["Горно-Алтайск"],
      },
      assumedFields: [],
    };
    render(
      <SwipeFeed
        initialQuery="из Москвы втроём на Алтай в октябре до 30 000"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            queryEvent,
            appendEvent("snapshot-1", "Горно-Алтайск", 51_299),
            doneEvent(),
          ]),
        )}
        sessionClient={sessionClient()}
        storageKey="over-budget"
      />,
    );

    await screen.findByRole("heading", { name: "Горно-Алтайск" });
    expect(screen.getByText(/Дороже вашего бюджета/u)).toBeVisible();
  });

  it("F25: сообщает о названном направлении, которое подобрать нельзя", async () => {
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
        vibeTags: [],
      },
      assumedFields: [],
      unknownDestinations: ["Крым"],
    };
    render(
      <SwipeFeed
        initialQuery="из Москвы в Крым вдвоём в сентябре"
        initialSession={session()}
        fetcher={vi.fn(async () =>
          responseFor([
            queryEvent,
            appendEvent("snapshot-1", "Сочи"),
            doneEvent(),
          ]),
        )}
        sessionClient={sessionClient()}
        storageKey="unknown-destination"
      />,
    );

    await screen.findByRole("heading", { name: "Сочи" });
    expect(
      screen.getByText(/Крым мы пока не подбираем/u),
    ).toBeVisible();
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
