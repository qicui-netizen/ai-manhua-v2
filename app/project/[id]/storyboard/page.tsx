"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getProject, saveProject } from "@/lib/store";
import type { Project, Panel } from "@/lib/types";

const BEAT_COLORS: Record<string, string> = { 起: "#3B82F6", 承: "#10B981", 转: "#F59E0B", 合: "#EC4899" };

export default function StoryboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    setProject(getProject(id) || null);
  }, [id]);

  function updatePanel(idx: number, field: keyof Panel, value: string) {
    if (!project) return;
    const next = [...project.panels];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next[idx] as any)[field] = value;
    const updated = { ...project, panels: next };
    setProject(updated);
    saveProject(updated);
  }

  if (project === undefined) return <div className="flex min-h-full items-center justify-center"><div className="pf-spinner" /></div>;
  if (project === null) return <div className="flex min-h-full items-center justify-center text-[var(--color-text-dim)]">项目不存在</div>;

  const templateLabel = project.templateType === "4_panel" ? "4格" : project.templateType === "9_panel" ? "9格" : "条漫";

  return (
    <div className="flex min-h-full flex-col pb-32">
      <div className="flex items-center justify-between px-5 pt-8 pb-2">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push("/")} className="h-9 w-9">
            <svg width="10" height="17" viewBox="0 0 10 17" fill="none">
              <path d="M9 1L1 8.5L9 16" stroke="var(--color-primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-lg font-extrabold text-[var(--color-text)]">{project.title}</h1>
        </div>
        <span className="rounded-full bg-[var(--color-primary-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-primary)]">
          {templateLabel}
        </span>
      </div>

      <div className="flex-1 px-5">
        <div className="mb-3 flex flex-col gap-2.5">
          {project.panels.map((p, idx) => (
            <div key={p.panelId} className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <button
                onClick={() => setEditingId(editingId === p.panelId ? null : p.panelId)}
                className="flex w-full items-center gap-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-2.5"
              >
                <div
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold"
                  style={{ borderColor: `${BEAT_COLORS[p.beat]}55`, background: `${BEAT_COLORS[p.beat]}22`, color: BEAT_COLORS[p.beat] }}
                >
                  {p.beat}
                </div>
                <span className="text-[13px] font-bold text-[var(--color-text)]">第 {idx + 1} 格</span>
                <span className="flex-1 truncate text-left text-xs text-[var(--color-text-dim)]">{p.scene}</span>
                {p.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
                )}
              </button>
              {editingId === p.panelId && (
                <div className="flex flex-col gap-2.5 p-3.5">
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--color-text-dim)]">场景描述</label>
                    <input className="pf-input text-sm" value={p.scene} onChange={(e) => updatePanel(idx, "scene", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--color-text-dim)]">对白</label>
                    <input className="pf-input text-sm" maxLength={28} value={p.dialogue} onChange={(e) => updatePanel(idx, "dialogue", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--color-text-dim)]">旁白</label>
                    <input className="pf-input text-sm" maxLength={35} value={p.caption} onChange={(e) => updatePanel(idx, "caption", e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 mx-auto max-w-md bg-gradient-to-t from-[var(--color-bg)] from-75% to-transparent px-5 pb-9 pt-3 sm:absolute">
        <button onClick={() => router.push(`/project/${id}/generate`)} className="pf-btn pf-btn-primary w-full">
          {project.panels.some((p) => p.status === "done") ? "查看/继续生成 →" : "开始生成图片 →"}
        </button>
      </div>
    </div>
  );
}
