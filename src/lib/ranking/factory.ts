import {
  createBayesianRanker,
  restoreBayesianRanker,
  type BayesianRankingState,
} from "./bayesian";
import type { CommonRankingState, Ranker } from "./interface";
import {
  createRuleRanker,
  restoreRuleRanker,
  type RuleRankingState,
} from "./rules";

export type RankingConfig =
  | { strategy: "bayesian"; seed: number }
  | { strategy: "rules" };

export type RankingState = BayesianRankingState | RuleRankingState;

export function createRanker(config: RankingConfig): Ranker {
  return config.strategy === "bayesian"
    ? createBayesianRanker({ seed: config.seed })
    : createRuleRanker();
}

export function restoreRanker(serialized: string): Ranker {
  const header = JSON.parse(serialized) as Partial<CommonRankingState>;
  if (header.kind === "bayesian") return restoreBayesianRanker(serialized);
  if (header.kind === "rules") return restoreRuleRanker(serialized);
  throw new TypeError("Unknown ranking strategy in serialized state");
}
