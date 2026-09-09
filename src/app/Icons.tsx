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

export function SwordsIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
    <path d="M13 19l6-6M16 16l4 4M19 21l2-2" />
    <path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
    <path d="M11 19l-6-6M8 16l-4 4M5 21l-2-2" />
  </>);
}

export function MegaphoneIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z" />
    <path d="M15 8a4 4 0 0 1 0 8M18 5a8 8 0 0 1 0 14" />
  </>);
}

export function BrainIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M9.5 2A3.5 3.5 0 0 0 6 5.5 3.5 3.5 0 0 0 3 9a3.5 3.5 0 0 0 1.5 2.9A3.5 3.5 0 0 0 5 18a3.5 3.5 0 0 0 4.5 3.4V2z" />
    <path d="M14.5 2A3.5 3.5 0 0 1 18 5.5 3.5 3.5 0 0 1 21 9a3.5 3.5 0 0 1-1.5 2.9A3.5 3.5 0 0 1 19 18a3.5 3.5 0 0 1-4.5 3.4V2z" />
  </>);
}

export function GearIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>);
}

export function MessageIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </>);
}

export function TargetIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </>);
}

export function EyeIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </>);
}

export function BotFaceIcon({ size = 18, className }: P) {
  return base(size, className, <>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 4v4M9 14h.01M15 14h.01" />
  </>);
}
