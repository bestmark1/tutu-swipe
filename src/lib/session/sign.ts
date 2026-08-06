import { createHmac, timingSafeEqual } from "node:crypto";

import {
  MAX_SESSION_STATE_BYTES,
  SESSION_ERROR_CODES,
  SessionStateError,
  appendSessionReaction,
  deriveSessionState,
  failure,
  normalizeSessionState,
  type DerivedSessionState,
  type SessionFailure,
  type SessionReaction,
  type SessionResult,
  type SessionState,
} from "./state";
import {
  serializeSessionState,
  sessionStateByteLength,
} from "./serialize";

const SESSION_SECRET_ENV = "SESSION_STATE_SECRET";

export interface SignedSessionState {
  state: SessionState;
  signature: string;
}

export function signSessionState(
  value: unknown,
  secret = sessionSecret(),
): SignedSessionState {
  const sizeFailure = checkSize(value);
  if (sizeFailure) {
    throw new SessionStateError(
      sizeFailure.error.code,
      sizeFailure.error.message,
    );
  }
  const normalized = normalizeSessionState(value);
  if (!normalized.ok) {
    throw new SessionStateError(
      normalized.error.code,
      normalized.error.message,
    );
  }

  return {
    state: normalized.state,
    signature: signatureFor(normalized.state, secret),
  };
}

export function verifySessionState(
  submission: unknown,
  secret = sessionSecret(),
): SessionResult<{ state: SessionState }> {
  if (!isRecord(submission) || !("state" in submission)) {
    return failure(
      SESSION_ERROR_CODES.INVALID_STATE,
      "Signed session state must contain state",
    );
  }

  const sizeFailure = checkSize(submission.state);
  if (sizeFailure) return sizeFailure;

  const normalized = normalizeSessionState(submission.state);
  if (!normalized.ok) return normalized;

  if (
    typeof submission.signature !== "string" ||
    submission.signature.length === 0
  ) {
    return failure(
      SESSION_ERROR_CODES.SIGNATURE_MISSING,
      "Session state signature is required",
    );
  }

  const expected = signatureFor(normalized.state, secret);
  if (!safeEqual(submission.signature, expected)) {
    return failure(
      SESSION_ERROR_CODES.INVALID_SIGNATURE,
      "Session state signature is invalid",
    );
  }

  return { ok: true, state: normalized.state };
}

export function acceptSessionState<TRankingState>(
  submission: unknown,
  recomputeRanking: (
    journal: readonly SessionReaction[],
  ) => TRankingState,
  secret = sessionSecret(),
): SessionResult<{ session: DerivedSessionState<TRankingState> }> {
  const verified = verifySessionState(submission, secret);
  if (!verified.ok) return verified;
  return {
    ok: true,
    session: deriveSessionState(verified.state, recomputeRanking),
  };
}

export function applySessionReaction<TRankingState>(
  submission: unknown,
  reaction: unknown,
  recomputeRanking: (
    journal: readonly SessionReaction[],
  ) => TRankingState,
  secret = sessionSecret(),
): SessionResult<{
  duplicate: boolean;
  signedState: SignedSessionState;
  session: DerivedSessionState<TRankingState>;
}> {
  const verified = verifySessionState(submission, secret);
  if (!verified.ok) return verified;

  const appended = appendSessionReaction(verified.state, reaction);
  if (!appended.ok) return appended;

  try {
    return {
      ok: true,
      duplicate: appended.duplicate,
      signedState: signSessionState(appended.state, secret),
      session: deriveSessionState(appended.state, recomputeRanking),
    };
  } catch (error) {
    if (error instanceof SessionStateError) {
      return failure(error.code, error.message);
    }
    throw error;
  }
}

function signatureFor(state: SessionState, secret: string): string {
  return createHmac("sha256", requireSecret(secret))
    .update(serializeSessionState(state), "utf8")
    .digest("base64url");
}

function sessionSecret(): string {
  return requireSecret(process.env[SESSION_SECRET_ENV]);
}

function requireSecret(secret: string | undefined): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(`${SESSION_SECRET_ENV} must be set on the server`);
  }
  return secret;
}

function checkSize(value: unknown): SessionFailure | null {
  try {
    if (sessionStateByteLength(value) <= MAX_SESSION_STATE_BYTES) return null;
    return failure(
      SESSION_ERROR_CODES.STATE_TOO_LARGE,
      `Session state exceeds ${MAX_SESSION_STATE_BYTES} bytes`,
    );
  } catch {
    return failure(
      SESSION_ERROR_CODES.INVALID_STATE,
      "Session state cannot be serialized",
    );
  }
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
