import { describe, expect, it } from "vitest";

import {
  MIN_EXPLANATION_CONFIRMATIONS,
  aggregateReactionFeatures,
  explainRecommendation,
  type ExplainFeatureValues,
} from "@/lib/explain";
import type { SessionReaction } from "@/lib/session";

const DIRECT: ExplainFeatureValues = { directness: 1 };
const WITH_TRANSFER: ExplainFeatureValues = { directness: 0.5 };

describe("F17: recommendation explanations", () => {
  it("AC26: does not explain a feature after one reaction", () => {
    const input = explanationInput([like(1)], { "card-1": DIRECT }, DIRECT);

    expect(explainRecommendation(input)).toBeNull();
  });

  it("AC26: explains a feature after three consistent likes", () => {
    const journal = [like(1), like(2), like(3)];
    const input = explanationInput(
      journal,
      featuresFor(journal, DIRECT),
      DIRECT,
    );

    expect(MIN_EXPLANATION_CONFIRMATIONS).toBe(3);
    expect(aggregateReactionFeatures(journal, input.reactedCardFeatures))
      .toMatchObject({ directness: { likes: 3, dislikes: 0 } });
    expect(explainRecommendation(input)).toMatchObject({
      computed: true,
      feature: "directness",
      confirmations: 3,
    });
  });

  it("AC27 / CONSTITUTION 3: omits a confirmed feature absent from this card", () => {
    const journal = [like(1), like(2), like(3)];

    expect(
      explainRecommendation(
        explanationInput(
          journal,
          featuresFor(journal, DIRECT),
          WITH_TRANSFER,
        ),
      ),
    ).toBeNull();
  });

  it("AC29: omits a feature with contradictory likes and dislikes", () => {
    const journal = [like(1), like(2), like(3), dislike(4)];
    const input = explanationInput(
      journal,
      featuresFor(journal, DIRECT),
      DIRECT,
    );

    expect(aggregateReactionFeatures(journal, input.reactedCardFeatures))
      .toMatchObject({ directness: { likes: 3, dislikes: 1 } });
    expect(explainRecommendation(input)).toBeNull();
  });

  it("AC28: returns identical text for unchanged session state", () => {
    const journal = [like(1), like(2), like(3)];
    const input = explanationInput(
      journal,
      featuresFor(journal, DIRECT),
      DIRECT,
    );

    expect(explainRecommendation(input)?.text).toBe(
      explainRecommendation(input)?.text,
    );
  });

  it("AC28: does not depend on different ranking model states", () => {
    const journal = [like(1), like(2), like(3)];
    const reactedCardFeatures = featuresFor(journal, DIRECT);
    const firstSession = {
      journal,
      rankingState: { kind: "bayesian", weights: [0.9, -0.1] },
    };
    const secondSession = {
      journal,
      rankingState: { kind: "rules", weights: [-100, 500] },
    };

    const first = explainRecommendation(
      explanationInput(
        firstSession.journal,
        reactedCardFeatures,
        DIRECT,
      ),
    );
    const second = explainRecommendation(
      explanationInput(
        secondSession.journal,
        reactedCardFeatures,
        DIRECT,
      ),
    );

    expect(first?.text).toBe(second?.text);
  });

  it("names the concrete confirmed feature instead of using generic wording", () => {
    const journal = [like(1), like(2), like(3)];
    const explanation = explainRecommendation(
      explanationInput(
        journal,
        featuresFor(journal, DIRECT),
        DIRECT,
      ),
    );

    expect(explanation?.text).toMatch(/без пересадок/i);
    expect(explanation?.text).not.toMatch(/вам подходит|хороший вариант/i);
  });
});

function explanationInput(
  journal: readonly SessionReaction[],
  reactedCardFeatures: Readonly<Record<string, ExplainFeatureValues>>,
  cardFeatures: ExplainFeatureValues,
) {
  return { journal, reactedCardFeatures, cardFeatures };
}

function featuresFor(
  journal: readonly SessionReaction[],
  features: ExplainFeatureValues,
): Record<string, ExplainFeatureValues> {
  return Object.fromEntries(
    journal.map(({ cardId }) => [cardId, features]),
  );
}

function like(index: number): SessionReaction {
  return {
    id: `reaction-${index}`,
    cardId: `card-${index}`,
    occurredAt: `2026-08-07T09:00:0${index}.000Z`,
    type: "like",
  };
}

function dislike(index: number): SessionReaction {
  return {
    id: `reaction-${index}`,
    cardId: `card-${index}`,
    occurredAt: `2026-08-07T09:00:0${index}.000Z`,
    type: "dislike",
    reason: "too_long",
  };
}
