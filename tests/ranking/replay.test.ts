import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

// Базовая линия считается на ЗАКРЕПЛЁННОМ снапшоте, а не на продуктовом.
// Продуктовый пересобирается перед сдачей, и его карточки меняются; записанные
// профили реакций ссылаются на конкретные идентификаторы, а метрики сравнимы
// между прогонами только на неизменном пуле.
import snapshotDocument from "../fixtures/snapshot/baseline-catalog.json";
import comfortSessionDocument from "../fixtures/sessions/comfort.json";
import economySessionDocument from "../fixtures/sessions/economy.json";
import fastSessionDocument from "../fixtures/sessions/fast.json";
import {
  REPLAY_MODES,
  averageLikedPosition,
  parseReplaySession,
  parseReplaySnapshot,
  runReplaySession,
  splitReplayReactions,
  type ReplaySession,
} from "@/lib/ranking/replay";
import type { RankableCard } from "@/lib/ranking";
import type { SessionReaction } from "@/lib/session";

const SEEDS = { bayesian: 42, random: 20260806 } as const;
const snapshot = parseReplaySnapshot(snapshotDocument);
const sessions = [
  parseReplaySession(economySessionDocument),
  parseReplaySession(fastSessionDocument),
  parseReplaySession(comfortSessionDocument),
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F16: ranking replay protocol", () => {
  it("AC25: repeats a recorded session identically", () => {
    const first = runReplaySession(snapshot, sessions[0]!, SEEDS);
    const second = runReplaySession(snapshot, sessions[0]!, SEEDS);

    expect(second).toEqual(first);
  });

  it("splits each session chronologically into the first 70% for training and the rest for held-out evaluation", () => {
    const session = sessionById("economy");
    const split = splitReplayReactions(session.reactions);

    expect(split.training).toEqual(session.reactions.slice(0, 14));
    expect(split.heldOut).toEqual(session.reactions.slice(14));
    expect(split.training).toHaveLength(14);
    expect(split.heldOut).toHaveLength(6);
  });

  it("does not use held-out reactions to train learned modes", () => {
    const session = sessionById("fast");
    const changedHeldOut = structuredClone(session);
    const heldOutCardIds = changedHeldOut.reactions
      .slice(14)
      .map(({ cardId }) => cardId)
      .reverse();
    changedHeldOut.reactions = changedHeldOut.reactions.map(
      (reaction, index) =>
        index < 14
          ? reaction
          : { ...reaction, cardId: heldOutCardIds[index - 14]! },
    );

    const original = runReplaySession(snapshot, session, SEEDS);
    const changed = runReplaySession(snapshot, changedHeldOut, SEEDS);

    for (const mode of ["bayesian", "rules"] as const) {
      expect(evaluation(original, mode, "heldOut").rankedCardIds).toEqual(
        evaluation(changed, mode, "heldOut").rankedCardIds,
      );
    }
  });

  it("calculates held-out metrics only from likes after the split", () => {
    const session = sessionById("comfort");
    const split = splitReplayReactions(session.reactions);
    const result = runReplaySession(snapshot, session, SEEDS);

    expect(result.trainingReactionCount).toBe(14);
    expect(result.heldOutReactionCount).toBe(6);
    expect(result.heldOutLikedCardCount).toBe(3);

    for (const mode of REPLAY_MODES) {
      const heldOut = evaluation(result, mode, "heldOut");
      const cardsById = new Map(snapshot.cards.map((card) => [card.id, card]));
      const ranking = heldOut.rankedCardIds.map((cardId) =>
        cardsById.get(cardId),
      );

      expect(ranking.every((card) => card !== undefined)).toBe(true);
      expect(heldOut.averageLikedPosition).toBe(
        averageLikedPosition(
          ranking as (typeof snapshot.cards)[number][],
          split.heldOut,
        ).average,
      );
      expect(heldOut.likedPositions).toHaveLength(3);
    }
  });

  it("runs every mode on the same checked-in 227-card snapshot", () => {
    const result = runReplaySession(snapshot, sessions[1]!, SEEDS);

    expect(snapshot.cards).toHaveLength(227);
    expect(result.modes.map(({ mode }) => mode)).toEqual(REPLAY_MODES);
    expect(new Set(result.modes.map(({ snapshotId }) => snapshotId))).toEqual(
      new Set([snapshot.id]),
    );
    expect(result.modes.every(({ poolSize }) => poolSize === 227)).toBe(true);

    const expectedIds = new Set(snapshot.cards.map(({ id }) => id));
    for (const mode of result.modes) {
      for (const sample of ["inSample", "heldOut"] as const) {
        expect(
          mode[sample].rankedCardIds.every((cardId) =>
            expectedIds.has(cardId),
          ),
        ).toBe(true);
      }
    }
  });

  it("changes the snapshot identity when ranking input changes", () => {
    const changed = structuredClone(snapshotDocument);
    changed.entries[0]!.hotel.rating =
      (changed.entries[0]!.hotel.rating ?? 0) + 0.01;

    expect(parseReplaySnapshot(changed).id).not.toBe(snapshot.id);
  });

  it("works offline without MCP or fetch calls", () => {
    const fetch = vi.fn(() => {
      throw new Error("Network access is forbidden during replay");
    });
    vi.stubGlobal("fetch", fetch);

    expect(() => runReplaySession(snapshot, sessions[2]!, SEEDS)).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      readFileSync("src/lib/ranking/replay.ts", "utf8"),
    ).not.toMatch(/(?:from|import\()\s*["'][^"']*\/mcp(?:[\/"'])/);
  });

  it("calculates one-based mean liked position deterministically", () => {
    const ranking = [card("a"), card("b"), card("c"), card("d")];
    const reactions: SessionReaction[] = [like("r1", "a"), like("r2", "d")];

    expect(averageLikedPosition(ranking, reactions)).toEqual({
      average: 2.5,
      positions: [1, 4],
    });
    expect(averageLikedPosition(ranking, reactions)).toEqual(
      averageLikedPosition(ranking, reactions),
    );
  });

  it("keeps all three recorded profiles internally consistent", () => {
    const cardById = new Map(snapshot.cards.map((item) => [item.id, item]));
    const profiles = [
      {
        session: sessionById("economy"),
        reason: "too_expensive",
        signal: (item: (typeof snapshot.cards)[number]) =>
          -item.price.total.amount,
      },
      {
        session: sessionById("fast"),
        reason: "too_long",
        signal: (item: (typeof snapshot.cards)[number]) =>
          -item.transport.durationMinutes,
      },
      {
        session: sessionById("comfort"),
        reason: "wrong_hotel",
        signal: (item: (typeof snapshot.cards)[number]) =>
          (item.hotel.stars ?? 2.5) / 5 + (item.hotel.rating ?? 5) / 10,
      },
    ];

    for (const profile of profiles) {
      const likedSignals = profile.session.reactions
        .filter(({ type }) => type === "like")
        .map(({ cardId }) => profile.signal(cardById.get(cardId)!));
      const disliked = profile.session.reactions.filter(
        (reaction) => reaction.type === "dislike",
      );
      const dislikedSignals = disliked.map(({ cardId }) =>
        profile.signal(cardById.get(cardId)!),
      );

      expect(profile.session.reactions).toHaveLength(20);
      expect(likedSignals).toHaveLength(10);
      expect(disliked).toHaveLength(10);
      expect(disliked.every(({ reason }) => reason === profile.reason)).toBe(
        true,
      );
      expect(Math.min(...likedSignals)).toBeGreaterThan(
        Math.max(...dislikedSignals),
      );
    }
  });

  it("shows that coherent budget feedback improves learned modes over seeded random", () => {
    const result = runReplaySession(
      snapshot,
      sessionById("economy"),
      SEEDS,
    );
    const random = metric(result, "random", "inSample");

    expect(metric(result, "bayesian", "inSample")).toBeLessThan(random);
    expect(metric(result, "rules", "inSample")).toBeLessThan(random);
  });
});

function sessionById(id: string): ReplaySession {
  const session = sessions.find((candidate) => candidate.id === id);
  if (!session) throw new Error(`Missing replay session: ${id}`);
  return session;
}

function metric(
  result: ReturnType<typeof runReplaySession>,
  mode: (typeof REPLAY_MODES)[number],
  sample: "inSample" | "heldOut",
): number {
  return evaluation(result, mode, sample).averageLikedPosition;
}

function evaluation(
  result: ReturnType<typeof runReplaySession>,
  mode: (typeof REPLAY_MODES)[number],
  sample: "inSample" | "heldOut",
) {
  const found = result.modes.find((candidate) => candidate.mode === mode);
  if (!found) throw new Error(`Missing replay mode: ${mode}`);
  return found[sample];
}

function card(id: string): RankableCard {
  return {
    id,
    destination: id,
    price: { total: { amount: 1 } },
    transport: {
      transport: "railway",
      durationMinutes: 1,
      legs: [{ segments: [{}] }],
    },
    hotel: {},
  };
}

function like(id: string, cardId: string): SessionReaction {
  return {
    id,
    cardId,
    occurredAt: "2026-08-06T09:00:00.000Z",
    type: "like",
  };
}
