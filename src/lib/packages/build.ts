export interface MoneyInput {
  amount: number;
  currency: string;
}

export interface TransportOfferInput {
  price: MoneyInput;
  legs?: readonly { label?: string }[];
  departureAt?: string;
  arrivalAt?: string;
}

export interface AccommodationPriceInput {
  price: MoneyInput;
  priceBasis?: string;
}

export interface HotelOfferInput {
  bestOffer?: AccommodationPriceInput;
}

export interface SelectedDestinationInput {
  name: string;
  region?: string | null;
  alsoNamed?: readonly string[];
  also_named?: readonly string[];
}

export interface TransportSearchInput<
  TTransport extends TransportOfferInput = TransportOfferInput,
> {
  variants: readonly TTransport[];
  meta?: {
    to?: SelectedDestinationInput;
  };
}

export interface HotelSearchInput<THotel extends HotelOfferInput = HotelOfferInput> {
  hotels: readonly THotel[];
  stay?: {
    checkIn: string;
    checkOut: string;
    nights: number;
  };
}

export interface PriceComponent extends MoneyInput {
  label: string;
}

export interface AccommodationPriceComponent extends PriceComponent {
  priceBasis: "stay_total";
}

export interface TripCardPrice {
  total: MoneyInput & { computed: true };
  breakdown: {
    transport: PriceComponent;
    accommodation: AccommodationPriceComponent;
  };
}

export type TripCardWarningCode =
  | "early_arrival"
  | "late_arrival"
  | "early_departure";

export interface TripCardWarning {
  code: TripCardWarningCode;
  message: string;
  computed: true;
}

export interface SelectedDestination {
  name: string;
  region: string | null;
  alsoNamed?: readonly string[];
}

export interface TripCard<
  TTransport extends TransportOfferInput = TransportOfferInput,
  THotel extends HotelOfferInput = HotelOfferInput,
> {
  transport: TTransport;
  hotel: THotel & { bestOffer: AccommodationPriceInput };
  stay?: HotelSearchInput["stay"];
  price: TripCardPrice;
  warnings: TripCardWarning[];
  selectedDestination?: SelectedDestination;
}

const EARLIEST_CONVENIENT_TIME_HOUR = 8;
const LATEST_CONVENIENT_ARRIVAL_HOUR = 22;

export type TripCardSkipReason =
  | "no_transport_offers"
  | "no_accommodation_offers"
  | "unsupported_accommodation_price_basis"
  | "currency_mismatch";

export type BuildTripCardResult<
  TTransport extends TransportOfferInput = TransportOfferInput,
  THotel extends HotelOfferInput = HotelOfferInput,
> =
  | { status: "built"; card: TripCard<TTransport, THotel> }
  | { status: "skipped"; reason: "no_transport_offers" }
  | { status: "skipped"; reason: "no_accommodation_offers" }
  | {
      status: "skipped";
      reason: "unsupported_accommodation_price_basis";
      priceBasis: string | undefined;
    }
  | {
      status: "skipped";
      reason: "currency_mismatch";
      currencies: { transport: string; accommodation: string };
    };

export function buildTripCard<
  TTransport extends TransportOfferInput,
  THotel extends HotelOfferInput,
>(
  transportSearch: TransportSearchInput<TTransport>,
  hotelSearch: HotelSearchInput<THotel>,
): BuildTripCardResult<TTransport, THotel> {
  const transport = transportSearch.variants[0];
  if (!transport) {
    return { status: "skipped", reason: "no_transport_offers" };
  }

  const hotel = hotelSearch.hotels.find(hasAccommodationOffer);
  if (!hotel) {
    return { status: "skipped", reason: "no_accommodation_offers" };
  }

  const accommodation = hotel.bestOffer;
  if (accommodation.priceBasis !== "stay_total") {
    return {
      status: "skipped",
      reason: "unsupported_accommodation_price_basis",
      priceBasis: accommodation.priceBasis,
    };
  }

  const transportCurrency = transport.price.currency;
  const accommodationCurrency = accommodation.price.currency;
  if (transportCurrency !== accommodationCurrency) {
    return {
      status: "skipped",
      reason: "currency_mismatch",
      currencies: {
        transport: transportCurrency,
        accommodation: accommodationCurrency,
      },
    };
  }

  return {
    status: "built",
    card: {
      transport,
      hotel,
      stay: hotelSearch.stay,
      warnings: consistencyWarnings(transport),
      selectedDestination: selectedDestination(transportSearch.meta?.to),
      price: {
        total: {
          amount: addPriceAmounts(
            transport.price.amount,
            accommodation.price.amount,
          ),
          currency: transportCurrency,
          computed: true,
        },
        breakdown: {
          transport: {
            ...transport.price,
            label: transportLabel(transport),
          },
          accommodation: {
            ...accommodation.price,
            label: accommodationLabel(hotelSearch.stay?.nights),
            priceBasis: "stay_total",
          },
        },
      },
    },
  };
}

function consistencyWarnings(
  transport: TransportOfferInput,
): TripCardWarning[] {
  const warnings: TripCardWarning[] = [];
  const arrivalMinutes = localMinutesSinceMidnight(transport.arrivalAt);
  const departureMinutes = localMinutesSinceMidnight(transport.departureAt);
  const earlyTimeMinutes = EARLIEST_CONVENIENT_TIME_HOUR * 60;
  const lateArrivalMinutes = LATEST_CONVENIENT_ARRIVAL_HOUR * 60;

  if (arrivalMinutes !== undefined && arrivalMinutes < earlyTimeMinutes) {
    warnings.push({
      code: "early_arrival",
      message: `Раннее прибытие: заселение до ${formatHour(EARLIEST_CONVENIENT_TIME_HOUR)} может быть недоступно`,
      computed: true,
    });
  } else if (
    arrivalMinutes !== undefined &&
    arrivalMinutes > lateArrivalMinutes
  ) {
    warnings.push({
      code: "late_arrival",
      message: `Позднее прибытие: заселение после ${formatHour(LATEST_CONVENIENT_ARRIVAL_HOUR)} может быть недоступно`,
      computed: true,
    });
  }

  if (departureMinutes !== undefined && departureMinutes < earlyTimeMinutes) {
    warnings.push({
      code: "early_departure",
      message: `Ранний отъезд: выселение до ${formatHour(EARLIEST_CONVENIENT_TIME_HOUR)} может быть затруднено`,
      computed: true,
    });
  }

  return warnings;
}

function localMinutesSinceMidnight(isoDateTime: string | undefined) {
  if (isoDateTime === undefined) return undefined;
  const match = /T(\d{2}):(\d{2})/.exec(isoDateTime);
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function selectedDestination(
  destination: SelectedDestinationInput | undefined,
): SelectedDestination | undefined {
  if (!destination) return undefined;
  const alsoNamed = destination.alsoNamed ?? destination.also_named;

  return {
    name: destination.name,
    region: destination.region ?? null,
    ...(alsoNamed === undefined ? {} : { alsoNamed }),
  };
}

function addPriceAmounts(first: number, second: number): number {
  const minorUnitsPerUnit = 100;
  return (
    (Math.round(first * minorUnitsPerUnit) +
      Math.round(second * minorUnitsPerUnit)) /
    minorUnitsPerUnit
  );
}

function transportLabel(transport: TransportOfferInput): string {
  const labels = new Set(transport.legs?.map(({ label }) => label));
  return labels.has("outbound") && labels.has("return")
    ? "Дорога туда-обратно"
    : "Дорога";
}

function hasAccommodationOffer<THotel extends HotelOfferInput>(
  hotel: THotel,
): hotel is THotel & { bestOffer: AccommodationPriceInput } {
  return hotel.bestOffer !== undefined;
}

function accommodationLabel(nights: number | undefined): string {
  if (nights === undefined) return "Жильё";
  return `Жильё за ${nights} ${nightWord(nights)}`;
}

function nightWord(nights: number): string {
  const lastTwoDigits = Math.abs(nights) % 100;
  const lastDigit = lastTwoDigits % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return "ночей";
  if (lastDigit === 1) return "ночь";
  if (lastDigit >= 2 && lastDigit <= 4) return "ночи";
  return "ночей";
}
