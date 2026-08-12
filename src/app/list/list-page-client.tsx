"use client";

import { useEffect, useState } from "react";

import {
  openSharedList,
  type OpenSharedListResult,
} from "./actions";

export type OpenSharedList = (
  fragment: string,
) => Promise<OpenSharedListResult>;

export interface ListPageClientProps {
  open?: OpenSharedList;
}

type ShareState = "idle" | "copied" | "manual";

export function ListPageClient({
  open = openSharedList,
}: ListPageClientProps) {
  const [result, setResult] = useState<OpenSharedListResult | null>(null);

  useEffect(() => {
    let active = true;
    void open(window.location.hash).then((next) => {
      if (active) setResult(next);
    });
    return () => {
      active = false;
    };
  }, [open]);

  if (!result) {
    return <Message title="Открываем подборку…">Ищем актуальные варианты.</Message>;
  }
  if (result.status === "invalid_link") {
    const title =
      result.reason === "unsupported_version"
        ? "Версия ссылки не поддерживается"
        : "Ссылка повреждена";
    return (
      <Message title={title}>
        Подборку не удалось прочитать. Попросите отправителя создать новую ссылку.
      </Message>
    );
  }
  if (result.status === "unavailable") {
    return (
      <Message title="Не удалось обновить подборку">
        Источник временно недоступен. Попробуйте открыть ссылку позже.
      </Message>
    );
  }

  return (
    <main className="flex-1 bg-canvas px-4 py-8 text-ink sm:px-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">
          Подборка поездок
        </h1>
        <p className="mt-2 text-ink-muted">
          Цены и наличие обновлены при открытии ссылки.
        </p>

        <ShareButton />

        <div className="mt-6 grid gap-4">
          {result.trips.map((trip) => (
            <article
              className="overflow-hidden rounded-lg bg-surface p-5 shadow-card sm:p-6"
              key={`${trip.destination}:${trip.hotelName}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">{trip.destination}</h2>
                  <p className="mt-2 font-medium">{trip.hotelName}</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Жильё и дорога пересобраны по параметрам подборки
                  </p>
                </div>
                {trip.replaced ? (
                  <span className="rounded-md border border-warn/30 bg-warn-soft px-3 py-1 text-sm font-medium text-ink">
                    Предложение заменено
                  </span>
                ) : null}
              </div>
              <div className="mt-5 flex items-end justify-between gap-3 rounded-lg bg-indigo p-4">
                <span className="text-sm font-semibold text-ink-on-dark">Итого</span>
                <p className="text-3xl font-bold tracking-tight text-price">
                  {formatMoney(trip.totalAmount, trip.currency)}
                </p>
              </div>
              {trip.replaced ? (
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  Исходный вариант исчез, поэтому показан лучший актуальный по тем же параметрам.
                </p>
              ) : null}
              {trip.tutuUrl ? (
                <a
                  href={trip.tutuUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 block rounded-md bg-action px-4 py-3.5 text-center font-semibold text-white transition hover:bg-action-strong"
                >
                  Смотреть на Туту
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}

function ShareButton() {
  const [state, setState] = useState<ShareState>("idle");
  const [manualUrl, setManualUrl] = useState("");

  useEffect(() => {
    if (state !== "copied") return;
    const timeout = setTimeout(() => setState("idle"), 3000);
    return () => clearTimeout(timeout);
  }, [state]);

  async function share() {
    const url = window.location.href;
    if (!navigator.clipboard?.writeText) {
      setManualUrl(url);
      setState("manual");
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setManualUrl(url);
      setState("manual");
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => void share()}
        className="w-full rounded-md bg-action px-5 py-3.5 font-semibold text-white transition hover:bg-action-strong sm:w-auto"
      >
        Поделиться
      </button>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-muted">
        {state === "copied"
          ? "Ссылка скопирована — отправьте её, с кем выбираете поездку."
          : state === "manual"
            ? "Автоматически скопировать не удалось — выделите ссылку ниже и скопируйте её вручную."
            : "Внутри ссылки — сама подборка, без сессии и аккаунта."}
      </p>
      {state === "manual" ? (
        <input
          type="text"
          aria-label="Ссылка на подборку"
          readOnly
          value={manualUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-2 w-full rounded-md border border-divider bg-field px-3 py-2 text-sm text-ink"
        />
      ) : null}
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
    <main className="grid flex-1 place-items-center bg-canvas px-5 py-12 text-ink">
      <section className="max-w-lg rounded-lg bg-surface p-8 shadow-card">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 leading-7 text-ink-muted">{children}</p>
      </section>
    </main>
  );
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
