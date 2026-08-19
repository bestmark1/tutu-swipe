import { describe, expect, it, vi } from "vitest";

import type { DiscoveryQuery } from "@/lib/discovery/schema";
import {
  MAX_SHARE_URL_LENGTH,
  createShortlistLink,
  decodeShortlistFragment,
  rebuildShortlist,
  type ShortlistOfferRef,
} from "@/lib/link";
import {
  createSessionState,
  signSessionState,
  type SessionReaction,
} from "@/lib/session";
import type { SearchCard } from "@/lib/search";

const SECRET = "test-secret-with-at-least-thirty-two-characters";
const BASE_URL = "https://tutu-swipe.example/list?must=disappear";
const QUERY: DiscoveryQuery = {
  origin: "Москва",
  travellers: { adults: 2, childrenAges: [5, 11] },
  dateWindow: { startDate: "2026-09-10", nights: 4 },
  budget: { amount: 80_000, currency: "RUB", scope: "group_trip_total" },
  vibeTags: ["sea", "quiet"],
};

function offer(index: number): ShortlistOfferRef {
  return {
    destination: ["Сочи", "Казань", "Калининград", "Псков"][index % 4],
    transportOfferId: `${String(index).padStart(2, "0")}d6e3129f003210b806a2f58709a8dc`,
    hotelOfferId: String(7_653_053 + index),
  };
}

function reaction(index: number): SessionReaction {
  return {
    id: `reaction-${index}`,
    cardId: `card-${index}`,
    occurredAt: new Date(Date.UTC(2026, 7, 7, 9, 0, index)).toISOString(),
    type: "like",
  };
}

function signedSession(count: number) {
  return signSessionState(
    {
      ...createSessionState({
        sessionId: "share-session",
        createdAt: "2026-08-07T09:00:00.000Z",
      }),
      reactions: Array.from({ length: count }, (_, index) => reaction(index)),
    },
    SECRET,
  );
}

function selection(journal: readonly SessionReaction[]) {
  return journal.slice(-3).map((item) => offer(Number(item.cardId.slice(5))));
}

function card(destination: string, transportId: string, hotelId: string): SearchCard {
  return {
    destination,
    transport: {
      id: transportId,
      transport: "railway",
      price: { amount: 20_000, currency: "RUB" },
      durationMinutes: 600,
      carriers: ["ФПК"],
      departureAt: "2026-09-10T09:00:00+03:00",
      arrivalAt: "2026-09-10T19:00:00+03:00",
      legs: [],
    },
    hotel: {
      id: hotelId,
      name: `Отель ${destination}`,
      photos: [],
      bestOffer: {
        price: { amount: 30_000, currency: "RUB" },
        priceBasis: "stay_total",
      },
    },
    stay: { checkIn: "2026-09-10", checkOut: "2026-09-14", nights: 4 },
    price: {
      total: { amount: 50_000, currency: "RUB", computed: true },
      breakdown: {
        transport: { amount: 20_000, currency: "RUB", label: "Дорога" },
        accommodation: {
          amount: 30_000,
          currency: "RUB",
          label: "Жильё за 4 ночи",
          priceBasis: "stay_total",
        },
      },
    },
    warnings: [],
  };
}

describe("shortlist link", () => {
  it("AC33a: keeps trip parameters in the fragment and clears query parameters", () => {
    const result = createShortlistLink(
      {
        baseUrl: BASE_URL,
        query: QUERY,
        session: signedSession(5),
        selectOffers: selection,
      },
      SECRET,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a share link");
    const url = new URL(result.url);
    expect(url.pathname).toBe("/list");
    expect(url.search).toBe("");
    expect(url.hash).toMatch(/^#v1\./u);
    expect(url.href).not.toContain("2026-09-10");

    const decoded = decodeShortlistFragment(url.hash, SECRET);
    expect(decoded).toMatchObject({ ok: true, payload: { query: QUERY } });
  });

  it("AC33: detects a damaged signature and an unsupported version", () => {
    const result = createShortlistLink(
      {
        baseUrl: BASE_URL,
        query: QUERY,
        session: signedSession(5),
        selectOffers: selection,
      },
      SECRET,
    );
    if (!result.ok) throw new Error("Expected a share link");
    const fragment = new URL(result.url).hash;

    expect(decodeShortlistFragment(`${fragment.slice(0, -1)}x`, SECRET)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      decodeShortlistFragment(fragment.replace(/^#v1\./u, "#v2."), SECRET),
    ).toEqual({ ok: false, reason: "unsupported_version" });
  });

  it("AC33 size budget: a real-shaped three-trip URL stays under the fixed limit", () => {
    const result = createShortlistLink(
      {
        baseUrl: "https://tutu-swipe.185.79.138.118.nip.io/list",
        query: QUERY,
        session: signedSession(10),
        selectOffers: () => [offer(0), offer(1), offer(2)],
      },
      SECRET,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a share link");
    expect(result.url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
    expect(result.url.length).toBeLessThan(1_000);
  });

  it("AC30: is locked before reaction five, mutable through nine, and frozen at ten", () => {
    const fourth = createShortlistLink(
      {
        baseUrl: BASE_URL,
        query: QUERY,
        session: signedSession(4),
        selectOffers: selection,
      },
      SECRET,
    );
    const fifth = createShortlistLink(
      {
        baseUrl: BASE_URL,
        query: QUERY,
        session: signedSession(5),
        selectOffers: selection,
      },
      SECRET,
    );
    const ninth = createShortlistLink(
      {
        baseUrl: BASE_URL,
        query: QUERY,
        session: signedSession(9),
        selectOffers: selection,
      },
      SECRET,
    );
    const tenth = createShortlistLink(
      {
        baseUrl: BASE_URL,
        query: QUERY,
        session: signedSession(10),
        selectOffers: selection,
      },
      SECRET,
    );
    const eleventh = createShortlistLink(
      {
        baseUrl: BASE_URL,
        query: QUERY,
        session: signedSession(11),
        selectOffers: selection,
      },
      SECRET,
    );

    expect(fourth).toMatchObject({ ok: false, reason: "locked" });
    expect(fifth).toMatchObject({ ok: true, status: "mutable" });
    expect(ninth).toMatchObject({ ok: true, status: "mutable" });
    expect(fifth).not.toEqual(ninth);
    expect(tenth).toMatchObject({ ok: true, status: "frozen" });
    expect(eleventh).toEqual(tenth);
  });

  it("AC31: сохраняет все отмеченные поездки", () => {
    const result = createShortlistLink(
      {
        baseUrl: BASE_URL,
        query: QUERY,
        session: signedSession(5),
        selectOffers: () => [offer(0), offer(1), offer(2), offer(3)],
      },
      SECRET,
    );
    if (!result.ok) throw new Error("Expected a share link");

    const decoded = decodeShortlistFragment(new URL(result.url).hash, SECRET);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("Expected a valid fragment");
    expect(decoded.payload.offers).toHaveLength(4);
  });

  it("AC31: обрезает подборку на шести — дальше ссылку режут мессенджеры", () => {
    const result = createShortlistLink(
      {
        baseUrl: BASE_URL,
        query: QUERY,
        session: signedSession(5),
        selectOffers: () =>
          Array.from({ length: 9 }, (_, index) => offer(index)),
      },
      SECRET,
    );
    if (!result.ok) throw new Error("Expected a share link");

    const decoded = decodeShortlistFragment(new URL(result.url).hash, SECRET);
    if (!decoded.ok) throw new Error("Expected a valid fragment");
    expect(decoded.payload.offers).toHaveLength(6);
  });

  it("AC33b: rebuilds the same directions and marks a changed offer as replaced", async () => {
    const stored = [offer(0), offer(1), offer(2)];
    const search = vi.fn(async () => [
      card(stored[0].destination, stored[0].transportOfferId, stored[0].hotelOfferId),
      card(stored[1].destination, "new-transport", stored[1].hotelOfferId),
      card(stored[2].destination, stored[2].transportOfferId, stored[2].hotelOfferId),
    ]);

    const rebuilt = await rebuildShortlist(
      { query: QUERY, offers: stored },
      { search },
    );

    expect(search).toHaveBeenCalledWith(QUERY, stored.map(({ destination }) => destination));
    expect(rebuilt.map(({ card: item }) => item.destination)).toEqual(
      stored.map(({ destination }) => destination),
    );
    expect(rebuilt.map(({ replaced }) => replaced)).toEqual([false, true, false]);
  });
});
