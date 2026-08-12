export const VIBE_TAGS = [
  "sea",
  "mountains",
  "city",
  "quiet",
  "active",
  "nature",
  "culture",
  "treatment",
] as const;

export type VibeTag = (typeof VIBE_TAGS)[number];

export interface TravellerComposition {
  adults: number;
  childrenAges: number[];
}

export interface DateWindow {
  startDate: string;
  nights: number;
}

export interface TripBudget {
  amount: number;
  currency: "RUB";
  scope: "group_trip_total";
}

export interface DiscoveryQuery {
  origin: string;
  travellers: TravellerComposition;
  dateWindow: DateWindow;
  budget: TripBudget;
  vibeTags: VibeTag[];
  /** Направления из каталога в порядке упоминания во фразе. */
  namedDestinations?: string[];
  /** Явный ценовой ориентир без выдуманного денежного потолка. */
  budgetPreference?: "low" | "unrestricted";
}

export type PartialDiscoveryQuery = Partial<DiscoveryQuery>;
export type DiscoveryRequiredField =
  | "origin"
  | "travellers"
  | "dateWindow"
  | "budget"
  | "vibeTags";

// F04 turns these markers into clarification steps. F03 only reserves the
// contract and never guesses either value.
export type DiscoveryBlockingField = "origin" | "childrenAges";

export interface DiscoveryClarification {
  field: DiscoveryBlockingField;
  question: string;
}

export interface DiscoveryFallbackRequest {
  input: string;
  today: string;
  parsed: PartialDiscoveryQuery;
  missingFields: DiscoveryRequiredField[];
  blockingFields: DiscoveryBlockingField[];
}

export interface DiscoveryFallbackParser {
  parse(
    request: DiscoveryFallbackRequest,
  ): Promise<PartialDiscoveryQuery | null>;
}

export type DiscoveryParseResult =
  | {
      status: "success";
      source: "rules" | "rules+fallback";
      query: DiscoveryQuery;
      /**
       * Поля, которых не было во фразе и которые заполнены умолчаниями.
       * Интерфейс показывает их отдельно, чтобы человек видел, что подставлено,
       * и мог поправить. Пустой массив означает, что всё пришло из запроса.
      */
      assumedFields: DiscoveryRequiredField[];
      /** Названные направления, которых нет в каталоге. */
      unknownDestinations?: string[];
    }
  | {
      status: "needs_clarification";
      source: "rules" | "rules+fallback";
      blockingFields: DiscoveryBlockingField[];
      clarifications: DiscoveryClarification[];
      unknownDestinations?: string[];
    }
  | {
      status: "rejected";
      source: "rules" | "rules+fallback";
      code: "unrecognized" | "incomplete";
      message: string;
      hint: string;
      missingFields: DiscoveryRequiredField[];
      blockingFields: DiscoveryBlockingField[];
      unknownDestinations?: string[];
    };

/**
 * Совместимое имя прежней заглушки. Импорт ленивый, чтобы schema оставалась
 * безопасной для type-only потребителей и не создавала статический цикл.
 */
export const unavailableDiscoveryFallback: DiscoveryFallbackParser = {
  async parse(request) {
    const { discoveryFallbackModel } = await import("./fallback-model");
    return discoveryFallbackModel.parse(request);
  },
};
