import { createHmac, timingSafeEqual } from "node:crypto";

import {
  VIBE_TAGS,
  type DiscoveryQuery,
  type VibeTag,
} from "../discovery/schema";
import {
  MAX_SHORTLIST_OFFERS,
  MAX_SHARE_URL_LENGTH,
  SHORTLIST_FORMAT_VERSION,
  type DecodeShortlistResult,
  type ShortlistOfferRef,
  type ShortlistPayload,
} from "./types";

const VERSION_TOKEN = `v${SHORTLIST_FORMAT_VERSION}`;
const LINK_SIGNATURE_CONTEXT = "tutu-swipe:shortlist:";
const SESSION_SECRET_ENV = "SESSION_STATE_SECRET";
const MAX_CITY_LENGTH = 128;
const MAX_OFFER_ID_LENGTH = 256;
const MAX_CHILDREN = 10;

type CompactPayload = {
  q: [string, number, number[], string, number, number, VibeTag[]];
  o: Array<[string, string, string]>;
};

export function encodeShortlistFragment(
  payload: ShortlistPayload,
  secret = linkSecret(),
): string {
  const normalized = normalizePayload(payload);
  if (!normalized) throw new TypeError("Shortlist payload is invalid");

  const encoded = Buffer.from(
    JSON.stringify(toCompactPayload(normalized)),
    "utf8",
  ).toString("base64url");
  const signed = `${VERSION_TOKEN}.${encoded}`;
  return `${signed}.${signatureFor(signed, secret)}`;
}

export function decodeShortlistFragment(
  fragment: string,
  secret = linkSecret(),
): DecodeShortlistResult {
  const value = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (value.length === 0 || value.length > MAX_SHARE_URL_LENGTH) {
    return { ok: false, reason: "invalid" };
  }

  const [version, encoded, signature, extra] = value.split(".");
  if (version !== VERSION_TOKEN) {
    return version?.startsWith("v")
      ? { ok: false, reason: "unsupported_version" }
      : { ok: false, reason: "invalid" };
  }
  if (!encoded || !signature || extra !== undefined || !isBase64Url(encoded)) {
    return { ok: false, reason: "invalid" };
  }

  const signed = `${version}.${encoded}`;
  if (!safeEqual(signature, signatureFor(signed, secret))) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) {
      return { ok: false, reason: "invalid" };
    }
    const compact: unknown = JSON.parse(bytes.toString("utf8"));
    const payload = fromCompactPayload(compact);
    return payload
      ? { ok: true, payload }
      : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

function toCompactPayload(payload: ShortlistPayload): CompactPayload {
  return {
    q: [
      payload.query.origin,
      payload.query.travellers.adults,
      payload.query.travellers.childrenAges,
      payload.query.dateWindow.startDate,
      payload.query.dateWindow.nights,
      payload.query.budget?.amount ?? 0,
      payload.query.vibeTags,
    ],
    o: payload.offers.map((offer) => [
      offer.destination,
      offer.transportOfferId,
      offer.hotelOfferId,
    ]),
  };
}

function fromCompactPayload(value: unknown): ShortlistPayload | undefined {
  if (!isRecord(value) || !Array.isArray(value.q) || !Array.isArray(value.o)) {
    return undefined;
  }
  if (value.q.length !== 7) return undefined;
  const [origin, adults, childrenAges, startDate, nights, budget, vibeTags] =
    value.q;
  const offers: ShortlistOfferRef[] = [];
  for (const item of value.o) {
    if (!Array.isArray(item) || item.length !== 3) return undefined;
    offers.push({
      destination: item[0] as string,
      transportOfferId: item[1] as string,
      hotelOfferId: item[2] as string,
    });
  }

  return normalizePayload({
    query: {
      origin: origin as string,
      travellers: {
        adults: adults as number,
        childrenAges: childrenAges as number[],
      },
      dateWindow: { startDate: startDate as string, nights: nights as number },
      // Ноль в компактном виде означает «бюджет не назван»: обратно он должен
      // разворачиваться в отсутствие поля, а не в сумму 0, которую валидация
      // справедливо отвергает как невалидную.
      ...(typeof budget === "number" && budget > 0
        ? {
            budget: {
              amount: budget,
              currency: "RUB" as const,
              scope: "group_trip_total" as const,
            },
          }
        : {}),
      vibeTags: vibeTags as VibeTag[],
    },
    offers,
  });
}

function normalizePayload(value: ShortlistPayload): ShortlistPayload | undefined {
  const query = normalizeQuery(value.query);
  if (!query || !Array.isArray(value.offers)) return undefined;
  if (value.offers.length === 0 || value.offers.length > MAX_SHORTLIST_OFFERS) {
    return undefined;
  }

  const offers: ShortlistOfferRef[] = [];
  for (const offer of value.offers) {
    if (!isRecord(offer)) return undefined;
    const destination = boundedString(offer.destination, MAX_CITY_LENGTH);
    const transportOfferId = boundedString(
      offer.transportOfferId,
      MAX_OFFER_ID_LENGTH,
    );
    const hotelOfferId = boundedString(offer.hotelOfferId, MAX_OFFER_ID_LENGTH);
    if (!destination || !transportOfferId || !hotelOfferId) return undefined;
    offers.push({ destination, transportOfferId, hotelOfferId });
  }
  return { query, offers };
}

function normalizeQuery(value: DiscoveryQuery): DiscoveryQuery | undefined {
  if (!isRecord(value)) return undefined;
  const origin = boundedString(value.origin, MAX_CITY_LENGTH);
  if (!origin || !isRecord(value.travellers) || !isRecord(value.dateWindow)) {
    return undefined;
  }
  // Бюджет и настроение необязательны: человек может их не называть, и тогда
  // поиск идёт с умолчаниями. Раньше валидация требовала оба, из-за чего
  // подборка по фразе «из Москвы в Сочи» вообще не собиралась — а ошибка
  // при этом маскировалась под «неверная сессия».
  if (!Array.isArray(value.vibeTags)) return undefined;
  if (value.budget !== undefined && !isRecord(value.budget)) return undefined;

  const adults = value.travellers.adults;
  const childrenAges = value.travellers.childrenAges;
  const startDate = value.dateWindow.startDate;
  const nights = value.dateWindow.nights;
  const budget = value.budget?.amount;
  if (!integerBetween(adults, 1, 20)) return undefined;
  if (
    !Array.isArray(childrenAges) ||
    childrenAges.length > MAX_CHILDREN ||
    !childrenAges.every((age) => integerBetween(age, 0, 17))
  ) {
    return undefined;
  }
  if (!isIsoDate(startDate) || !integerBetween(nights, 1, 60)) {
    return undefined;
  }
  if (budget !== undefined) {
    if (!Number.isSafeInteger(budget) || budget <= 0) return undefined;
    if (
      value.budget?.currency !== "RUB" ||
      value.budget?.scope !== "group_trip_total"
    ) {
      return undefined;
    }
  }
  if (!value.vibeTags.every(isVibeTag)) return undefined;

  return {
    origin,
    travellers: { adults, childrenAges: [...childrenAges] },
    dateWindow: { startDate, nights },
    ...(budget !== undefined
      ? {
          budget: {
            amount: budget,
            currency: "RUB" as const,
            scope: "group_trip_total" as const,
          },
        }
      : {}),
    vibeTags: [...value.vibeTags],
  };
}

function signatureFor(value: string, secret: string): string {
  if (secret.length === 0) throw new Error(`${SESSION_SECRET_ENV} must be set`);
  return createHmac("sha256", secret)
    .update(`${LINK_SIGNATURE_CONTEXT}${value}`, "utf8")
    .digest("base64url");
}

function linkSecret(): string {
  return process.env[SESSION_SECRET_ENV] ?? "";
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFKC").trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function integerBetween(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isVibeTag(value: unknown): value is VibeTag {
  return typeof value === "string" && (VIBE_TAGS as readonly string[]).includes(value);
}

function isBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
