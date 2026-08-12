import type { DestinationCandidate } from "../discovery/select";
import type { DiscoveryQuery } from "../discovery/schema";
import {
  createMcpClient,
  type HotelSearchDto,
  type McpCallOutcome,
  type McpCallRequest,
  type TransportSearchDto,
} from "../mcp";
import { buildTripCard } from "../packages/build";
import {
  DEFAULT_CANDIDATE_BUDGET_RATIO,
  DEFAULT_SEARCH_BUDGET_MS,
  SearchBudget,
} from "./budget";
import type {
  CandidateErrorReason,
  SearchCard,
} from "./stream";
import {
  loadSnapshot,
  type SnapshotSearchCard,
} from "./snapshot";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TARGET_POOL_SIZE = 5;

export interface RateLimitedOutcome {
  status: "rate_limited";
  retryAfterMs: number;
}

export type SearchCallOutcome = McpCallOutcome | RateLimitedOutcome;

export interface SearchClient {
  callTool(request: McpCallRequest): Promise<SearchCallOutcome>;
}

export interface FanOutSearchOptions {
  candidates: readonly Pick<DestinationCandidate, "name">[];
  query: DiscoveryQuery;
  client?: SearchClient;
  snapshotPath?: string;
  signal?: AbortSignal;
  totalBudgetMs?: number;
  candidateBudgetRatio?: number;
  concurrency?: number;
  targetPoolSize?: number;
}

export type LiveSearchCard = SearchCard & {
  source: "live";
  isNewDestination?: true;
};

export type FanOutSearchCard = SnapshotSearchCard | LiveSearchCard;

export type FanOutSearchEvent =
  | {
      type: "card";
      eventId: string;
      destination: string;
      card: FanOutSearchCard;
      source: "snapshot" | "live";
      update: "append" | "replace";
      replacesEventId?: string;
      isNewDestination?: true;
    }
  | {
      type: "candidate_error";
      destination: string;
      reason: CandidateErrorReason;
    }
  | { type: "done"; pool: FanOutSearchCard[] }
  | {
      type: "aborted";
      reason: "request_aborted" | "budget_exhausted";
      pool: FanOutSearchCard[];
    }
  | { type: "unavailable"; pool: FanOutSearchCard[] };

type SourceState = "available" | "indeterminate" | "unavailable";

type CandidateResult =
  | { status: "card"; card: SearchCard; sourceState: "available" }
  | {
      status: "error";
      reason: CandidateErrorReason | "request_aborted";
      sourceState: SourceState;
    };

type StopReason =
  | "budget_exhausted"
  | "pool_complete"
  | "request_aborted";

interface ActiveResult {
  index: number;
  result: CandidateResult;
}

export async function* fanOutSearch(
  options: FanOutSearchOptions,
): AsyncGenerator<FanOutSearchEvent> {
  const concurrency = positiveInteger(
    options.concurrency ?? DEFAULT_CONCURRENCY,
    "concurrency",
  );
  const targetPoolSize = positiveInteger(
    options.targetPoolSize ?? DEFAULT_TARGET_POOL_SIZE,
    "targetPoolSize",
  );
  const snapshot = loadSnapshot({ filePath: options.snapshotPath });
  const poolByDestination = new Map<string, FanOutSearchCard>();
  const snapshotEventIds = new Map<string, string>();

  for (const [index, candidate] of options.candidates.entries()) {
    const card = snapshot.getCard(options.query.origin, candidate.name);
    if (!card) continue;

    const eventId = `snapshot-card-${index + 1}`;
    const destinationKey = normalizeDestination(candidate.name);
    snapshotEventIds.set(destinationKey, eventId);
    poolByDestination.set(destinationKey, card);
    yield {
      type: "card",
      eventId,
      destination: candidate.name,
      card,
      source: "snapshot",
      update: "append",
    };
  }

  // The live branch starts only after snapshot events have been consumed.
  const budget = new SearchBudget(
    options.totalBudgetMs ?? DEFAULT_SEARCH_BUDGET_MS,
    options.candidateBudgetRatio ?? DEFAULT_CANDIDATE_BUDGET_RATIO,
  );
  const client = options.client ?? createMcpClient();
  const requestController = new AbortController();
  const requestSignal = requestController.signal;
  const active = new Map<number, Promise<ActiveResult>>();
  let nextCandidateIndex = 0;
  let stopReason: StopReason | undefined;
  let completedCandidates = 0;
  let whollyUnavailableCandidates = 0;
  let liveCardCount = 0;

  const abortFromCaller = () => {
    if (stopReason === undefined) stopReason = "request_aborted";
    requestController.abort(options.signal?.reason);
  };
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) abortFromCaller();

  const requestTimeout = setTimeout(() => {
    if (stopReason === undefined) stopReason = "budget_exhausted";
    requestController.abort(new Error("search budget exhausted"));
  }, budget.remainingMs());

  const startAvailableCandidates = () => {
    while (
      stopReason === undefined &&
      active.size < concurrency &&
      nextCandidateIndex < options.candidates.length
    ) {
      const index = nextCandidateIndex;
      nextCandidateIndex += 1;
      const candidate = options.candidates[index];
      const pending = searchCandidate(
        client,
        options.query,
        candidate.name,
        budget,
        requestSignal,
      )
        .catch(
          (): CandidateResult => ({
            status: "error",
            reason: "invalid_response",
            sourceState: "indeterminate",
          }),
        )
        .then((result): ActiveResult => ({ index, result }));
      active.set(index, pending);
    }
  };

  try {
    startAvailableCandidates();

    while (active.size > 0) {
      const completed = await Promise.race(active.values());
      active.delete(completed.index);

      if (
        stopReason === "request_aborted" ||
        stopReason === "budget_exhausted"
      ) {
        await Promise.allSettled(active.values());
        active.clear();
        break;
      }

      completedCandidates += 1;
      if (completed.result.sourceState === "unavailable") {
        whollyUnavailableCandidates += 1;
      }

      const destination = options.candidates[completed.index].name;
      if (stopReason === "pool_complete") {
        yield {
          type: "candidate_error",
          destination,
          reason: "tail_cancelled",
        };
        continue;
      }

      if (completed.result.status === "card") {
        const destinationKey = normalizeDestination(destination);
        const replacesEventId = snapshotEventIds.get(destinationKey);
        const isNewDestination = replacesEventId === undefined;
        const card: LiveSearchCard = {
          ...completed.result.card,
          source: "live",
          ...(isNewDestination ? { isNewDestination: true } : {}),
        };
        poolByDestination.set(destinationKey, card);
        liveCardCount += 1;
        if (
          liveCardCount >= targetPoolSize &&
          (active.size > 0 || nextCandidateIndex < options.candidates.length)
        ) {
          stopReason = "pool_complete";
          requestController.abort(new Error("target pool complete"));
        }
        yield {
          type: "card",
          eventId: `card-${completed.index + 1}`,
          destination,
          card,
          source: "live",
          update: replacesEventId ? "replace" : "append",
          ...(replacesEventId ? { replacesEventId } : {}),
          ...(isNewDestination ? { isNewDestination: true } : {}),
        };
      } else {
        yield {
          type: "candidate_error",
          destination,
          reason:
            completed.result.reason === "request_aborted"
              ? "tail_cancelled"
              : completed.result.reason,
        };
      }

      startAvailableCandidates();
    }

    if (
      stopReason === "request_aborted" ||
      stopReason === "budget_exhausted"
    ) {
      yield {
        type: "aborted",
        reason: stopReason,
        pool: [...poolByDestination.values()],
      };
      return;
    }

    if (
      liveCardCount === 0 &&
      completedCandidates > 0 &&
      completedCandidates === whollyUnavailableCandidates
    ) {
      yield { type: "unavailable", pool: [...poolByDestination.values()] };
      return;
    }

    yield { type: "done", pool: [...poolByDestination.values()] };
  } finally {
    clearTimeout(requestTimeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
    if (!requestSignal.aborted) {
      requestController.abort(new Error("search stream closed"));
    }
  }
}

async function searchCandidate(
  client: SearchClient,
  query: DiscoveryQuery,
  destination: string,
  requestBudget: SearchBudget,
  signal: AbortSignal,
): Promise<CandidateResult> {
  const candidateStartedAt = performance.now();
  const candidateBudgetMs = requestBudget.candidateMs(candidateStartedAt);
  if (candidateBudgetMs <= 0 || signal.aborted) {
    return {
      status: "error",
      reason: "request_aborted",
      sourceState: "indeterminate",
    };
  }
  const candidateDeadline = Math.min(
    requestBudget.deadline,
    candidateStartedAt + candidateBudgetMs,
  );
  const checkOut = addDays(query.dateWindow.startDate, query.dateWindow.nights);

  // KTD8: both independent calls start before either result is awaited.
  const transportPending = callWithRetryAfter(
    client,
    {
      name: "search_multitransport",
      arguments: {
        origin: query.origin,
        destination,
        departure_date: query.dateWindow.startDate,
        adults: query.travellers.adults,
        optimize_for: "price",
        page_size: 1,
        view: "compact",
      },
      signal,
    },
    candidateDeadline,
  );
  const hotelPending = callWithRetryAfter(
    client,
    {
      name: "search_hotels",
      arguments: {
        city_name: destination,
        check_in: query.dateWindow.startDate,
        check_out: checkOut,
        adults: query.travellers.adults,
        children_ages: query.travellers.childrenAges,
        page_size: 1,
        view: "compact",
      },
      signal,
    },
    candidateDeadline,
  );
  const [transportOutcome, hotelOutcome] = await Promise.all([
    transportPending,
    hotelPending,
  ]);

  const sourceState = combinedSourceState(transportOutcome, hotelOutcome);
  if (signal.aborted || isAborted(transportOutcome) || isAborted(hotelOutcome)) {
    return { status: "error", reason: "request_aborted", sourceState };
  }
  if (isTimedOut(transportOutcome) || isTimedOut(hotelOutcome)) {
    return { status: "error", reason: "timed_out", sourceState };
  }
  if (isRateLimited(transportOutcome) || isRateLimited(hotelOutcome)) {
    return { status: "error", reason: "rate_limited", sourceState };
  }
  if (
    transportOutcome.status === "source_unavailable" ||
    hotelOutcome.status === "source_unavailable"
  ) {
    return { status: "error", reason: "source_unavailable", sourceState };
  }
  if (
    transportOutcome.status === "unresolved" ||
    hotelOutcome.status === "unresolved"
  ) {
    return { status: "error", reason: "unresolved", sourceState };
  }

  const transportSearch = asTransportSearch(transportOutcome);
  const hotelSearch = asHotelSearch(hotelOutcome);
  if (!transportSearch || !hotelSearch) {
    return { status: "error", reason: "invalid_response", sourceState };
  }

  const built = buildTripCard(transportSearch, hotelSearch, {
    adults: query.travellers.adults,
  });
  if (built.status !== "built") {
    return { status: "error", reason: "not_built", sourceState };
  }

  return {
    status: "card",
    sourceState: "available",
    card: { ...built.card, destination },
  };
}

async function callWithRetryAfter(
  client: SearchClient,
  request: Omit<McpCallRequest, "budgetMs">,
  deadline: number,
): Promise<SearchCallOutcome> {
  const first = await callOnce(client, request, deadline);
  if (!isRateLimited(first)) return first;

  const remainingMs = deadline - performance.now();
  if (first.retryAfterMs >= remainingMs) return first;

  const waited = await wait(first.retryAfterMs, request.signal);
  if (!waited) return abortedOutcome();
  return callOnce(client, request, deadline);
}

async function callOnce(
  client: SearchClient,
  request: Omit<McpCallRequest, "budgetMs">,
  deadline: number,
): Promise<SearchCallOutcome> {
  const budgetMs = deadline - performance.now();
  if (budgetMs <= 0) return timeoutOutcome();

  try {
    return await raceCall(
      client.callTool({ ...request, budgetMs }),
      budgetMs,
      request.signal,
    );
  } catch {
    return {
      status: "source_unavailable",
      failure: { kind: "network" },
      attempts: 1,
    };
  }
}

function raceCall(
  call: Promise<SearchCallOutcome>,
  budgetMs: number,
  signal: AbortSignal | undefined,
): Promise<SearchCallOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: SearchCallOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => finish(abortedOutcome());
    const timeout = setTimeout(() => finish(timeoutOutcome()), budgetMs);

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    void call.then(finish, () =>
      finish({
        status: "source_unavailable",
        failure: { kind: "network" },
        attempts: 1,
      }),
    );
  });
}

function wait(delayMs: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function combinedSourceState(
  transport: SearchCallOutcome,
  hotel: SearchCallOutcome,
): SourceState {
  if (isInfrastructureUnavailable(transport) && isInfrastructureUnavailable(hotel)) {
    return "unavailable";
  }
  if (isValidSourceResponse(transport) || isValidSourceResponse(hotel)) {
    return "available";
  }
  return "indeterminate";
}

function isInfrastructureUnavailable(outcome: SearchCallOutcome): boolean {
  return (
    outcome.status === "source_unavailable" &&
    outcome.failure.kind !== "aborted" &&
    outcome.failure.kind !== "timeout"
  );
}

function isValidSourceResponse(outcome: SearchCallOutcome): boolean {
  return outcome.status === "success" || outcome.status === "unresolved";
}

function isRateLimited(
  outcome: SearchCallOutcome,
): outcome is RateLimitedOutcome {
  return outcome.status === "rate_limited";
}

function isAborted(outcome: SearchCallOutcome): boolean {
  return (
    outcome.status === "source_unavailable" &&
    outcome.failure.kind === "aborted"
  );
}

function isTimedOut(outcome: SearchCallOutcome): boolean {
  return (
    outcome.status === "source_unavailable" &&
    outcome.failure.kind === "timeout"
  );
}

function asTransportSearch(
  outcome: SearchCallOutcome,
): TransportSearchDto | undefined {
  if (outcome.status !== "success") return undefined;
  return outcome.data.type === "transport" ? outcome.data : undefined;
}

function asHotelSearch(
  outcome: SearchCallOutcome,
): HotelSearchDto | undefined {
  if (outcome.status !== "success") return undefined;
  return outcome.data.type === "hotel" ? outcome.data : undefined;
}

function timeoutOutcome(): McpCallOutcome {
  return {
    status: "source_unavailable",
    failure: { kind: "timeout" },
    attempts: 1,
  };
}

function abortedOutcome(): McpCallOutcome {
  return {
    status: "source_unavailable",
    failure: { kind: "aborted" },
    attempts: 1,
  };
}

function addDays(startDate: string, days: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function normalizeDestination(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replaceAll("ё", "е");
}
