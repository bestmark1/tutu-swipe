import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="bg-indigo px-4 py-4 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <Link
          href="/swipe"
          className="text-lg font-bold tracking-tight text-ink-on-dark"
        >
          tutu<span className="text-action">·</span>swipe
        </Link>
        <nav
          aria-label="Основная навигация"
          className="flex items-center gap-4 text-xs text-ink-on-dark/80"
        >
          <span className="hidden sm:inline">подбор путешествий</span>
          <Link
            href="/help"
            className="rounded-sm px-1 py-1 font-medium underline decoration-white/35 underline-offset-4 transition hover:text-ink-on-dark"
          >
            Помощь
          </Link>
        </nav>
      </div>
    </header>
  );
}
