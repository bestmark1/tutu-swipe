import {
  LOW_BUDGET_PHRASES,
  MONTHS,
  ONE_ADULT_PHRASES,
  ORIGIN_CITIES,
  RUSSIAN_BUDGET_TENS,
  TWO_ADULT_PHRASES,
  UNRESTRICTED_BUDGET_PHRASES,
  VIBE_SYNONYMS,
} from "./dictionaries";
import { destinationCatalog, fullDestinationCatalog } from "./catalog";
import { discoveryFallbackModel } from "./fallback-model";
import {
  type DateWindow,
  type DiscoveryBlockingField,
  type DiscoveryClarification,
  type DiscoveryFallbackParser,
  type DiscoveryParseResult,
  type DiscoveryQuery,
  type DiscoveryRequiredField,
  type PartialDiscoveryQuery,
  type TravellerComposition,
  type TripBudget,
  type VibeTag,
} from "./schema";

const DEFAULT_START_DAY = 10;
const DEFAULT_NIGHTS = 4;

interface DestinationAliasGroup {
  aliases: readonly string[];
  destinations: readonly string[];
}

// Только словарь из постановки F25. Дополнительные формы ниже — склонения
// этих же названий, а не новые географические синонимы.
const REGION_DESTINATION_ALIASES: readonly DestinationAliasGroup[] = [
  { aliases: ["алтай", "алтае", "алтая"], destinations: ["Горно-Алтайск"] },
  { aliases: ["байкал", "байкале", "байкала"], destinations: ["Иркутск", "Улан-Удэ"] },
  { aliases: ["карелия", "карелию", "карелии"], destinations: ["Петрозаводск", "Сортавала"] },
  { aliases: ["ладога", "ладогу", "ладоге", "ладожское", "ладожском"], destinations: ["Сортавала"] },
  { aliases: ["онега", "онегу", "онеге", "онежское", "онежском"], destinations: ["Петрозаводск"] },
  { aliases: ["кавказ", "кавказе", "кавказа"], destinations: ["Пятигорск", "Кисловодск", "Нальчик", "Владикавказ"] },
  {
    aliases: [
      "кавминводы",
      "кавминводах",
      "кмв",
      "минводы",
      "минводах",
      "минеральные воды",
      "минеральных водах",
    ],
    destinations: ["Пятигорск", "Кисловодск", "Ессентуки", "Железноводск"],
  },
  {
    aliases: ["золотое кольцо", "золотом кольце", "золотому кольцу"],
    destinations: ["Владимир", "Суздаль", "Ярославль", "Кострома"],
  },
  { aliases: ["дагестан", "дагестане", "дагестана"], destinations: ["Махачкала", "Дербент"] },
  { aliases: ["адыгея", "адыгею", "адыгее"], destinations: ["Майкоп"] },
  {
    aliases: [
      "осетия",
      "осетию",
      "осетии",
      "северная осетия",
      "северную осетию",
      "северной осетии",
      "алания",
      "аланию",
      "алании",
    ],
    destinations: ["Владикавказ"],
  },
  { aliases: ["кабардино-балкария", "кабардино-балкарию", "кабардино-балкарии", "кбр"], destinations: ["Нальчик"] },
  { aliases: ["татарстан", "татарстане", "татарстана"], destinations: ["Казань"] },
  { aliases: ["бурятия", "бурятию", "бурятии"], destinations: ["Улан-Удэ"] },
  { aliases: ["приморье", "приморье", "приморский край", "приморском крае"], destinations: ["Владивосток"] },
  { aliases: ["хибины", "хибинах", "териберка", "териберку", "териберке", "кольский", "кольском", "заполярье", "заполярье"], destinations: ["Мурманск"] },
  { aliases: ["красная поляна", "красную поляну", "красной поляне", "роза хутор", "розе хутор", "сириус", "сириусе", "адлер", "адлере"], destinations: ["Сочи"] },
  { aliases: ["куршская коса", "куршскую косу", "куршской косе"], destinations: ["Зеленоградск"] },
  { aliases: ["беларусь", "беларуси", "белоруссия", "белоруссию", "белоруссии"], destinations: ["Минск", "Брест", "Гродно"] },
  { aliases: ["казахстан", "казахстане", "казахстана"], destinations: ["Алматы", "Астана"] },
  { aliases: ["узбекистан", "узбекистане", "узбекистана"], destinations: ["Ташкент", "Самарканд"] },
  { aliases: ["грузия", "грузию", "грузии"], destinations: ["Тбилиси"] },
  { aliases: ["армения", "армению", "армении"], destinations: ["Ереван"] },
  { aliases: ["азербайджан", "азербайджане", "азербайджана"], destinations: ["Баку"] },
  { aliases: ["киргизия", "киргизию", "киргизии", "кыргызстан", "кыргызстане", "кыргызстана"], destinations: ["Бишкек"] },
] as const;

const CONVERSATIONAL_CITY_ALIASES: readonly DestinationAliasGroup[] = [
  {
    aliases: [
      "питер",
      "питере",
      "питера",
      "спб",
      "петербург",
      "петербурге",
      "петербурга",
      "санкт петербург",
      "санкт петербурге",
      "санкт петербурга",
    ],
    destinations: ["Санкт-Петербург"],
  },
  { aliases: ["мск"], destinations: ["Москва"] },
  { aliases: ["нижний", "нижнем", "нижнего"], destinations: ["Нижний Новгород"] },
  { aliases: ["новосиб"], destinations: ["Новосибирск"] },
  { aliases: ["екб", "ебург", "екат"], destinations: ["Екатеринбург"] },
] as const;

const UNKNOWN_DESTINATION_ALIASES: readonly DestinationAliasGroup[] = [
  { aliases: ["париж", "париже", "парижа"], destinations: ["Париж"] },
  { aliases: ["крым", "крыму", "крыма"], destinations: ["Крым"] },
  { aliases: ["абхазия", "абхазию", "абхазии"], destinations: ["Абхазия"] },
  { aliases: ["камчатка", "камчатку", "камчатке"], destinations: ["Камчатка"] },
  { aliases: ["домбай", "домбае", "домбая"], destinations: ["Домбай"] },
  { aliases: ["архыз", "архызе", "архыза"], destinations: ["Архыз"] },
  { aliases: ["эльбрус", "эльбрусе", "эльбруса"], destinations: ["Эльбрус"] },
  { aliases: ["байконур", "байконуре", "байконура"], destinations: ["Байконур"] },
  { aliases: ["ростов", "ростове", "ростова"], destinations: ["Ростов"] },
] as const;

const MULTIWORD_CITY_FORMS: Readonly<Record<string, readonly string[]>> = {
  "Горно-Алтайск": ["горно-алтайск", "горно-алтайска", "горно-алтайске"],
  "Нижний Новгород": [
    "нижний новгород",
    "нижнего новгорода",
    "нижнем новгороде",
  ],
  "Великий Новгород": [
    "великий новгород",
    "великого новгорода",
    "великом новгороде",
  ],
  "Санкт-Петербург": [
    "санкт-петербург",
    "санкт-петербурга",
    "санкт-петербурге",
  ],
  "Улан-Удэ": ["улан-удэ", "улан удэ"],
  Ессентуки: ["ессентуки", "ессентуках"],
};

// Регулярками, а не множествами: проверка границ запрещает Map/Set/массивы на
// уровне модуля, потому что они переживают HTTP-ответ в тёплом процессе. Здесь
// данных запроса нет, но правило проще соблюсти, чем обосновывать исключение.
const FEMININE_SOFT_SIGN_CITY = /^(?:Казань|Рязань|Тюмень)$/u;
const MASCULINE_SOFT_SIGN_CITY = /^(?:Суздаль|Ярославль)$/u;

// Словарь строится по ПОЛНОМУ справочнику, а не по отфильтрованному каталогу:
// названное направление нужно узнать даже тогда, когда предложить его нельзя.
// Недостижимые отсеиваются ниже, в parseDestinationMentions, и попадают
// в unknownDestinations — человек увидит, что его слово услышано.
const CATALOG_CITY_ALIASES: readonly DestinationAliasGroup[] =
  fullDestinationCatalog.map(({ name }) => ({
    aliases: catalogCityForms(name),
    destinations: [name],
  }));

export interface ParseTravelQueryOptions {
  today: Date;
  fallback?: DiscoveryFallbackParser;
}

export async function parseTravelQuery(
  input: string,
  options: ParseTravelQueryOptions,
): Promise<DiscoveryParseResult> {
  assertValidToday(options.today);
  const text = normalizeText(input);
  const travellerMatch = parseTravellers(text);
  const origin = parseOrigin(text);
  const { namedDestinations, unknownDestinations } =
    parseDestinationMentions(text, origin);
  const parsed: PartialDiscoveryQuery = {
    origin,
    travellers: travellerMatch.value,
    dateWindow: parseDateWindow(text, options.today),
    budget: parseBudget(text),
    vibeTags: parseVibeTags(text),
    namedDestinations,
    budgetPreference: parseBudgetPreference(text),
  };
  removeMissingValues(parsed);

  const missingFields = findMissingFields(parsed);
  const blockingFields = findBlockingFields(parsed, travellerMatch);

  // Период назван, но разобрать его не удалось — например, дата в прошлом.
  // Это ошибка во фразе, а не отсутствие данных: подставить умолчание
  // значило бы молча увезти человека не туда, куда он просил.
  if (!parsed.dateWindow && mentionsUnusablePeriod(text)) {
    return {
      status: "rejected",
      source: "rules",
      code: "incomplete",
      message: "Не удалось понять даты поездки.",
      hint: "Проверьте период: дата должна быть в будущем.",
      missingFields: ["dateWindow"],
      blockingFields: [],
      ...unknownDestinationMetadata(unknownDestinations),
    };
  }

  // Правила собрали всё — модель не нужна.
  if (missingFields.length === 0) {
    return success(parsed, "rules", [], unknownDestinations);
  }

  const fallback = options.fallback ?? discoveryFallbackModel;
  const fallbackParsed = await fallback.parse({
    input,
    today: formatDate(
      options.today.getUTCFullYear(),
      options.today.getUTCMonth() + 1,
      options.today.getUTCDate(),
    ),
    parsed: copyPartialQuery(parsed),
    missingFields: [...missingFields],
    blockingFields: [...blockingFields],
  });
  const combined = mergeRuleAndFallbackResults(parsed, fallbackParsed);
  const combinedMissingFields = findMissingFields(combined);

  if (combinedMissingFields.length === 0) {
    return success(combined, "rules+fallback", [], unknownDestinations);
  }

  const recognizedNothing = recognizedFieldCount(parsed) === 0;
  const unresolvedBlocking = unresolvedBlockingFields(
    blockingFields,
    combined,
  );
  if (
    unresolvedBlocking.length > 0 &&
    (!recognizedNothing || travellerMatch.childrenMentionedWithoutAges)
  ) {
    return clarificationRequired(
      unresolvedBlocking,
      "rules+fallback",
      unknownDestinations,
    );
  }

  // Ни правила, ни модель не поняли ничего — вернуть человеку нечего.
  if (recognizedNothing) {
    return {
      status: "rejected",
      source: "rules+fallback",
      code: "unrecognized",
      message: "Не удалось понять запрос о поездке.",
      hint:
        "Назовите город отправления и когда хотите поехать. Например: «из Москвы на море в сентябре».",
      missingFields: combinedMissingFields,
      blockingFields: unresolvedBlocking,
      ...unknownDestinationMetadata(unknownDestinations),
    };
  }

  // Что-то поняли, блокирующего не осталось — запускаем поиск с умолчаниями
  // для необязательного. Отказывать из-за ненайденного бюджета или тега
  // значило бы превратить свободную фразу в форму с обязательными полями.
  return success(
    withDefaults(combined, options.today),
    "rules+fallback",
    combinedMissingFields,
    unknownDestinations,
  );
}

function parseDestinationMentions(
  text: string,
  origin: string | undefined,
): { namedDestinations?: string[]; unknownDestinations?: string[] } {
  const catalogNames = new Set(destinationCatalog.map(({ name }) => name));
  const mentioned = orderedDestinationsFromAliases(text, [
    ...REGION_DESTINATION_ALIASES,
    ...CONVERSATIONAL_CITY_ALIASES,
    ...CATALOG_CITY_ALIASES,
  ]);
  const named = mentioned.filter(
    (destination) =>
      catalogNames.has(destination) &&
      normalizeText(destination) !== normalizeText(origin ?? ""),
  );

  // Названное направление может быть отфильтровано каталогом: Суздаль,
  // Зеленоградск, Ейск и Светлогорск известны, но MCP не собирает до них
  // маршрут, и каталог их отбрасывает. Молчать об этом нельзя — человек
  // написал «на Куршскую косу» и не поймёт, почему ему показывают другое.
  // Такие направления идут в unknownDestinations вместе с ненайденными.
  const unreachable = mentioned.filter(
    (destination) =>
      !catalogNames.has(destination) &&
      normalizeText(destination) !== normalizeText(origin ?? ""),
  );

  const unknown = [
    ...orderedDestinationsFromAliases(text, UNKNOWN_DESTINATION_ALIASES, true),
    ...unreachable,
  ];

  return {
    ...(named.length > 0 ? { namedDestinations: named } : {}),
    ...(unknown.length > 0 ? { unknownDestinations: unknown } : {}),
  };
}

function orderedDestinationsFromAliases(
  text: string,
  groups: readonly DestinationAliasGroup[],
  directionalOnly = false,
): string[] {
  const mentions: Array<{
    index: number;
    length: number;
    groupIndex: number;
    destinations: readonly string[];
  }> = [];

  groups.forEach((group, groupIndex) => {
    for (const rawAlias of new Set(group.aliases)) {
      const alias = normalizeText(rawAlias);
      const pattern = new RegExp(
        `(?:^|[^\\p{L}\\p{N}])(${escapeRegExp(alias)})(?![\\p{L}\\p{N}])`,
        "gu",
      );
      for (const match of text.matchAll(pattern)) {
        const aliasIndex = (match.index ?? 0) + match[0].length - match[1].length;
        if (
          directionalOnly &&
          !/(?:^|[\s,;])(?:в|на)\s+$/u.test(text.slice(0, aliasIndex))
        ) {
          continue;
        }
        mentions.push({
          index: aliasIndex,
          length: alias.length,
          groupIndex,
          destinations: group.destinations,
        });
      }
    }
  });

  mentions.sort(
    (left, right) =>
      left.index - right.index ||
      right.length - left.length ||
      left.groupIndex - right.groupIndex,
  );

  const destinations: string[] = [];
  const seen = new Set<string>();
  for (const mention of mentions) {
    for (const destination of mention.destinations) {
      if (!seen.has(destination)) {
        seen.add(destination);
        destinations.push(destination);
      }
    }
  }
  return destinations;
}

function catalogCityForms(name: string): string[] {
  const explicit = MULTIWORD_CITY_FORMS[name];
  if (explicit) return [...explicit];

  const normalized = normalizeText(name);
  const forms = new Set([normalized]);
  if (FEMININE_SOFT_SIGN_CITY.test(name)) {
    forms.add(`${normalized.slice(0, -1)}и`);
  } else if (MASCULINE_SOFT_SIGN_CITY.test(name)) {
    forms.add(`${normalized.slice(0, -1)}я`);
    forms.add(`${normalized.slice(0, -1)}е`);
  } else if (normalized.endsWith("а")) {
    const stem = normalized.slice(0, -1);
    forms.add(`${stem}у`);
    forms.add(`${stem}е`);
    forms.add(`${stem}${/[гкхжчшщ]$/u.test(stem) ? "и" : "ы"}`);
  } else if (normalized.endsWith("я")) {
    const stem = normalized.slice(0, -1);
    forms.add(`${stem}ю`);
    forms.add(`${stem}е`);
    forms.add(`${stem}и`);
  } else if (/[бвгджзйклмнпрстфхцчшщ]$/u.test(normalized)) {
    forms.add(`${normalized}а`);
    forms.add(`${normalized}е`);
  }
  return [...forms];
}

function unknownDestinationMetadata(
  unknownDestinations: string[] | undefined,
): { unknownDestinations: string[] } | Record<string, never> {
  return unknownDestinations && unknownDestinations.length > 0
    ? { unknownDestinations }
    : {};
}

function parseOrigin(text: string): string | undefined {
  const aliases = ORIGIN_CITIES.flatMap((city) =>
    city.aliases.map((alias) => ({ alias: normalizeText(alias), city })),
  ).sort((left, right) => right.alias.length - left.alias.length);

  for (const { alias, city } of aliases) {
    const pattern = new RegExp(
      `(?:^|[\\s,;])из\\s+(?:города\\s+)?${escapeRegExp(alias)}(?=$|[\\s,.;!?])`,
      "u",
    );
    if (pattern.test(text)) {
      return city.name;
    }
  }

  return undefined;
}

interface TravellerMatch {
  value?: TravellerComposition;
  childrenMentionedWithoutAges: boolean;
}

const MAX_RULE_BASED_ADULTS = 9;

const GROUP_SIZE_WORDS: Readonly<Record<string, number>> = {
  двое: 2,
  двух: 2,
  двоих: 2,
  трое: 3,
  трех: 3,
  троих: 3,
  четверо: 4,
  четырех: 4,
  четверых: 4,
  пятеро: 5,
  пяти: 5,
  пятерых: 5,
  шестеро: 6,
  шести: 6,
  шестерых: 6,
  семеро: 7,
  семи: 7,
  семерых: 7,
  восьми: 8,
  восьмерых: 8,
  девяти: 9,
  девятерых: 9,
  десяти: 10,
  десятерых: 10,
};

const GROUP_SIZE_PHRASES: ReadonlyArray<readonly [string, number]> = [
  ["вдвоем", 2],
  ["втроем", 3],
  ["вчетвером", 4],
  ["впятером", 5],
  ["вшестером", 6],
  ["всемером", 7],
  ["ввосьмером", 8],
  ["вдевятером", 9],
  ["вдесятером", 10],
  ["на двоих", 2],
  ["на троих", 3],
  ["на четверых", 4],
  ["на пятерых", 5],
  ["на шестерых", 6],
  ["на семерых", 7],
  ["на восьмерых", 8],
  ["на девятерых", 9],
  ["на десятерых", 10],
];

function parseTravellers(text: string): TravellerMatch {
  const childrenMentioned = /(?:дет(?:и|ей|ьми)|ребен(?:ок|ком|ка))/u.test(
    text,
  );
  const childrenAges = childrenMentioned ? parseChildAges(text) : [];
  const childrenMentionedWithoutAges =
    childrenMentioned && childrenAges.length === 0;

  let adults = parseExplicitAdultCount(text);
  if (adults === undefined) {
    if (TWO_ADULT_PHRASES.some((phrase) => containsPhrase(text, phrase))) {
      adults = 2;
    } else if (
      ONE_ADULT_PHRASES.some((phrase) => containsPhrase(text, phrase))
    ) {
      adults = 1;
    }
  }

  // Не обрезаем большие группы до лимита: это молча изменило бы явно названный
  // состав. Значения вне 1–9 не принимаем и оставляем fallback/умолчанию.
  if (
    !adults ||
    adults > MAX_RULE_BASED_ADULTS ||
    childrenMentionedWithoutAges
  ) {
    return { childrenMentionedWithoutAges };
  }

  return {
    value: { adults, childrenAges },
    childrenMentionedWithoutAges,
  };
}

function parseExplicitAdultCount(text: string): number | undefined {
  const numericAdults = text.match(
    /(?:^|[\s,.;!?])(\d{1,3})\s*взросл(?:ых|ого|ый)(?=$|[\s,.;!?])/u,
  );
  if (numericAdults) return Number(numericAdults[1]);

  const numericPeople = text.match(
    /(?:^|[\s,.;!?])(\d{1,3})\s*(?:человек(?:а)?|чел\.?)(?=$|[\s,.;!?])/u,
  );
  if (numericPeople) return Number(numericPeople[1]);

  const oneAdult = text.match(
    /(?:^|[\s,.;!?])(?:один|одна)\s+взросл/u,
  );
  if (oneAdult) return 1;

  const wordPattern = Object.keys(GROUP_SIZE_WORDS)
    .sort((left, right) => right.length - left.length)
    .join("|");
  const wordPeople = text.match(
    new RegExp(
      `(?:^|[\\s,.;!?])(${wordPattern})\\s+(?:человек(?:а)?|взросл(?:ых|ого|ый))(?=$|[\\s,.;!?])`,
      "u",
    ),
  );
  if (wordPeople) return GROUP_SIZE_WORDS[wordPeople[1]];

  const contextualWord = text.match(
    new RegExp(
      `(?:^|[\\s,.;!?])(?:нас|для)\\s+(${wordPattern})(?=$|[\\s,.;!?])`,
      "u",
    ),
  );
  if (contextualWord) return GROUP_SIZE_WORDS[contextualWord[1]];

  return GROUP_SIZE_PHRASES.find(([phrase]) => containsPhrase(text, phrase))?.[1];
}

function parseChildAges(text: string): number[] {
  const ages = new Set<number>();
  const pairedAges = text.match(
    /(?:дет(?:и|ей|ьми)|ребен(?:ок|ком|ка))\s+(\d{1,2})\s*(?:и|,)\s*(\d{1,2})\s*(?:лет|года?)/u,
  );
  if (pairedAges) {
    ages.add(Number(pairedAges[1]));
    ages.add(Number(pairedAges[2]));
  }

  for (const match of text.matchAll(/(\d{1,2})\s*(?:лет|года?)/gu)) {
    ages.add(Number(match[1]));
  }

  return [...ages].filter(isChildAge).sort((left, right) => left - right);
}

function isChildAge(age: number): boolean {
  return Number.isInteger(age) && age >= 0 && age <= 17;
}

function parseDateWindow(text: string, today: Date): DateWindow | undefined {
  const nights = parseNights(text) ?? DEFAULT_NIGHTS;

  if (containsPhrase(text, "через месяц")) {
    const date = addCalendarMonths(today, 1);
    return { startDate: formatUtcDate(date), nights };
  }

  if (/на\s+выходн(?:ых|ые)/u.test(text)) {
    const date = new Date(today.getTime());
    const daysUntilSaturday = (6 - date.getUTCDay() + 7) % 7;
    date.setUTCDate(date.getUTCDate() + daysUntilSaturday);
    return { startDate: formatUtcDate(date), nights: 2 };
  }

  if (containsPhrase(text, "на новый год")) {
    return relativeDateWindow(1, 1, undefined, nights, today);
  }

  if (containsPhrase(text, "на майские")) {
    return relativeDateWindow(5, 1, undefined, nights, today);
  }

  const isoDate = text.match(/(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?=$|[\s,.;!?])/u);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    if (isCalendarDate(year, month, day)) {
      return { startDate: formatDate(year, month, day), nights };
    }
  }

  for (const monthEntry of MONTHS) {
    for (const alias of monthEntry.aliases) {
      const aliasPattern = escapeRegExp(alias);
      const specificDate = text.match(
        new RegExp(
          `(?:^|\\s)(\\d{1,2})\\s+${aliasPattern}(?:\\s+(\\d{4}))?(?=$|[\\s,.;!?])`,
          "u",
        ),
      );
      if (specificDate) {
        return relativeDateWindow(
          monthEntry.month,
          Number(specificDate[1]),
          specificDate[2] ? Number(specificDate[2]) : undefined,
          nights,
          today,
        );
      }
      const monthPart = text.match(
        new RegExp(
          `(?:^|[\\s,])в\\s+(начале|конце)\\s+${aliasPattern}(?=$|[\\s,.;!?])`,
          "u",
        ),
      );
      if (monthPart) {
        return relativeDateWindow(
          monthEntry.month,
          monthPart[1] === "начале" ? 1 : 25,
          undefined,
          nights,
          today,
        );
      }
      if (new RegExp(`(?:^|[\\s,])${aliasPattern}(?=$|[\\s,.;!?])`, "u").test(text)) {
        return relativeDateWindow(
          monthEntry.month,
          DEFAULT_START_DAY,
          undefined,
          nights,
          today,
        );
      }
    }
  }

  return undefined;
}

function relativeDateWindow(
  month: number,
  day: number,
  explicitYear: number | undefined,
  nights: number,
  today: Date,
): DateWindow | undefined {
  // `today` is a UTC calendar day, so local time zones cannot affect rollover.
  const todayStamp = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  if (explicitYear !== undefined) {
    if (
      !isCalendarDate(explicitYear, month, day) ||
      Date.UTC(explicitYear, month - 1, day) < todayStamp
    ) {
      return undefined;
    }

    return { startDate: formatDate(explicitYear, month, day), nights };
  }

  const currentYear = today.getUTCFullYear();
  for (let offset = 0; offset <= 8; offset += 1) {
    const year = currentYear + offset;
    if (
      isCalendarDate(year, month, day) &&
      Date.UTC(year, month - 1, day) >= todayStamp
    ) {
      return { startDate: formatDate(year, month, day), nights };
    }
  }

  return undefined;
}

function parseNights(text: string): number | undefined {
  const numeric = text.match(/на\s+(\d{1,2})\s*(?:ноч(?:ь|и|ей)|дн(?:я|ей))/u);
  if (numeric) {
    const nights = Number(numeric[1]);
    return nights > 0 ? nights : undefined;
  }
  if (/на\s+недел(?:ю|и)/u.test(text)) {
    return 7;
  }
  if (/на\s+выходные/u.test(text)) {
    return 2;
  }
  return undefined;
}

function parseBudget(text: string): TripBudget | undefined {
  const wordThousands = text.match(
    /тысяч(?:а|и|у)?\s+за\s+(двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто)(?=$|[\s,.;!?])/u,
  );
  if (wordThousands) {
    return totalBudget(RUSSIAN_BUDGET_TENS[wordThousands[1]] * 1_000);
  }

  const thousands = text.match(
    /(\d+(?:[.,]\d+)?)\s*(?:к|k|тыс(?:\.|яч(?:а|и|у)?|(?=$|[\s,;!?])))(?!\s*(?:год(?:а)?|лет|ноч(?:ь|и|ей)|д(?:ень|ня|ней))(?=$|[\s,.;!?]))(?=$|[\s,.;!?])/u,
  );
  if (thousands) {
    return totalBudget(Math.round(Number(thousands[1].replace(",", ".")) * 1_000));
  }

  const rubles = text.match(
    /(\d(?:[\d\s]*\d)?)\s*руб(?:ль|ля|лей|\.)?(?=$|[\s,.;!?])/u,
  );
  if (rubles) {
    return totalBudget(Number(rubles[1].replace(/\s/gu, "")));
  }

  const prefixed = text.match(
    /(?:до|бюджет(?:ом)?(?:\s+до)?)\s+(\d(?:\s?\d){3,})(?!\d|-\d)(?!\s*(?:год(?:а)?|лет|ноч(?:ь|и|ей)|д(?:ень|ня|ней))(?=$|[\s,.;!?]))/u,
  );
  return prefixed
    ? totalBudget(Number(prefixed[1].replace(/\s/gu, "")))
    : undefined;
}

function parseBudgetPreference(
  text: string,
): DiscoveryQuery["budgetPreference"] | undefined {
  if (LOW_BUDGET_PHRASES.some((phrase) => containsPhrase(text, phrase))) {
    return "low";
  }
  if (
    UNRESTRICTED_BUDGET_PHRASES.some((phrase) => containsPhrase(text, phrase))
  ) {
    return "unrestricted";
  }
  return undefined;
}

function totalBudget(amount: number): TripBudget | undefined {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return undefined;
  }
  return { amount, currency: "RUB", scope: "group_trip_total" };
}

function parseVibeTags(text: string): VibeTag[] {
  return VIBE_SYNONYMS.filter(({ phrases }) =>
    phrases.some((phrase) => text.includes(normalizeText(phrase))),
  ).map(({ tag }) => tag);
}

function mergeRuleAndFallbackResults(
  rules: PartialDiscoveryQuery,
  fallback: PartialDiscoveryQuery | null | undefined,
): PartialDiscoveryQuery {
  if (!fallback) {
    return rules;
  }
  return {
    origin: rules.origin ?? fallback.origin,
    travellers: rules.travellers ?? fallback.travellers,
    dateWindow: rules.dateWindow ?? fallback.dateWindow,
    budget: rules.budget ?? fallback.budget,
    vibeTags:
      rules.vibeTags && rules.vibeTags.length > 0
        ? rules.vibeTags
        : fallback.vibeTags,
    namedDestinations:
      rules.namedDestinations ?? fallback.namedDestinations,
    budgetPreference: rules.budgetPreference ?? fallback.budgetPreference,
  };
}

function copyPartialQuery(parsed: PartialDiscoveryQuery): PartialDiscoveryQuery {
  return {
    ...parsed,
    travellers: parsed.travellers
      ? {
          ...parsed.travellers,
          childrenAges: [...parsed.travellers.childrenAges],
        }
      : undefined,
    dateWindow: parsed.dateWindow ? { ...parsed.dateWindow } : undefined,
    budget: parsed.budget ? { ...parsed.budget } : undefined,
    vibeTags: parsed.vibeTags ? [...parsed.vibeTags] : undefined,
    namedDestinations: parsed.namedDestinations
      ? [...parsed.namedDestinations]
      : undefined,
  };
}

function findMissingFields(
  parsed: PartialDiscoveryQuery,
): DiscoveryRequiredField[] {
  const missing: DiscoveryRequiredField[] = [];
  if (!parsed.origin) missing.push("origin");
  if (!parsed.travellers) missing.push("travellers");
  if (!parsed.dateWindow) missing.push("dateWindow");
  if (!parsed.budget && !parsed.budgetPreference) missing.push("budget");
  if (!parsed.vibeTags || parsed.vibeTags.length === 0) missing.push("vibeTags");
  return missing;
}

function findBlockingFields(
  parsed: PartialDiscoveryQuery,
  travellerMatch: TravellerMatch,
): DiscoveryBlockingField[] {
  const blocking: DiscoveryBlockingField[] = [];
  if (!parsed.origin) blocking.push("origin");
  if (travellerMatch.childrenMentionedWithoutAges) {
    blocking.push("childrenAges");
  }
  return blocking;
}

function unresolvedBlockingFields(
  blockingFields: DiscoveryBlockingField[],
  parsed: PartialDiscoveryQuery,
): DiscoveryBlockingField[] {
  return blockingFields.filter((field) => {
    if (field === "origin") return !parsed.origin;
    return !parsed.travellers || parsed.travellers.childrenAges.length === 0;
  });
}

const CLARIFICATION_QUESTIONS: Record<
  DiscoveryBlockingField,
  DiscoveryClarification["question"]
> = {
  origin: "Из какого города вы отправляетесь?",
  childrenAges: "Сколько лет каждому ребёнку?",
};

function clarificationRequired(
  blockingFields: DiscoveryBlockingField[],
  source: "rules" | "rules+fallback",
  unknownDestinations?: string[],
): DiscoveryParseResult {
  return {
    status: "needs_clarification",
    source,
    blockingFields,
    clarifications: blockingFields.map((field) => ({
      field,
      question: CLARIFICATION_QUESTIONS[field],
    })),
    ...unknownDestinationMetadata(unknownDestinations),
  };
}

function success(
  parsed: PartialDiscoveryQuery,
  source: "rules" | "rules+fallback",
  assumedFields: DiscoveryRequiredField[] = [],
  unknownDestinations?: string[],
): DiscoveryParseResult {
  return {
    status: "success",
    source,
    query: parsed as DiscoveryQuery,
    assumedFields,
    ...unknownDestinationMetadata(unknownDestinations),
  };
}

/** Число взрослых, когда состав не назван: человек ищет для себя. */
const DEFAULT_ADULTS = 1;
/** Через сколько дней начинается поездка, если период не назван. */
const DEFAULT_LEAD_DAYS = 21;

/**
 * Во фразе есть указание на период, но разобрать его не удалось.
 *
 * Отличает «человек не назвал даты» от «человек назвал даты, но они не
 * годятся»: первое достраивается умолчанием, второе возвращается ему.
 */
function mentionsUnusablePeriod(text: string): boolean {
  const monthMentioned = MONTHS.some(({ aliases }) =>
    aliases.some((alias) =>
      new RegExp(`(?:^|[\\s,])${escapeRegExp(alias)}(?=$|[\\s,.;!?])`, "u").test(
        text,
      ),
    ),
  );
  const isoMentioned = /\d{4}-\d{2}-\d{2}/u.test(text);
  return monthMentioned || isoMentioned;
}

/**
 * Заполняет ненайденные необязательные поля.
 *
 * Отсутствие бюджета — это не «бюджет ноль», а «ограничения нет»: поле
 * остаётся пустым, и отбор направлений работает без ценового потолка.
 * Отсутствие тегов означает, что человек не назвал формат отдыха, и
 * подбирать нужно разнообразное, а не ничего.
 */
function withDefaults(
  parsed: PartialDiscoveryQuery,
  today: Date,
): PartialDiscoveryQuery {
  const filled: PartialDiscoveryQuery = { ...parsed };
  if (!filled.travellers) {
    filled.travellers = { adults: DEFAULT_ADULTS, childrenAges: [] };
  }
  if (!filled.dateWindow) {
    const start = new Date(today.getTime());
    start.setUTCDate(start.getUTCDate() + DEFAULT_LEAD_DAYS);
    filled.dateWindow = {
      startDate: formatDate(
        start.getUTCFullYear(),
        start.getUTCMonth() + 1,
        start.getUTCDate(),
      ),
      nights: DEFAULT_NIGHTS,
    };
  }
  if (!filled.vibeTags || filled.vibeTags.length === 0) {
    filled.vibeTags = [];
  }
  return filled;
}

function removeMissingValues(parsed: PartialDiscoveryQuery): void {
  for (const key of Object.keys(parsed) as DiscoveryRequiredField[]) {
    const value = parsed[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete parsed[key];
    }
  }
}

function recognizedFieldCount(parsed: PartialDiscoveryQuery): number {
  return Object.keys(parsed).length;
}

function normalizeText(input: string): string {
  return input
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/[\u00a0\u202f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function assertValidToday(today: Date): void {
  if (!(today instanceof Date) || Number.isNaN(today.getTime())) {
    throw new TypeError("options.today must be a valid Date");
  }
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatUtcDate(date: Date): string {
  return formatDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(
    `(?:^|[\\s,.;!?])${escapeRegExp(phrase)}(?=$|[\\s,.;!?])`,
    "u",
  ).test(text);
}
