import {
  normalizeSessionState,
  type SessionReaction,
} from "../session";
import { createBayesianRanker } from "./bayesian";
import {
  rankableCardId,
  type RankableCard,
  type Ranker,
  type RankingContext,
} from "./interface";
import { createRuleRanker } from "./rules";

export const REPLAY_MODES = [
  "bayesian",
  "rules",
  "price",
  "random",
] as const;

export const REPLAY_TRAINING_RATIO = 0.7;

export type ReplayMode = (typeof REPLAY_MODES)[number];

export interface ReplayCard extends RankableCard {
  id: string;
  origin: string;
}

export interface ReplaySnapshot {
  id: string;
  completedAt: string;
  cards: ReplayCard[];
}

export interface ReplaySession {
  id: string;
  profile: string;
  description: string;
  context: RankingContext;
  reactions: SessionReaction[];
}

export interface ReplaySeeds {
  bayesian: number;
  random: number;
}

export interface LikedPositionMetric {
  average: number;
  positions: number[];
}

export interface ReplayEvaluationResult {
  averageLikedPosition: number;
  likedPositions: number[];
  rankedCardIds: string[];
}

export interface ReplayModeResult {
  mode: ReplayMode;
  snapshotId: string;
  poolSize: number;
  inSample: ReplayEvaluationResult;
  heldOut: ReplayEvaluationResult;
}

export interface ReplaySessionResult {
  sessionId: string;
  profile: string;
  description: string;
  reactionCount: number;
  likedCardCount: number;
  trainingReactionCount: number;
  heldOutReactionCount: number;
  trainingLikedCardCount: number;
  heldOutLikedCardCount: number;
  modes: ReplayModeResult[];
}

export interface ReplayReactionSplit {
  training: SessionReaction[];
  heldOut: SessionReaction[];
}

export function replayReactions(
  ranker: Ranker,
  reactions: readonly SessionReaction[],
  cards: readonly RankableCard[],
  context: RankingContext,
): Ranker {
  const cardsById = new Map(cards.map((card) => [rankableCardId(card), card]));
  for (const reaction of reactions) {
    const card = cardsById.get(reaction.cardId);
    if (card) ranker.react(reaction, card, context);
  }
  return ranker;
}

export function parseReplaySnapshot(value: unknown): ReplaySnapshot {
  const document = requiredRecord(value, "snapshot");
  if (document.schemaVersion !== 1) {
    throw new TypeError("Replay snapshot must use schemaVersion 1");
  }
  const run = requiredRecord(document.run, "snapshot.run");
  const completedAt = requiredString(
    run.completedAt,
    "snapshot.run.completedAt",
  );
  const entries = requiredArray(document.entries, "snapshot.entries");
  const cards = entries.map(parseSnapshotEntry);
  const ids = new Set(cards.map(({ id }) => id));
  if (ids.size !== cards.length) {
    throw new TypeError("Replay snapshot contains duplicate card identifiers");
  }

  return {
    id: `catalog-v1:${completedAt}:${cards.length}:${snapshotFingerprint(cards)}`,
    completedAt,
    cards,
  };
}

export function parseReplaySession(value: unknown): ReplaySession {
  const document = requiredRecord(value, "replay session");
  if (document.schemaVersion !== 1) {
    throw new TypeError("Replay session must use schemaVersion 1");
  }
  const id = requiredString(document.id, "replay session.id");
  const profile = requiredString(document.profile, "replay session.profile");
  const description = requiredString(
    document.description,
    "replay session.description",
  );
  const context = requiredRecord(document.context, "replay session.context");
  const budget = requiredNumber(context.budget, "replay session.context.budget");
  if (budget <= 0) {
    throw new TypeError("Replay session budget must be positive");
  }

  const normalized = normalizeSessionState({
    version: 1,
    metadata: {
      sessionId: id,
      createdAt: "2026-08-06T00:00:00.000Z",
    },
    reactions: document.reactions,
  });
  if (!normalized.ok) {
    throw new TypeError(`Invalid replay session: ${normalized.error.message}`);
  }

  return {
    id,
    profile,
    description,
    context: { budget },
    reactions: normalized.state.reactions,
  };
}

export function runReplaySession(
  snapshot: ReplaySnapshot,
  session: ReplaySession,
  seeds: ReplaySeeds,
): ReplaySessionResult {
  validateSeed(seeds.bayesian, "Bayesian replay seed");
  validateSeed(seeds.random, "random replay seed");
  assertReactionsBelongToSnapshot(snapshot, session);
  const split = splitReplayReactions(session.reactions);

  const inSampleRankings = createReplayRankings(
    snapshot,
    session,
    session.reactions,
    seeds,
  );
  const heldOutRankings = createReplayRankings(
    snapshot,
    session,
    split.training,
    seeds,
  );

  const modes = REPLAY_MODES.map((mode) => {
    return {
      mode,
      snapshotId: snapshot.id,
      poolSize: snapshot.cards.length,
      inSample: evaluateRanking(inSampleRankings[mode], session.reactions),
      heldOut: evaluateRanking(heldOutRankings[mode], split.heldOut),
    };
  });

  return {
    sessionId: session.id,
    profile: session.profile,
    description: session.description,
    reactionCount: session.reactions.length,
    likedCardCount: uniqueLikedCardCount(session.reactions),
    trainingReactionCount: split.training.length,
    heldOutReactionCount: split.heldOut.length,
    trainingLikedCardCount: uniqueLikedCardCount(split.training),
    heldOutLikedCardCount: uniqueLikedCardCount(split.heldOut),
    modes,
  };
}

export function splitReplayReactions(
  reactions: readonly SessionReaction[],
): ReplayReactionSplit {
  const trainingCount = Math.floor(
    reactions.length * REPLAY_TRAINING_RATIO,
  );
  if (trainingCount === 0 || trainingCount === reactions.length) {
    throw new TypeError(
      "Replay session must contain reactions in both training and held-out parts",
    );
  }
  return {
    training: reactions.slice(0, trainingCount),
    heldOut: reactions.slice(trainingCount),
  };
}

export function averageLikedPosition(
  ranking: readonly RankableCard[],
  reactions: readonly SessionReaction[],
): LikedPositionMetric {
  const positionsById = new Map(
    ranking.map((card, index) => [rankableCardId(card), index + 1]),
  );
  const likedIds = [
    ...new Set(
      reactions
        .filter(({ type }) => type === "like")
        .map(({ cardId }) => cardId),
    ),
  ];
  if (likedIds.length === 0) {
    throw new TypeError("Replay session must contain at least one liked card");
  }

  const positions = likedIds.map((cardId) => {
    const position = positionsById.get(cardId);
    if (position === undefined) {
      throw new TypeError(`Liked card is absent from ranking: ${cardId}`);
    }
    return position;
  });
  return {
    average:
      positions.reduce((total, position) => total + position, 0) /
      positions.length,
    positions,
  };
}

function parseSnapshotEntry(value: unknown, index: number): ReplayCard {
  const entry = requiredRecord(value, `snapshot.entries[${index}]`);
  const transport = requiredRecord(
    entry.transport,
    `snapshot.entries[${index}].transport`,
  );
  const transportPrice = requiredRecord(
    transport.price,
    `snapshot.entries[${index}].transport.price`,
  );
  const hotel = requiredRecord(
    entry.hotel,
    `snapshot.entries[${index}].hotel`,
  );
  const bestOffer = requiredRecord(
    hotel.best_offer,
    `snapshot.entries[${index}].hotel.best_offer`,
  );
  const hotelPrice = requiredRecord(
    bestOffer.price,
    `snapshot.entries[${index}].hotel.best_offer.price`,
  );
  const legs = requiredArray(
    transport.legs,
    `snapshot.entries[${index}].transport.legs`,
  ).map((leg, legIndex) => ({
    segments: requiredArray(
      requiredRecord(leg, `snapshot.entries[${index}].transport.legs[${legIndex}]`)
        .segments,
      `snapshot.entries[${index}].transport.legs[${legIndex}].segments`,
    ),
  }));

  return {
    id: requiredString(
      transport.offer_id,
      `snapshot.entries[${index}].transport.offer_id`,
    ),
    origin: requiredString(entry.origin, `snapshot.entries[${index}].origin`),
    destination: requiredString(
      entry.destination,
      `snapshot.entries[${index}].destination`,
    ),
    price: {
      total: {
        amount:
          requiredNumber(
            transportPrice.amount,
            `snapshot.entries[${index}].transport.price.amount`,
          ) +
          requiredNumber(
            hotelPrice.amount,
            `snapshot.entries[${index}].hotel.best_offer.price.amount`,
          ),
      },
    },
    transport: {
      id: requiredString(
        transport.offer_id,
        `snapshot.entries[${index}].transport.offer_id`,
      ),
      transport: requiredString(
        transport.transport,
        `snapshot.entries[${index}].transport.transport`,
      ),
      durationMinutes: requiredNumber(
        transport.duration_min,
        `snapshot.entries[${index}].transport.duration_min`,
      ),
      legs,
    },
    hotel: {
      stars: optionalNumber(
        hotel.stars,
        `snapshot.entries[${index}].hotel.stars`,
      ),
      rating: optionalNumber(
        hotel.rating,
        `snapshot.entries[${index}].hotel.rating`,
      ),
    },
  };
}

function rankByPrice(cards: readonly ReplayCard[]): ReplayCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort(
      (first, second) =>
        first.card.price.total.amount - second.card.price.total.amount ||
        first.index - second.index,
    )
    .map(({ card }) => card);
}

function createReplayRankings(
  snapshot: ReplaySnapshot,
  session: ReplaySession,
  trainingReactions: readonly SessionReaction[],
  seeds: ReplaySeeds,
): Record<ReplayMode, ReplayCard[]> {
  return {
    bayesian: replayReactions(
      createBayesianRanker({ seed: seeds.bayesian }),
      trainingReactions,
      snapshot.cards,
      session.context,
    ).rank(snapshot.cards, session.context) as ReplayCard[],
    rules: replayReactions(
      createRuleRanker(),
      trainingReactions,
      snapshot.cards,
      session.context,
    ).rank(snapshot.cards, session.context) as ReplayCard[],
    price: rankByPrice(snapshot.cards),
    random: seededShuffle(snapshot.cards, seeds.random),
  };
}

function evaluateRanking(
  ranking: readonly ReplayCard[],
  reactions: readonly SessionReaction[],
): ReplayEvaluationResult {
  const metric = averageLikedPosition(ranking, reactions);
  return {
    averageLikedPosition: metric.average,
    likedPositions: metric.positions,
    rankedCardIds: ranking.map(rankableCardId),
  };
}

function uniqueLikedCardCount(
  reactions: readonly SessionReaction[],
): number {
  return new Set(
    reactions
      .filter(({ type }) => type === "like")
      .map(({ cardId }) => cardId),
  ).size;
}

function seededShuffle(
  cards: readonly ReplayCard[],
  seed: number,
): ReplayCard[] {
  const shuffled = [...cards];
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex]!,
      shuffled[index]!,
    ];
  }
  return shuffled;
}

function assertReactionsBelongToSnapshot(
  snapshot: ReplaySnapshot,
  session: ReplaySession,
): void {
  const cardIds = new Set(snapshot.cards.map(({ id }) => id));
  const missing = session.reactions.find(({ cardId }) => !cardIds.has(cardId));
  if (missing) {
    throw new TypeError(
      `Replay reaction ${missing.id} refers to an absent card: ${missing.cardId}`,
    );
  }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredNumber(value, label);
}

function validateSeed(seed: number, label: string): void {
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError(`${label} must be a safe integer`);
  }
}

function snapshotFingerprint(cards: readonly ReplayCard[]): string {
  const serialized = JSON.stringify(cards);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
