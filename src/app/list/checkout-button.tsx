"use client";

import { useEffect, useState } from "react";

import type {
  CheckoutLinkInput,
  PreparedCheckoutLink,
} from "@/lib/mcp/checkout";

const DEFAULT_CLIENT_TIMEOUT_MS = 6_000;
const FALLBACK_LABEL = "Открыть подборку на Туту";

export interface CheckoutButtonProps {
  checkoutRef: CheckoutLinkInput["checkoutRef"];
  fallbackUrl?: string;
  isMultiPnr?: boolean;
  multiPnrNote?: string;
  preparedLink?: PreparedCheckoutLink;
  fetcher?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}

export function CheckoutButton({
  checkoutRef,
  fallbackUrl,
  isMultiPnr = false,
  multiPnrNote,
  preparedLink,
  fetcher = fetch,
  endpoint = "/api/checkout",
  timeoutMs = DEFAULT_CLIENT_TIMEOUT_MS,
}: CheckoutButtonProps) {
  const [fetchedLink, setFetchedLink] = useState<PreparedCheckoutLink>();
  const link = preparedLink ?? fetchedLink;
  const requestBody = JSON.stringify({ checkoutRef, fallbackUrl });

  useEffect(() => {
    if (preparedLink) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    async function prepare() {
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: requestBody,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Checkout API failed");
        const payload: unknown = await response.json();
        if (!isPreparedCheckoutLink(payload)) {
          throw new Error("Invalid checkout response");
        }
        if (active) setFetchedLink(payload);
      } catch {
        if (active) setFetchedLink(clientFallback(checkoutRef, fallbackUrl));
      } finally {
        clearTimeout(timeout);
      }
    }

    void prepare();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [checkoutRef, endpoint, fallbackUrl, fetcher, preparedLink, requestBody, timeoutMs]);

  return (
    <div className="mt-5">
      {isMultiPnr && multiPnrNote ? (
        <p
          role="note"
          className="mb-3 rounded-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-ink"
        >
          {multiPnrNote}
        </p>
      ) : null}

      {link?.status === "fallback" ? (
        <p role="alert" className="mb-3 text-sm text-amber-800">
          {link.message}
        </p>
      ) : null}

      {link ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-md bg-action px-4 py-3.5 text-center font-semibold text-ink transition hover:bg-action-strong"
        >
          {link.label}
        </a>
      ) : (
        <span
          aria-live="polite"
          className="block rounded-md bg-canvas px-4 py-3.5 text-center font-medium text-ink-muted"
        >
          Готовим переход…
        </span>
      )}
    </div>
  );
}

function clientFallback(
  checkoutRef: CheckoutLinkInput["checkoutRef"],
  explicitFallback?: string,
): PreparedCheckoutLink {
  const fallback = safeTutuUrl(explicitFallback)
    ?? safeTutuUrl(readString(checkoutRef.search_results_url))
    ?? safeTutuUrl(readString(checkoutRef.fallback_url))
    ?? productHome(checkoutRef);

  return {
    status: "fallback",
    url: fallback,
    fallbackUrl: fallback,
    kind: "search_redirect",
    label: FALLBACK_LABEL,
    message: "Не удалось подготовить точный переход. Откроем результаты поиска.",
    failure: "error",
  };
}

function isPreparedCheckoutLink(value: unknown): value is PreparedCheckoutLink {
  if (!isRecord(value)) return false;
  if (value.status !== "ready" && value.status !== "fallback") return false;
  return (
    typeof value.url === "string" &&
    safeTutuUrl(value.url) !== undefined &&
    typeof value.fallbackUrl === "string" &&
    typeof value.kind === "string" &&
    typeof value.label === "string" &&
    (value.status === "ready" || typeof value.message === "string")
  );
}

function productHome(checkoutRef: CheckoutLinkInput["checkoutRef"]): string {
  const product = (
    readString(checkoutRef.product_type) ?? readString(checkoutRef.transport)
  )?.toLowerCase();
  if (product === "avia") return "https://avia.tutu.ru/";
  if (product === "bus") return "https://bus.tutu.ru/";
  if (product === "hotels") return "https://hotel.tutu.ru/";
  if (product === "etrain") return "https://www.tutu.ru/rasp.php";
  if (product === "rail" || product === "railway") {
    return "https://www.tutu.ru/poezda/";
  }
  return "https://www.tutu.ru/";
}

function safeTutuUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "tutu.ru" || url.hostname.endsWith(".tutu.ru"))
    ) {
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
