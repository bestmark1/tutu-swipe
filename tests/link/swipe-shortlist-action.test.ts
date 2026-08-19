import { afterEach, describe, expect, it, vi } from "vitest";

import { createSwipeShortlist } from "@/app/swipe/actions";
import type { DiscoveryQuery } from "@/lib/discovery/schema";
import { decodeShortlistFragment } from "@/lib/link";
import {
  createSessionState,
  signSessionState,
  type SessionReaction,
} from "@/lib/session";

const SECRET = "test-secret-with-at-least-thirty-two-characters";
const QUERY: DiscoveryQuery = {
  origin: "Москва",
  travellers: { adults: 2, childrenAges: [] },
  dateWindow: { startDate: "2026-09-10", nights: 4 },
  budget: { amount: 80_000, currency: "RUB", scope: "group_trip_total" },
  vibeTags: ["sea"],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("swipe shortlist action", () => {
  it("connects verified likes to createShortlistLink and returns a signed fragment", async () => {
    vi.stubEnv("SESSION_STATE_SECRET", SECRET);
    const reactions: SessionReaction[] = Array.from(
      { length: 5 },
      (_, index) => ({
        id: `reaction-${index}`,
        cardId: `card-${index}`,
        occurredAt: new Date(Date.UTC(2026, 7, 19, 9, 0, index)).toISOString(),
        type: index === 3 ? "dislike" : "like",
      }),
    );
    const signed = signSessionState(
      {
        ...createSessionState({ sessionId: "swipe-shortlist" }),
        reactions,
      },
      SECRET,
    );
    const candidates = reactions.map((reaction, index) => ({
      eventId: reaction.cardId,
      destination: ["Сочи", "Казань", "Самара", "Тула", "Псков"][index],
      transportOfferId: `transport-${index}`,
      hotelOfferId: `hotel-${index}`,
    }));

    const result = await createSwipeShortlist(
      signed,
      QUERY,
      candidates,
      "https://tutu-swipe.example/list",
    );

    expect(result).toMatchObject({ ok: true, status: "mutable" });
    if (!result.ok) throw new Error("Expected a shortlist link");
    const url = new URL(result.url);
    expect(url.pathname).toBe("/list");
    expect(url.hash.length).toBeGreaterThan(1);
    const decoded = decodeShortlistFragment(url.hash, SECRET);
    expect(decoded).toMatchObject({
      ok: true,
      payload: {
        offers: [
          { destination: "Псков" },
          { destination: "Самара" },
          { destination: "Казань" },
        ],
      },
    });
  });
});
