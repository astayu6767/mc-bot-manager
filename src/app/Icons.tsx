// Shared SVG icon set — one consistent stroke style for the whole app.
// (Replaces emoji icons that render differently per OS and look casual.)

type P = { size?: number; className?: string };

function base(size: number, className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ChartIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M3 3v18h18" />
    <path d="M7 15l4-6 3 3 5-8" />
  </>);
}

export function UsersIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>);
}

export function TicketStarIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z" />
    <path d="M13 5v2M13 11v2M13 17v2" />
  </>);
}

export function KeyIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2 20 3M17 6l3 3M14 9l2 2" />
  </>);
}

export function CartIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
  </>);
}

export function LockIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>);
}

export function PlusIcon({ size = 18, className }: P) {
  return base(size, className, <path d="M12 5v14M5 12h14" />);
}

export function TrashIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </>);
}

export function BellIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </>);
}
