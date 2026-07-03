"use client";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getProject, saveProject, loadCharacters, spendQuota, getQuota } from "@/lib/store";
import { styleOf, platformOf } from "@/lib/data";
import { persistRemoteImage } from "@/lib/persistImage";
import { renderPanelWithBubbles } from "@/lib/exporter";
import { DEFAULT_DIALOGUE_STYLE, DEFAULT_CAPTION_STYLE, SHAPE_LABELS } from "@/lib/bubbles";
import type { Project, Character, Panel, BubbleStyle, BubbleAnchor, BubbleShape } from "@/lib/types";

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
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [rerollingId, setRerollingId] = useState<number | null>(null);
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
      // 额度耗尽软拦截:演示期先在前端挡住,服务端闸门随账号体系落地
      if (getQuota() <= 0) {
        const blockedPanels = project!.panels.map((p) => ({ ...p, status: "error" as const }));
        const blockedProject = { ...project!, panels: blockedPanels };
        try {
          saveProject(blockedProject);
        } catch {
          /* 存储失败时保持内存态即可 */
        }
        setProject(blockedProject);
        setGenErrors({ [GLOBAL_ERROR_KEY]: "本月免费额度已用完（30 格/月，次月 1 日自动重置），暂时无法生成" });
        setPhase("review");
        return;
      }
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
        setGenErrors({ [GLOBAL_ERROR_KEY]: "网络错误，生成失败，请点击下方「一键重新生成失败的格子」重试" });
        setPhase("review");
      } finally {
        inFlightProjects.delete(id);
      }
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, phase]);

  // 一键重新生成全部失败格:复用批量接口(服务端并发4路),不必一格一格点
  async function regenerateFailedPanels() {
    if (!project || retryingFailed) return;
    // 跨挂载守卫:重试在途时离开再进入,不允许发起第二次(双倍扣额度、结果互相覆盖)
    if (inFlightProjects.has(id)) return;
    const failed = project.panels.filter((p) => p.status === "error");
    if (failed.length === 0) return;
    if (getQuota() <= 0) {
      setGenErrors((prev) => ({ ...prev, [GLOBAL_ERROR_KEY]: "本月免费额度已用完（次月 1 日自动重置），暂时无法重新生成" }));
      return;
    }
    inFlightProjects.add(id);
    setRetryingFailed(true);
    const projChars = characters.filter((c) => project.characterIds.includes(c.id));
    const style = styleOf(project.styleId);
    const platform = platformOf(project.targetPlatform);
    try {
      const res = await fetch("/api/generate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storySummary: project.expandedPlot?.plot || project.synopsis,
          panels: failed,
          characters: projChars,
          styleLabel: style.name,
          aspectRatio: platform.ratio,
          layoutTemplate: project.templateType === "4_panel" ? "4格" : project.templateType === "9_panel" ? "9格" : "条漫",
        }),
      });
      const data = await res.json();
      const results: { panelId: number; status: "done" | "error"; imageUrl?: string; notes?: string }[] = data.results || [];

      // 先转存成功格图片(临时URL过期问题),再合入状态
      const persisted = new Map<number, string>();
      for (const r of results) {
        if (r.status === "done" && r.imageUrl) persisted.set(r.panelId, await persistRemoteImage(r.imageUrl));
      }
      const doneCount = persisted.size;

      // 落盘不放进 setState updater:重试期间用户离开页面时组件已卸载,
      // updater 不会执行,结果会白白丢掉(额度却扣了)。基于最新落盘态合并后直接存。
      const latest = getProject(id) || project;
      const nextPanels = latest.panels.map((p) =>
        persisted.has(p.panelId) ? { ...p, status: "done" as const, imageUrl: persisted.get(p.panelId)! } : p
      );
      const updated = { ...latest, panels: nextPanels };
      try {
        saveProject(updated);
      } catch {
        /* 存储超限时保持内存态 */
      }
      setProject(updated);
      setGenErrors((prevErr) => {
        const n = { ...prevErr };
        delete n[GLOBAL_ERROR_KEY];
        for (const r of results) {
          if (r.status === "done") delete n[r.panelId];
          else n[r.panelId] = r.notes || "生成失败";
        }
        return n;
      });
      if (doneCount > 0) spendQuota(doneCount);
    } catch {
      setGenErrors((prev) => ({ ...prev, [GLOBAL_ERROR_KEY]: "网络异常，重试失败，请稍后再试" }));
    } finally {
      inFlightProjects.delete(id);
      setRetryingFailed(false);
    }
  }

  // 单格重抽:成功但不满意的格子重新生成,可附一句修正提示。成功才扣 1 格额度,失败保留原图。
  async function rerollPanel(panelId: number, hint: string) {
    if (!project || retryingFailed || rerollingId !== null) return;
    // 跨挂载守卫:重抽在途时离开再进入,组件态 rerollingId 已丢失,
    // 必须靠模块级集合阻止对同一项目并发二次重抽(双倍扣额度、结果互相覆盖)
    if (inFlightProjects.has(id)) return;
    if (getQuota() <= 0) {
      setGenErrors((prev) => ({ ...prev, [GLOBAL_ERROR_KEY]: "本月免费额度已用完（次月 1 日自动重置），暂时无法重抽" }));
      return;
    }
    const latest = getProject(id) || project;
    const target = latest.panels.find((p) => p.panelId === panelId);
    if (!target) return;
    inFlightProjects.add(id);
    setRerollingId(panelId);
    const projChars = characters.filter((c) => latest.characterIds.includes(c.id));
    const style = styleOf(latest.styleId);
    const platform = platformOf(latest.targetPlatform);
    // 与批量接口同一套角色筛选口径(按动作文本点名);全都没点名时兜底传全部,不让重抽死于筛选
    const inPanel = projChars.length === 1 ? projChars : projChars.filter((c) => target.characterAction.includes(c.name));
    const charsForApi = inPanel.length > 0 ? inPanel : projChars;
    const trimmed = hint.trim().slice(0, 50);
    try {
      const res = await fetch("/api/generate-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storySummary: latest.expandedPlot?.plot || latest.synopsis,
          panel: target,
          characters: charsForApi,
          styleLabel: style.name,
          aspectRatio: platform.ratio,
          layoutTemplate: latest.templateType === "4_panel" ? "4格" : latest.templateType === "9_panel" ? "9格" : "条漫",
          // 修正要求作为一等字段传递(不拼进 visualPromptHint,防离线兜底 slice 截断丢失)
          adjustHint: trimmed,
        }),
      });
      const r = await res.json();
      if (r.status !== "done" || !r.imageUrl) {
        setGenErrors((prev) => ({ ...prev, [panelId]: `重抽失败:${r.notes || "生成失败"}(原图已保留)` }));
        return;
      }
      // 生成图是临时签名URL,立即转存;基于最新落盘态合并,防止在途期间的其他改动被覆盖
      const persistedUrl = await persistRemoteImage(r.imageUrl);
      const base = getProject(id) || latest;
      const nextPanels = base.panels.map((p) =>
        p.panelId === panelId ? { ...p, status: "done" as const, imageUrl: persistedUrl } : p
      );
      const updated = { ...base, panels: nextPanels };
      // 扣额度放在 setProject 之前:spendQuota 会广播 pf:update,refresh 监听器
      // 用磁盘态 setProject——若 saveProject 因写满失败,磁盘旧态会覆盖内存新图。
      // 先扣、后落盘、最后 setProject(updated),保证最终内存态永远是新结果。
      spendQuota(1);
      let storageFull = false;
      try {
        saveProject(updated);
      } catch {
        storageFull = true;
      }
      setProject(updated);
      setGenErrors((prev) => {
        const n = { ...prev };
        delete n[panelId];
        if (storageFull) n[GLOBAL_ERROR_KEY] = "本地存储空间不足，重抽的新图可能无法长期保存，请尽快导出";
        return n;
      });
    } catch {
      setGenErrors((prev) => ({ ...prev, [panelId]: "网络异常，重抽失败(原图已保留)" }));
    } finally {
      inFlightProjects.delete(id);
      setRerollingId(null);
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

  function updateBubbleStyle(idx: number, field: "dialogueBubble" | "captionBubble", patch: Partial<BubbleStyle>) {
    if (!project) return;
    const next = [...project.panels];
    const current = next[idx][field] || (field === "dialogueBubble" ? DEFAULT_DIALOGUE_STYLE : DEFAULT_CAPTION_STYLE);
    next[idx] = { ...next[idx], [field]: { ...current, ...patch } };
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
          <ReviewView
            project={project}
            genErrors={genErrors}
            retrying={retryingFailed}
            onRetryFailed={regenerateFailedPanels}
            rerollingId={rerollingId}
            onReroll={rerollPanel}
          />
        )}
        {phase === "bubble" && (
          <BubbleEditorView
            project={project}
            selectedIdx={selectedPanelIdx}
            setSelectedIdx={setSelectedPanelIdx}
            onUpdate={updateBubble}
            onUpdateStyle={updateBubbleStyle}
          />
        )}
      </div>

      {phase === "review" && (
        <div className="fixed bottom-0 left-0 right-0 mx-auto flex max-w-md gap-2.5 bg-gradient-to-t from-[var(--color-bg)] from-75% to-transparent px-5 pb-9 pt-3 sm:absolute">
          <button
            onClick={() => router.push(`/export?project=${id}`)}
            disabled={retryingFailed || rerollingId !== null}
            className="pf-btn pf-btn-primary w-full"
          >
            {retryingFailed ? "重新生成中，请稍候…" : rerollingId !== null ? "重抽中，请稍候…" : "导出稿件 →"}
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
  retrying,
  onRetryFailed,
  rerollingId,
  onReroll,
}: {
  project: Project;
  genErrors: Record<number, string>;
  retrying: boolean;
  onRetryFailed: () => void;
  rerollingId: number | null;
  onReroll: (panelId: number, hint: string) => void;
}) {
  const doneCount = project.panels.filter((p) => p.status === "done").length;
  const failedCount = project.panels.filter((p) => p.status === "error").length;
  // 展开修正提示输入的格子(一次只展开一格,输入随展开切换重置)
  const [rerollTarget, setRerollTarget] = useState<number | null>(null);
  const [rerollHint, setRerollHint] = useState("");
  const busy = retrying || rerollingId !== null;
  return (
    <div className="py-3">
      {genErrors[GLOBAL_ERROR_KEY] && (
        <div className="mb-3 rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-3 text-xs text-[var(--color-error)]">
          {genErrors[GLOBAL_ERROR_KEY]}
        </div>
      )}
      <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.1)] p-3">
        <span>✅</span>
        <div className="flex-1">
          <p className="text-[13px] font-bold text-[var(--color-success)]">
            成功 {doneCount} / {project.panels.length} 格
          </p>
          {failedCount > 0 && (
            <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">有 {failedCount} 格未生成成功，可一键补齐</p>
          )}
        </div>
      </div>
      {failedCount > 0 && (
        <button onClick={onRetryFailed} disabled={retrying} className="pf-btn pf-btn-primary mb-4 w-full">
          {retrying ? `正在重新生成 ${failedCount} 格…` : `一键重新生成失败的 ${failedCount} 格`}
        </button>
      )}

      <div className="mb-4 grid grid-cols-2 gap-1.5 overflow-hidden rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        {project.panels.map((p) => (
          <div key={p.panelId} className="relative flex aspect-[3/4] items-center justify-center bg-[var(--color-surface-2)]">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl">❌</span>
            )}
            {rerollingId === p.panelId && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                <div className="pf-spinner" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {project.panels.map((p, idx) => (
          <div key={p.panelId} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <div className="flex items-center gap-3">
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
              {p.status === "error" && <span className="text-[11px] text-[var(--color-error)]">待重新生成</span>}
              {p.status === "done" && (
                <button
                  onClick={() => {
                    setRerollTarget(rerollTarget === p.panelId ? null : p.panelId);
                    setRerollHint("");
                  }}
                  disabled={busy}
                  className="pf-btn pf-btn-secondary !min-h-8 flex-shrink-0 !px-3 !py-1.5 text-xs"
                >
                  {rerollingId === p.panelId ? "重抽中…" : "🎲 重抽"}
                </button>
              )}
            </div>
            {/* 不满意的成功格:展开修正提示输入,重抽消耗 1 格额度 */}
            {rerollTarget === p.panelId && p.status === "done" && (
              <div className="mt-2.5 flex gap-2">
                <input
                  className="pf-input flex-1 !py-2 text-[13px]"
                  maxLength={50}
                  placeholder="可选：想改哪里？如「表情改成微笑」"
                  value={rerollHint}
                  onChange={(e) => setRerollHint(e.target.value)}
                />
                <button
                  onClick={() => {
                    setRerollTarget(null);
                    onReroll(p.panelId, rerollHint);
                  }}
                  disabled={busy}
                  className="pf-btn pf-btn-primary !min-h-9 flex-shrink-0 !px-3.5 !py-2 text-xs"
                >
                  重抽(耗1格额度)
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BubbleEditorView({
  project,
  selectedIdx,
  setSelectedIdx,
  onUpdate,
  onUpdateStyle,
}: {
  project: Project;
  selectedIdx: number;
  setSelectedIdx: (i: number) => void;
  onUpdate: (idx: number, field: "dialogue" | "caption", value: string) => void;
  onUpdateStyle: (idx: number, field: "dialogueBubble" | "captionBubble", patch: Partial<BubbleStyle>) => void;
}) {
  const panels = project.panels;
  const p = panels[selectedIdx];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderSeq = useRef(0);

  // 预览与导出共用同一套 canvas 渲染,改什么立刻看到什么。
  // 渲染序号防竞态:快速切格时慢的旧渲染(图片解码慢)不允许覆盖新格子的画面
  useEffect(() => {
    if (!canvasRef.current || !p) return;
    const seq = ++renderSeq.current;
    renderPanelWithBubbles(canvasRef.current, project, selectedIdx, { isStale: () => renderSeq.current !== seq });
  }, [project, selectedIdx, p]);

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

      <canvas ref={canvasRef} className="mb-4 h-auto w-full rounded-2xl bg-[var(--color-surface-2)] shadow-lg" />

      <div className="flex flex-col gap-2.5">
        <BubbleControls
          title="对白（≤28字）"
          placeholder="输入对白文字"
          maxLength={28}
          value={p.dialogue}
          style={p.dialogueBubble || DEFAULT_DIALOGUE_STYLE}
          onText={(v) => onUpdate(selectedIdx, "dialogue", v)}
          onStyle={(patch) => onUpdateStyle(selectedIdx, "dialogueBubble", patch)}
        />
        <BubbleControls
          title="旁白（≤35字）"
          placeholder="旁白文字，留空则无"
          maxLength={35}
          value={p.caption}
          style={p.captionBubble || DEFAULT_CAPTION_STYLE}
          onText={(v) => onUpdate(selectedIdx, "caption", v)}
          onStyle={(patch) => onUpdateStyle(selectedIdx, "captionBubble", patch)}
        />
      </div>
    </div>
  );
}

const SHAPES: BubbleShape[] = ["oval", "burst", "box"];
const ANCHORS: BubbleAnchor[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function BubbleControls({
  title,
  placeholder,
  maxLength,
  value,
  style,
  onText,
  onStyle,
}: {
  title: string;
  placeholder: string;
  maxLength: number;
  value: string;
  style: BubbleStyle;
  onText: (v: string) => void;
  onStyle: (patch: Partial<BubbleStyle>) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
      <p className="mb-2 text-[13px] font-bold text-[var(--color-text)]">{title}</p>
      <input
        className="pf-input text-sm"
        maxLength={maxLength}
        value={value}
        onChange={(e) => onText(e.target.value)}
        placeholder={placeholder}
      />
      {value.trim() && (
        <div className="mt-3 flex items-start gap-4">
          <div className="flex-1">
            <p className="mb-1.5 text-[11px] text-[var(--color-text-dim)]">气泡形状</p>
            <div className="flex flex-wrap gap-1.5">
              {SHAPES.map((s) => (
                <button
                  key={s}
                  onClick={() => onStyle({ shape: s })}
                  className={`pf-chip !min-h-8 !px-3 !py-1 text-xs ${style.shape === s ? "active" : ""}`}
                >
                  {SHAPE_LABELS[s]}
                </button>
              ))}
            </div>
            <p className="mb-1.5 mt-3 text-[11px] text-[var(--color-text-dim)]">
              底色透明度 {Math.round(style.opacity * 100)}%
            </p>
            <input
              type="range"
              min={30}
              max={100}
              value={Math.round(style.opacity * 100)}
              onChange={(e) => onStyle({ opacity: Number(e.target.value) / 100 })}
              className="w-full accent-[var(--color-primary)]"
            />
          </div>
          <div>
            <p className="mb-1.5 text-[11px] text-[var(--color-text-dim)]">位置</p>
            <div className="grid grid-cols-3 gap-1">
              {ANCHORS.map((a) => (
                <button
                  key={a}
                  onClick={() => onStyle({ anchor: a })}
                  aria-label={`位置${a}`}
                  className="h-7 w-7 rounded-md border"
                  style={{
                    borderColor: style.anchor === a ? "var(--color-primary)" : "var(--color-border)",
                    background: style.anchor === a ? "var(--color-primary)" : "var(--color-surface)",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
