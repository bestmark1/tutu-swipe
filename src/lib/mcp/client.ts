import { McpPayloadError, normalizeToolResult } from "./normalize";
import { createSdkToolInvoker } from "./sdk";
import type {
  McpCallOutcome,
  McpClient as McpClientContract,
  McpFailureKind,
  McpToolInvoker,
} from "./types";

const DEFAULT_TOTAL_BUDGET_MS = 12_000;
// Keeps the measured 10.8s cold call inside the first-attempt share.
const DEFAULT_FIRST_ATTEMPT_BUDGET_RATIO = 0.92;
const DEFAULT_CIRCUIT_RESET_MS = 30_000;
const DEFAULT_FAILURE_THRESHOLD = 2;
const DEFAULT_MAX_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 100;
const RETRY_MAX_DELAY_MS = 1_000;
const RETRY_JITTER_RATIO = 0.1;
const MIN_RETRY_ATTEMPT_BUDGET_MS = 100;

class RequestAbortedError extends Error {}
class AttemptTimeoutError extends Error {}

export interface McpClientOptions {
  invoker?: McpToolInvoker;
  totalBudgetMs?: number;
  firstAttemptBudgetRatio?: number;
  maxRetries?: number;
  failureThreshold?: number;
  circuitResetMs?: number;
}

export function createMcpClient(options: McpClientOptions = {}): McpClientContract {
  return new DefaultMcpClient(options);
}

class DefaultMcpClient implements McpClientContract {
  private readonly invoker: McpToolInvoker;
  private readonly totalBudgetMs: number;
  private readonly firstAttemptBudgetRatio: number;
  private readonly maxRetries: number;
  private readonly failureThreshold: number;
  private readonly circuitResetMs: number;
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(options: McpClientOptions) {
    this.invoker = options.invoker ?? createSdkToolInvoker();
    this.totalBudgetMs = positiveNumber(
      options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS,
      "totalBudgetMs",
    );
    this.firstAttemptBudgetRatio = ratio(
      options.firstAttemptBudgetRatio ?? DEFAULT_FIRST_ATTEMPT_BUDGET_RATIO,
      "firstAttemptBudgetRatio",
    );
    this.maxRetries = nonNegativeInteger(
      options.maxRetries ?? DEFAULT_MAX_RETRIES,
      "maxRetries",
    );
    this.failureThreshold = positiveInteger(
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
      "failureThreshold",
    );
    this.circuitResetMs = positiveNumber(
      options.circuitResetMs ?? DEFAULT_CIRCUIT_RESET_MS,
      "circuitResetMs",
    );
  }

  async callTool(
    request: Parameters<McpClientContract["callTool"]>[0],
  ): Promise<McpCallOutcome> {
    if (this.isCircuitOpen()) {
      return unavailable("circuit_open", 0);
    }
    if (request.signal?.aborted) {
      return unavailable("aborted", 0);
    }

    const totalBudgetMs = positiveNumber(
      request.budgetMs ?? this.totalBudgetMs,
      "budgetMs",
    );
    const deadline = performance.now() + totalBudgetMs;
    let attempts = 0;

    for (let attemptIndex = 0; attemptIndex <= this.maxRetries; attemptIndex++) {
      if (request.signal?.aborted) {
        return unavailable("aborted", attempts);
      }

      const remainingMs = deadline - performance.now();
      const timeoutMs = Math.min(
        remainingMs,
        this.attemptBudgetMs(totalBudgetMs, attemptIndex),
      );
      if (timeoutMs <= 0) {
        return unavailable("timeout", attempts);
      }

      attempts += 1;
      try {
        const rawResult = await this.invokeAttempt(
          request.name,
          request.arguments,
          request.signal,
          timeoutMs,
        );
        const normalized = normalizeToolResult(rawResult);
        this.recordSuccess();
        return { ...normalized, attempts };
      } catch (error) {
        const failureKind = classifyFailure(error);
        if (failureKind === "aborted") {
          return unavailable(failureKind, attempts);
        }

        this.recordFailure();
        const remainingAfterFailureMs = deadline - performance.now();
        if (remainingAfterFailureMs <= 0) {
          return unavailable("timeout", attempts);
        }

        const retryDelayMs = this.retryDelayMs(attemptIndex);
        const nextAttemptBudgetMs = Math.min(
          remainingAfterFailureMs - retryDelayMs,
          this.attemptBudgetMs(totalBudgetMs, attemptIndex + 1),
        );
        const canRetry =
          attemptIndex < this.maxRetries &&
          failureKind !== "invalid_response" &&
          !this.isCircuitOpen() &&
          nextAttemptBudgetMs >= MIN_RETRY_ATTEMPT_BUDGET_MS &&
          !request.signal?.aborted;
        if (!canRetry) {
          return unavailable(failureKind, attempts);
        }

        try {
          await this.waitBeforeRetry(retryDelayMs, request.signal);
        } catch {
          return unavailable("aborted", attempts);
        }
      }
    }

    return unavailable(
      performance.now() >= deadline ? "timeout" : "network",
      attempts,
    );
  }

  private attemptBudgetMs(totalBudgetMs: number, attemptIndex: number): number {
    if (attemptIndex === 0 || this.maxRetries === 0) {
      return Math.ceil(
        totalBudgetMs *
          (this.maxRetries === 0 ? 1 : this.firstAttemptBudgetRatio),
      );
    }
    const retryBudget = totalBudgetMs * (1 - this.firstAttemptBudgetRatio);
    return Math.ceil(retryBudget / this.maxRetries);
  }

  private retryDelayMs(attemptIndex: number): number {
    const exponentialDelayMs = Math.min(
      RETRY_BASE_DELAY_MS * 2 ** attemptIndex,
      RETRY_MAX_DELAY_MS,
    );
    const jitter = (Math.random() * 2 - 1) * RETRY_JITTER_RATIO;
    return Math.round(exponentialDelayMs * (1 + jitter));
  }

  private waitBeforeRetry(
    delayMs: number,
    requestSignal: AbortSignal | undefined,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        reject(new RequestAbortedError());
      };
      const timeout = setTimeout(() => {
        requestSignal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);

      if (requestSignal?.aborted) {
        onAbort();
        return;
      }
      requestSignal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async invokeAttempt(
    name: string,
    args: Record<string, unknown> | undefined,
    requestSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const attemptController = new AbortController();
    let timedOut = false;
    const abortFromRequest = () => {
      attemptController.abort(requestSignal?.reason);
    };
    requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
    if (requestSignal?.aborted) abortFromRequest();

    const timeout = setTimeout(() => {
      timedOut = true;
      attemptController.abort(new AttemptTimeoutError());
    }, timeoutMs);
    const aborted = new Promise<never>((_, reject) => {
      if (attemptController.signal.aborted) {
        reject(attemptController.signal.reason);
      } else {
        attemptController.signal.addEventListener(
          "abort",
          () => reject(attemptController.signal.reason),
          { once: true },
        );
      }
    });

    try {
      const invocation = this.invoker({
        name,
        arguments: args,
        signal: attemptController.signal,
        timeoutMs,
      });
      return await Promise.race([invocation, aborted]);
    } catch (error) {
      if (requestSignal?.aborted) throw new RequestAbortedError();
      if (timedOut) throw new AttemptTimeoutError();
      throw error;
    } finally {
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", abortFromRequest);
    }
  }

  private isCircuitOpen(): boolean {
    if (this.openUntil === 0) return false;
    if (performance.now() < this.openUntil) return true;
    this.openUntil = 0;
    this.consecutiveFailures = 0;
    return false;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.openUntil = performance.now() + this.circuitResetMs;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }
}

function classifyFailure(error: unknown): McpFailureKind {
  if (error instanceof RequestAbortedError) return "aborted";
  if (error instanceof AttemptTimeoutError) return "timeout";
  if (error instanceof McpPayloadError) return "invalid_response";
  return "network";
}

function unavailable(
  kind: McpFailureKind,
  attempts: number,
): McpCallOutcome {
  return { status: "source_unavailable", failure: { kind }, attempts };
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
  return value;
}

function ratio(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new TypeError(`${name} must be between 0 and 1`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}
