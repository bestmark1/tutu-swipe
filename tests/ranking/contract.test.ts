import { describe, expect, it } from "vitest";

import {
  FEATURE_NAMES,
  createBayesianRanker,
  createRuleRanker,
  type RankableCard,
  type Ranker,
} from "@/lib/ranking";
import type { SessionReaction } from "@/lib/session";

const CONTEXT = { budget: 100_000 };
const NOW = "2026-08-06T09:00:00.000Z";

function card({
  id,
  city,
  price = 80_000,
  duration = 180,
  transfers = 0,
  transport = "avia",
  stars = 4,
  rating = 8,
  locationType = "city",
}: {
  id: string;
  city: string;
  price?: number;
  duration?: number;
  transfers?: number;
  transport?: string;
  stars?: number;
  rating?: number;
  locationType?: string;
}): RankableCard {
  return {
    id,
    destination: city,
    locationType,
    price: { total: { amount: price } },
    transport: {
      id: `transport-${id}`,
      transport,
      durationMinutes: duration,
      legs: [
        {
          segments: Array.from({ length: transfers + 1 }, () => ({})),
        },
      ],
    },
    hotel: { stars, rating },
  };
}

function like(index: number, cardId: string): SessionReaction {
  return {
    id: `like-${index}`,
    cardId,
    occurredAt: NOW,
    type: "like",
  };
}

function dislike(
  index: number,
  cardId: string,
  reason: "too_expensive" | "too_long" | "wrong_city" | "wrong_hotel",
): SessionReaction {
  return {
    id: `dislike-${index}`,
    cardId,
    occurredAt: NOW,
    type: "dislike",
    reason,
  };
}

const implementations: Array<{
  name: string;
  create: () => Ranker;
}> = [
  { name: "bayesian", create: () => createBayesianRanker({ seed: 42 }) },
  { name: "rules", create: () => createRuleRanker() },
];

describe.each(implementations)("$name ranker contract", ({ create }) => {
  it("likes on direct routes lower cards with transfers", () => {
    const ranker = create();
    const liked = card({ id: "liked", city: "Казань", transfers: 0 });
    for (let index = 0; index < 3; index += 1) {
      ranker.react(like(index, liked.id!), liked, CONTEXT);
    }

    const direct = card({
      id: "direct",
      city: "Самара",
      price: 85_000,
      transfers: 0,
    });
    const connecting = card({
      id: "connecting",
      city: "Уфа",
      price: 70_000,
      transfers: 2,
    });

    expect(ranker.rank([connecting, direct], CONTEXT)[0]?.id).toBe("direct");
  });

  it("AC20: too_expensive lowers the median price of following cards", () => {
    const pool = [
      card({ id: "p1", city: "Казань", price: 35_000, rating: 6 }),
      card({ id: "p2", city: "Самара", price: 50_000, rating: 7 }),
      card({ id: "p3", city: "Уфа", price: 70_000, rating: 10 }),
      card({ id: "p4", city: "Псков", price: 100_000, rating: 10 }),
      card({ id: "p5", city: "Тула", price: 120_000, rating: 10 }),
      card({ id: "p6", city: "Омск", price: 150_000, rating: 10 }),
    ];
    const expensive = card({ id: "shown", city: "Сочи", price: 150_000 });
    const before = medianPrice(create().rank(pool, CONTEXT).slice(0, 3));
    const ranker = create();

    ranker.react(dislike(1, expensive.id!, "too_expensive"), expensive, CONTEXT);
    const after = medianPrice(ranker.rank(pool, CONTEXT).slice(0, 3));

    expect(after).toBeLessThan(before);
  });

  it("AC19: wrong_city excludes that city", () => {
    const ranker = create();
    const rejected = card({ id: "sochi-1", city: "Сочи" });
    ranker.react(dislike(1, rejected.id!, "wrong_city"), rejected, CONTEXT);

    const ranked = ranker.rank(
      [rejected, card({ id: "sochi-2", city: "Сочи" }), card({ id: "kazan", city: "Казань" })],
      CONTEXT,
    );

    expect(ranked.map(({ destination }) => destination)).toEqual(["Казань"]);
  });

  it("AC19: two consecutive wrong_city reactions request a refill", () => {
    const ranker = create();
    const first = card({ id: "first", city: "Сочи" });
    const second = card({ id: "second", city: "Анапа" });

    expect(
      ranker.react(dislike(1, first.id!, "wrong_city"), first, CONTEXT)
        .refillRequested,
    ).toBe(false);
    expect(
      ranker.react(dislike(2, second.id!, "wrong_city"), second, CONTEXT)
        .refillRequested,
    ).toBe(true);
    expect(ranker.shouldRefill()).toBe(true);
  });

  it("wrong_hotel changes housing weights but not transport weights", () => {
    const ranker = create();
    const rejected = card({ id: "hotel", city: "Казань", stars: 5, rating: 9.8 });
    const before = ranker.getWeights();

    ranker.react(dislike(1, rejected.id!, "wrong_hotel"), rejected, CONTEXT);
    const after = ranker.getWeights();

    const housing = [FEATURE_NAMES.indexOf("hotelStars"), FEATURE_NAMES.indexOf("hotelRating")];
    const transport = [
      FEATURE_NAMES.indexOf("shortTravel"),
      FEATURE_NAMES.indexOf("directness"),
      FEATURE_NAMES.indexOf("airTransport"),
      FEATURE_NAMES.indexOf("railTransport"),
    ];
    expect(housing.some((index) => after[index] !== before[index])).toBe(true);
    expect(transport.map((index) => after[index])).toEqual(
      transport.map((index) => before[index]),
    );
  });

  it("too_long changes travel-time weight without changing hotel weights", () => {
    const ranker = create();
    const rejected = card({ id: "long", city: "Казань", duration: 1_200 });
    const before = ranker.getWeights();

    ranker.react(dislike(1, rejected.id!, "too_long"), rejected, CONTEXT);
    const after = ranker.getWeights();

    expect(after[FEATURE_NAMES.indexOf("shortTravel")]).not.toBe(
      before[FEATURE_NAMES.indexOf("shortTravel")],
    );
    for (const feature of ["hotelStars", "hotelRating"] as const) {
      const index = FEATURE_NAMES.indexOf(feature);
      expect(after[index]).toBe(before[index]);
    }
  });

  it("AC23: repeated reaction identifiers are applied only once", () => {
    const ranker = create();
    const liked = card({ id: "same", city: "Казань" });
    const reaction = like(1, liked.id!);

    expect(ranker.react(reaction, liked, CONTEXT).duplicate).toBe(false);
    const afterFirst = ranker.getState();
    expect(ranker.react(reaction, liked, CONTEXT).duplicate).toBe(true);

    expect(ranker.getState()).toEqual(afterFirst);
  });

  it("AC21: every five-card window contains at most two cards from one city", () => {
    const ranker = create();
    const pool = [
      ...Array.from({ length: 5 }, (_, index) =>
        card({ id: `k${index}`, city: "Казань", price: 40_000 + index }),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        card({ id: `s${index}`, city: "Самара", price: 60_000 + index }),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        card({ id: `u${index}`, city: "Уфа", price: 80_000 + index }),
      ),
    ];

    const ranked = ranker.rank(pool, CONTEXT);
    for (let start = 0; start <= ranked.length - 5; start += 1) {
      const counts = new Map<string, number>();
      for (const item of ranked.slice(start, start + 5)) {
        counts.set(item.destination, (counts.get(item.destination) ?? 0) + 1);
      }
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    }
  });

  it("without reactions uses the same default order instead of randomness", () => {
    const pool = [
      card({ id: "slow", city: "Уфа", duration: 900, price: 100_000 }),
      card({ id: "best", city: "Казань", duration: 90, price: 50_000 }),
      card({ id: "middle", city: "Самара", duration: 300, price: 75_000 }),
    ];

    expect(create().rank(pool, CONTEXT).map(({ id }) => id)).toEqual([
      "best",
      "middle",
      "slow",
    ]);
  });

  it("one-sided feedback still reserves an exploration slot for a dissimilar card", () => {
    const ranker = create();
    const liked = card({ id: "liked", city: "Казань", transfers: 0, transport: "avia" });
    for (let index = 0; index < 4; index += 1) {
      ranker.react(like(index, liked.id!), liked, CONTEXT);
    }
    const pool = [
      card({ id: "same-1", city: "Самара", transfers: 0, transport: "avia" }),
      card({ id: "same-2", city: "Уфа", transfers: 0, transport: "avia" }),
      card({ id: "same-3", city: "Псков", transfers: 0, transport: "avia" }),
      card({ id: "same-4", city: "Тула", transfers: 0, transport: "avia" }),
      card({ id: "explore", city: "Омск", transfers: 2, transport: "rail" }),
    ];

    expect(ranker.rank(pool, CONTEXT).slice(0, 4).map(({ id }) => id)).toContain(
      "explore",
    );
  });
});

function medianPrice(cards: readonly RankableCard[]): number {
  const prices = cards
    .map(({ price }) => price.total.amount)
    .sort((first, second) => first - second);
  return prices[Math.floor(prices.length / 2)] ?? Number.NaN;
}
