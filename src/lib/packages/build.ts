export interface MoneyInput {
  amount: number;
  currency: string;
}

export interface TransportOfferInput {
  price: MoneyInput;
  legs?: readonly { label?: string }[];
}

export interface AccommodationPriceInput {
  price: MoneyInput;
  priceBasis?: string;
}

export interface HotelOfferInput {
  bestOffer?: AccommodationPriceInput;
}

export interface TransportSearchInput<
  TTransport extends TransportOfferInput = TransportOfferInput,
> {
  variants: readonly TTransport[];
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

export interface TripCard<
  TTransport extends TransportOfferInput = TransportOfferInput,
  THotel extends HotelOfferInput = HotelOfferInput,
> {
  transport: TTransport;
  hotel: THotel & { bestOffer: AccommodationPriceInput };
  stay?: HotelSearchInput["stay"];
  price: TripCardPrice;
}

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
