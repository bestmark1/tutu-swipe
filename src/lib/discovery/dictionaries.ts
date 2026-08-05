import type { VibeTag } from "./schema";

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
    phrases: ["море", "морю", "пляж", "пляжу", "побережье", "приморье"],
  },
  {
    tag: "mountains",
    phrases: ["горы", "горах", "горам", "горный", "альпинизм"],
  },
  {
    tag: "city",
    phrases: ["городской отдых", "мегаполис", "музеи", "архитектура"],
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
];
