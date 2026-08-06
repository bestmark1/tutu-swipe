import { describe, expect, it } from "vitest";

import {
  createBayesianRanker,
  restoreBayesianRanker,
  type RankableCard,
} from "@/lib/ranking";
import type { SessionReaction } from "@/lib/session";

const CONTEXT = { budget: 100_000 };

function card(id: string, city: string, price: number): RankableCard {
  return {
    id,
    destination: city,
    locationType: "city",
    price: { total: { amount: price } },
    transport: {
      id: `transport-${id}`,
      transport: id.includes("rail") ? "rail" : "avia",
      durationMinutes: price / 100,
      legs: [{ segments: [{}] }],
    },
    hotel: { stars: 4, rating: 8 },
  };
}

function like(id: string, cardId: string): SessionReaction {
  return {
    id,
    cardId,
    occurredAt: "2026-08-06T09:00:00.000Z",
    type: "like",
  };
}

describe("bayesian ranker state", () => {
  it("AC25: the same seed and reactions produce an identical feed", () => {
    const pool = [
      card("a", "Казань", 60_000),
      card("rail-b", "Самара", 75_000),
      card("c", "Уфа", 90_000),
      card("rail-d", "Псков", 105_000),
      card("e", "Тула", 120_000),
    ];
    const first = createBayesianRanker({ seed: 73 });
    const second = createBayesianRanker({ seed: 73 });
    for (const ranker of [first, second]) {
      ranker.react(like("r1", "a"), pool[0], CONTEXT);
      ranker.react(like("r2", "c"), pool[2], CONTEXT);
    }

    expect(first.rank(pool, CONTEXT).map(({ id }) => id)).toEqual(
      second.rank(pool, CONTEXT).map(({ id }) => id),
    );
  });

  it("serializes and restores posterior and generator state without loss", () => {
    const pool = [
      card("a", "Казань", 60_000),
      card("rail-b", "Самара", 75_000),
      card("c", "Уфа", 90_000),
      card("rail-d", "Псков", 105_000),
    ];
    const original = createBayesianRanker({ seed: 91 });
    original.react(like("r1", "a"), pool[0], CONTEXT);
    original.rank(pool, CONTEXT);

    const serialized = original.serialize();
    const restored = restoreBayesianRanker(serialized);

    expect(restored.getState()).toEqual(original.getState());
    expect(restored.rank(pool, CONTEXT).map(({ id }) => id)).toEqual(
      original.rank(pool, CONTEXT).map(({ id }) => id),
    );
    expect(restored.getState()).toEqual(original.getState());
  });
});
