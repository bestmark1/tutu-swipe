import {
  applySessionReaction,
  createSessionState,
  signSessionState,
  verifySessionState,
  type SessionReaction,
  type SignedSessionState,
} from "../session";

export function createSignedSwipeSession({
  sessionId,
  createdAt,
}: {
  sessionId: string;
  createdAt?: string;
}): SignedSessionState {
  return signSessionState(createSessionState({ sessionId, createdAt }));
}

export function addSignedSwipeReaction(
  submission: unknown,
  reaction: SessionReaction,
): SignedSessionState {
  const applied = applySessionReaction(submission, reaction, () => null);
  if (!applied.ok) throw new Error(applied.error.code);
  return applied.signedState;
}

export function undoSignedSwipeReaction(
  submission: unknown,
): SignedSessionState {
  const verified = verifySessionState(submission);
  if (!verified.ok) throw new Error(verified.error.code);

  return signSessionState({
    ...verified.state,
    reactions: verified.state.reactions.slice(0, -1),
  });
}
