import type { SessionReaction } from "../session";

export const RANKING_STATE_VERSION = 1 as const;

export interface RankableCard {
  id?: string;
  destination: string;
  locationType?: string;
  price: {
    total: { amount: number };
  };
  transport: {
    id?: string;
    transport: string;
    durationMinutes: number;
    legs: readonly { segments: readonly unknown[] }[];
  };
  hotel: {
    stars?: number;
    rating?: number;
  };
}

export interface RankingContext {
  budget: number;
}

export interface RankingReactionResult {
  duplicate: boolean;
  refillRequested: boolean;
  excludedCities: readonly string[];
}

export interface CommonRankingState {
  version: typeof RANKING_STATE_VERSION;
  kind: "bayesian" | "rules";
  reactionCount: number;
  featureSums: number[];
  processedReactionIds: string[];
  excludedCities: string[];
  wrongCityStreak: number;
  refillRequested: boolean;
}

export interface Ranker<TState extends CommonRankingState = CommonRankingState> {
  readonly kind: TState["kind"];
  rank<TCard extends RankableCard>(
    cards: readonly TCard[],
    context: RankingContext,
  ): TCard[];
  react(
    reaction: SessionReaction,
    card: RankableCard,
    context: RankingContext,
  ): RankingReactionResult;
  getWeights(): readonly number[];
  getState(): TState;
  serialize(): string;
  shouldRefill(): boolean;
}

export function rankableCardId(card: RankableCard): string {
  return card.id ?? card.transport.id ?? "";
}

export function normalizeCity(city: string): string {
  return city.trim().toLocaleLowerCase("ru-RU");
}

export function cloneCommonState<TState extends CommonRankingState>(
  state: TState,
): TState {
  return {
    ...state,
    featureSums: [...state.featureSums],
    processedReactionIds: [...state.processedReactionIds],
    excludedCities: [...state.excludedCities],
  };
}
