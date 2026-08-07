import {
  EXPLAIN_FEATURE_NAMES,
  MIN_EXPLANATION_CONFIRMATIONS,
  aggregateReactionFeatures,
  featureIsPresent,
  type ExplainFeatureName,
  type ExplainFeatureValues,
} from "./aggregate";
import type { SessionReaction } from "../session";

export interface ExplainRecommendationInput {
  journal: readonly SessionReaction[];
  reactedCardFeatures: Readonly<Record<string, ExplainFeatureValues>>;
  cardFeatures: ExplainFeatureValues;
}

export interface RecommendationExplanation {
  computed: true;
  feature: ExplainFeatureName;
  confirmations: number;
  text: string;
}

export function explainRecommendation({
  journal,
  reactedCardFeatures,
  cardFeatures,
}: ExplainRecommendationInput): RecommendationExplanation | null {
  const aggregates = aggregateReactionFeatures(
    journal,
    reactedCardFeatures,
  );

  for (const feature of EXPLAIN_FEATURE_NAMES) {
    const aggregate = aggregates[feature];
    if (
      aggregate.likes >= MIN_EXPLANATION_CONFIRMATIONS &&
      aggregate.dislikes === 0 &&
      featureIsPresent(feature, cardFeatures)
    ) {
      return {
        computed: true,
        feature,
        confirmations: aggregate.likes,
        text: explanationText(feature),
      };
    }
  }

  return null;
}

function explanationText(feature: ExplainFeatureName): string {
  switch (feature) {
    case "affordability":
      return "Цена укладывается в ваш бюджет — такие варианты вы лайкали раньше.";
    case "shortTravel":
      return "Дорога занимает не больше половины суток — такие поездки вы лайкали раньше.";
    case "directness":
      return "Маршрут без пересадок — такие поездки вы лайкали раньше.";
    case "airTransport":
      return "Перелёт на самолёте — такие поездки вы лайкали раньше.";
    case "railTransport":
      return "Поездка на поезде — такие варианты вы лайкали раньше.";
    case "hotelStars":
      return "Отель категории от четырёх звёзд — такие варианты вы лайкали раньше.";
    case "hotelRating":
      return "Рейтинг отеля не ниже 8 из 10 — такие варианты вы лайкали раньше.";
    case "urbanLocation":
      return "Это городское направление — такие поездки вы лайкали раньше.";
    case "leisureLocation":
      return "Это курортное направление — такие поездки вы лайкали раньше.";
  }
}
