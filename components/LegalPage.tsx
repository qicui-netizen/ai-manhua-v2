"use client";
import { useRouter } from "next/navigation";
import LegalDocView from "@/components/LegalDocView";
import type { LegalDoc } from "@/lib/legal";

// /terms 与 /privacy 独立页共用壳:返回键 + 标题 + 正文
export default function LegalPage({ doc }: { doc: LegalDoc }) {
  const router = useRouter();
  return (
    <div className="flex min-h-full flex-col">
      <div className="px-5 pt-8 pb-4">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
            aria-label="返回"
            className="-ml-2 flex h-9 w-9 items-center justify-center"
          >
            <svg width="10" height="17" viewBox="0 0 10 17" fill="none">
              <path d="M9 1L1 8.5L9 16" stroke="var(--color-primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-xl font-extrabold text-[var(--color-text)]">{doc.title}</h1>
        </div>
      </div>
      <div className="flex-1 px-5">
        <LegalDocView doc={doc} />
      </div>
    </div>
  );
}
