"use server";

import type {
  SessionReaction,
  SignedSessionState,
} from "@/lib/session";
import {
  addSignedSwipeReaction,
  createSignedSwipeSession,
  undoSignedSwipeReaction,
} from "@/lib/usecases/react";

export async function createSwipeSession(): Promise<SignedSessionState> {
  return createSignedSwipeSession({ sessionId: crypto.randomUUID() });
}

export async function addSwipeReaction(
  session: SignedSessionState,
  reaction: SessionReaction,
): Promise<SignedSessionState> {
  return addSignedSwipeReaction(session, reaction);
}

export async function undoSwipeReaction(
  session: SignedSessionState,
): Promise<SignedSessionState> {
  return undoSignedSwipeReaction(session);
}
