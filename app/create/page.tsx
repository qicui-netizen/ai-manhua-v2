"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loadCharacters, saveProject, newId } from "@/lib/store";
import { TEMPLATES, PLATFORMS, TONES, SYNOPSIS_EXAMPLES, styleOf, visualStyleOf } from "@/lib/data";
import type { Character, TemplateType, TargetPlatform, ExpandedPlot, Panel } from "@/lib/types";

type Phase = "input" | "expanding" | "confirm" | "error";

// 无账号体系下的最简风控:BLOCK 次数落 localStorage,达到阈值显示警告
const RISK_KEY = "pf_risk_v1";
const RISK_WARN_THRESHOLD = 3;
function bumpRiskCount(): number {
  const n = Number(localStorage.getItem(RISK_KEY) || "0") + 1;
  localStorage.setItem(RISK_KEY, String(n));
  return n;
}

function CreatePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCharId = searchParams.get("character");

  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(initialCharId);
  const [synopsis, setSynopsis] = useState("");
  const [tone, setTone] = useState<string>(TONES[1]);
  const [templateType, setTemplateType] = useState<TemplateType>("4_panel");
  const [styleId, setStyleId] = useState("jp-anime");
  const [targetPlatform, setTargetPlatform] = useState<TargetPlatform>("xhs_vertical");
  const [selfWrite, setSelfWrite] = useState(false);

  const [phase, setPhase] = useState<Phase>("input");
  const [errorMsg, setErrorMsg] = useState("");
  const [blockedInfo, setBlockedInfo] = useState<{ reason: string; safeRewrite?: string } | null>(null);
  const [riskCount, setRiskCount] = useState(0);
  const [expandedPlot, setExpandedPlot] = useState<ExpandedPlot | null>(null);
  const [storyTitle, setStoryTitle] = useState("");
  const [panels, setPanels] = useState<Panel[]>([]);
  const [adjustHint, setAdjustHint] = useState("");

  useEffect(() => {
    const list = loadCharacters();
    setCharacters(list);
    // URL 带的角色 id 可能已被删除或来自其他设备,无效时回退到第一个角色,避免主按钮永久禁用
    setSelectedCharId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id || null));
    setRiskCount(Number(localStorage.getItem(RISK_KEY) || "0"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedChar = characters.find((c) => c.id === selectedCharId);
  const template = TEMPLATES.find((t) => t.id === templateType)!;

  async function runAgent(withAdjustHint?: string, locked?: ExpandedPlot) {
    // 从确认页发起的重新生成,失败时应留在确认页,不能把用户已编辑的分镜踢回输入页。
    // 用调用时的 phase 判断来源(而非 expandedPlot 是否存在):用户从确认页点返回回到输入页后
    // expandedPlot 仍有旧值,若据此判断会把新提交的失败错误地踢回旧数据的确认页
    const hadConfirm = phase === "confirm";
    setPhase("expanding");
    setErrorMsg("");
    try {
      const res = await fetch("/api/plot-and-storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          synopsis,
          tone,
          characters: selectedChar ? [{ name: selectedChar.name, canon: selectedChar.canon }] : [],
          adjustHint: withAdjustHint,
          templateType,
          panelCount: template.panels,
          visualStyle: visualStyleOf(styleId),
          lockedExpandedPlot: locked,
        }),
      });
      const data = await res.json();
      if (data.status === "blocked") {
        // 内容安全拦截:显示温和话术+改写建议,记风控计数
        setBlockedInfo({ reason: data.reason || "内容未通过安全审核", safeRewrite: data.safeRewrite });
        setRiskCount(bumpRiskCount());
        if (hadConfirm) {
          // 确认页视图没有 blocked 横幅,复用它的错误提示位,避免用户零反馈
          setErrorMsg(data.reason || "内容未通过安全审核");
        }
        setPhase(hadConfirm ? "confirm" : "input");
        return;
      }
      if (data.status === "insufficient_input") {
        setErrorMsg(data.clarifyMessage || "请补充更多故事细节");
        setPhase(hadConfirm ? "confirm" : "error");
        return;
      }
      setBlockedInfo(null);
      setStoryTitle(data.storyTitle || "");
      setExpandedPlot(data.expandedPlot);
      setPanels(data.panels || []);
      setPhase("confirm");
    } catch {
      setErrorMsg("生成失败，请检查网络后重试");
      setPhase(hadConfirm ? "confirm" : "error");
    }
  }

  function handleSubmit() {
    if (selfWrite) {
      setExpandedPlot({
        toneLabel: tone,
        conflict: "",
        scene: "",
        charactersState: "",
        plot: synopsis,
        keyDialogues: [],
        dialogueCount: "0/8对",
        ending: "",
        beats: { 起: "", 承: "", 转: "", 合: "" },
        riskNotes: [],
      });
      runAgent(undefined, {
        toneLabel: tone,
        conflict: "",
        scene: "",
        charactersState: "",
        plot: synopsis,
        keyDialogues: [],
        dialogueCount: "0/8对",
        ending: "",
        beats: { 起: "", 承: "", 转: "", 合: "" },
        riskNotes: [],
      });
      return;
    }
    if (synopsis.trim().length < 4) {
      setErrorMsg("请先输入一句话故事梗概（至少4个字）");
      setPhase("error");
      return;
    }
    runAgent();
  }

  function handleConfirm() {
    if (!expandedPlot || !selectedChar) return;
    const project = {
      id: newId("proj"),
      title: storyTitle || "未命名短篇",
      characterIds: [selectedChar.id],
      templateType,
      panelCount: panels.length,
      styleId,
      targetPlatform,
      tone,
      synopsis,
      plotSource: selfWrite ? ("user_written" as const) : ("ai_expanded" as const),
      expandedPlot,
      panels,
      status: "storyboard_confirmed" as const,
      ownershipType: selectedChar.ownershipType,
      createdAt: Date.now(),
      exports: 0,
    };
    saveProject(project);
    router.push(`/project/${project.id}/generate`);
  }

  if (phase === "expanding") {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
        <div className="pf-spinner mb-4" style={{ width: 36, height: 36 }} />
        <p className="mb-1 text-base font-bold text-[var(--color-text)]">AI 正在编剧 + 分镜…</p>
        <p className="text-sm text-[var(--color-text-sub)]">「{synopsis}」</p>
        <p className="mt-4 text-xs text-[var(--color-text-dim)]">一次调用同时完成剧情扩写与分镜拆解，约需30-60秒</p>
      </div>
    );
  }

  if (phase === "confirm" && expandedPlot) {
    return (
      <ConfirmView
        storyTitle={storyTitle}
        expandedPlot={expandedPlot}
        panels={panels}
        setPanels={setPanels}
        adjustHint={adjustHint}
        setAdjustHint={setAdjustHint}
        errorMsg={errorMsg}
        onRegenerate={() => runAgent(adjustHint, selfWrite ? expandedPlot ?? undefined : undefined)}
        onReplotFromScratch={() => setPhase("input")}
        onConfirm={handleConfirm}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col pb-32">
      <div className="px-5 pt-8 pb-4">
        <div className="mb-1 flex items-center gap-1.5">
          <button onClick={() => router.push("/")} aria-label="返回" className="-ml-2 flex h-9 w-9 items-center justify-center">
            <svg width="10" height="17" viewBox="0 0 10 17" fill="none">
              <path d="M9 1L1 8.5L9 16" stroke="var(--color-primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-xl font-extrabold text-[var(--color-text)]">说说发生了什么？</h1>
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--color-text-sub)]">上传照片或选角色，一句话即可，AI 会帮你补全起承转合</p>
      </div>

      <div className="flex-1 px-5">
        {riskCount >= RISK_WARN_THRESHOLD && (
          <div className="mb-3 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] p-3 text-xs text-[#F59E0B]">
            ⚠️ 你已多次触发内容安全拦截，请遵守社区创作规范，持续违规将影响使用
          </div>
        )}
        {blockedInfo && (
          <div className="mb-3 rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-3.5">
            <p className="text-[13px] font-semibold text-[var(--color-error)]">🚫 {blockedInfo.reason}</p>
            {blockedInfo.safeRewrite && (
              <div className="mt-2 flex items-start gap-2">
                <p className="flex-1 text-xs leading-relaxed text-[var(--color-text-sub)]">建议：{blockedInfo.safeRewrite}</p>
                <button
                  onClick={() => {
                    setSynopsis(blockedInfo.safeRewrite || "");
                    setBlockedInfo(null);
                  }}
                  className="pf-btn pf-btn-secondary !min-h-7 flex-shrink-0 !px-2.5 !py-1 text-[11px]"
                >
                  采用建议
                </button>
              </div>
            )}
          </div>
        )}
        {/* 角色选择 */}
        <div className="pf-card mb-4">
          <div className="flex items-center gap-2.5">
            {selectedChar?.referenceImages[0]?.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedChar.referenceImages[0].url} alt="" className="h-10 w-10 rounded-full object-cover" />
            )}
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-[var(--color-text)]">{selectedChar ? `${selectedChar.name} 的故事` : "请选择角色"}</p>
              {selectedChar?.referenceImages.length === 0 && (
                <p className="text-[11px] text-[var(--color-error)]">该角色暂无参考图，出图前需先补传照片</p>
              )}
            </div>
            <select
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-text)]"
              value={selectedCharId || ""}
              onChange={(e) => setSelectedCharId(e.target.value)}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 一句话输入 */}
        <textarea
          className="pf-input mb-3 resize-none"
          rows={4}
          placeholder={"用一句话说说发生了什么…\n例如：她终于鼓起勇气告白，对方却已经消失了"}
          value={synopsis}
          onChange={(e) => setSynopsis(e.target.value)}
        />

        {/* 氛围 */}
        <div className="mb-4">
          <p className="mb-2 text-[13px] font-semibold text-[var(--color-text-sub)]">氛围</p>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button key={t} className={`pf-chip ${tone === t ? "active" : ""}`} onClick={() => setTone(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* 示例 */}
        <p className="mb-2 text-[13px] font-semibold text-[var(--color-text-sub)]">快速示例 ↓</p>
        <div className="mb-4 flex flex-col gap-2">
          {SYNOPSIS_EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setSynopsis(ex)}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-left text-[13px] leading-relaxed text-[var(--color-text-sub)]"
            >
              {ex}
            </button>
          ))}
        </div>

        {/* 模板选择 */}
        <p className="mb-2 text-[13px] font-semibold text-[var(--color-text)]">选格式</p>
        <div className="mb-4 flex gap-2.5">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTemplateType(t.id)}
              className="flex-1 rounded-xl border-2 p-3 text-center"
              style={{ borderColor: templateType === t.id ? "var(--color-primary)" : "var(--color-border)" }}
            >
              <p className="text-[15px] font-bold text-[var(--color-text)]">{t.name}</p>
              <p className="mt-0.5 text-[10px] text-[var(--color-text-dim)]">{t.est}</p>
            </button>
          ))}
        </div>

        {/* 画风 */}
        <p className="mb-2 text-[13px] font-semibold text-[var(--color-text)]">画面风格</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {["jp-anime", "guofeng", "kr-manhwa", "chibi", "thick-paint", "bw"].map((id) => (
            <button key={id} className={`pf-chip ${styleId === id ? "active" : ""}`} onClick={() => setStyleId(id)}>
              {styleOf(id).name}
            </button>
          ))}
        </div>

        {/* 目标平台 */}
        <p className="mb-2 text-[13px] font-semibold text-[var(--color-text)]">目标平台</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              className={`pf-chip ${targetPlatform === p.id ? "active" : ""}`}
              onClick={() => setTargetPlatform(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* 自己写 */}
        <button
          onClick={() => setSelfWrite((v) => !v)}
          className="mb-2 flex w-full items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
        >
          <div className="flex-1 text-left">
            <p className="text-[13px] font-semibold text-[var(--color-text)]">{selfWrite ? "✓ 已选择自己写剧情" : "自己写剧情"}</p>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">跳过 AI 补全，直接把你写的内容拆分镜</p>
          </div>
        </button>

        {phase === "error" && errorMsg && (
          <div className="mb-3 rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-3 text-xs text-[var(--color-error)]">
            {errorMsg}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 mx-auto max-w-md bg-gradient-to-t from-[var(--color-bg)] from-75% to-transparent px-5 pb-9 pt-3 sm:absolute">
        <button onClick={handleSubmit} disabled={!selectedChar} className="pf-btn pf-btn-primary w-full">
          {selfWrite ? "拆分镜 →" : "✦ AI 补全剧情 + 分镜"}
        </button>
      </div>
    </div>
  );
}

function ConfirmView({
  storyTitle,
  expandedPlot,
  panels,
  setPanels,
  adjustHint,
  setAdjustHint,
  errorMsg,
  onRegenerate,
  onReplotFromScratch,
  onConfirm,
}: {
  storyTitle: string;
  expandedPlot: ExpandedPlot;
  panels: Panel[];
  setPanels: (p: Panel[]) => void;
  adjustHint: string;
  setAdjustHint: (s: string) => void;
  errorMsg?: string;
  onRegenerate: () => void;
  onReplotFromScratch: () => void;
  onConfirm: () => void;
}) {
  // 默认展开:扩写剧情是核心中间产物,用户要能直接看到(可手动收起)
  const [plotExpanded, setPlotExpanded] = useState(true);
  // 自写剧情模式下 beats 全空,不渲染四张空白起承转合卡
  const hasBeats = (["起", "承", "转", "合"] as const).some((b) => expandedPlot.beats[b]?.trim());
  const beatColors: Record<string, string> = { 起: "#3B82F6", 承: "#10B981", 转: "#F59E0B", 合: "#EC4899" };

  function updatePanel(idx: number, field: keyof Panel, value: string) {
    const next = [...panels];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next[idx] as any)[field] = value;
    setPanels(next);
  }

  return (
    <div className="flex min-h-full flex-col pb-36">
      <div className="px-5 pt-8 pb-3">
        <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.1)] p-3">
          <span>✅</span>
          <p className="text-[13px] font-semibold text-[var(--color-success)]">剧情 + 分镜生成完成！</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onReplotFromScratch} aria-label="返回输入" className="-ml-2 flex h-9 w-9 items-center justify-center">
            <svg width="10" height="17" viewBox="0 0 10 17" fill="none">
              <path d="M9 1L1 8.5L9 16" stroke="var(--color-primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h2 className="text-lg font-extrabold text-[var(--color-text)]">{storyTitle}</h2>
        </div>
        <p className="mt-0.5 text-xs text-[var(--color-text-dim)]">{expandedPlot.toneLabel}</p>
      </div>

      <div className="px-5">
        {/* 剧情摘要,默认折叠 */}
        <button
          onClick={() => setPlotExpanded((v) => !v)}
          className="mb-3 flex w-full items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-2.5"
        >
          <span className="text-[13px] font-semibold text-[var(--color-text)]">{hasBeats ? "剧情摘要（起承转合）" : "你的剧情"}</span>
          <span className="text-xs text-[var(--color-text-dim)]">{plotExpanded ? "收起 ▲" : "展开 ▼"}</span>
        </button>
        {plotExpanded && (
          <div className="mb-4 flex flex-col gap-2">
            {hasBeats &&
              (["起", "承", "转", "合"] as const).map((b) => (
                <div key={b} className="flex gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  <div
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold"
                    style={{ borderColor: `${beatColors[b]}55`, background: `${beatColors[b]}22`, color: beatColors[b] }}
                  >
                    {b}
                  </div>
                  <p className="text-[13px] leading-relaxed text-[var(--color-text-sub)]">{expandedPlot.beats[b]}</p>
                </div>
              ))}
            <p className={`mt-1 leading-relaxed ${hasBeats ? "text-xs text-[var(--color-text-dim)]" : "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-[13px] text-[var(--color-text-sub)]"}`}>
              {expandedPlot.plot}
            </p>
          </div>
        )}

        {/* 分镜卡列表 */}
        <p className="mb-2 text-[15px] font-bold text-[var(--color-text)]">分镜（{panels.length} 格，可编辑）</p>
        <div className="mb-4 flex flex-col gap-2.5">
          {panels.map((p, idx) => (
            <PanelEditCard key={p.panelId} panel={p} idx={idx} beatColors={beatColors} onChange={updatePanel} />
          ))}
        </div>

        <div className="mb-3">
          {errorMsg && (
            <div className="mb-2 rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-3 text-xs text-[var(--color-error)]">
              重新生成失败：{errorMsg}（已保留当前分镜）
            </div>
          )}
          <input
            className="pf-input mb-2 text-sm"
            placeholder="重新生成时的调整方向（可选，如：更悬疑一点）"
            value={adjustHint}
            onChange={(e) => setAdjustHint(e.target.value)}
          />
          <div className="flex gap-2.5">
            <button onClick={onRegenerate} className="pf-btn pf-btn-secondary flex-1 !min-h-11 text-sm">
              重新生成剧情+分镜
            </button>
            <button onClick={onReplotFromScratch} className="pf-btn pf-btn-secondary flex-1 !min-h-11 text-sm">
              重新输入
            </button>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 mx-auto max-w-md bg-gradient-to-t from-[var(--color-bg)] from-75% to-transparent px-5 pb-9 pt-3 sm:absolute">
        <button onClick={onConfirm} className="pf-btn pf-btn-primary w-full">
          确认，开始生成图片 →
        </button>
      </div>
    </div>
  );
}

function PanelEditCard({
  panel,
  idx,
  beatColors,
  onChange,
}: {
  panel: Panel;
  idx: number;
  beatColors: Record<string, string>;
  onChange: (idx: number, field: keyof Panel, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-2.5"
      >
        <div
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold"
          style={{ borderColor: `${beatColors[panel.beat]}55`, background: `${beatColors[panel.beat]}22`, color: beatColors[panel.beat] }}
        >
          {panel.beat}
        </div>
        <span className="text-[13px] font-bold text-[var(--color-text)]">第 {idx + 1} 格</span>
        <span className="flex-1 truncate text-left text-xs text-[var(--color-text-dim)]">{panel.scene}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 p-3.5">
          <Field label="场景描述" value={panel.scene} onChange={(v) => onChange(idx, "scene", v)} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="镜头" value={panel.camera} onChange={(v) => onChange(idx, "camera", v)} small />
            <Field label="情绪" value={panel.emotion} onChange={(v) => onChange(idx, "emotion", v)} small />
          </div>
          <Field label="对白" value={panel.dialogue} onChange={(v) => onChange(idx, "dialogue", v)} />
          <Field label="旁白" value={panel.caption} onChange={(v) => onChange(idx, "caption", v)} />
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, small }: { label: string; value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-[var(--color-text-dim)]">{label}</label>
      <input
        className="pf-input"
        style={small ? { fontSize: 12, padding: "8px 10px" } : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="flex min-h-full items-center justify-center"><div className="pf-spinner" /></div>}>
      <CreatePageInner />
    </Suspense>
  );
}
