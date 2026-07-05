"use client";
import { usePathname } from "next/navigation";
import TabBar from "./TabBar";

const TAB_ROUTES = ["/", "/characters", "/export", "/profile"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showTabBar = TAB_ROUTES.includes(pathname);
  const useComicStyle = showTabBar;
  const classicVars = {
    "--color-primary": "#7c3aed",
    "--color-primary-light": "#8b5cf6",
    "--color-primary-dark": "#6d28d9",
    "--color-primary-bg": "#ede9fe",
    "--color-accent": "#f59e0b",
    "--color-accent-bg": "#fef3c7",
    "--color-bg": "#0f0f13",
    "--color-surface": "#1a1a24",
    "--color-surface-2": "#24243a",
    "--color-border": "#2e2e48",
    "--color-border-light": "#3d3d60",
    "--color-text": "#f1f0ff",
    "--color-text-sub": "#a09dc0",
    "--color-text-dim": "#5e5c80",
  } as React.CSSProperties;

  return (
    <div
      style={useComicStyle ? undefined : classicVars}
      className={`relative mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-hidden sm:my-4 sm:min-h-screen sm:rounded-[32px] sm:shadow-2xl ${
        useComicStyle
          ? "pf-app-shell sm:border sm:border-white/20"
          : "pf-classic-shell bg-[var(--color-bg)] sm:border sm:border-[var(--color-border)]"
      }`}
    >
      {useComicStyle && (
        <>
          <div className="pf-panel-ghost one" aria-hidden="true" />
          <div className="pf-panel-ghost two" aria-hidden="true" />
          <div className="pf-panel-ghost three" aria-hidden="true" />
          <div className="pf-burst pow" aria-hidden="true">POW</div>
          <div className="pf-burst boom" aria-hidden="true">BOOM</div>
          <div className="pf-spark a" aria-hidden="true" />
          <div className="pf-spark b" aria-hidden="true" />
          <div className="pf-spark c" aria-hidden="true" />
          <div className="pf-diamond d1" aria-hidden="true" />
          <div className="pf-diamond d2" aria-hidden="true" />
          <div className="pf-diamond d3" aria-hidden="true" />
          <div className="pf-glow-orb o1" aria-hidden="true" />
          <div className="pf-glow-orb o2" aria-hidden="true" />
        </>
      )}
      <div className="relative flex-1 overflow-y-auto">{children}</div>
      {showTabBar && <TabBar />}
      {!useComicStyle && (
        <style jsx global>{`
          .pf-classic-shell {
            background: #0f0f13 !important;
            color: #f1f0ff !important;
          }
          .pf-classic-shell .pf-card {
            --color-text: #f1f0ff !important;
            --color-text-sub: #a09dc0 !important;
            --color-text-dim: #5e5c80 !important;
            --color-surface: #1a1a24 !important;
            --color-surface-2: #24243a !important;
            --color-border: #2e2e48 !important;
            background: #1a1a24 !important;
            border: 1px solid #2e2e48 !important;
            border-radius: 16px !important;
            box-shadow: none !important;
            color: #f1f0ff !important;
          }
          .pf-classic-shell .pf-input {
            background: #24243a !important;
            border: 1px solid #3d3d60 !important;
            border-radius: 12px !important;
            box-shadow: none !important;
            color: #f1f0ff !important;
          }
          .pf-classic-shell .pf-input::placeholder {
            color: #5e5c80 !important;
          }
          .pf-classic-shell .pf-chip {
            background: #24243a !important;
            border: 1px solid #2e2e48 !important;
            color: #a09dc0 !important;
            font-weight: 400 !important;
          }
          .pf-classic-shell .pf-chip.active {
            background: #ede9fe !important;
            border-color: #7c3aed !important;
            color: #7c3aed !important;
          }
          .pf-classic-shell .pf-btn {
            border-radius: 12px !important;
            font-weight: 600 !important;
          }
          .pf-classic-shell .pf-btn-primary {
            background: linear-gradient(135deg, #7c3aed, #6d28d9) !important;
            border: none !important;
            box-shadow: 0 0 20px rgba(124, 58, 237, 0.35) !important;
            color: #fff !important;
          }
          .pf-classic-shell .pf-btn-secondary {
            background: #24243a !important;
            border: 1px solid #3d3d60 !important;
            box-shadow: none !important;
            color: #f1f0ff !important;
          }
        `}</style>
      )}
    </div>
  );
}
