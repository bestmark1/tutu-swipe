import { prepareCheckoutLink, type CheckoutRef } from "@/lib/mcp/checkout";

export const maxDuration = 10;
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 16 * 1024;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      return Response.json(
        { error: "checkout_request_too_large" },
        { status: 413 },
      );
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isCheckoutRequest(body)) {
    return Response.json({ error: "invalid_checkout_request" }, { status: 400 });
  }

  const result = await prepareCheckoutLink({
    checkoutRef: body.checkoutRef,
    ...(body.fallbackUrl === undefined
      ? {}
      : { fallbackUrl: body.fallbackUrl }),
    signal: request.signal,
  });
  return Response.json(result, {
    headers: { "cache-control": "no-store" },
  });
}

function isCheckoutRequest(
  value: unknown,
): value is { checkoutRef: CheckoutRef; fallbackUrl?: string } {
  if (!isRecord(value) || !isRecord(value.checkoutRef)) return false;
  if (
    value.fallbackUrl !== undefined &&
    typeof value.fallbackUrl !== "string"
  ) {
    return false;
  }
  const product = value.checkoutRef.product_type ?? value.checkoutRef.transport;
  return typeof product === "string" && product.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
