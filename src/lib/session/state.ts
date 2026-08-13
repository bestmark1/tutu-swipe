export const SESSION_STATE_VERSION = 1 as const;
export const MAX_SESSION_REACTIONS = 100;
export const MAX_SESSION_STATE_BYTES = 32 * 1024;

const SHORTLIST_AVAILABLE_REACTIONS = 5;
const SHORTLIST_FROZEN_REACTIONS = 10;
const MAX_REACTION_ID_LENGTH = 128;
const MAX_CARD_ID_LENGTH = 256;
const MAX_SESSION_ID_LENGTH = 128;
const LEARNING_FEATURE_COUNT = 9;
const MAX_DESTINATION_LENGTH = 128;

export const SESSION_ERROR_CODES = {
  INVALID_STATE: "SESSION_STATE_INVALID",
  INVALID_SIGNATURE: "SESSION_SIGNATURE_INVALID",
  REACTION_LIMIT_EXCEEDED: "SESSION_REACTION_LIMIT_EXCEEDED",
  SIGNATURE_MISSING: "SESSION_SIGNATURE_MISSING",
  STATE_TOO_LARGE: "SESSION_STATE_TOO_LARGE",
  UNSUPPORTED_VERSION: "SESSION_VERSION_UNSUPPORTED",
} as const;

export type SessionErrorCode =
  (typeof SESSION_ERROR_CODES)[keyof typeof SESSION_ERROR_CODES];

export interface SessionFailure {
  ok: false;
  error: {
    code: SessionErrorCode;
    message: string;
  };
}

export type SessionResult<T> = ({ ok: true } & T) | SessionFailure;

export class SessionStateError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = "SessionStateError";
    this.code = code;
  }
}

export type DislikeReason =
  | "too_expensive"
  | "too_long"
  | "wrong_city"
  | "wrong_hotel";

export interface ReactionLearningSignal {
  /** Нормализованные признаки карточки в контексте исходного поиска. */
  features: number[];
  destination: string;
}

interface ReactionBase {
  id: string;
  cardId: string;
  occurredAt: string;
  learningSignal?: ReactionLearningSignal;
}

export type SessionReaction =
  | (ReactionBase & { type: "like" })
  | (ReactionBase & { type: "dislike"; reason: DislikeReason });

export interface SessionMetadata {
  sessionId: string;
  createdAt: string;
}

export interface SessionState {
  version: typeof SESSION_STATE_VERSION;
  metadata: SessionMetadata;
  reactions: SessionReaction[];
}

export type ShortlistStatus = "locked" | "mutable" | "frozen";

export interface DerivedSessionState<TRankingState> {
  state: SessionState;
  reactionCount: number;
  shortlistStatus: ShortlistStatus;
  rankingState: TRankingState;
}

export function createSessionState({
  sessionId,
  createdAt = new Date().toISOString(),
}: {
  sessionId: string;
  createdAt?: string;
}): SessionState {
  const normalized = normalizeSessionState({
    version: SESSION_STATE_VERSION,
    metadata: { sessionId, createdAt },
    reactions: [],
  });
  if (!normalized.ok) {
    throw new SessionStateError(
      normalized.error.code,
      normalized.error.message,
    );
  }
  return normalized.state;
}

export function normalizeSessionState(
  value: unknown,
): SessionResult<{ state: SessionState }> {
  if (!isRecord(value)) return invalid("Session state must be an object");
  if (value.version !== SESSION_STATE_VERSION) {
    return failure(
      SESSION_ERROR_CODES.UNSUPPORTED_VERSION,
      `Unsupported session state version: ${String(value.version)}`,
    );
  }
  if (!isRecord(value.metadata)) {
    return invalid("Session metadata must be an object");
  }
  if (!Array.isArray(value.reactions)) {
    return invalid("Session reactions must be an array");
  }
  if (value.reactions.length > MAX_SESSION_REACTIONS) {
    return failure(
      SESSION_ERROR_CODES.REACTION_LIMIT_EXCEEDED,
      `Session has more than ${MAX_SESSION_REACTIONS} reactions`,
    );
  }

  const sessionId = boundedString(
    value.metadata.sessionId,
    "metadata.sessionId",
    MAX_SESSION_ID_LENGTH,
  );
  if (!sessionId.ok) return sessionId;
  const createdAt = timestamp(value.metadata.createdAt, "metadata.createdAt");
  if (!createdAt.ok) return createdAt;

  const reactions: SessionReaction[] = [];
  const reactionIds = new Set<string>();
  for (let index = 0; index < value.reactions.length; index += 1) {
    const normalized = normalizeReaction(
      value.reactions[index],
      `reactions[${index}]`,
    );
    if (!normalized.ok) return normalized;
    if (reactionIds.has(normalized.reaction.id)) continue;
    reactionIds.add(normalized.reaction.id);
    reactions.push(normalized.reaction);
  }

  return {
    ok: true,
    state: {
      version: SESSION_STATE_VERSION,
      metadata: { sessionId: sessionId.value, createdAt: createdAt.value },
      reactions,
    },
  };
}

export function appendSessionReaction(
  state: SessionState,
  value: unknown,
): SessionResult<{ state: SessionState; duplicate: boolean }> {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    state.reactions.some(({ id }) => id === value.id)
  ) {
    return { ok: true, state, duplicate: true };
  }

  const normalized = normalizeReaction(value, "reaction");
  if (!normalized.ok) return normalized;
  if (state.reactions.length >= MAX_SESSION_REACTIONS) {
    return failure(
      SESSION_ERROR_CODES.REACTION_LIMIT_EXCEEDED,
      `Session cannot contain more than ${MAX_SESSION_REACTIONS} reactions`,
    );
  }

  return {
    ok: true,
    duplicate: false,
    state: { ...state, reactions: [...state.reactions, normalized.reaction] },
  };
}

export function deriveSessionState<TRankingState>(
  state: SessionState,
  recomputeRanking: (
    journal: readonly SessionReaction[],
  ) => TRankingState,
): DerivedSessionState<TRankingState> {
  const reactionCount = state.reactions.length;
  return {
    state,
    reactionCount,
    shortlistStatus:
      reactionCount < SHORTLIST_AVAILABLE_REACTIONS
        ? "locked"
        : reactionCount < SHORTLIST_FROZEN_REACTIONS
          ? "mutable"
          : "frozen",
    rankingState: recomputeRanking(state.reactions),
  };
}

export function failure(
  code: SessionErrorCode,
  message: string,
): SessionFailure {
  return { ok: false, error: { code, message } };
}

function normalizeReaction(
  value: unknown,
  label: string,
): SessionResult<{ reaction: SessionReaction }> {
  if (!isRecord(value)) return invalid(`${label} must be an object`);

  const id = boundedString(value.id, `${label}.id`, MAX_REACTION_ID_LENGTH);
  if (!id.ok) return id;
  const cardId = boundedString(
    value.cardId,
    `${label}.cardId`,
    MAX_CARD_ID_LENGTH,
  );
  if (!cardId.ok) return cardId;
  const occurredAt = timestamp(value.occurredAt, `${label}.occurredAt`);
  if (!occurredAt.ok) return occurredAt;
  const learningSignal =
    value.learningSignal === undefined
      ? undefined
      : normalizeLearningSignal(value.learningSignal, label);
  if (learningSignal && !learningSignal.ok) return learningSignal;

  const base = {
    id: id.value,
    cardId: cardId.value,
    occurredAt: occurredAt.value,
    ...(learningSignal ? { learningSignal: learningSignal.signal } : {}),
  };
  if (value.type === "like") {
    return { ok: true, reaction: { ...base, type: "like" } };
  }
  if (value.type !== "dislike") {
    return invalid(`${label}.type must be like or dislike`);
  }
  if (!isDislikeReason(value.reason)) {
    return invalid(`${label}.reason is not a supported dislike reason`);
  }
  return {
    ok: true,
    reaction: { ...base, type: "dislike", reason: value.reason },
  };
}

function normalizeLearningSignal(
  value: unknown,
  label: string,
): SessionResult<{ signal: ReactionLearningSignal }> {
  if (!isRecord(value)) {
    return invalid(`${label}.learningSignal must be an object`);
  }
  if (
    !Array.isArray(value.features) ||
    value.features.length !== LEARNING_FEATURE_COUNT ||
    !value.features.every(
      (feature) =>
        typeof feature === "number" &&
        Number.isFinite(feature) &&
        feature >= -1 &&
        feature <= 1,
    )
  ) {
    return invalid(
      `${label}.learningSignal.features must contain ${LEARNING_FEATURE_COUNT} normalized values`,
    );
  }
  const destination = boundedString(
    value.destination,
    `${label}.learningSignal.destination`,
    MAX_DESTINATION_LENGTH,
  );
  if (!destination.ok) return destination;
  return {
    ok: true,
    signal: { features: [...value.features], destination: destination.value },
  };
}

function boundedString(
  value: unknown,
  label: string,
  maxLength: number,
): SessionResult<{ value: string }> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    return invalid(`${label} must be 1-${maxLength} characters`);
  }
  return { ok: true, value };
}

function timestamp(
  value: unknown,
  label: string,
): SessionResult<{ value: string }> {
  if (
    typeof value !== "string" ||
    !value.includes("T") ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalid(`${label} must be an ISO-8601 timestamp`);
  }
  return { ok: true, value };
}

function isDislikeReason(value: unknown): value is DislikeReason {
  return (
    value === "too_expensive" ||
    value === "too_long" ||
    value === "wrong_city" ||
    value === "wrong_hotel"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): SessionFailure {
  return failure(SESSION_ERROR_CODES.INVALID_STATE, message);
}
