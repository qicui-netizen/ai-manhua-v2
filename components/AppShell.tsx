"use client";
import { usePathname } from "next/navigation";
import TabBar from "./TabBar";

const TAB_ROUTES = ["/", "/characters", "/export", "/profile"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showTabBar = TAB_ROUTES.includes(pathname);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-[var(--color-bg)] sm:min-h-screen sm:my-4 sm:rounded-[32px] sm:border sm:border-[var(--color-border)] sm:shadow-2xl overflow-hidden">
      <div className="relative flex-1 overflow-y-auto">{children}</div>
      {showTabBar && <TabBar />}
    </div>
  );
}
