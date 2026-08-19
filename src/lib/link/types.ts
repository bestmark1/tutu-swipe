import type { DiscoveryQuery } from "../discovery/schema";

export const SHORTLIST_FORMAT_VERSION = 1 as const;
/**
 * Сколько поездок помещается в подборку.
 *
 * Было три: подборка задумывалась коротким списком для отправки. Владелец
 * возразил по существу — человек отмечает восемь поездок и не понимает, куда
 * делись пять.
 *
 * Предел поднят до шести. Замер 19 августа на настоящих идентификаторах
 * (транспорт 32 символа, жильё 8): три поездки дают ссылку в 497 символов,
 * пять — 711, шесть — 817, а восемь уже 1031 при пределе в тысячу. Дальше
 * ссылку начинают резать мессенджеры, и подборка перестаёт открываться.
 */
export const MAX_SHORTLIST_OFFERS = 6;
export const MAX_SHARE_URL_LENGTH = 1_000;

export interface ShortlistOfferRef {
  destination: string;
  transportOfferId: string;
  hotelOfferId: string;
}

export interface ShortlistPayload {
  query: DiscoveryQuery;
  offers: ShortlistOfferRef[];
}

export type DecodeShortlistResult =
  | { ok: true; payload: ShortlistPayload }
  | { ok: false; reason: "invalid" | "unsupported_version" };
