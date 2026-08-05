"use client";

import { FormEvent, useState } from "react";

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
    <main className="min-h-screen bg-[#f4f2ed] px-4 py-10 text-zinc-950 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <header className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
            tutu-swipe
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
            Куда отправимся?
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-600">
            Опишите поездку одной фразой — соберём дорогу и жильё в готовые варианты.
          </p>
        </header>

        <form className="mt-10 flex max-w-3xl gap-3" onSubmit={submit}>
          <label className="sr-only" htmlFor="travel-query">
            Пожелания к поездке
          </label>
          <input
            id="travel-query"
            name="travel-query"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Из Москвы, вдвоём, в сентябре на 4 ночи, до 60к, к морю"
            className="min-w-0 flex-1 rounded-2xl border border-zinc-300 bg-white px-5 py-4 text-base shadow-sm outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-2xl bg-zinc-950 px-6 py-4 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
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
    <article className="flex flex-col rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-emerald-700">
        {card.stay?.checkIn} — {card.stay?.checkOut}
      </p>
      <h3 className="mt-2 text-3xl font-semibold">{card.destination}</h3>
      <p className="mt-4 font-medium">{card.hotel.name}</p>
      <p className="mt-1 text-sm text-zinc-500">
        {card.hotel.address ?? "Адрес уточняется на Туту"}
      </p>

      <dl className="mt-6 space-y-2 border-t border-zinc-200 pt-5 text-sm">
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

      <p className="mt-5 text-xs leading-5 text-zinc-500">
        Цена получена сейчас и могла измениться к моменту перехода на Туту.
      </p>
      <a
        href={card.tutuUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 rounded-xl bg-emerald-700 px-4 py-3 text-center font-medium text-white transition hover:bg-emerald-800"
      >
        {linkLabel(card.linkKind)}
      </a>
    </article>
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
    <div className="flex justify-between gap-3 text-zinc-600">
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
