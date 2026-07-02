"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "工作台", match: (p: string) => p === "/" },
  { href: "/characters", label: "角色库", match: (p: string) => p.startsWith("/characters") },
  { href: "/export", label: "导出", match: (p: string) => p.startsWith("/export") },
  { href: "/profile", label: "我的", match: (p: string) => p.startsWith("/profile") },
];

const ICONS: Record<string, React.ReactNode> = {
  工作台: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
      <path d="M9 21V12h6v9" />
    </svg>
  ),
  角色库: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  导出: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v13M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  ),
  我的: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="7" r="4" />
      <path d="M5.5 21a7.5 7.5 0 0113 0" />
    </svg>
  ),
};

export default function TabBar() {
  const pathname = usePathname();
  return (
    <div className="flex items-center justify-around border-t border-[var(--color-border)] bg-[var(--color-surface)] py-2 pb-7">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="flex min-h-11 min-w-15 flex-col items-center justify-center gap-0.5 p-1"
          >
            <span className={active ? "text-[var(--color-primary-light)] drop-shadow-[0_0_6px_rgba(124,58,237,0.6)]" : "text-[var(--color-text-dim)]"}>
              {ICONS[t.label]}
            </span>
            <span className={`text-xs font-medium ${active ? "text-[var(--color-primary-light)]" : "text-[var(--color-text-dim)]"}`}>
              {t.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
