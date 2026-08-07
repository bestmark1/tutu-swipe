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
    <main className="min-h-screen bg-zinc-950 px-5 py-10 text-zinc-50">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm font-medium text-emerald-300">tutu-swipe</p>
        <h1 className="mt-2 text-3xl font-semibold">Подборка поездок</h1>
        <p className="mt-2 text-zinc-400">
          Цены и наличие обновлены при открытии ссылки.
        </p>
        <div className="mt-8 grid gap-4">
          {result.trips.map((trip) => (
            <article
              className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6"
              key={`${trip.destination}:${trip.hotelName}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">{trip.destination}</h2>
                  <p className="mt-1 text-zinc-300">{trip.hotelName}</p>
                </div>
                {trip.replaced ? (
                  <span className="rounded-full bg-amber-300/15 px-3 py-1 text-sm text-amber-200">
                    Предложение заменено
                  </span>
                ) : null}
              </div>
              <p className="mt-6 text-xl font-semibold">
                {formatMoney(trip.totalAmount, trip.currency)}
              </p>
              {trip.replaced ? (
                <p className="mt-2 text-sm text-zinc-400">
                  Исходный вариант исчез, поэтому показан лучший актуальный по тем же параметрам.
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </main>
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
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-5 text-zinc-50">
      <section className="max-w-lg rounded-3xl border border-zinc-800 bg-zinc-900 p-8">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-zinc-300">{children}</p>
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
