import { McpPayloadError, parseTextPayload } from "./normalize";
import { createSdkToolInvoker } from "./sdk";
import type { McpToolInvoker } from "./types";

export const DEFAULT_CHECKOUT_TIMEOUT_MS = 4_000;

export type CheckoutRef = Record<string, unknown>;

export type CheckoutLinkKind =
  | "checkout_deeplink"
  | "deeplink"
  | "hotel_page"
  | "order_url"
  | "search_redirect"
  | "seats_url";

export type CheckoutLinkLabel =
  | "Открыть корзину"
  | "Выбрать места"
  | "Открыть подборку на Туту";

export interface CheckoutLinkInput {
  checkoutRef: CheckoutRef;
  fallbackUrl?: string;
  signal?: AbortSignal;
}

export type PreparedCheckoutLink =
  | {
      status: "ready";
      url: string;
      fallbackUrl: string;
      kind: CheckoutLinkKind;
      label: CheckoutLinkLabel;
    }
  | {
      status: "fallback";
      url: string;
      fallbackUrl: string;
      kind: "search_redirect";
      label: "Открыть подборку на Туту";
      message: string;
      failure: "error" | "invalid_response" | "timeout";
    };

export interface PrepareCheckoutLinkOptions {
  invoker?: McpToolInvoker;
  timeoutMs?: number;
}

interface CheckoutToolPayload {
  checkoutUrl: string;
  kind: CheckoutLinkKind;
  searchResultsUrl?: string;
}

class CheckoutTimeoutError extends Error {}

export async function prepareCheckoutLink(
  input: CheckoutLinkInput,
  options: PrepareCheckoutLinkOptions = {},
): Promise<PreparedCheckoutLink> {
  const fallbackUrl = checkoutFallbackUrl(input.checkoutRef, input.fallbackUrl);
  const timeoutMs = positiveTimeout(
    options.timeoutMs ?? DEFAULT_CHECKOUT_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const abortFromInput = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abortFromInput, { once: true });
  if (input.signal?.aborted) abortFromInput();

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new CheckoutTimeoutError());
  }, timeoutMs);

  try {
    const invoker = options.invoker ?? createSdkToolInvoker();
    const result = await Promise.race([
      invoker({
        name: "create_checkout_link",
        arguments: input.checkoutRef,
        signal: controller.signal,
        timeoutMs,
      }),
      aborted(controller.signal),
    ]);
    const payload = normalizeCheckoutToolResult(result);
    const effectiveFallback = payload.searchResultsUrl ?? fallbackUrl;

    return {
      status: "ready",
      url: payload.checkoutUrl,
      fallbackUrl: effectiveFallback,
      kind: payload.kind,
      label: checkoutLinkLabel(payload.kind, input.checkoutRef),
    };
  } catch (error) {
    if (timedOut || error instanceof CheckoutTimeoutError) {
      return fallback(fallbackUrl, "timeout");
    }
    if (error instanceof McpPayloadError || error instanceof TypeError) {
      return fallback(fallbackUrl, "invalid_response");
    }
    return fallback(fallbackUrl, "error");
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortFromInput);
  }
}

export function checkoutLinkLabel(
  kind: CheckoutLinkKind,
  checkoutRef: CheckoutRef = {},
): CheckoutLinkLabel {
  if (kind === "checkout_deeplink") return "Открыть корзину";
  if (kind === "search_redirect" || kind === "hotel_page") {
    return "Открыть подборку на Туту";
  }
  if (kind === "order_url" || kind === "seats_url") return "Выбрать места";

  const product = productType(checkoutRef);
  if (product === "avia") return "Открыть корзину";
  if (product === "rail" || product === "railway" || product === "bus") {
    return "Выбрать места";
  }
  return "Открыть подборку на Туту";
}

export function checkoutFallbackUrl(
  checkoutRef: CheckoutRef,
  explicitFallback?: string,
): string {
  const candidates = [
    explicitFallback,
    stringValue(checkoutRef.search_results_url),
    stringValue(checkoutRef.fallback_url),
  ];
  for (const candidate of candidates) {
    if (candidate && isTutuUrl(candidate)) return candidate;
  }

  switch (productType(checkoutRef)) {
    case "avia":
      return "https://avia.tutu.ru/";
    case "bus":
      return "https://bus.tutu.ru/";
    case "hotels":
      return "https://hotel.tutu.ru/";
    case "etrain":
      return "https://www.tutu.ru/rasp.php";
    case "rail":
    case "railway":
      return "https://www.tutu.ru/poezda/";
    default:
      return "https://www.tutu.ru/";
  }
}

function normalizeCheckoutToolResult(result: unknown): CheckoutToolPayload {
  const payload = isRecord(result) && Array.isArray(result.content)
    ? parseTextPayload(result)
    : result;
  if (!isRecord(payload)) {
    throw new McpPayloadError("Checkout payload must be an object");
  }

  const checkoutUrl = stringValue(payload.checkout_url);
  const kind = stringValue(payload.kind);
  if (!checkoutUrl || !isTutuUrl(checkoutUrl) || !isCheckoutKind(kind)) {
    throw new McpPayloadError("Checkout payload has no safe URL or known kind");
  }
  const searchResultsUrl = stringValue(payload.search_results_url);

  return {
    checkoutUrl,
    kind,
    ...(searchResultsUrl && isTutuUrl(searchResultsUrl)
      ? { searchResultsUrl }
      : {}),
  };
}

function fallback(
  url: string,
  failure: "error" | "invalid_response" | "timeout",
): PreparedCheckoutLink {
  return {
    status: "fallback",
    url,
    fallbackUrl: url,
    kind: "search_redirect",
    label: "Открыть подборку на Туту",
    message:
      failure === "timeout"
        ? "Туту не ответил вовремя. Откроем результаты поиска."
        : "Не удалось подготовить точный переход. Откроем результаты поиска.",
    failure,
  };
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

function positiveTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("timeoutMs must be a positive number");
  }
  return value;
}

function productType(checkoutRef: CheckoutRef): string | undefined {
  return (
    stringValue(checkoutRef.product_type) ?? stringValue(checkoutRef.transport)
  )?.toLowerCase();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isCheckoutKind(value: string | undefined): value is CheckoutLinkKind {
  return (
    value === "checkout_deeplink" ||
    value === "deeplink" ||
    value === "hotel_page" ||
    value === "order_url" ||
    value === "search_redirect" ||
    value === "seats_url"
  );
}

function isTutuUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "tutu.ru" || url.hostname.endsWith(".tutu.ru"))
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
