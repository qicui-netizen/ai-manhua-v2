"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getProject, saveProject, getPlanClient, setPlanClient, spendQuota } from "@/lib/store";
import { PLATFORMS, platformOf } from "@/lib/data";
import { composeExport, downloadDataUrl } from "@/lib/exporter";
import type { Project, TargetPlatform } from "@/lib/types";

function ExportPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [platformId, setPlatformId] = useState<TargetPlatform>("xhs_vertical");
  const [isPaid, setIsPaid] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    const p = getProject(projectId);
    setProject(p || null);
    if (p) setPlatformId(p.targetPlatform);
    setIsPaid(getPlanClient() === "member");
  }, [projectId]);

  const platform = platformOf(platformId);
  const readyPanels = project?.panels.filter((p) => p.imageUrl).length || 0;

  async function handleExport() {
    if (!project) return;
    setExporting(true);
    setResultUrl(null);
    setExportError("");
    try {
      const dataUrl = await composeExport(project, platform, { hd: isPaid, watermark: !isPaid });
      setResultUrl(dataUrl);
      const updated: Project = { ...project, status: "exported", exports: project.exports + 1 };
      saveProject(updated);
      setProject(updated);
      spendQuota(0);
    } catch {
      // 常见原因:生成图URL过期或跨域受限导致canvas无法导出
      setExportError("导出失败：图片加载异常，请回上一步重新生成后再试");
    } finally {
      setExporting(false);
    }
  }

  function handleDownload() {
    if (!resultUrl || !project) return;
    downloadDataUrl(resultUrl, `${project.title || "panelforge"}_${platform.id}.png`);
  }

  if (project === undefined) return <div className="flex min-h-full items-center justify-center"><div className="pf-spinner" /></div>;
  if (project === null) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 px-8 text-center text-[var(--color-text-dim)]">
        <p>请先从工作台选择一个已生成的短篇</p>
        <button onClick={() => router.push("/")} className="pf-btn pf-btn-secondary">
          返回工作台
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col pb-32">
      <div className="flex items-center justify-between px-5 pt-8 pb-3">
        <h1 className="text-lg font-extrabold text-[var(--color-text)]">导出稿件</h1>
        {!isPaid && (
          <button
            onClick={() => {
              // 演示版:与 /profile 页行为一致,直接切换套餐(未接真实支付)
              setPlanClient("member");
              setIsPaid(true);
            }}
            className="flex items-center gap-1.5 rounded-full border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.15)] px-3 py-1"
          >
            <span className="text-xs font-bold text-[#F59E0B]">升级会员</span>
          </button>
        )}
      </div>

      <div className="flex-1 px-5">
        <div className="relative mb-4">
          <div
            className="grid grid-cols-2 gap-1 overflow-hidden rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
            style={{ filter: isPaid ? undefined : "brightness(0.75)" }}
          >
            {project.panels.slice(0, 4).map((p) => (
              <div key={p.panelId} className="relative flex aspect-[3/4] items-center justify-center bg-[var(--color-surface-2)]">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xl">🖼️</span>
                )}
              </div>
            ))}
          </div>
          {!isPaid && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl">
              <div className="rounded-xl bg-black/60 px-5 py-2.5 text-center">
                <p className="text-[13px] font-bold text-white">预览含水印</p>
                <p className="mt-0.5 text-[11px] text-white/60">升级会员去除</p>
              </div>
            </div>
          )}
        </div>

        <p className="mb-2 text-[13px] font-bold text-[var(--color-text)]">选择平台</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPlatformId(p.id)}
              className="flex items-center gap-2.5 rounded-xl border-2 bg-[var(--color-surface-2)] p-3"
              style={{ borderColor: platformId === p.id ? "var(--color-primary)" : "var(--color-border)" }}
            >
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[13px] font-bold text-[var(--color-text)]">{p.name}</p>
                <p className="text-[10px] text-[var(--color-text-dim)]">{p.note}</p>
              </div>
            </button>
          ))}
        </div>

        <p className="mb-2 text-[13px] font-bold text-[var(--color-text)]">画质对比</p>
        <div className="mb-4 flex gap-2">
          <div className="flex-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
            <p className="mb-2 text-[13px] font-bold text-[var(--color-text)]">免费版</p>
            <p className="text-[11px] text-[var(--color-text-dim)]">低清 · 带水印</p>
          </div>
          <div className="flex-1 rounded-2xl border-[1.5px] border-[rgba(124,58,237,0.4)] bg-gradient-to-br from-[rgba(124,58,237,0.15)] to-[rgba(168,85,247,0.08)] p-3.5">
            <p className="mb-2 text-[13px] font-bold text-[var(--color-primary-light)]">会员版</p>
            <p className="text-[11px] text-[var(--color-text-sub)]">高清 · 无水印</p>
          </div>
        </div>

        {readyPanels < project.panels.length && (
          <div className="mb-4 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] p-3 text-xs text-[#F59E0B]">
            仅 {readyPanels}/{project.panels.length} 格已生成成功，导出将跳过失败格
          </div>
        )}

        {exportError && (
          <div className="mb-4 rounded-xl border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-3 text-xs text-[var(--color-error)]">
            {exportError}
          </div>
        )}

        {resultUrl && (
          <div className="mb-4 rounded-2xl border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.1)] p-4 text-center">
            <p className="mb-3 text-[13px] font-bold text-[var(--color-success)]">✅ 导出成功！</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl} alt="导出结果" className="mx-auto mb-3 max-h-64 rounded-lg" />
            <button onClick={handleDownload} className="pf-btn pf-btn-primary w-full">
              下载图片
            </button>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 mx-auto max-w-md bg-gradient-to-t from-[var(--color-bg)] from-75% to-transparent px-5 pb-9 pt-3 sm:absolute">
        <button onClick={handleExport} disabled={exporting || readyPanels === 0} className="pf-btn pf-btn-primary w-full">
          {exporting ? "合成中…" : isPaid ? "高清导出 →" : "免费导出（含水印）"}
        </button>
      </div>
    </div>
  );
}

export default function ExportPage() {
  return (
    <Suspense fallback={<div className="flex min-h-full items-center justify-center"><div className="pf-spinner" /></div>}>
      <ExportPageInner />
    </Suspense>
  );
}
