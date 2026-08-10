"use client";

import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  assumedFieldChips,
  type AssumedFieldChip,
} from "@/lib/discovery/assumed";
import type {
  DiscoveryQuery,
  DiscoveryRequiredField,
} from "@/lib/discovery/schema";
import type {
  SessionReaction,
  SignedSessionState,
} from "@/lib/session";
import type { SearchStreamEvent } from "@/lib/usecases/search-stream";

import {
  addSwipeReaction,
  createSwipeSession,
  undoSwipeReaction,
} from "./actions";

const DEFAULT_QUERY =
  "Из Москвы вдвоём 10 сентября на 4 ночи до 80к к морю";
const DEFAULT_STORAGE_KEY = "tutu-swipe-feed";
const DEFAULT_RECONNECT_DELAY_MS = 750;
const SWIPE_DISTANCE_PX = 72;

const ASSUMED_FIELD_NAMES: readonly DiscoveryRequiredField[] = [
  "origin",
  "travellers",
  "dateWindow",
  "budget",
  "vibeTags",
];

type CardEvent = Extract<SearchStreamEvent, { type: "card" }>;
type TerminalEvent = Extract<
  SearchStreamEvent,
  { type: "done" | "aborted" | "unavailable" }
>;

interface FeedCard {
  eventId: string;
  card: CardEvent["card"];
  updated: boolean;
  isNewDestination: boolean;
}

interface FeedState {
  query: string;
  cards: FeedCard[];
  position: number;
  session?: SignedSessionState;
  receivedEventIds: string[];
  failedDestinations: string[];
  terminal?: TerminalEvent["type"];
  /** Поля, которых не было во фразе: показываются чипами «подставлено». */
  assumedFields?: DiscoveryRequiredField[];
  /** Разобранный запрос: из него берутся подставленные значения для чипов. */
  parsedQuery?: DiscoveryQuery;
  abortedReason?: Extract<TerminalEvent, { type: "aborted" }>["reason"];
}

interface StoredFeedState extends FeedState {
  version: 1;
}

type ConnectionState = "idle" | "loading" | "streaming" | "reconnecting" | "failed";

export interface SwipeSessionClient {
  createSession(): Promise<SignedSessionState>;
  addReaction(
    session: SignedSessionState,
    reaction: SessionReaction,
  ): Promise<SignedSessionState>;
  undoLastReaction(session: SignedSessionState): Promise<SignedSessionState>;
}

export interface SwipeFeedProps {
  initialQuery?: string;
  initialSession?: SignedSessionState;
  fetcher?: typeof fetch;
  sessionClient?: SwipeSessionClient;
  reconnectDelayMs?: number;
  storageKey?: string;
}

const defaultSessionClient: SwipeSessionClient = {
  createSession: createSwipeSession,
  addReaction: addSwipeReaction,
  undoLastReaction: undoSwipeReaction,
};

export function SwipeFeed({
  initialQuery = "",
  initialSession,
  fetcher = fetch,
  sessionClient = defaultSessionClient,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  storageKey = DEFAULT_STORAGE_KEY,
}: SwipeFeedProps) {
  const initialState: FeedState = {
    query: initialQuery.trim(),
    cards: [],
    position: 0,
    session: initialSession,
    receivedEventIds: [],
    failedDestinations: [],
  };
  const [feed, setFeed] = useState<FeedState>(initialState);
  const [input, setInput] = useState(initialQuery);
  const [hydrated, setHydrated] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [reactionPending, setReactionPending] = useState(false);
  const [reactionError, setReactionError] = useState(false);
  const feedRef = useRef(feed);
  const reactionPendingRef = useRef(false);
  const pointerStartX = useRef<number | undefined>(undefined);

  const commit = useCallback((next: FeedState) => {
    feedRef.current = next;
    setFeed(next);
    persist(storageKey, next);
  }, [storageKey]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const restored = restore(storageKey);
      if (restored) {
        feedRef.current = restored;
        setFeed(restored);
        setInput(restored.query);
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(timeout);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || !feed.query || feed.terminal) return;

    const controller = new AbortController();
    let active = true;

    async function connect() {
      let reconnecting = false;
      while (active && !controller.signal.aborted) {
        setConnection(reconnecting ? "reconnecting" : "loading");
        try {
          const response = await fetcher("/api/search", {
            method: "POST",
            headers: {
              accept: "application/x-ndjson",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              input: feedRef.current.query,
              receivedEventIds: feedRef.current.receivedEventIds,
            }),
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            setConnection("failed");
            return;
          }

          setConnection("streaming");
          const terminalReceived = await consumeStream(
            response.body,
            (event) => applyStreamEvent(event, feedRef.current, commit),
          );
          if (!active || controller.signal.aborted || terminalReceived) {
            setConnection("idle");
            return;
          }
        } catch (error) {
          if (!active || controller.signal.aborted || isAbortError(error)) return;
        }

        reconnecting = true;
        setConnection("reconnecting");
        await delay(reconnectDelayMs, controller.signal);
      }
    }

    void connect();
    return () => {
      active = false;
      controller.abort();
    };
  }, [commit, feed.query, feed.terminal, fetcher, hydrated, reconnectDelayMs]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = input.trim();
    if (!query) return;

    setReactionError(false);
    setConnection("loading");
    commit({
      query,
      cards: [],
      position: 0,
      session: initialSession,
      receivedEventIds: [],
      failedDestinations: [],
    });
  }

  async function reactToCard(type: "like" | "dislike") {
    const current = feedRef.current.cards[feedRef.current.position];
    if (!current || reactionPendingRef.current) return;

    reactionPendingRef.current = true;
    setReactionPending(true);
    setReactionError(false);
    try {
      const signed =
        feedRef.current.session ?? (await sessionClient.createSession());
      const base = {
        id: reactionId(),
        cardId: current.eventId,
        occurredAt: new Date().toISOString(),
      };
      const reaction: SessionReaction =
        type === "like"
          ? { ...base, type: "like" }
          : { ...base, type: "dislike", reason: "wrong_hotel" };
      const nextSession = await sessionClient.addReaction(signed, reaction);
      const latest = feedRef.current;
      commit({
        ...latest,
        session: nextSession,
        position: Math.min(latest.position + 1, latest.cards.length),
      });
    } catch {
      setReactionError(true);
    } finally {
      reactionPendingRef.current = false;
      setReactionPending(false);
    }
  }

  async function undo() {
    const current = feedRef.current;
    if (
      !current.session ||
      current.session.state.reactions.length === 0 ||
      reactionPendingRef.current
    ) {
      return;
    }

    reactionPendingRef.current = true;
    setReactionPending(true);
    setReactionError(false);
    try {
      const nextSession = await sessionClient.undoLastReaction(current.session);
      const latest = feedRef.current;
      commit({
        ...latest,
        session: nextSession,
        position: Math.max(0, latest.position - 1),
      });
    } catch {
      setReactionError(true);
    } finally {
      reactionPendingRef.current = false;
      setReactionPending(false);
    }
  }

  function pointerDown(event: ReactPointerEvent<HTMLElement>) {
    pointerStartX.current = event.clientX;
  }

  function pointerUp(event: ReactPointerEvent<HTMLElement>) {
    const start = pointerStartX.current;
    pointerStartX.current = undefined;
    if (start === undefined) return;
    const distance = event.clientX - start;
    if (distance >= SWIPE_DISTANCE_PX) void reactToCard("like");
    if (distance <= -SWIPE_DISTANCE_PX) void reactToCard("dislike");
  }

  function startNewSearch() {
    setInput(feed.query);
    commit({
      query: "",
      cards: [],
      position: 0,
      session: initialSession,
      receivedEventIds: [],
      failedDestinations: [],
    });
  }

  const current = feed.cards[feed.position];
  const reactionCount = feed.session?.state.reactions.length ?? 0;
  const showSearchForm = !feed.query;
  const assumedChips =
    feed.parsedQuery && feed.assumedFields
      ? assumedFieldChips(feed.parsedQuery, feed.assumedFields)
      : [];

  return (
    <main className="min-h-screen bg-canvas px-4 py-8 text-ink sm:px-8 sm:py-12">
      <div className="mx-auto max-w-xl">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
            tutu-swipe
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Лента поездок
          </h1>
        </header>

        {showSearchForm ? (
          <SearchForm input={input} onInput={setInput} onSubmit={submit} />
        ) : (
          <section className="mt-6" aria-label="Состояние ленты">
            <div className="flex items-center justify-between gap-4 text-sm text-ink-muted">
              <p>{feedCountLabel(feed.cards.length)}</p>
              <p>{reactionCountLabel(reactionCount)}</p>
            </div>

            <AssumedChips chips={assumedChips} onEdit={startNewSearch} />
            <ConnectionMessage connection={connection} hasCards={feed.cards.length > 0} />
            <PartialFailure destinations={feed.failedDestinations} />

            {current ? (
              <TripCard
                item={current}
                disabled={reactionPending}
                onPointerDown={pointerDown}
                onPointerUp={pointerUp}
                onLike={() => void reactToCard("like")}
                onDislike={() => void reactToCard("dislike")}
              />
            ) : (
              <EmptyFeedState feed={feed} connection={connection} />
            )}

            {reactionError ? (
              <p role="alert" className="mt-4 text-sm text-red-700">
                Не удалось сохранить реакцию. Попробуйте ещё раз.
              </p>
            ) : null}

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void undo()}
                disabled={reactionPending || reactionCount === 0}
                className="rounded-md border border-divider bg-surface px-4 py-3 text-sm font-medium text-ink transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
              >
                Отменить реакцию
              </button>
              <button
                type="button"
                onClick={startNewSearch}
                className="px-2 py-3 text-sm font-medium text-ink-muted transition hover:text-ink"
              >
                Новый поиск
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function SearchForm({
  input,
  onInput,
  onSubmit,
}: {
  input: string;
  onInput(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  return (
    <form className="mt-8 space-y-3" onSubmit={onSubmit}>
      <label className="block text-sm font-medium" htmlFor="swipe-query">
        Опишите поездку
      </label>
      <textarea
        id="swipe-query"
        value={input}
        onChange={(event) => onInput(event.target.value)}
        placeholder={DEFAULT_QUERY}
        rows={4}
        className="w-full resize-none rounded-md border border-divider bg-surface px-4 py-3 text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
      />
      <button
        type="submit"
        disabled={!input.trim()}
        className="w-full rounded-md bg-action px-5 py-4 text-base font-semibold text-ink transition hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-45"
      >
        Подобрать поездки
      </button>
    </form>
  );
}

function TripCard({
  item,
  disabled,
  onPointerDown,
  onPointerUp,
  onLike,
  onDislike,
}: {
  item: FeedCard;
  disabled: boolean;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onLike(): void;
  onDislike(): void;
}) {
  const { card } = item;
  const snapshot = card.source === "snapshot" ? card : undefined;

  return (
    <article
      className="mt-5 touch-pan-y select-none rounded-lg bg-surface p-5 shadow-lift sm:p-6"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-accent">
            {formatStay(card.stay)}
          </p>
          <h2 className="mt-1 text-3xl font-semibold">{card.destination}</h2>
        </div>
        {item.updated ? (
          <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-ink">
            Данные обновлены
          </span>
        ) : null}
      </div>

      {item.isNewDestination ? (
        <p className="mt-3 text-sm font-medium text-accent">
          Найдено новое направление
        </p>
      ) : null}

      <section className="mt-5 border-t border-divider pt-5" aria-label="Дорога">
        <h3 className="font-semibold">Дорога</h3>
        <p className="mt-1 text-sm text-ink-muted">
          {transportLabel(card.transport.transport)} · {durationLabel(card.transport.durationMinutes)}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {formatDateTime(card.transport.departureAt)} — {formatDateTime(card.transport.arrivalAt)}
        </p>
        {card.transport.carriers.length > 0 ? (
          <p className="mt-1 text-sm text-ink-muted">{card.transport.carriers.join(", ")}</p>
        ) : null}
      </section>

      <section className="mt-5 border-t border-divider pt-5" aria-label="Жильё">
        <h3 className="font-semibold">Жильё</h3>
        <p className="mt-1">{card.hotel.name}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {card.hotel.address ?? "Адрес уточняется"}
        </p>
      </section>

      {card.warnings.length > 0 ? (
        <ul className="mt-5 space-y-2 rounded-md border border-warn/30 bg-warn-soft p-4 text-sm text-ink">
          {card.warnings.map((warning) => (
            <li key={warning.code}>{warning.message}</li>
          ))}
        </ul>
      ) : null}

      <dl className="mt-5 space-y-2 border-t border-divider pt-5 text-sm">
        <PriceRow component={card.price.breakdown.transport} />
        <PriceRow component={card.price.breakdown.accommodation} />
        <div className="flex items-baseline justify-between gap-3 pt-2 font-semibold">
          <dt>Итого</dt>
          <dd className="text-2xl">
            {formatMoney(card.price.total.amount, card.price.total.currency)}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs leading-5 text-ink-muted">
        {snapshot ? priceAgeLabel(snapshot.priceAgeMs, snapshot.priceIsStale) : "Цена обновлена сейчас"}. Цена могла измениться к моменту перехода на Туту.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onDislike}
          className="min-h-14 rounded-md border border-divider bg-surface px-4 text-base font-semibold text-ink transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45"
        >
          Не нравится
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onLike}
          className="min-h-14 rounded-md bg-action px-4 text-base font-semibold text-ink transition hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-45"
        >
          Нравится
        </button>
      </div>
    </article>
  );
}

function PriceRow({
  component,
}: {
  component: { label: string; amount: number; currency: string };
}) {
  return (
    <div className="flex justify-between gap-3 text-ink-muted">
      <dt>{component.label}</dt>
      <dd>{formatMoney(component.amount, component.currency)}</dd>
    </div>
  );
}

function ConnectionMessage({
  connection,
  hasCards,
}: {
  connection: ConnectionState;
  hasCards: boolean;
}) {
  if (connection === "reconnecting") {
    return (
      <p role="status" className="mt-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-ink">
        Соединение прервалось. Переподключаемся…
      </p>
    );
  }
  if (connection === "failed") {
    return (
      <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">
        Не удалось начать поиск. Проверьте запрос и попробуйте ещё раз.
      </p>
    );
  }
  if ((connection === "loading" || connection === "streaming") && hasCards) {
    return <p className="mt-4 text-sm text-ink-muted">Подбираем ещё варианты…</p>;
  }
  return null;
}

function PartialFailure({ destinations }: { destinations: string[] }) {
  if (destinations.length === 0) return null;
  return (
    <p className="mt-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-ink">
      Часть направлений не ответила: {destinations.join(", ")}.
    </p>
  );
}

function EmptyFeedState({
  feed,
  connection,
}: {
  feed: FeedState;
  connection: ConnectionState;
}) {
  if (feed.cards.length > 0 && feed.position >= feed.cards.length) {
    return (
      <StatusPanel title="Варианты закончились">
        Вы посмотрели все поездки из текущей ленты. Можно отменить последнюю реакцию или начать новый поиск.
      </StatusPanel>
    );
  }
  if (feed.terminal === "unavailable") {
    return (
      <StatusPanel title="Источник временно недоступен">
        Туту сейчас не отвечает. Попробуйте повторить поиск позже.
      </StatusPanel>
    );
  }
  if (feed.terminal === "done") {
    return (
      <StatusPanel title="Ничего не нашли">
        Попробуйте увеличить бюджет, изменить даты или смягчить пожелания.
      </StatusPanel>
    );
  }
  if (feed.terminal === "aborted") {
    return (
      <StatusPanel title="Поиск завершён не полностью">
        {feed.abortedReason === "budget_exhausted"
          ? "Время поиска закончилось раньше, чем появились варианты."
          : "Поиск был прерван до получения вариантов."}
      </StatusPanel>
    );
  }
  if (connection === "failed") return null;
  return (
    <StatusPanel title="Подбираем поездки">
      Ищем дорогу и жильё. Первые варианты появятся по мере готовности.
    </StatusPanel>
  );
}

function StatusPanel({ title, children }: { title: string; children: string }) {
  return (
    <section className="mt-5 rounded-lg bg-surface p-6 shadow-card" aria-live="polite">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-ink-muted">{children}</p>
    </section>
  );
}

function AssumedChips({
  chips,
  onEdit,
}: {
  chips: AssumedFieldChip[];
  onEdit(): void;
}) {
  if (chips.length === 0) return null;
  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-2"
      aria-label="Подставлено автоматически из запроса"
    >
      {chips.map((chip) => (
        <button
          key={chip.field}
          type="button"
          onClick={onEdit}
          title="Подставлено автоматически. Нажмите, чтобы уточнить запрос"
          className="rounded-sm bg-accent-soft px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-accent/15"
        >
          {chip.label}
          <span className="text-ink-muted"> · подставлено</span>
        </button>
      ))}
    </div>
  );
}

async function consumeStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: SearchStreamEvent) => void,
): Promise<boolean> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalReceived = false;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseStreamEvent(line);
      if (!event) continue;
      onEvent(event);
      if (isTerminal(event)) terminalReceived = true;
    }

    if (done) break;
  }

  const finalEvent = parseStreamEvent(buffer);
  if (finalEvent) {
    onEvent(finalEvent);
    if (isTerminal(finalEvent)) terminalReceived = true;
  }
  return terminalReceived;
}

function applyStreamEvent(
  event: SearchStreamEvent,
  current: FeedState,
  commit: (next: FeedState) => void,
) {
  if (current.receivedEventIds.includes(event.eventId)) return;
  const receivedEventIds = [...current.receivedEventIds, event.eventId];

  if (event.type === "card") {
    const existingIndex =
      event.update === "replace"
        ? current.cards.findIndex(
            (item) =>
              item.eventId === event.replacesEventId ||
              item.card.destination === event.destination,
          )
        : -1;
    const item: FeedCard = {
      eventId: event.eventId,
      card: event.card,
      updated: event.update === "replace",
      isNewDestination: event.isNewDestination === true,
    };
    const cards = [...current.cards];
    if (existingIndex >= 0) cards[existingIndex] = item;
    else cards.push(item);
    commit({ ...current, cards, receivedEventIds });
    return;
  }

  if (event.type === "candidate_error") {
    const failedDestinations = current.failedDestinations.includes(event.destination)
      ? current.failedDestinations
      : [...current.failedDestinations, event.destination];
    commit({ ...current, failedDestinations, receivedEventIds });
    return;
  }

  if (event.type === "aborted") {
    commit({
      ...current,
      receivedEventIds,
      terminal: event.type,
      abortedReason: event.reason,
    });
    return;
  }

  if (event.type === "query") {
    commit({
      ...current,
      receivedEventIds,
      assumedFields: event.assumedFields,
      parsedQuery: event.query,
    });
    return;
  }

  commit({ ...current, receivedEventIds, terminal: event.type });
}

function parseStreamEvent(line: string): SearchStreamEvent | undefined {
  if (!line.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value) || typeof value.eventId !== "string") return undefined;
    if (value.type === "query") {
      return isQueryEvent(value)
        ? (value as unknown as SearchStreamEvent)
        : undefined;
    }
    if (
      value.type !== "card" &&
      value.type !== "candidate_error" &&
      value.type !== "done" &&
      value.type !== "aborted" &&
      value.type !== "unavailable"
    ) {
      return undefined;
    }
    return value as SearchStreamEvent;
  } catch {
    return undefined;
  }
}

function isQueryEvent(
  value: Record<string, unknown>,
): boolean {
  return (
    Array.isArray(value.assumedFields) &&
    value.assumedFields.every(
      (field) =>
        typeof field === "string" &&
        ASSUMED_FIELD_NAMES.includes(field as DiscoveryRequiredField),
    ) &&
    isRecord(value.query)
  );
}

function restore(storageKey: string): FeedState | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!isStoredFeed(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function persist(storageKey: string, state: FeedState) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...state }));
  } catch {
    // A full or unavailable localStorage must not break the active feed.
  }
}

function isStoredFeed(value: unknown): value is StoredFeedState {
  if (!isRecord(value) || value.version !== 1) return false;
  if (
    typeof value.query !== "string" ||
    !Array.isArray(value.cards) ||
    !Number.isInteger(value.position) ||
    Number(value.position) < 0 ||
    !Array.isArray(value.receivedEventIds) ||
    !value.receivedEventIds.every((id) => typeof id === "string") ||
    !Array.isArray(value.failedDestinations) ||
    !value.failedDestinations.every((name) => typeof name === "string")
  ) {
    return false;
  }
  if (value.assumedFields !== undefined && !isStoredAssumedFields(value.assumedFields)) {
    return false;
  }
  if (value.parsedQuery !== undefined && !isRecord(value.parsedQuery)) {
    return false;
  }
  return value.cards.every(
    (item) =>
      isRecord(item) &&
      typeof item.eventId === "string" &&
      typeof item.updated === "boolean" &&
      typeof item.isNewDestination === "boolean" &&
      isRecord(item.card) &&
      typeof item.card.destination === "string" &&
      isRecord(item.card.price) &&
      isRecord(item.card.transport) &&
      isRecord(item.card.hotel),
  );
}

function isStoredAssumedFields(value: unknown): value is DiscoveryRequiredField[] {
  return (
    Array.isArray(value) &&
    value.every(
      (field) =>
        typeof field === "string" &&
        ASSUMED_FIELD_NAMES.includes(field as DiscoveryRequiredField),
    )
  );
}

function isTerminal(event: SearchStreamEvent): event is TerminalEvent {
  return event.type === "done" || event.type === "aborted" || event.type === "unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function reactionId(): string {
  return globalThis.crypto.randomUUID();
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, Math.max(0, ms));
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function feedCountLabel(count: number): string {
  return `${count} ${plural(count, "вариант", "варианта", "вариантов")} в ленте`;
}

function reactionCountLabel(count: number): string {
  return `${count} ${plural(count, "реакция", "реакции", "реакций")}`;
}

function plural(count: number, one: string, few: string, many: string): string {
  const lastTwo = Math.abs(count) % 100;
  const last = lastTwo % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatStay(stay: CardEvent["card"]["stay"]): string {
  if (!stay) return "Даты уточняются";
  return `${stay.checkIn} — ${stay.checkOut}, ${stay.nights} ${plural(stay.nights, "ночь", "ночи", "ночей")}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

function transportLabel(value: string): string {
  if (value === "train") return "Поезд";
  if (value === "plane") return "Самолёт";
  if (value === "bus") return "Автобус";
  return value;
}

function priceAgeLabel(ageMs: number, stale: boolean): string {
  const hours = Math.max(0, Math.floor(ageMs / 3_600_000));
  const age =
    hours < 1
      ? "Цена получена меньше часа назад"
      : `Цена получена ${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  return stale ? `${age}, данные могут быть устаревшими` : age;
}
