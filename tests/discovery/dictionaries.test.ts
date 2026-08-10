import { describe, expect, it } from "vitest";

import { parseTravelQuery } from "@/lib/discovery/parse";

const TODAY = new Date("2026-08-05T12:00:00.000Z");

async function parse(phrase: string) {
  const result = await parseTravelQuery(
    `из Москвы ${phrase}`,
    { today: TODAY },
  );
  expect(result.status).toBe("success");
  if (result.status !== "success") throw new Error(`Не разобрано: ${phrase}`);
  return result.query;
}

describe("F22: живые формулировки discovery-запроса", () => {
  it.each([
    "с женой",
    "с мужем",
    "с супругой",
    "вдвоём с женой",
    "я и жена",
    "нас двое",
    "с девушкой",
    "с парнем",
    "семьёй",
    "с семьёй",
  ])(
    "%s означает двух взрослых",
    async (phrase) => {
      expect((await parse(phrase)).travellers).toEqual({
        adults: 2,
        childrenAges: [],
      });
    },
  );

  it.each(["один", "сам", "в одиночку"])(
    "%s означает одного взрослого",
    async (phrase) => {
      expect((await parse(phrase)).travellers).toEqual({
        adults: 1,
        childrenAges: [],
      });
    },
  );

  it.each([
    ["бюджет 60000", 60_000],
    ["в районе 50к", 50_000],
  ] as const)("%s даёт числовой бюджет", async (phrase, amount) => {
    expect((await parse(phrase)).budget?.amount).toBe(amount);
  });

  it.each([
    ["примерно 60 тысяч", 60_000],
    ["тысяч за шестьдесят", 60_000],
  ] as const)("понимает бюджет «%s»", async (phrase, amount) => {
    expect((await parse(phrase)).budget?.amount).toBe(amount);
  });

  it("не превращает «недорого» в выдуманную сумму", async () => {
    const query = await parse("недорого");

    expect(query.budget).toBeUndefined();
    expect(query.budgetPreference).toBe("low");
  });

  it.each(["не важно сколько", "любой бюджет"])(
    "%s означает отсутствие ограничения, а не сумму",
    async (phrase) => {
      const query = await parse(phrase);
      expect(query.budget).toBeUndefined();
      expect(query.budgetPreference).toBe("unrestricted");
    },
  );

  it.each([
    ["на юг", ["sea"]],
    ["погреться", ["sea"]],
    ["в горы", ["mountains"]],
    ["покататься на лыжах", ["mountains"]],
    ["по городам", ["city"]],
    ["посмотреть города", ["city"]],
    ["отдохнуть от суеты", ["quiet"]],
    ["подальше от людей", ["quiet"]],
    ["полечиться", ["treatment"]],
    ["на воды", ["treatment"]],
  ] as const)("%s даёт нужное настроение", async (phrase, tags) => {
    expect((await parse(phrase)).vibeTags).toEqual(tags);
  });

  it.each([
    ["в начале сентября", { startDate: "2026-09-01", nights: 4 }],
    ["через месяц", { startDate: "2026-09-05", nights: 4 }],
    ["в конце августа", { startDate: "2026-08-25", nights: 4 }],
    ["на новый год", { startDate: "2027-01-01", nights: 4 }],
    ["на майские", { startDate: "2027-05-01", nights: 4 }],
    ["на выходных", { startDate: "2026-08-08", nights: 2 }],
  ] as const)("%s даёт конкретное окно", async (phrase, window) => {
    expect((await parse(phrase)).dateWindow).toEqual(window);
  });

  it("остаётся детерминированным", async () => {
    const phrase = "в начале сентября вдвоём с женой недорого на юг";

    expect(await parse(phrase)).toEqual(await parse(phrase));
  });
});
