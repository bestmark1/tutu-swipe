import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/search/route";

describe("POST /api/search", () => {
  it("returns 400 for an empty input without calling the scenario", async () => {
    const response = await POST(
      new Request("http://localhost/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "   " }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "empty_input",
      message: "Опишите поездку одной фразой.",
    });
  });
});
