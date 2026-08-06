import {
  SessionStateError,
  normalizeSessionState,
} from "./state";

export function serializeSessionState(value: unknown): string {
  const normalized = normalizeSessionState(value);
  if (!normalized.ok) {
    throw new SessionStateError(
      normalized.error.code,
      normalized.error.message,
    );
  }
  return stableSerialize(normalized.state);
}

export function sessionStateByteLength(value: unknown): number {
  return new TextEncoder().encode(stableSerialize(value)).byteLength;
}

export function stableSerialize(value: unknown): string {
  return serializeValue(value, new Set());
}

function serializeValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Session state contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Session state contains unsupported ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new TypeError("Session state contains a circular reference");
  }

  ancestors.add(value);
  let serialized: string;
  if (Array.isArray(value)) {
    serialized = `[${value
      .map((item) => serializeValue(item, ancestors))
      .join(",")}]`;
  } else {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${serializeValue(item, ancestors)}`,
      );
    serialized = `{${entries.join(",")}}`;
  }
  ancestors.delete(value);
  return serialized;
}
