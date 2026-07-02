"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getProject, saveProject, loadCharacters, spendQuota } from "@/lib/store";
import { styleOf, platformOf } from "@/lib/data";
import { persistRemoteImage } from "@/lib/persistImage";
import type { Project, Character, Panel } from "@/lib/types";

type Phase = "generating" | "review" | "bubble";

// 批量生成在途标记(模块级):防止生成中离开再进入时并发触发第二次批量生成、双倍扣额度
const inFlightProjects = new Set<string>();
// genErrors 的全局错误键(panelId 从 1 开始,0 不会与任何格冲突)
const GLOBAL_ERROR_KEY = 0;

export default function GeneratePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [phase, setPhase] = useState<Phase>("generating");
  const [genErrors, setGenErrors] = useState<Record<number, string>>({});
  const [regenLoading, setRegenLoading] = useState<number | null>(null);
  const [selectedPanelIdx, setSelectedPanelIdx] = useState(0);

  useEffect(() => {
    const refresh = () => {
      const p = getProject(id);
      setProject(p || null);
      setCharacters(loadCharacters());
      // 只要跑过一轮(有成功或失败记录)就进预览,否则部分失败的项目重进会永远卡在"生成中"
      if (p && p.panels.some((pn) => pn.status === "done" || pn.status === "error")) {
        setPhase((prev) => (prev === "generating" ? "review" : prev));
      }
    };
    refresh();
    // 监听存储更新:若另一个在途批量生成完成落盘,本实例界面能跟着刷新
    window.addEventListener("pf:update", refresh);
    return () => window.removeEventListener("pf:update", refresh);
  }, [id]);

  useEffect(() => {
    if (!project || phase !== "generating") return;
    if (project.panels.some((p) => p.status === "done" || p.status === "error")) return; // 已经跑过一次

    const projChars = characters.filter((c) => project.characterIds.includes(c.id));
    const style = styleOf(project.styleId);
    const platform = platformOf(project.targetPlatform);

    async function run() {
      // 防止生成中离开再进入触发第二次批量生成(双倍扣额度、结果互相覆盖)
      if (inFlightProjects.has(id)) return;
      inFlightProjects.add(id);

      // 标记 loading
      const loadingPanels = project!.panels.map((p) => ({ ...p, status: "loading" as const }));
      setProject({ ...project!, panels: loadingPanels });

      try {
        const res = await fetch("/api/generate-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storySummary: project!.expandedPlot?.plot || project!.synopsis,
            panels: project!.panels,
            characters: projChars,
            styleLabel: style.name,
            aspectRatio: platform.ratio,
            layoutTemplate: project!.templateType === "4_panel" ? "4格" : project!.templateType === "9_panel" ? "9格" : "条漫",
          }),
        });
        const data = await res.json();
        const results: { panelId: number; status: "done" | "error"; imageUrl?: string; notes?: string }[] = data.results || [];

        const errors: Record<number, string> = {};
        // 生成图是临时签名URL,立即压缩转存为 data URL,否则数小时后过期、导出全裂
        const updatedPanels: Panel[] = await Promise.all(
          project!.panels.map(async (p) => {
            const r = results.find((x) => x.panelId === p.panelId);
            if (!r || r.status === "error" || !r.imageUrl) {
              errors[p.panelId] = r?.notes || "生成失败";
              return { ...p, status: "error" as const };
            }
            const persisted = await persistRemoteImage(r.imageUrl);
            return { ...p, status: "done" as const, imageUrl: persisted };
          })
        );

        const doneCount = updatedPanels.filter((p) => p.status === "done").length;
        spendQuota(doneCount);

        const updatedProject = { ...project!, panels: updatedPanels, status: "generated" as const };
        try {
          saveProject(updatedProject);
        } catch {
          errors[GLOBAL_ERROR_KEY] = "本地存储空间不足，图片可能无法长期保存";
        }
        setProject(updatedProject);
        setGenErrors(errors);
        setPhase("review");
      } catch {
        // 整体网络失败:把各格标记为 error 落盘,避免重进页面卡死在"生成中"
        const failedPanels = project!.panels.map((p) => ({ ...p, status: "error" as const }));
        const failedProject = { ...project!, panels: failedPanels };
        try {
          saveProject(failedProject);
        } catch {
          /* 存储失败时保持内存态即可 */
        }
        setProject(failedProject);
        setGenErrors({ [GLOBAL_ERROR_KEY]: "网络错误，生成失败，可逐格点击「重新生成」重试" });
        setPhase("review");
      } finally {
        inFlightProjects.delete(id);
      }
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, phase]);

  async function regeneratePanel(panelIdx: number) {
    // 全局互斥:并发重生成会基于旧快照互相覆盖,先完成的结果被后完成的丢掉
    if (!project || regenLoading !== null) return;
    setRegenLoading(panelIdx);
    const panel = project.panels[panelIdx];
    const projChars = characters.filter((c) => project.characterIds.includes(c.id));
    const style = styleOf(project.styleId);
    const platform = platformOf(project.targetPlatform);
    try {
      const res = await fetch("/api/generate-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storySummary: project.expandedPlot?.plot || project.synopsis,
          panel,
          characters: projChars,
          styleLabel: style.name,
          aspectRatio: platform.ratio,
          layoutTemplate: project.templateType === "4_panel" ? "4格" : project.templateType === "9_panel" ? "9格" : "条漫",
        }),
      });
      const data = await res.json();
      if (data.status === "done" && data.imageUrl) {
        const persisted = await persistRemoteImage(data.imageUrl);
        // 函数式更新拿最新面板,避免闭包旧快照覆盖别的格
        setProject((prev) => {
          if (!prev) return prev;
          const nextPanels = [...prev.panels];
          nextPanels[panelIdx] = { ...nextPanels[panelIdx], status: "done", imageUrl: persisted };
          const updated = { ...prev, panels: nextPanels };
          try {
            saveProject(updated);
          } catch {
            /* 存储超限时保持内存态 */
          }
          return updated;
        });
        setGenErrors((prev) => { const n = { ...prev }; delete n[panel.panelId]; return n; });
        spendQuota(1);
      } else {
        setGenErrors((prev) => ({ ...prev, [panel.panelId]: data.notes || "生成失败" }));
      }
    } catch {
      setGenErrors((prev) => ({ ...prev, [panel.panelId]: "网络异常，请重试" }));
    } finally {
      setRegenLoading(null);
    }
  }

  function updateBubble(idx: number, field: "dialogue" | "caption", value: string) {
    if (!project) return;
    const next = [...project.panels];
    next[idx] = { ...next[idx], [field]: value };
    const updated = { ...project, panels: next };
    setProject(updated);
    saveProject(updated);
  }

  if (project === undefined) {
    return <div className="flex min-h-full items-center justify-center"><div className="pf-spinner" /></div>;
  }
  if (project === null) {
    return <div className="flex min-h-full items-center justify-center text-[var(--color-text-dim)]">项目不存在</div>;
  }

  return (
    <div className="flex min-h-full flex-col pb-32">
      <div className="flex items-center justify-between px-5 pt-8 pb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push(`/project/${id}/storyboard`)} className="h-9 w-9">
            <svg width="10" height="17" viewBox="0 0 10 17" fill="none">
              <path d="M9 1L1 8.5L9 16" stroke="var(--color-primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-lg font-extrabold text-[var(--color-text)]">
            {phase === "generating" ? "生成中…" : phase === "review" ? "稿件预览" : "气泡编辑"}
          </h1>
        </div>
        {phase === "review" && (
          <button onClick={() => setPhase("bubble")} className="pf-btn pf-btn-secondary !min-h-9 !py-2 !px-4 text-sm">
            编辑气泡
          </button>
        )}
        {phase === "bubble" && (
          <button onClick={() => setPhase("review")} className="pf-btn pf-btn-secondary !min-h-9 !py-2 !px-4 text-sm">
            ← 预览
          </button>
        )}
      </div>

      <div className="flex-1 px-5">
        {phase === "generating" && <GeneratingView panels={project.panels} />}
        {phase === "review" && (
          <ReviewView project={project} genErrors={genErrors} regenLoading={regenLoading} onRegenerate={regeneratePanel} />
        )}
        {phase === "bubble" && (
          <BubbleEditorView
            panels={project.panels}
            selectedIdx={selectedPanelIdx}
            setSelectedIdx={setSelectedPanelIdx}
            onUpdate={updateBubble}
          />
        )}
      </div>

      {phase === "review" && (
        <div className="fixed bottom-0 left-0 right-0 mx-auto flex max-w-md gap-2.5 bg-gradient-to-t from-[var(--color-bg)] from-75% to-transparent px-5 pb-9 pt-3 sm:absolute">
          <button onClick={() => router.push(`/export?project=${id}`)} className="pf-btn pf-btn-primary w-full">
            导出稿件 →
          </button>
        </div>
      )}
      {phase === "bubble" && (
        <div className="fixed bottom-0 left-0 right-0 mx-auto max-w-md bg-gradient-to-t from-[var(--color-bg)] from-75% to-transparent px-5 pb-9 pt-3 sm:absolute">
          <button onClick={() => router.push(`/export?project=${id}`)} className="pf-btn pf-btn-primary w-full">
            确认气泡，去导出 →
          </button>
        </div>
      )}
    </div>
  );
}

function GeneratingView({ panels }: { panels: Panel[] }) {
  return (
    <div className="py-4">
      <div className="pf-card mb-4">
        <div className="flex items-center gap-3">
          <div className="pf-spinner" />
          <p className="text-sm font-semibold text-[var(--color-text)]">正在批量生成 {panels.length} 格，请稍候…</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 overflow-hidden rounded-2xl">
        {panels.map((p, i) => (
          <div key={p.panelId} className="relative flex aspect-[3/4] items-center justify-center bg-[var(--color-surface-2)]">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="pf-skeleton absolute inset-0" />
            )}
            <span className="absolute m-2 self-start justify-self-start rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
              第{i + 1}格
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewView({
  project,
  genErrors,
  regenLoading,
  onRegenerate,
}: {
  project: Project;
  genErrors: Record<number, string>;
  regenLoading: number | null;
  onRegenerate: (idx: number) => void;
}) {
  const doneCount = project.panels.filter((p) => p.status === "done").length;
  return (
    <div className="py-3">
      {genErrors[GLOBAL_ERROR_KEY] && (
        <div className="mb-3 rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-3 text-xs text-[var(--color-error)]">
          {genErrors[GLOBAL_ERROR_KEY]}
        </div>
      )}
      <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.1)] p-3">
        <span>✅</span>
        <div className="flex-1">
          <p className="text-[13px] font-bold text-[var(--color-success)]">
            成功 {doneCount} / {project.panels.length} 格
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">点击失败格可重新生成</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1.5 overflow-hidden rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        {project.panels.map((p) => (
          <div key={p.panelId} className="relative flex aspect-[3/4] items-center justify-center bg-[var(--color-surface-2)]">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl">❌</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {project.panels.map((p, idx) => (
          <div key={p.panelId} className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--color-surface)]">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                "❌"
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--color-text)]">第 {idx + 1} 格</p>
              {genErrors[p.panelId] && <p className="truncate text-[11px] text-[var(--color-error)]">{genErrors[p.panelId]}</p>}
            </div>
            <button
              onClick={() => onRegenerate(idx)}
              disabled={regenLoading !== null}
              className="pf-btn pf-btn-secondary !min-h-8 !py-1.5 !px-3 text-xs"
            >
              {regenLoading === idx ? "生成中…" : "重新生成"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BubbleEditorView({
  panels,
  selectedIdx,
  setSelectedIdx,
  onUpdate,
}: {
  panels: Panel[];
  selectedIdx: number;
  setSelectedIdx: (i: number) => void;
  onUpdate: (idx: number, field: "dialogue" | "caption", value: string) => void;
}) {
  const p = panels[selectedIdx];
  if (!p) return null;
  return (
    <div className="py-3">
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {panels.map((panel, i) => (
          <button
            key={panel.panelId}
            onClick={() => setSelectedIdx(i)}
            className="relative h-13 w-13 flex-shrink-0 overflow-hidden rounded-lg"
            style={{ border: i === selectedIdx ? "2.5px solid var(--color-primary)" : "2px solid transparent" }}
          >
            {panel.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={panel.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-[var(--color-surface-2)]" />
            )}
          </button>
        ))}
      </div>

      <div className="relative mb-4 aspect-[3/4] overflow-hidden rounded-2xl bg-[var(--color-surface-2)] shadow-lg">
        {p.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
        )}
        {p.dialogue && (
          <div className="absolute bottom-5 left-4 right-4 rounded-2xl rounded-bl-md bg-white/95 px-3.5 py-2.5 text-[13px] font-semibold text-black shadow-lg">
            {p.dialogue}
          </div>
        )}
        {p.caption && (
          <div className="absolute left-3 right-3 top-3 rounded-md bg-black/60 px-2.5 py-1.5 text-xs text-white">{p.caption}</div>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
          <p className="mb-2 text-[13px] font-bold text-[var(--color-text)]">对白（≤28字）</p>
          <input
            className="pf-input text-sm"
            maxLength={28}
            value={p.dialogue}
            onChange={(e) => onUpdate(selectedIdx, "dialogue", e.target.value)}
            placeholder="输入对白文字"
          />
        </div>
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
          <p className="mb-2 text-[13px] font-bold text-[var(--color-text)]">旁白（≤35字）</p>
          <input
            className="pf-input text-sm"
            maxLength={35}
            value={p.caption}
            onChange={(e) => onUpdate(selectedIdx, "caption", e.target.value)}
            placeholder="旁白文字，留空则无"
          />
        </div>
      </div>
    </div>
  );
}
