import type {
  DiscoveryQuery,
  DiscoveryRequiredField,
  VibeTag,
} from "./schema";

export interface AssumedFieldChip {
  field: DiscoveryRequiredField;
  label: string;
}

const VIBE_LABELS: Record<VibeTag, string> = {
  sea: "море",
  mountains: "горы",
  city: "город",
  quiet: "тишина",
  active: "активный отдых",
  nature: "природа",
  culture: "культура",
  treatment: "лечение",
};

/**
 * Человекочитаемые значения полей, которых не было во фразе и которые
 * поиск подставил умолчаниями. Интерфейс показывает их чипами, чтобы
 * человек видел додуманное и мог поправить фразу.
 */
export function assumedFieldChips(
  query: DiscoveryQuery,
  assumedFields: readonly DiscoveryRequiredField[],
): AssumedFieldChip[] {
  const chips: AssumedFieldChip[] = [];
  for (const field of assumedFields) {
    const label = assumedFieldLabel(field, query);
    if (label) chips.push({ field, label });
  }
  return chips;
}

function assumedFieldLabel(
  field: DiscoveryRequiredField,
  query: DiscoveryQuery,
): string {
  switch (field) {
    case "origin":
      return query.origin ? `из ${query.origin}` : "";
    case "travellers":
      return travellersLabel(query);
    case "dateWindow":
      return dateWindowLabel(query);
    case "budget":
      return budgetLabel(query);
    case "vibeTags":
      return vibeLabel(query);
  }
}

function travellersLabel(query: DiscoveryQuery): string {
  const { adults, childrenAges } = query.travellers;
  const parts = [`${adults} ${plural(adults, "взрослый", "взрослых", "взрослых")}`];
  if (childrenAges.length > 0) {
    parts.push(
      childrenAges.length === 1
        ? `ребёнок ${childrenAges[0]} ${plural(childrenAges[0], "год", "года", "лет")}`
        : `дети ${childrenAges.join(" и ")} лет`,
    );
  }
  return parts.join(", ");
}

function dateWindowLabel(query: DiscoveryQuery): string {
  const { startDate, nights } = query.dateWindow;
  const date = new Date(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);
  return `${day}, ${nights} ${plural(nights, "ночь", "ночи", "ночей")}`;
}

function budgetLabel(query: DiscoveryQuery): string {
  if (query.budget) {
    const amount = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: query.budget.currency,
      maximumFractionDigits: 0,
    }).format(query.budget.amount);
    return `до ${amount}`;
  }
  if (query.budgetPreference === "low") return "недорого";
  return "без ограничения по цене";
}

function vibeLabel(query: DiscoveryQuery): string {
  if (query.vibeTags.length === 0) return "любой тип отдыха";
  return query.vibeTags.map((tag) => VIBE_LABELS[tag]).join(", ");
}

function plural(count: number, one: string, few: string, many: string): string {
  const lastTwo = Math.abs(count) % 100;
  const last = lastTwo % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
