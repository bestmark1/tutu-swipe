import { beforeEach, describe, expect, it } from "vitest";

import type { RankableCard } from "@/lib/ranking";
import {
  addSignedSwipeReaction,
  createSignedSwipeSession,
  rankSignedSwipeFeed,
} from "@/lib/usecases/react";

const NOW = "2026-08-13T09:00:00.000Z";

describe("F27: learned preferences across searches", () => {
  beforeEach(() => {
    process.env.SESSION_STATE_SECRET =
      "test-secret-with-at-least-thirty-two-characters";
  });

  it("replays signed feature signals when every card id in the new pool changed", () => {
    const rejectedHotel = rankingCard("old-hotel", "Сочи", 5, 10);
    let signed = createSignedSwipeSession({
      sessionId: "cross-search",
      createdAt: NOW,
    });

    for (let index = 0; index < 3; index += 1) {
      signed = addSignedSwipeReaction(
        signed,
        {
          id: `reaction-${index}`,
          cardId: rejectedHotel.id!,
          occurredAt: new Date(Date.parse(NOW) + index * 1_000).toISOString(),
          type: "dislike",
          reason: "wrong_hotel",
        },
        [rejectedHotel],
      ).session;
    }

    expect(
      signed.state.reactions.every((reaction) => reaction.learningSignal !== undefined),
    ).toBe(true);

    const newPool = [
      rankingCard("new-five-star", "Казань", 5, 10),
      rankingCard("new-one-star", "Самара", 1, 1),
    ];
    const ranked = rankSignedSwipeFeed(signed, newPool);

    expect(ranked.order[0]).toBe("new-one-star");
  });

  it("CONSTITUTION 7: does not sign a learning signal supplied by the client", () => {
    const signed = createSignedSwipeSession({
      sessionId: "forged-signal",
      createdAt: NOW,
    });
    const outcome = addSignedSwipeReaction(
      signed,
      {
        id: "forged-reaction",
        cardId: "missing-card",
        occurredAt: NOW,
        type: "like",
        learningSignal: {
          destination: "Сочи",
          features: Array.from({ length: 9 }, () => 1),
        },
      },
      [],
    );

    expect(outcome.session.state.reactions[0]?.learningSignal).toBeUndefined();
  });
});

function rankingCard(
  id: string,
  destination: string,
  stars: number,
  rating: number,
): RankableCard {
  return {
    id,
    destination,
    price: { total: { amount: 50_000 } },
    transport: {
      id: `transport-${id}`,
      transport: "railway",
      durationMinutes: 600,
      legs: [{ segments: [{}] }],
    },
    hotel: { stars, rating },
  };
}
