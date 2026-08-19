import type { Metadata } from "next";
import Link from "next/link";

const examples = [
  "из Москвы на море в сентябре вдвоём до 60 тысяч",
  "из Санкт-Петербурга 16 сентября на 7 дней втроём в Казань",
  "из Москвы втроём на Алтай в начале октября бюджет до 30 000",
] as const;

const labels = [
  {
    label: "· подставлено",
    description:
      "Так отмечен параметр, которого не было во фразе. Мы взяли обычное значение, чтобы начать поиск. Нажмите на чип, уточните фразу и повторите поиск, если значение не подходит.",
  },
  {
    label: "Учли по реакциям",
    description:
      "Здесь коротко написано, какие предпочтения стали заметны по вашим лайкам и дизлайкам.",
  },
  {
    label: "Предварительный вариант на близкие даты",
    description:
      "Первый экран собран из недавно полученных вариантов, поэтому может быть на соседние даты. Точный вариант на ваши даты подгружается следом.",
  },
  {
    label: "Цена получена N часов назад",
    description:
      "Подпись показывает возраст цены. Если рядом написано «данные могут быть устаревшими», перед переходом стоит особенно внимательно проверить итог.",
  },
  {
    label: "Дороже вашего бюджета на N ₽",
    description:
      "Такой вариант остаётся в ленте, когда вы сами назвали это направление. Мы показываем найденную поездку, но честно отмечаем превышение.",
  },
  {
    label: "Крым мы пока не подбираем",
    description:
      "Направление распознано, но сейчас для него нельзя собрать надёжный готовый вариант.",
  },
  {
    label: "Часть направлений не ответила",
    description:
      "Поиск продолжился, но получить данные удалось не по всем городам. Остальные найденные поездки можно смотреть как обычно.",
  },
] as const;

export const metadata: Metadata = {
  title: "Как пользоваться tutu-swipe",
  description:
    "Как описать поездку одной фразой, читать подписи в ленте и использовать реакции.",
};

export default function HelpPage() {
  return (
    <main className="flex-1 bg-canvas px-4 py-8 text-ink sm:px-8 sm:py-12">
      <article className="mx-auto w-full max-w-3xl">
        <header className="rounded-xl bg-action-soft px-5 py-7 sm:px-8 sm:py-9">
          <p className="text-sm font-semibold text-action-strong">Помощь</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Как пользоваться tutu·swipe
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-ink-muted sm:text-lg">
            Опишите поездку обычной фразой вместо заполнения формы. Вы получите
            готовые варианты, где дорога и жильё уже собраны вместе. Это удобно,
            если вы знаете пожелания, но ещё не выбрали точный маршрут.
          </p>
        </header>

        <section className="mt-10" aria-labelledby="phrase-heading">
          <h2
            id="phrase-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Как описать поездку
          </h2>
          <p className="mt-3 leading-7 text-ink-muted">
            Пишите так, как рассказали бы о поездке знакомому. Например:
          </p>
          <ul className="mt-5 space-y-3">
            {examples.map((example) => (
              <li
                key={example}
                className="rounded-lg border border-divider bg-field px-4 py-3 leading-7"
              >
                «{example}»
              </li>
            ))}
          </ul>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Detail title="Откуда">из Москвы, из Санкт-Петербурга</Detail>
            <Detail title="Сколько человек">
              втроём, 3 человека, нас трое, семьёй из четырёх
            </Detail>
            <Detail title="Когда">
              в сентябре, 16 сентября, на 7 дней
            </Detail>
            <Detail title="Бюджет">
              до 60к, до 30 000, 30000 рублей
            </Detail>
            <Detail title="Настроение">на море, в горы</Detail>
            <Detail title="Точное место">на Алтай, на Байкал, в Карелию</Detail>
          </div>

          <p className="mt-5 rounded-md border-l-4 border-action bg-surface px-4 py-3 leading-7 text-ink-muted shadow-card">
            Если назвать конкретный город или регион, подбор будет только по
            нему и не добавит другие города.
          </p>
        </section>

        <section className="mt-12" aria-labelledby="labels-heading">
          <h2
            id="labels-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Что означают подписи в ленте
          </h2>
          <dl className="mt-5 space-y-4">
            {labels.map(({ label, description }) => (
              <div
                key={label}
                className="rounded-lg border border-divider bg-surface p-5 shadow-card"
              >
                <dt className="font-semibold">«{label}»</dt>
                <dd className="mt-2 leading-7 text-ink-muted">{description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-12" aria-labelledby="reactions-heading">
          <h2
            id="reactions-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Как работают реакции
          </h2>
          <p className="mt-3 leading-7 text-ink-muted">
            Лайк и дизлайк меняют порядок следующих карточек. По реакциям лента
            постепенно учитывает подходящую цену, длительность дороги, тип места
            и качество жилья. Дизлайк можно отменить кнопкой «Отменить реакцию».
          </p>
          <p className="mt-3 leading-7 text-ink-muted">
            При новом поиске предпочтения сохраняются, пока длится текущая
            сессия. Аккаунтов здесь нет: после окончания сессии переносить эти
            предпочтения некуда.
          </p>
        </section>

        <section className="mt-12" aria-labelledby="tutu-heading">
          <h2
            id="tutu-heading"
            className="text-2xl font-semibold tracking-tight"
          >
            Что происходит при переходе на Туту
          </h2>
          <p className="mt-3 leading-7 text-ink-muted">
            Кнопка ведёт на Туту, где можно ещё раз проверить даты, пассажиров,
            наличие мест и перейти к оформлению. Цена в ленте относится к
            моменту получения данных. К моменту перехода наличие или стоимость
            могли измениться, поэтому окончательной считается сумма на странице
            Туту.
          </p>
        </section>

        <section
          className="mt-12 rounded-xl bg-indigo p-6 text-ink-on-dark sm:p-8"
          aria-labelledby="limits-heading"
        >
          <h2 id="limits-heading" className="text-2xl font-semibold">
            Ограничения
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-7 text-ink-on-dark/80">
            <li>Это неофициальный прототип, сделанный для хакатона Туту.</li>
            <li>Варианты поездок собираются из открытых данных Туту.</li>
            <li>Бронирование и оплата происходят на Туту, а не здесь.</li>
          </ul>
        </section>

        <footer className="mt-10 flex flex-col gap-3 border-t border-divider pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/swipe"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-action px-5 py-3 font-semibold text-white transition hover:bg-action-strong"
          >
            Перейти к ленте
          </Link>
          <a
            href="https://github.com/bestmark1/tutu-swipe/blob/main/docs/USER_GUIDE.md"
            className="text-sm font-medium text-action underline decoration-action/35 underline-offset-4 hover:text-action-strong"
          >
            Инструкция в репозитории
          </a>
        </footer>
      </article>
    </main>
  );
}

function Detail({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-field p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-ink-muted">{children}</p>
    </div>
  );
}
