import { readFileSync } from "node:fs";
import path from "node:path";

const SNAPSHOT_PATH = path.join(
  process.cwd(),
  "data/snapshot/catalog.json",
);

interface SnapshotHealth {
  version: string;
  schemaVersion: number;
  generatedAt: string;
  buildStatus: string;
  entries: number;
}

const snapshot = readSnapshotHealth();

export function GET(): Response {
  const healthy = snapshot !== undefined;

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      snapshotVersion: snapshot?.version ?? null,
      snapshot: snapshot ?? null,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

function readSnapshotHealth(): SnapshotHealth | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    if (!isRecord(value) || !Number.isInteger(value.schemaVersion)) {
      return undefined;
    }
    if (
      !isRecord(value.run) ||
      !Array.isArray(value.entries) ||
      value.entries.length === 0
    ) {
      return undefined;
    }

    const generatedAt = value.run.completedAt;
    const buildStatus = value.run.status;
    if (typeof generatedAt !== "string" || typeof buildStatus !== "string") {
      return undefined;
    }

    const schemaVersion = value.schemaVersion as number;
    return {
      version: `${schemaVersion}:${generatedAt}`,
      schemaVersion,
      generatedAt,
      buildStatus,
      entries: value.entries.length,
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
