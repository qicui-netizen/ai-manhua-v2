"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadCharacters } from "@/lib/store";
import type { Character } from "@/lib/types";

export default function CharacterLibraryPage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      const list = loadCharacters();
      setCharacters(list);
      setSelected((prev) => prev || list[0]?.id || null);
    };
    refresh();
    window.addEventListener("pf:update", refresh);
    return () => window.removeEventListener("pf:update", refresh);
  }, []);

  const selectedChar = characters.find((c) => c.id === selected);

  return (
    <div className="flex min-h-full flex-col pb-24">
      <div className="flex items-center justify-between px-5 pt-8 pb-3">
        <h1 className="text-xl font-extrabold text-[var(--color-text)]">角色库</h1>
        <Link href="/characters/new" className="pf-btn pf-btn-primary !min-h-9 !py-2 !px-4 text-sm">
          + 新建角色
        </Link>
      </div>

      <div className="flex-1 px-5">
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[rgba(124,58,237,0.25)] bg-[rgba(124,58,237,0.1)] p-3.5">
          <span className="flex-shrink-0 text-base">💡</span>
          <p className="text-xs leading-relaxed text-[var(--color-text-sub)]">
            上传照片或从系统预设头像建卡后，生成时 AI 会用这张图锁定角色一致性。没有参考图的角色暂时无法出图。
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {characters.map((c) => (
            <div
              key={c.id}
              onClick={() => setSelected(c.id)}
              className="pf-card cursor-pointer"
              style={{ borderColor: selected === c.id ? "rgba(124,58,237,0.5)" : undefined }}
            >
              <div className="flex items-center gap-3.5">
                <div className="h-15 w-15 flex-shrink-0 overflow-hidden rounded-full border-2 border-[rgba(124,58,237,0.4)]">
                  {c.referenceImages[0]?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.referenceImages[0].url} alt={c.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[var(--color-surface-2)] text-2xl">👤</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[15px] font-bold text-[var(--color-text)]">{c.name}</span>
                    <span className="rounded-full bg-[rgba(124,58,237,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary-light)]">
                      {c.ownershipType === "original_oc" ? "OC" : "同人"}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-sub)]">{c.ageFeel}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.referenceImages.length === 0 && (
                      <span className="rounded-full border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-2 py-0.5 text-[10px] text-[var(--color-error)]">
                        ⚠️ 缺少参考图
                      </span>
                    )}
                    {(["face", "hair", "outfit", "color"] as const).map(
                      (k) =>
                        c.lockedTraits[k] === "强锁定" && (
                          <span
                            key={k}
                            className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] text-[var(--color-text-dim)]"
                          >
                            🔒 {k === "face" ? "面部" : k === "hair" ? "发色" : k === "outfit" ? "服装" : "配色"}
                          </span>
                        )
                    )}
                  </div>
                </div>
                {selected === c.id && (
                  <span className="flex-shrink-0 rounded-full bg-[rgba(124,58,237,0.2)] px-2 py-1 text-[10px] font-semibold text-[var(--color-primary-light)]">
                    已选
                  </span>
                )}
              </div>
            </div>
          ))}

          <Link
            href="/characters/new"
            className="flex items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed border-[var(--color-border-light)] p-5 text-[var(--color-text-dim)]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="text-sm">创建新角色卡</span>
          </Link>
        </div>
      </div>

      {selectedChar && (
        <div className="fixed bottom-20 left-0 right-0 mx-auto max-w-md bg-gradient-to-t from-[var(--color-bg)] from-80% to-transparent px-5 pb-8 pt-3 sm:absolute">
          <button
            onClick={() => router.push(`/create?character=${selectedChar.id}`)}
            className="pf-btn pf-btn-primary w-full"
          >
            用「{selectedChar.name}」开始创作 →
          </button>
        </div>
      )}
    </div>
  );
}
