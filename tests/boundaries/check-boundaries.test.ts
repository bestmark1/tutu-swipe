import { describe, expect, it } from "vitest";

import {
  RULES,
  createBoundaryChecker,
  formatViolation,
} from "../../scripts/boundary-rules.mjs";

const checker = createBoundaryChecker();

function rule(name: string) {
  const found = RULES.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Boundary rule not found: ${name}`);
  return found;
}

const noMcpImports = rule("доменные слои не импортируют mcp");
const explainDoesNotImportRanking = rule(
  "explain не импортирует реализацию ranking",
);
const noServerState = rule("сервер не хранит пользовательские данные");

function check(
  boundaryRule: (typeof RULES)[number],
  file: string,
  source: string,
  files: Record<string, string> = {},
) {
  return checker.check(boundaryRule, file, source, files);
}

describe("CONSTITUTION 10: domain layers do not depend on MCP", () => {
  it("catches a direct MCP import from ranking", () => {
    expect(
      check(
        noMcpImports,
        "src/lib/ranking/index.ts",
        'import { callTool } from "@/lib/mcp";',
      ),
    ).not.toBeNull();
  });

  it.each(["explain", "packages"])(
    "catches an MCP import from %s",
    (layer) => {
      expect(
        check(
          noMcpImports,
          `src/lib/${layer}/index.ts`,
          'export { callTool } from "@/lib/mcp/client";',
        ),
      ).not.toBeNull();
    },
  );

  it("resolves a relative MCP import", () => {
    expect(
      check(
        noMcpImports,
        "src/lib/ranking/model.ts",
        'const client = require("../mcp/client");',
      ),
    ).not.toBeNull();
  });

  it("resolves the @/* alias from tsconfig", () => {
    expect(
      check(
        noMcpImports,
        "src/lib/packages/build.ts",
        'import type { TransportDto } from "@/lib/mcp/types";',
      ),
    ).not.toBeNull();
  });

  it("catches a dynamic MCP import", () => {
    expect(
      check(
        noMcpImports,
        "src/lib/explain/aggregate.ts",
        'const client = await import("@/lib/mcp/client");',
      ),
    ).not.toBeNull();
  });

  it("follows an intermediate re-export", () => {
    expect(
      check(
        noMcpImports,
        "src/lib/ranking/model.ts",
        'import { callTool } from "@/lib/shared/mcp-adapter";',
        {
          "src/lib/shared/mcp-adapter.ts":
            'export { callTool } from "@/lib/mcp/client";',
        },
      ),
    ).not.toBeNull();
  });

  it("allows MCP internals and search to import MCP", () => {
    expect(
      check(
        noMcpImports,
        "src/lib/mcp/client.ts",
        'import { normalize } from "./normalize";',
      ),
    ).toBeNull();
    expect(
      check(
        noMcpImports,
        "src/lib/search/fan-out.ts",
        'import { callTool } from "@/lib/mcp";',
      ),
    ).toBeNull();
  });
});

describe("CONSTITUTION 11: explain does not depend on ranking implementation", () => {
  it("catches an import of the ranking implementation", () => {
    expect(
      check(
        explainDoesNotImportRanking,
        "src/lib/explain/aggregate.ts",
        'import { updateWeights } from "@/lib/ranking/bayesian";',
      ),
    ).not.toBeNull();
  });

  it("allows type imports from the ranking interface", () => {
    expect(
      check(
        explainDoesNotImportRanking,
        "src/lib/explain/aggregate.ts",
        'import type { CardFeatures } from "@/lib/ranking/interface";',
      ),
    ).toBeNull();
  });
});

describe("CONSTITUTION 13: server has no cross-request user state", () => {
  it("catches writes to globalThis", () => {
    expect(
      check(
        noServerState,
        "src/app/api/search/route.ts",
        "globalThis.lastSearch = request;",
      ),
    ).not.toBeNull();
  });

  it.each([
    ["Map", "const cache = new Map<string, unknown>();"],
    ["array", "const sessions: unknown[] = [];\nsessions.push(request);"],
  ])("catches a module-level accumulating %s", (_kind, source) => {
    expect(
      check(noServerState, "src/app/api/search/route.ts", source),
    ).not.toBeNull();
  });

  it("allows a local mutable variable inside a function", () => {
    expect(
      check(
        noServerState,
        "src/app/api/search/route.ts",
        "export function POST() {\n  let results = [];\n  results.push('ok');\n  return results;\n}",
      ),
    ).toBeNull();
  });

  it("allows a reusable opaque connection without user data", () => {
    expect(
      check(
        noServerState,
        "src/lib/mcp/connection.ts",
        "const connection = createMcpConnection();\nexport { connection };",
      ),
    ).toBeNull();
  });
});

describe("boundary diagnostics", () => {
  it.each([noMcpImports, explainDoesNotImportRanking, noServerState])(
    "$name message contains WHAT, WHY and FIX",
    (boundaryRule) => {
      const message = formatViolation(
        boundaryRule,
        "src/example.ts",
        "example violation",
      );

      expect(message).toContain("WHAT:");
      expect(message).toContain("WHY:");
      expect(message).toContain("FIX:");
    },
  );
});
