"use client";

import { FormEvent, useState } from "react";

import { assumedFieldChips } from "@/lib/discovery/assumed";
import type {
  DiscoveryQuery,
  DiscoveryRequiredField,
} from "@/lib/discovery/schema";
import type {
  SearchOnceCard,
  SearchOnceResult,
  TutuLinkKind,
} from "@/lib/usecases/search-once";

type ScreenResult =
  | SearchOnceResult
  | { status: "request_error"; message: string };

export default function Home() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ScreenResult>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() || loading) return;

    setLoading(true);
    setResult(undefined);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const payload: unknown = await response.json();
      if (!isSearchResult(payload)) throw new Error("invalid response");
      setResult(payload);
    } catch {
      setResult({
        status: "request_error",
        message: "Не удалось выполнить поиск. Проверьте соединение и попробуйте ещё раз.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-canvas px-4 py-8 text-ink sm:px-8 sm:py-14">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        <header className="max-w-3xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
            tutu-swipe
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Куда отправимся?
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-ink-muted sm:text-lg">
            Опишите поездку одной фразой — соберём дорогу и жильё в готовые варианты.
          </p>
        </header>

        <form className="mt-8 flex max-w-3xl flex-col gap-3 sm:flex-row" onSubmit={submit}>
          <label className="sr-only" htmlFor="travel-query">
            Пожелания к поездке
          </label>
          <input
            id="travel-query"
            name="travel-query"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Из Москвы на море в сентябре вдвоём"
            className="min-w-0 flex-1 rounded-md border border-divider bg-surface px-5 py-4 text-base text-ink outline-none transition placeholder:text-ink-faint focus:border-accent"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-md bg-action px-6 py-4 text-base font-semibold text-ink transition hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-45"
          >
            {loading ? "Ищем…" : "Найти"}
          </button>
        </form>

        <Result result={result} />
      </div>
    </main>
  );
}

function Result({ result }: { result: ScreenResult | undefined }) {
  if (!result) return null;

  if (result.status === "success") {
    return (
      <section className="mt-12" aria-live="polite">
        <AssumedFieldsNote
          query={result.query}
          assumedFields={result.assumedFields}
        />
        <h2 className="text-2xl font-semibold">Готовые поездки</h2>
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          {result.cards.map((card) => (
            <TripCardView key={card.destination} card={card} />
          ))}
        </div>
      </section>
    );
  }

  if (result.status === "needs_clarification") {
    return (
      <Message title="Нужно уточнение">
        {result.clarifications.map(({ field, question }) => (
          <p key={field}>{question}</p>
        ))}
      </Message>
    );
  }

  if (result.status === "rejected") {
    return (
      <Message title={result.message}>
        <p>{result.hint}</p>
      </Message>
    );
  }

  return (
    <Message
      title={
        result.status === "source_unavailable"
          ? "Источник временно недоступен"
          : result.status === "no_offers"
            ? "Вариантов пока нет"
            : "Поиск не выполнен"
      }
    >
      <p>{result.message}</p>
    </Message>
  );
}

function TripCardView({ card }: { card: SearchOnceCard }) {
  return (
    <article className="flex flex-col rounded-lg bg-surface p-5 shadow-card sm:p-6">
      <p className="text-sm font-medium text-accent">
        {card.stay?.checkIn} — {card.stay?.checkOut}
      </p>
      <h3 className="mt-2 text-2xl font-semibold sm:text-3xl">{card.destination}</h3>
      <p className="mt-4 font-medium">{card.hotel.name}</p>
      <p className="mt-1 text-sm text-ink-muted">
        {card.hotel.address ?? "Адрес уточняется на Туту"}
      </p>

      <dl className="mt-5 space-y-2 border-t border-divider pt-4 text-sm">
        <PriceRow
          label={card.price.breakdown.transport.label}
          amount={card.price.breakdown.transport.amount}
          currency={card.price.breakdown.transport.currency}
        />
        <PriceRow
          label={card.price.breakdown.accommodation.label}
          amount={card.price.breakdown.accommodation.amount}
          currency={card.price.breakdown.accommodation.currency}
        />
        <div className="flex items-baseline justify-between gap-3 pt-3 text-base font-semibold">
          <dt>Итого</dt>
          <dd className="text-xl">
            {formatMoney(card.price.total.amount, card.price.total.currency)}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs leading-5 text-ink-muted">
        Цена получена сейчас и могла измениться к моменту перехода на Туту.
      </p>
      <a
        href={card.tutuUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 rounded-md bg-action px-4 py-3.5 text-center font-semibold text-ink transition hover:bg-action-strong"
      >
        {linkLabel(card.linkKind)}
      </a>
    </article>
  );
}

function AssumedFieldsNote({
  query,
  assumedFields,
}: {
  query: DiscoveryQuery;
  assumedFields: DiscoveryRequiredField[];
}) {
  const chips = assumedFieldChips(query, assumedFields);
  if (chips.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={chip.field}
            className="rounded-sm bg-accent-soft px-3 py-1.5 text-sm font-medium text-ink"
          >
            {chip.label}
            <span className="text-ink-muted"> · подставлено</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        Эти параметры система подставила сама — уточните их во фразе и запустите
        поиск заново, если нужно иначе.
      </p>
    </div>
  );
}

function PriceRow({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: number;
  currency: string;
}) {
  return (
    <div className="flex justify-between gap-3 text-ink-muted">
      <dt>{label}</dt>
      <dd>{formatMoney(amount, currency)}</dd>
    </div>
  );
}

function Message({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="mt-10 max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950"
      aria-live="polite"
    >
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 space-y-1 text-sm leading-6">{children}</div>
    </section>
  );
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function linkLabel(kind: TutuLinkKind): string {
  if (kind === "checkout") return "Выбрать места на Туту";
  if (kind === "hotel_page") return "Выбрать номер на Туту";
  return "Смотреть варианты на Туту";
}

function isSearchResult(value: unknown): value is SearchOnceResult {
  if (typeof value !== "object" || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return (
    status === "success" ||
    status === "no_offers" ||
    status === "source_unavailable" ||
    status === "needs_clarification" ||
    status === "rejected"
  );
}
