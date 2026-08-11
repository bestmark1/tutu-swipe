export function SiteHeader() {
  return (
    <header className="bg-indigo px-4 py-4 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
        <span className="text-lg font-bold tracking-tight text-ink-on-dark">
          tutu<span className="text-action">·</span>swipe
        </span>
        <span className="text-xs text-ink-on-dark/80">
          подбор путешествий
        </span>
      </div>
    </header>
  );
}
