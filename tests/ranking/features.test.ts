import { describe, expect, it } from "vitest";

import {
  FEATURE_NAMES,
  createRanker,
  extractFeatures,
  type RankableCard,
} from "@/lib/ranking";

function card(): RankableCard {
  return {
    id: "card",
    destination: "Сочи",
    locationType: "resort",
    price: { total: { amount: 75_000 } },
    transport: {
      id: "transport-card",
      transport: "avia",
      durationMinutes: 180,
      legs: [{ segments: [{}, {}] }],
    },
    hotel: { stars: 4, rating: 8.5 },
  };
}

describe("first-pass ranking features", () => {
  it("KTD9: uses a compact nine-feature vector from eager search data", () => {
    const features = extractFeatures(card(), { budget: 100_000 });

    expect(FEATURE_NAMES).toHaveLength(9);
    expect(features).toHaveLength(FEATURE_NAMES.length);
    expect(features.every(Number.isFinite)).toBe(true);
  });

  it("KTD9: lazy review themes cannot affect primary ranking", () => {
    const withoutDetails = card();
    const withDetails = {
      ...card(),
      hotel: {
        ...card().hotel,
        reviewThemes: ["тихо", "хороший завтрак"],
      },
    };

    expect(extractFeatures(withDetails, { budget: 100_000 })).toEqual(
      extractFeatures(withoutDetails, { budget: 100_000 }),
    );
  });

  it.each([
    ["city", 1, 0],
    ["sea", 0, 1],
    ["treatment nature", 0, 1],
  ])(
    "maps the catalog location type %s to urban and leisure features",
    (locationType, expectedUrban, expectedLeisure) => {
      const features = extractFeatures(
        { ...card(), locationType },
        { budget: 100_000 },
      );

      expect(features[FEATURE_NAMES.indexOf("urbanLocation")]).toBe(
        expectedUrban,
      );
      expect(features[FEATURE_NAMES.indexOf("leisureLocation")]).toBe(
        expectedLeisure,
      );
    },
  );

  it("selects either implementation through one configuration entry point", () => {
    expect(createRanker({ strategy: "bayesian", seed: 1 }).kind).toBe(
      "bayesian",
    );
    expect(createRanker({ strategy: "rules" }).kind).toBe("rules");
  });
});
