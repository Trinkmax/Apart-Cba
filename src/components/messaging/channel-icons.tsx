import { cn } from "@/lib/utils";

interface IconProps {
  className?: string;
}

export function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn(className)} aria-hidden>
      <path
        fill="#25D366"
        d="M16 0a16 16 0 0 0-13.4 24.8L0 32l7.5-2.4A16 16 0 1 0 16 0z"
      />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M11.6 8.7c-.3-.6-.5-.6-.8-.6h-.8c-.3 0-.7.1-1 .5s-1.4 1.4-1.4 3.3 1.4 3.8 1.6 4.1c.2.3 2.7 4.4 6.7 6 3.3 1.3 4 1 4.7.9.7-.1 2.2-.9 2.5-1.8.3-.9.3-1.6.2-1.8-.1-.2-.4-.3-.8-.5-.4-.2-2.4-1.2-2.8-1.3-.4-.2-.7-.2-.9.2-.3.4-1 1.3-1.3 1.5-.2.3-.4.3-.8.1-.4-.2-1.7-.6-3.2-2-1.2-1-2-2.4-2.2-2.8-.3-.4 0-.6.2-.8.2-.2.4-.4.6-.7l.3-.5c.1-.2 0-.4-.1-.6 0-.1-.9-2.2-1.2-3z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function InstagramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={cn(className)} aria-hidden>
      <defs>
        <linearGradient id="ig-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FED576" />
          <stop offset=".26" stopColor="#F47133" />
          <stop offset=".61" stopColor="#BC3081" />
          <stop offset="1" stopColor="#4C63D2" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="8" fill="url(#ig-grad)" />
      <rect x="6.5" y="6.5" width="19" height="19" rx="5.5" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="16" cy="16" r="4.6" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="22" cy="10" r="1.3" fill="#fff" />
    </svg>
  );
}
