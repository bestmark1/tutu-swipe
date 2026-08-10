import {
  VIBE_TAGS,
  type DiscoveryFallbackParser,
  type DiscoveryFallbackRequest,
  type DiscoveryRequiredField,
  type PartialDiscoveryQuery,
  type VibeTag,
} from "./schema";

const DEFAULT_TIMEOUT_MS = 3_000;

type Environment = Readonly<Record<string, string | undefined>>;

export interface DiscoveryFallbackModelOptions {
  env?: Environment;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

/**
 * OpenAI-compatible fallback. Any provider/configuration failure deliberately
 * becomes an empty parse so the deterministic rules and defaults keep working.
 */
export function createDiscoveryFallbackModel(
  options: DiscoveryFallbackModelOptions = {},
): DiscoveryFallbackParser {
  return {
    async parse(request) {
      const env = options.env ?? process.env;
      const apiKey = env.DISCOVERY_MODEL_API_KEY ?? env.OPENAI_API_KEY;
      const baseUrl = env.DISCOVERY_MODEL_BASE_URL ?? env.OPENAI_BASE_URL;
      const model = env.DISCOVERY_MODEL ?? env.OPENAI_MODEL;
      if (!apiKey || !baseUrl || !model || request.missingFields.length === 0) {
        return null;
      }

      const controller = new AbortController();
      const timeoutMs = Math.min(
        Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 0),
        DEFAULT_TIMEOUT_MS,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        const operation = async (): Promise<PartialDiscoveryQuery | null> => {
          const response = await (options.fetcher ?? fetch)(
            chatCompletionsUrl(baseUrl),
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${apiKey}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(modelRequest(model, request)),
              signal: controller.signal,
            },
          );
          if (!response.ok) return null;
          const payload: unknown = await response.json();
          return sanitizeModelOutput(readMessageContent(payload), request);
        };

        return await Promise.race([
          operation(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("discovery model timeout"));
            }, timeoutMs);
          }),
        ]);
      } catch {
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

export const discoveryFallbackModel = createDiscoveryFallbackModel();
/** @deprecated Имя сохранено для совместимости; fallback теперь доступен. */
export const unavailableDiscoveryFallback = discoveryFallbackModel;

function modelRequest(model: string, request: DiscoveryFallbackRequest) {
  const properties = Object.fromEntries(
    request.missingFields.map((field) => [field, fieldSchema(field)]),
  );

  return {
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Извлеки только явно сказанные параметры поездки. Не угадывай значения. " +
          "Верни только запрошенные ключи; если значение не сказано, верни null. " +
          `Сегодня ${request.today}.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          input: request.input,
          fields: request.missingFields,
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "discovery_missing_fields",
        strict: true,
        schema: {
          type: "object",
          properties,
          required: request.missingFields,
          additionalProperties: false,
        },
      },
    },
  };
}

function fieldSchema(field: DiscoveryRequiredField): object {
  const schema: Record<DiscoveryRequiredField, object> = {
    origin: { type: ["string", "null"] },
    travellers: {
      anyOf: [
        {
          type: "object",
          properties: {
            adults: { type: "integer", minimum: 1, maximum: 20 },
            childrenAges: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: 17 },
              maxItems: 10,
            },
          },
          required: ["adults", "childrenAges"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    dateWindow: {
      anyOf: [
        {
          type: "object",
          properties: {
            startDate: { type: "string", format: "date" },
            nights: { type: "integer", minimum: 1, maximum: 60 },
          },
          required: ["startDate", "nights"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    budget: {
      anyOf: [
        {
          type: "object",
          properties: {
            amount: { type: "integer", minimum: 1 },
            currency: { const: "RUB" },
            scope: { const: "group_trip_total" },
          },
          required: ["amount", "currency", "scope"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    vibeTags: {
      anyOf: [
        {
          type: "array",
          items: { type: "string", enum: VIBE_TAGS },
          uniqueItems: true,
        },
        { type: "null" },
      ],
    },
  };
  return schema[field];
}

function readMessageContent(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined;
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return undefined;
  const content = first.message.content;
  if (typeof content !== "string") return undefined;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function sanitizeModelOutput(
  output: unknown,
  request: DiscoveryFallbackRequest,
): PartialDiscoveryQuery | null {
  if (!isRecord(output)) return null;
  const allowed = new Set<DiscoveryRequiredField>(request.missingFields);
  const result: PartialDiscoveryQuery = {};

  if (allowed.has("origin") && typeof output.origin === "string") {
    const origin = output.origin.trim();
    if (origin) result.origin = origin;
  }

  if (allowed.has("travellers") && isRecord(output.travellers)) {
    const { adults, childrenAges } = output.travellers;
    if (
      Number.isInteger(adults) &&
      (adults as number) >= 1 &&
      (adults as number) <= 20 &&
      Array.isArray(childrenAges) &&
      childrenAges.length <= 10 &&
      childrenAges.every(
        (age) => Number.isInteger(age) && age >= 0 && age <= 17,
      )
    ) {
      result.travellers = {
        adults: adults as number,
        childrenAges: [...childrenAges] as number[],
      };
    }
  }

  if (allowed.has("dateWindow") && isRecord(output.dateWindow)) {
    const { startDate, nights } = output.dateWindow;
    if (
      typeof startDate === "string" &&
      isIsoCalendarDate(startDate) &&
      startDate >= request.today &&
      Number.isInteger(nights) &&
      (nights as number) >= 1 &&
      (nights as number) <= 60
    ) {
      result.dateWindow = { startDate, nights: nights as number };
    }
  }

  if (allowed.has("budget") && isRecord(output.budget)) {
    const { amount, currency, scope } = output.budget;
    if (
      Number.isSafeInteger(amount) &&
      (amount as number) > 0 &&
      currency === "RUB" &&
      scope === "group_trip_total"
    ) {
      result.budget = {
        amount: amount as number,
        currency,
        scope,
      };
    }
  }

  if (allowed.has("vibeTags") && Array.isArray(output.vibeTags)) {
    const tags = output.vibeTags.filter(isVibeTag);
    if (tags.length > 0) result.vibeTags = [...new Set(tags)];
  }

  return Object.keys(result).length > 0 ? result : null;
}

function isVibeTag(value: unknown): value is VibeTag {
  return (
    typeof value === "string" &&
    (VIBE_TAGS as readonly string[]).includes(value)
  );
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
