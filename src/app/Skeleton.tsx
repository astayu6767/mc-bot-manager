// Content-shaped skeleton blocks — loads feel instant instead of spinner-y.

export function SkeletonRow({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-slate-800/70 ${className}`}
      aria-hidden="true"
    />
  );
}

// A skeleton that matches a bot card (avatar + lines + buttons).
export function SkeletonBotCard() {
  return (
    <div className="glass rounded-2xl p-4 shadow-lg shadow-black/20">
      <div className="flex items-start gap-3">
        <SkeletonRow className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex-1 space-y-2.5 pt-1">
          <SkeletonRow className="h-4 w-1/3" />
          <SkeletonRow className="h-3 w-1/2" />
        </div>
        <div className="hidden gap-2 sm:flex">
          <SkeletonRow className="h-8 w-16" />
          <SkeletonRow className="h-8 w-16" />
          <SkeletonRow className="h-8 w-8" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonBotList({ n = 3 }: { n?: number }) {
  return (
    <ul className="grid gap-4" aria-busy="true" aria-label="Loading bots">
      {Array.from({ length: n }, (_, i) => (
        <SkeletonBotCard key={i} />
      ))}
    </ul>
  );
}

// Generic panel skeleton (stats + a block).
export function SkeletonPanel() {
  return (
    <div className="animate-fade-in space-y-6" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3">
        <SkeletonRow className="h-11 w-11 rounded-xl" />
        <div className="space-y-2">
          <SkeletonRow className="h-5 w-36" />
          <SkeletonRow className="h-3 w-52" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SkeletonRow className="h-20" />
        <SkeletonRow className="h-20" />
        <SkeletonRow className="h-20" />
      </div>
      <SkeletonRow className="h-40" />
    </div>
  );
}

// Table-shaped skeleton for lists of rows.
export function SkeletonTable({ n = 5 }: { n?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading rows">
      {Array.from({ length: n }, (_, i) => (
        <SkeletonRow key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
