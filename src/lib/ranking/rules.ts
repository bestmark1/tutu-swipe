import type { DislikeReason, SessionReaction } from "../session";
import { DEFAULT_WEIGHTS, FEATURE_NAMES } from "./features";
import {
  RANKING_STATE_VERSION,
  cloneCommonState,
  type CommonRankingState,
  type RankableCard,
  type Ranker,
  type RankingContext,
  type RankingReactionResult,
} from "./interface";
import { prepareReaction, prepareReactionFeatures, rankCards } from "./shared";

export interface RuleRankingState extends CommonRankingState {
  kind: "rules";
  weights: number[];
}

const LIKE_STEP = 0.35;
const REASON_STEP = 2.5;

export function createRuleRanker(): Ranker<RuleRankingState> {
  return new RuleRanker(createInitialState());
}

export function restoreRuleRanker(serialized: string): Ranker<RuleRankingState> {
  const state = JSON.parse(serialized) as RuleRankingState;
  validateState(state);
  return new RuleRanker(state);
}

class RuleRanker implements Ranker<RuleRankingState> {
  readonly kind = "rules" as const;

  constructor(private readonly state: RuleRankingState) {}

  rank<TCard extends RankableCard>(
    cards: readonly TCard[],
    context: RankingContext,
  ): TCard[] {
    return rankCards(this.state, cards, context, this.state.weights);
  }

  react(
    reaction: SessionReaction,
    card: RankableCard,
    context: RankingContext,
  ): RankingReactionResult {
    const prepared = prepareReaction(this.state, reaction, card, context);
    return this.applyPrepared(reaction, prepared);
  }

  reactFeatures(
    reaction: SessionReaction,
    features: readonly number[],
    destination: string,
  ): RankingReactionResult {
    const prepared = prepareReactionFeatures(
      this.state,
      reaction,
      features,
      destination,
    );
    return this.applyPrepared(reaction, prepared);
  }

  private applyPrepared(
    reaction: SessionReaction,
    prepared: ReturnType<typeof prepareReaction>,
  ): RankingReactionResult {
    if (prepared.duplicate) return prepared.result;

    if (reaction.type === "like") {
      for (let index = 0; index < this.state.weights.length; index += 1) {
        this.state.weights[index] += LIKE_STEP * (prepared.features[index] ?? 0);
      }
    } else {
      applyReason(this.state.weights, prepared.features, reaction.reason);
    }
    return prepared.result;
  }

  getWeights(): readonly number[] {
    return [...this.state.weights];
  }

  getState(): RuleRankingState {
    return { ...cloneCommonState(this.state), weights: [...this.state.weights] };
  }

  serialize(): string {
    return JSON.stringify(this.getState());
  }

  shouldRefill(): boolean {
    return this.state.refillRequested;
  }
}

function applyReason(
  weights: number[],
  features: readonly number[],
  reason: DislikeReason,
): void {
  if (reason === "too_expensive") {
    weights[indexOf("affordability")] += REASON_STEP;
  } else if (reason === "too_long") {
    weights[indexOf("shortTravel")] += REASON_STEP;
  } else if (reason === "wrong_hotel") {
    for (const feature of ["hotelStars", "hotelRating"] as const) {
      const index = indexOf(feature);
      weights[index] -= REASON_STEP * (features[index] ?? 0);
    }
  }
}

function indexOf(feature: (typeof FEATURE_NAMES)[number]): number {
  return FEATURE_NAMES.indexOf(feature);
}

function createInitialState(): RuleRankingState {
  return {
    version: RANKING_STATE_VERSION,
    kind: "rules",
    weights: [...DEFAULT_WEIGHTS],
    reactionCount: 0,
    featureSums: FEATURE_NAMES.map(() => 0),
    processedReactionIds: [],
    excludedCities: [],
    wrongCityStreak: 0,
    refillRequested: false,
  };
}

function validateState(state: RuleRankingState): void {
  if (
    state.version !== RANKING_STATE_VERSION ||
    state.kind !== "rules" ||
    state.weights.length !== FEATURE_NAMES.length ||
    state.featureSums.length !== FEATURE_NAMES.length
  ) {
    throw new TypeError("Invalid rule ranking state");
  }
}
