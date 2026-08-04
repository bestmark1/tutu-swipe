// Как прогнать один кейс через LLM твоего продукта.
//
// Пока CONFIGURED = false, `npm run eval` пропускает прогон и выходит с 0 —
// проектам без размытых LLM-выходов evals не нужны (см. eval/README.md).
//
// Чтобы включить: поставь CONFIGURED = true и реализуй runCase так, чтобы она
// возвращала строку — то, что вернул LLM на этот вход.

export const CONFIGURED = false;

export async function runCase(input) {
  // Пример для продукта, где ценность — выход LLM:
  //
  //   const { translate } = await import("../src/lib/llm/provider.ts");
  //   const result = await translate(input.text, input.from, input.to);
  //   return result.translation;

  throw new Error(
    `runCase не реализована — заполни eval/run-case.mjs (вход: ${JSON.stringify(input)})`
  );
}
