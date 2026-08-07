"use server";

import {
  decodeShortlistFragment,
  rebuildShortlist,
} from "@/lib/link";

export interface SharedListTrip {
  destination: string;
  hotelName: string;
  totalAmount: number;
  currency: string;
  replaced: boolean;
}

export type OpenSharedListResult =
  | { status: "ready"; trips: SharedListTrip[] }
  | {
      status: "invalid_link";
      reason: "invalid" | "unsupported_version";
    }
  | { status: "unavailable" };

export async function openSharedList(
  fragment: string,
): Promise<OpenSharedListResult> {
  let decoded;
  try {
    decoded = decodeShortlistFragment(fragment);
  } catch {
    return { status: "unavailable" };
  }
  if (!decoded.ok) {
    return { status: "invalid_link", reason: decoded.reason };
  }

  try {
    const rebuilt = await rebuildShortlist(decoded.payload);
    if (rebuilt.length === 0) return { status: "unavailable" };
    return {
      status: "ready",
      trips: rebuilt.map(({ card, replaced }) => ({
        destination: card.destination,
        hotelName: card.hotel.name,
        totalAmount: card.price.total.amount,
        currency: card.price.total.currency,
        replaced,
      })),
    };
  } catch {
    return { status: "unavailable" };
  }
}
