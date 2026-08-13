import { describe, expect, it, vi } from "vitest";

import {
  MAX_SESSION_REACTIONS,
  MAX_SESSION_STATE_BYTES,
  SESSION_ERROR_CODES,
  acceptSessionState,
  applySessionReaction,
  createSessionState,
  serializeSessionState,
  sessionStateByteLength,
  signSessionState,
  verifySessionState,
  type SessionReaction,
} from "@/lib/session";

const SECRET = "test-secret-with-at-least-thirty-two-characters";
const CREATED_AT = "2026-08-06T09:00:00.000Z";

function reaction(index: number): SessionReaction {
  const base = {
    id: `reaction-${index}`,
    cardId: `card-${index}`,
    occurredAt: new Date(Date.parse(CREATED_AT) + index * 1_000).toISOString(),
  };
  return index % 2 === 0
    ? { ...base, type: "like" }
    : { ...base, type: "dislike", reason: "too_expensive" };
}

function stateWithReactions(count: number) {
  return {
    ...createSessionState({ sessionId: "session-1", createdAt: CREATED_AT }),
    reactions: Array.from({ length: count }, (_, index) => reaction(index)),
  };
}

describe("signed session state", () => {
  it("CONSTITUTION 6: accepts state with a valid signature", () => {
    const signed = signSessionState(stateWithReactions(1), SECRET);

    expect(verifySessionState(signed, SECRET)).toEqual({
      ok: true,
      state: stateWithReactions(1),
    });
  });

  it("CONSTITUTION 6: rejects a journal changed after signing", () => {
    const signed = signSessionState(stateWithReactions(1), SECRET);
    const forged = {
      ...signed,
      state: {
        ...signed.state,
        reactions: [{ ...signed.state.reactions[0], cardId: "forged-card" }],
      },
    };

    expect(verifySessionState(forged, SECRET)).toMatchObject({
      ok: false,
      error: { code: SESSION_ERROR_CODES.INVALID_SIGNATURE },
    });
  });

  it("AC30 / CONSTITUTION 8: derives the shortlist threshold from the verified journal", () => {
    const signed = signSessionState(stateWithReactions(4), SECRET);
    const submitted = { ...signed, reactionCount: 10_000 };

    const result = acceptSessionState(
      submitted,
      (journal) => ({ replayed: journal.length }),
      SECRET,
    );

    expect(result).toMatchObject({
      ok: true,
      session: {
        reactionCount: 4,
        shortlistStatus: "locked",
        rankingState: { replayed: 4 },
      },
    });
  });

  it("CONSTITUTION 7: recomputes ranking state instead of trusting client weights", () => {
    const recomputeRanking = vi.fn((journal: readonly SessionReaction[]) => ({
      weight: journal.filter(({ type }) => type === "like").length,
    }));
    const signed = signSessionState(stateWithReactions(3), SECRET);
    const submitted = {
      ...signed,
      rankingState: { weight: 999_999, injected: true },
    };

    const result = acceptSessionState(submitted, recomputeRanking, SECRET);

    expect(recomputeRanking).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      session: { rankingState: { weight: 2 } },
    });
  });

  it("AC23: applies a repeated reaction identifier only once", () => {
    const initial = signSessionState(stateWithReactions(0), SECRET);
    const first = applySessionReaction(
      initial,
      reaction(1),
      (journal) => journal.length,
      SECRET,
    );
    if (!first.ok) throw new Error("Expected the first reaction to apply");

    const repeated = applySessionReaction(
      first.signedState,
      reaction(1),
      (journal) => journal.length,
      SECRET,
    );

    expect(repeated).toMatchObject({
      ok: true,
      duplicate: true,
      session: { reactionCount: 1, rankingState: 1 },
      signedState: { state: { reactions: [reaction(1)] } },
    });
  });

  it("AC23: normalizes duplicate identifiers already present in a submitted journal", () => {
    const oneReaction = signSessionState(stateWithReactions(1), SECRET);
    const submitted = {
      ...oneReaction,
      state: {
        ...oneReaction.state,
        reactions: [
          oneReaction.state.reactions[0],
          oneReaction.state.reactions[0],
        ],
      },
    };

    expect(
      acceptSessionState(submitted, (journal) => journal.length, SECRET),
    ).toMatchObject({
      ok: true,
      session: { reactionCount: 1, rankingState: 1 },
    });
  });

  it("AC30: exposes a mutable shortlist from reaction five and freezes it at ten", () => {
    const fifth = acceptSessionState(
      signSessionState(stateWithReactions(5), SECRET),
      (journal) => journal.length,
      SECRET,
    );
    const tenth = acceptSessionState(
      signSessionState(stateWithReactions(10), SECRET),
      (journal) => journal.length,
      SECRET,
    );

    expect(fifth).toMatchObject({
      ok: true,
      session: { reactionCount: 5, shortlistStatus: "mutable" },
    });
    expect(tenth).toMatchObject({
      ok: true,
      session: { reactionCount: 10, shortlistStatus: "frozen" },
    });
  });

  it("CONSTITUTION 9: rejects too many reactions with a code instead of truncating", () => {
    const signed = signSessionState(
      stateWithReactions(MAX_SESSION_REACTIONS),
      SECRET,
    );
    const overLimit = {
      ...signed,
      state: {
        ...signed.state,
        reactions: [
          ...signed.state.reactions,
          reaction(MAX_SESSION_REACTIONS),
        ],
      },
    };

    expect(verifySessionState(overLimit, SECRET)).toMatchObject({
      ok: false,
      error: { code: SESSION_ERROR_CODES.REACTION_LIMIT_EXCEEDED },
    });
    expect(overLimit.state.reactions).toHaveLength(MAX_SESSION_REACTIONS + 1);
  });

  it("CONSTITUTION 9: rejects oversized state", () => {
    const signed = signSessionState(stateWithReactions(0), SECRET);
    const oversized = {
      ...signed,
      state: {
        ...signed.state,
        ignoredClientField: "x".repeat(MAX_SESSION_STATE_BYTES),
      },
    };

    expect(verifySessionState(oversized, SECRET)).toMatchObject({
      ok: false,
      error: { code: SESSION_ERROR_CODES.STATE_TOO_LARGE },
    });
  });

  it("F27: one hundred portable learning signals fit the signed session limit", () => {
    const state = {
      ...createSessionState({ sessionId: "portable-profile", createdAt: CREATED_AT }),
      reactions: Array.from({ length: MAX_SESSION_REACTIONS }, (_, index) => ({
        ...reaction(index),
        learningSignal: {
          destination: `Город ${index}`,
          features: [0.1234, 0.5678, 1, -0.25, 1, 0.8, 0.91, 0.25, 0.25],
        },
      })),
    };

    expect(sessionStateByteLength(state)).toBeLessThanOrEqual(
      MAX_SESSION_STATE_BYTES,
    );
    expect(() => signSessionState(state, SECRET)).not.toThrow();
  });

  it("rejects an incompatible format version with a clear code", () => {
    const signed = signSessionState(stateWithReactions(0), SECRET);
    const incompatible = {
      ...signed,
      state: { ...signed.state, version: 2 },
    };

    expect(verifySessionState(incompatible, SECRET)).toMatchObject({
      ok: false,
      error: { code: SESSION_ERROR_CODES.UNSUPPORTED_VERSION },
    });
  });

  it("CONSTITUTION 6: rejects unsigned state", () => {
    expect(
      verifySessionState({ state: stateWithReactions(0) }, SECRET),
    ).toMatchObject({
      ok: false,
      error: { code: SESSION_ERROR_CODES.SIGNATURE_MISSING },
    });
  });

  it("serializes deterministically for storage and signing", () => {
    const first = stateWithReactions(2);
    const reordered = {
      reactions: first.reactions,
      metadata: first.metadata,
      version: first.version,
    };

    expect(serializeSessionState(first)).toBe(serializeSessionState(reordered));
  });
});
