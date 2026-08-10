import type { VibeTag } from "./schema";

export const TWO_ADULT_PHRASES = [
  "с женой",
  "с мужем",
  "с супругой",
  "вдвоем с женой",
  "я и жена",
  "нас двое",
  "с девушкой",
  "с парнем",
  "семьей",
  "с семьей",
] as const;

export const ONE_ADULT_PHRASES = ["один", "сам", "в одиночку"] as const;

export const LOW_BUDGET_PHRASES = ["недорого", "подешевле"] as const;
export const UNRESTRICTED_BUDGET_PHRASES = [
  "не важно сколько",
  "неважно сколько",
  "любой бюджет",
] as const;

export const RUSSIAN_BUDGET_TENS: Readonly<Record<string, number>> = {
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
  шестьдесят: 60,
  семьдесят: 70,
  восемьдесят: 80,
  девяносто: 90,
};

export interface CityDictionaryEntry {
  name: string;
  aliases: readonly string[];
}

// This is a phrase-recognition dictionary, not a list of valid Tutu cities.
// Live MCP search remains the source of truth for geo resolution.
export const ORIGIN_CITIES: readonly CityDictionaryEntry[] = [
  { name: "Москва", aliases: ["москва", "москвы", "москве"] },
  {
    name: "Санкт-Петербург",
    aliases: [
      "санкт-петербург",
      "санкт-петербурга",
      "санкт-петербурге",
      "петербург",
      "петербурга",
      "питер",
      "питера",
    ],
  },
  { name: "Казань", aliases: ["казань", "казани"] },
  {
    name: "Екатеринбург",
    aliases: ["екатеринбург", "екатеринбурга", "екатеринбурге"],
  },
  {
    name: "Новосибирск",
    aliases: ["новосибирск", "новосибирска", "новосибирске"],
  },
  {
    name: "Нижний Новгород",
    aliases: [
      "нижний новгород",
      "нижнего новгорода",
      "нижнем новгороде",
    ],
  },
  { name: "Самара", aliases: ["самара", "самары", "самаре"] },
  {
    name: "Ростов-на-Дону",
    aliases: ["ростов-на-дону", "ростова-на-дону", "ростове-на-дону"],
  },
  {
    name: "Краснодар",
    aliases: ["краснодар", "краснодара", "краснодаре"],
  },
  { name: "Сочи", aliases: ["сочи"] },
  { name: "Уфа", aliases: ["уфа", "уфы", "уфе"] },
  { name: "Пермь", aliases: ["пермь", "перми"] },
  { name: "Омск", aliases: ["омск", "омска", "омске"] },
  {
    name: "Челябинск",
    aliases: ["челябинск", "челябинска", "челябинске"],
  },
  {
    name: "Волгоград",
    aliases: ["волгоград", "волгограда", "волгограде"],
  },
  { name: "Воронеж", aliases: ["воронеж", "воронежа", "воронеже"] },
] as const;

export const MONTHS: ReadonlyArray<{
  month: number;
  aliases: readonly string[];
}> = [
  { month: 1, aliases: ["январь", "января", "январе"] },
  { month: 2, aliases: ["февраль", "февраля", "феврале"] },
  { month: 3, aliases: ["март", "марта", "марте"] },
  { month: 4, aliases: ["апрель", "апреля", "апреле"] },
  { month: 5, aliases: ["май", "мая", "мае"] },
  { month: 6, aliases: ["июнь", "июня", "июне"] },
  { month: 7, aliases: ["июль", "июля", "июле"] },
  { month: 8, aliases: ["август", "августа", "августе"] },
  { month: 9, aliases: ["сентябрь", "сентября", "сентябре"] },
  { month: 10, aliases: ["октябрь", "октября", "октябре"] },
  { month: 11, aliases: ["ноябрь", "ноября", "ноябре"] },
  { month: 12, aliases: ["декабрь", "декабря", "декабре"] },
];

export const VIBE_SYNONYMS: ReadonlyArray<{
  tag: VibeTag;
  phrases: readonly string[];
}> = [
  {
    tag: "sea",
    phrases: [
      "море",
      "морю",
      "пляж",
      "пляжу",
      "побережье",
      "приморье",
      "на юг",
      "к теплому морю",
      "погреться",
    ],
  },
  {
    tag: "mountains",
    phrases: [
      "горы",
      "горах",
      "горам",
      "горный",
      "альпинизм",
      "в горы",
      "покататься на лыжах",
    ],
  },
  {
    tag: "city",
    phrases: [
      "городской отдых",
      "мегаполис",
      "музеи",
      "архитектура",
      "по городам",
      "посмотреть города",
    ],
  },
  {
    tag: "quiet",
    phrases: [
      "тишина",
      "тихо",
      "спокойно",
      "не шумно",
      "уединение",
      "уединения",
      "отдохнуть от суеты",
      "подальше от людей",
    ],
  },
  {
    tag: "active",
    phrases: [
      "активный отдых",
      "активно",
      "поход",
      "походы",
      "треккинг",
      "спорт",
    ],
  },
  {
    tag: "nature",
    phrases: ["природа", "природе", "лес", "озеро", "заповедник"],
  },
  {
    tag: "culture",
    phrases: ["культура", "музей", "музеи", "история", "архитектура"],
  },
  {
    tag: "treatment",
    phrases: ["полечиться", "на воды"],
  },
];
