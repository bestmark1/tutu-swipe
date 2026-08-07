import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";

describe("health endpoint", () => {
  it("reports the checked-in snapshot without touching MCP or another network service", async () => {
    const checkedInSnapshot = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "data/snapshot/catalog.json"),
        "utf8",
      ),
    ) as {
      schemaVersion: number;
      run: { completedAt: string };
      entries: unknown[];
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      snapshotVersion: `${checkedInSnapshot.schemaVersion}:${checkedInSnapshot.run.completedAt}`,
      snapshot: {
        schemaVersion: checkedInSnapshot.schemaVersion,
        generatedAt: checkedInSnapshot.run.completedAt,
        entries: checkedInSnapshot.entries.length,
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
