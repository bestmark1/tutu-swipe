import type { SessionReaction } from "../session";
import { diversify } from "./diversity";
import {
  dotProduct,
  extractFeatures,
  featureDistance,
  type FeatureVector,
} from "./features";
import {
  normalizeCity,
  type CommonRankingState,
  type RankableCard,
  type RankingContext,
  type RankingReactionResult,
} from "./interface";

export function prepareReaction(
  state: CommonRankingState,
  reaction: SessionReaction,
  card: RankableCard,
  context: RankingContext,
): { duplicate: true; result: RankingReactionResult } | {
  duplicate: false;
  features: FeatureVector;
  result: RankingReactionResult;
} {
  return prepareReactionFeatures(
    state,
    reaction,
    extractFeatures(card, context),
    card.destination,
  );
}

export function prepareReactionFeatures(
  state: CommonRankingState,
  reaction: SessionReaction,
  features: readonly number[],
  destination: string,
): { duplicate: true; result: RankingReactionResult } | {
  duplicate: false;
  features: FeatureVector;
  result: RankingReactionResult;
} {
  if (state.processedReactionIds.includes(reaction.id)) {
    return { duplicate: true, result: reactionResult(state, true) };
  }

  state.processedReactionIds.push(reaction.id);
  state.reactionCount += 1;
  for (let index = 0; index < features.length; index += 1) {
    state.featureSums[index] =
      (state.featureSums[index] ?? 0) + (features[index] ?? 0);
  }

  if (reaction.type === "dislike" && reaction.reason === "wrong_city") {
    const city = normalizeCity(destination);
    if (!state.excludedCities.includes(city)) state.excludedCities.push(city);
    state.wrongCityStreak += 1;
    if (state.wrongCityStreak >= 2) state.refillRequested = true;
  } else {
    state.wrongCityStreak = 0;
  }

  return {
    duplicate: false,
    features: [...features],
    result: reactionResult(state, false),
  };
}

export function rankCards<TCard extends RankableCard>(
  state: CommonRankingState,
  cards: readonly TCard[],
  context: RankingContext,
  weights: readonly number[],
): TCard[] {
  const excluded = new Set(state.excludedCities);
  const scored = cards
    .map((card, index) => ({
      card,
      index,
      features: extractFeatures(card, context),
    }))
    .filter(({ card }) => !excluded.has(normalizeCity(card.destination)))
    .map((entry) => ({
      ...entry,
      score: dotProduct(weights, entry.features),
    }))
    .sort((first, second) => second.score - first.score || first.index - second.index);

  reserveExplorationSlot(state, scored);
  return diversify(scored.map(({ card }) => card));
}

function reserveExplorationSlot<TCard extends RankableCard>(
  state: CommonRankingState,
  scored: Array<{
    card: TCard;
    features: FeatureVector;
    score: number;
    index: number;
  }>,
): void {
  if (state.reactionCount < 3 || scored.length < 4) return;

  const centroid = state.featureSums.map(
    (sum) => sum / state.reactionCount,
  );
  let explorationIndex = 0;
  let greatestDistance = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < scored.length; index += 1) {
    const distance = featureDistance(scored[index]!.features, centroid);
    if (distance > greatestDistance) {
      explorationIndex = index;
      greatestDistance = distance;
    }
  }

  const [exploration] = scored.splice(explorationIndex, 1);
  if (exploration) scored.splice(3, 0, exploration);
}

function reactionResult(
  state: CommonRankingState,
  duplicate: boolean,
): RankingReactionResult {
  return {
    duplicate,
    refillRequested: state.refillRequested,
    excludedCities: [...state.excludedCities],
  };
}
