import type { SessionReaction } from "../session";

export const MIN_EXPLANATION_CONFIRMATIONS = 3;

export const EXPLAIN_FEATURE_NAMES = [
  "affordability",
  "shortTravel",
  "directness",
  "airTransport",
  "railTransport",
  "hotelStars",
  "hotelRating",
  "urbanLocation",
  "leisureLocation",
] as const;

export type ExplainFeatureName = (typeof EXPLAIN_FEATURE_NAMES)[number];
export type ExplainFeatureValues = Partial<
  Readonly<Record<ExplainFeatureName, number>>
>;

export interface FeatureReactionAggregate {
  likes: number;
  dislikes: number;
}

export type FeatureReactionAggregates = Record<
  ExplainFeatureName,
  FeatureReactionAggregate
>;

export function aggregateReactionFeatures(
  journal: readonly SessionReaction[],
  reactedCardFeatures: Readonly<Record<string, ExplainFeatureValues>>,
): FeatureReactionAggregates {
  const aggregates = Object.fromEntries(
    EXPLAIN_FEATURE_NAMES.map((feature) => [
      feature,
      { likes: 0, dislikes: 0 },
    ]),
  ) as FeatureReactionAggregates;

  for (const reaction of journal) {
    const features = reactedCardFeatures[reaction.cardId];
    if (!features) continue;

    for (const feature of EXPLAIN_FEATURE_NAMES) {
      if (!featureIsPresent(feature, features)) continue;
      const aggregate = aggregates[feature];
      if (reaction.type === "like") aggregate.likes += 1;
      else aggregate.dislikes += 1;
    }
  }

  return aggregates;
}

export function featureIsPresent(
  feature: ExplainFeatureName,
  features: ExplainFeatureValues,
): boolean {
  const value = features[feature];
  if (value === undefined || !Number.isFinite(value)) return false;

  switch (feature) {
    case "affordability":
      return value > 0;
    case "shortTravel":
      return value >= 0.5;
    case "directness":
      return value >= 1;
    case "airTransport":
    case "railTransport":
      return value > 0;
    case "hotelStars":
    case "hotelRating":
      return value >= 0.8;
    case "urbanLocation":
    case "leisureLocation":
      return value >= 1;
  }
}
