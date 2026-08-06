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
import { createRandomState, sampleStandardNormal } from "./random";
import { prepareReaction, rankCards } from "./shared";

export interface BayesianRankingState extends CommonRankingState {
  kind: "bayesian";
  means: number[];
  variances: number[];
  rngState: number;
}

export interface BayesianRankerOptions {
  seed: number;
}

const PRIOR_VARIANCE = 0.35;
const OBSERVATION_NOISE_VARIANCE = 0.08;
const LIKE_TARGET = 1.5;
const REASON_TARGET = 4;

export function createBayesianRanker(
  options: BayesianRankerOptions,
): Ranker<BayesianRankingState> {
  const random = createRandomState(options.seed);
  return new BayesianRanker(createInitialState(random.state));
}

export function restoreBayesianRanker(
  serialized: string,
): Ranker<BayesianRankingState> {
  const state = JSON.parse(serialized) as BayesianRankingState;
  validateState(state);
  return new BayesianRanker(state);
}

class BayesianRanker implements Ranker<BayesianRankingState> {
  readonly kind = "bayesian" as const;

  constructor(private readonly state: BayesianRankingState) {}

  rank<TCard extends RankableCard>(
    cards: readonly TCard[],
    context: RankingContext,
  ): TCard[] {
    const weights =
      this.state.reactionCount === 0
        ? this.state.means
        : this.samplePosteriorWeights();
    return rankCards(this.state, cards, context, weights);
  }

  react(
    reaction: SessionReaction,
    card: RankableCard,
    context: RankingContext,
  ): RankingReactionResult {
    const prepared = prepareReaction(this.state, reaction, card, context);
    if (prepared.duplicate) return prepared.result;

    if (reaction.type === "like") {
      for (let index = 0; index < FEATURE_NAMES.length; index += 1) {
        this.observe(index, prepared.features[index] ?? 0, LIKE_TARGET);
      }
    } else {
      this.observeReason(reaction.reason, prepared.features);
    }
    return prepared.result;
  }

  getWeights(): readonly number[] {
    return [...this.state.means];
  }

  getState(): BayesianRankingState {
    return {
      ...cloneCommonState(this.state),
      means: [...this.state.means],
      variances: [...this.state.variances],
    };
  }

  serialize(): string {
    return JSON.stringify(this.getState());
  }

  shouldRefill(): boolean {
    return this.state.refillRequested;
  }

  private observeReason(
    reason: DislikeReason,
    features: readonly number[],
  ): void {
    if (reason === "too_expensive") {
      this.observe(indexOf("affordability"), 1, REASON_TARGET);
    } else if (reason === "too_long") {
      this.observe(indexOf("shortTravel"), 1, REASON_TARGET);
    } else if (reason === "wrong_hotel") {
      for (const feature of ["hotelStars", "hotelRating"] as const) {
        const index = indexOf(feature);
        this.observe(index, features[index] ?? 0, -LIKE_TARGET);
      }
    }
  }

  private observe(index: number, evidence: number, target: number): void {
    if (evidence === 0) return;
    // Feedback is represented as independent one-feature observations
    // y_i = x_i * w_i + noise. The diagonal design keeps the posterior
    // factorized, so these are exact conjugate Gaussian updates rather than
    // a point estimate with synthetic noise added at ranking time.
    const priorVariance = this.state.variances[index]!;
    const priorMean = this.state.means[index]!;
    const posteriorVariance =
      1 /
      (1 / priorVariance +
        (evidence * evidence) / OBSERVATION_NOISE_VARIANCE);
    const posteriorMean =
      posteriorVariance *
      (priorMean / priorVariance +
        (evidence * target) / OBSERVATION_NOISE_VARIANCE);
    this.state.variances[index] = posteriorVariance;
    this.state.means[index] = posteriorMean;
  }

  private samplePosteriorWeights(): number[] {
    const random = { state: this.state.rngState };
    const weights = this.state.means.map(
      (mean, index) =>
        mean +
        Math.sqrt(this.state.variances[index]!) * sampleStandardNormal(random),
    );
    this.state.rngState = random.state;
    return weights;
  }
}

function indexOf(feature: (typeof FEATURE_NAMES)[number]): number {
  return FEATURE_NAMES.indexOf(feature);
}

function createInitialState(seed: number): BayesianRankingState {
  return {
    version: RANKING_STATE_VERSION,
    kind: "bayesian",
    means: [...DEFAULT_WEIGHTS],
    variances: FEATURE_NAMES.map(() => PRIOR_VARIANCE),
    rngState: seed,
    reactionCount: 0,
    featureSums: FEATURE_NAMES.map(() => 0),
    processedReactionIds: [],
    excludedCities: [],
    wrongCityStreak: 0,
    refillRequested: false,
  };
}

function validateState(state: BayesianRankingState): void {
  if (
    state.version !== RANKING_STATE_VERSION ||
    state.kind !== "bayesian" ||
    state.means.length !== FEATURE_NAMES.length ||
    state.variances.length !== FEATURE_NAMES.length ||
    state.featureSums.length !== FEATURE_NAMES.length ||
    !Number.isSafeInteger(state.rngState)
  ) {
    throw new TypeError("Invalid Bayesian ranking state");
  }
}
