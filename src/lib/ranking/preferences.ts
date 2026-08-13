import { DEFAULT_WEIGHTS, FEATURE_NAMES, type FeatureName } from "./features";

const MIN_REACTION_COUNT = 3;
const MIN_WEIGHT_DEVIATION = 0.5;
const MIN_FEATURE_SPREAD = 0.1;
const MAX_SUMMARY_ITEMS = 3;

/**
 * Признаки, о которых не говорим вслух, потому что они дублируют скорость.
 *
 * Замер 13 августа на живой ленте: корреляция длительности с признаком «поезд»
 * +0.89, с признаком «самолёт» −0.85, а на Москва → Казань и вовсе +1.00 —
 * самолёт всегда быстрее поезда, вид транспорта и время в пути несут один и
 * тот же сигнал. Модель считает веса независимыми (диагональная ковариация,
 * KTD5), поэтому сигнал «быстро» размазывается по трём признакам и знаки у
 * транспортных расходятся: после лайков быстрым вариантам выжимка выдавала
 * разом «предпочитаете быстрые поездки» и «реже выбираете самолёт».
 *
 * На ранжирование это влияет терпимо — вес скорости просто утроен, — а вот как
 * утверждение о вкусе человека это неправда. Скорость показываем одним
 * признаком shortTravel, вид транспорта оставляем модели.
 *
 * Функцией, а не множеством: проверка границ запрещает Map и Set на уровне
 * модуля, потому что они переживают HTTP-ответ в тёплом процессе.
 */
function isHiddenFeature(feature: FeatureName): boolean {
  return feature === "airTransport" || feature === "railTransport";
}

interface PreferencePhrase {
  positive: string;
  negative: string;
}

const PREFERENCE_PHRASES: Record<FeatureName, PreferencePhrase> = {
  affordability: {
    positive: "избегаете дорогих вариантов",
    negative: "готовы рассматривать более дорогие варианты",
  },
  shortTravel: {
    positive: "предпочитаете быстрые поездки",
    negative: "не против долгой дороги",
  },
  directness: {
    positive: "предпочитаете маршруты без пересадок",
    negative: "не против маршрутов с пересадками",
  },
  airTransport: {
    positive: "чаще выбираете самолёт",
    negative: "реже выбираете самолёт",
  },
  railTransport: {
    positive: "чаще выбираете поезд",
    negative: "реже выбираете поезд",
  },
  hotelStars: {
    positive: "предпочитаете отели высокой категории",
    negative: "категория отеля для вас не главное",
  },
  hotelRating: {
    positive: "выбираете жильё с высоким рейтингом",
    negative: "рейтинг жилья для вас не главное",
  },
  urbanLocation: {
    positive: "чаще выбираете города",
    negative: "реже выбираете городские направления",
  },
  leisureLocation: {
    positive: "чаще выбираете курортные направления",
    negative: "реже выбираете курортные направления",
  },
};

/**
 * Переводит состояние модели в короткую и осторожную выжимку для человека.
 *
 * Три реакции — тот же минимум подтверждений, который уже используется в
 * объяснениях карточки: одного-двух жестов недостаточно, чтобы называть их
 * вкусом. Отклонение 0.5 близко к одному стандартному отклонению исходного
 * prior байесовской модели (~0.59), поэтому отсекает небольшие колебания вокруг
 * начальных весов. Признак также должен различать карточки хотя бы на 0.1:
 * высокий вес бесполезен и не является наблюдаемым предпочтением, если вся
 * текущая лента по этому признаку одинакова.
 */
export function summarizePreferences(
  weights: readonly number[],
  reactionCount: number,
  featureSpreads: readonly number[],
): string[] {
  if (reactionCount < MIN_REACTION_COUNT) return [];

  return FEATURE_NAMES.map((feature, index) => {
    const deviation = (weights[index] ?? DEFAULT_WEIGHTS[index]!) -
      DEFAULT_WEIGHTS[index]!;
    const spread = featureSpreads[index] ?? 0;
    return {
      feature,
      deviation,
      spread,
      significance: Math.abs(deviation) * spread,
    };
  })
    .filter(
      ({ feature, deviation, spread }) =>
        !isHiddenFeature(feature) &&
        Math.abs(deviation) >= MIN_WEIGHT_DEVIATION &&
        spread >= MIN_FEATURE_SPREAD,
    )
    .sort((left, right) => right.significance - left.significance)
    .slice(0, MAX_SUMMARY_ITEMS)
    .map(({ feature, deviation }) =>
      deviation > 0
        ? PREFERENCE_PHRASES[feature].positive
        : PREFERENCE_PHRASES[feature].negative,
    );
}
