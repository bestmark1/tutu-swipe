export const DEFAULT_SEARCH_BUDGET_MS = 12_000;
export const DEFAULT_CANDIDATE_BUDGET_RATIO = 0.9;

export class SearchBudget {
  readonly deadline: number;
  private readonly candidateWindowMs: number;

  constructor(
    readonly totalMs: number,
    candidateRatio: number,
    startedAt = performance.now(),
  ) {
    assertPositive(totalMs, "totalBudgetMs");
    if (
      !Number.isFinite(candidateRatio) ||
      candidateRatio <= 0 ||
      candidateRatio > 1
    ) {
      throw new TypeError("candidateBudgetRatio must be between 0 and 1");
    }

    this.deadline = startedAt + totalMs;
    this.candidateWindowMs = totalMs * candidateRatio;
  }

  remainingMs(now = performance.now()): number {
    return Math.max(0, this.deadline - now);
  }

  candidateMs(now = performance.now()): number {
    return Math.min(this.candidateWindowMs, this.remainingMs(now));
  }
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
}
