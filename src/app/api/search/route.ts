import { searchOnce, type SearchOnceResult } from "@/lib/usecases/search-once";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) {
    return Response.json(
      {
        status: "error",
        code: "invalid_json",
        message: "Тело запроса должно быть JSON-объектом.",
      },
      { status: 400 },
    );
  }

  const input = body.input;
  if (typeof input !== "string" || input.trim().length === 0) {
    return Response.json(
      {
        status: "error",
        code: "empty_input",
        message: "Опишите поездку одной фразой.",
      },
      { status: 400 },
    );
  }

  const result = await searchOnce(input, { signal: request.signal });
  return Response.json(result, { status: httpStatus(result) });
}

async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function httpStatus(result: SearchOnceResult): number {
  if (result.status === "source_unavailable") return 503;
  if (result.status === "needs_clarification" || result.status === "rejected") {
    return 422;
  }
  return 200;
}
