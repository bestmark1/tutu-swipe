import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_WEIGHTS,
  FEATURE_NAMES,
  summarizePreferences,
  type RankableCard,
} from "@/lib/ranking";
import {
  addSignedSwipeReaction,
  createSignedSwipeSession,
} from "@/lib/usecases/react";

const VARIED_FEATURES = FEATURE_NAMES.map(() => 1);

function changedWeights(
  changes: Partial<Record<(typeof FEATURE_NAMES)[number], number>>,
): number[] {
  return FEATURE_NAMES.map(
    (feature, index) => DEFAULT_WEIGHTS[index]! + (changes[feature] ?? 0),
  );
}

describe("learned preference summary", () => {
  beforeEach(() => {
    process.env.SESSION_STATE_SECRET =
      "test-secret-with-at-least-thirty-two-characters";
  });

  it("is returned by the reaction use case on the third reaction", () => {
    const cards = [travelCard("slow", 1_200), travelCard("fast", 90)];
    let signed = createSignedSwipeSession({ sessionId: "preference-summary" });

    for (let index = 1; index <= 3; index += 1) {
      const outcome = addSignedSwipeReaction(
        signed,
        {
          id: `reaction-${index}`,
          cardId: "slow",
          occurredAt: `2026-08-13T09:00:0${index}.000Z`,
          type: "dislike",
          reason: "too_long",
        },
        cards,
      );
      signed = outcome.session;
      expect(outcome.feed.preferenceSummary).toEqual(
        index < 3 ? [] : ["предпочитаете быстрые поездки"],
      );
    }
  });

  it("does not infer a preference before three reactions", () => {
    const weights = changedWeights({ shortTravel: 2 });

    expect(summarizePreferences(weights, 2, VARIED_FEATURES)).toEqual([]);
  });

  it("uses human wording for the strongest learned weights", () => {
    const weights = changedWeights({
      affordability: 1.2,
      shortTravel: 1.1,
      hotelRating: 1,
    });

    expect(summarizePreferences(weights, 3, VARIED_FEATURES)).toEqual([
      "избегаете дорогих вариантов",
      "предпочитаете быстрые поездки",
      "выбираете жильё с высоким рейтингом",
    ]);
  });

  it("omits weak changes and features that do not vary in the feed", () => {
    const weights = changedWeights({ directness: 3, hotelStars: 0.2 });
    const spreads = FEATURE_NAMES.map((feature) =>
      feature === "directness" ? 0 : 1,
    );

    expect(summarizePreferences(weights, 5, spreads)).toEqual([]);
  });
});

function travelCard(id: string, durationMinutes: number): RankableCard {
  return {
    id,
    destination: id === "slow" ? "Сочи" : "Казань",
    locationType: id === "slow" ? "sea" : "city",
    price: { total: { amount: 50_000 } },
    transport: {
      id: `transport-${id}`,
      transport: "railway",
      durationMinutes,
      legs: [{ segments: [{}] }],
    },
    hotel: { stars: 4, rating: 8 },
  };
}
