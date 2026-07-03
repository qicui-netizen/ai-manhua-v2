"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getProject, saveProject, loadProjects, getPlanClient } from "@/lib/store";
import { PLATFORMS, platformOf } from "@/lib/data";
import { composeExport, downloadDataUrl } from "@/lib/exporter";
import type { Project, TargetPlatform } from "@/lib/types";

function ExportPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [platformId, setPlatformId] = useState<TargetPlatform>("xhs_vertical");
  const [isPaid, setIsPaid] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (projectId) {
        const p = getProject(projectId);
        setProject(p || null);
      } else {
        // 无项目参数(从底部Tab进入):展示全部作品供选择,并显示导出记录
        setProject(null);
        setAllProjects(loadProjects());
      }
      setIsPaid(getPlanClient() === "member");
    };
    refresh();
    if (projectId) {
      const p = getProject(projectId);
      if (p) setPlatformId(p.targetPlatform);
    }
    // 监听存储更新:后台一键重试补齐图片后,本页数据自动刷新,避免导出缺格旧数据
    window.addEventListener("pf:update", refresh);
    return () => window.removeEventListener("pf:update", refresh);
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
    // 从底部Tab直接进入:显示全部作品与导出记录,点击进入对应作品的导出
    const withImages = allProjects.filter((p) => p.panels.some((pn) => pn.imageUrl));
    const drafts = allProjects.filter((p) => !p.panels.some((pn) => pn.imageUrl));
    if (allProjects.length === 0) {
      return (
        <div className="flex min-h-full flex-col items-center justify-center gap-3 px-8 text-center text-[var(--color-text-dim)]">
          <div className="text-4xl">📤</div>
          <p>还没有可导出的作品</p>
          <button onClick={() => router.push("/create")} className="pf-btn pf-btn-secondary">
            去创作一篇
          </button>
        </div>
      );
    }
    return (
      <div className="flex min-h-full flex-col pb-24">
        <div className="px-5 pt-8 pb-3">
          <h1 className="text-lg font-extrabold text-[var(--color-text)]">导出作品</h1>
          <p className="mt-0.5 text-xs text-[var(--color-text-dim)]">选择一个作品进行导出，历史导出次数如下</p>
        </div>
        <div className="flex flex-col gap-2.5 px-5">
          {withImages.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/export?project=${p.id}`)}
              className="pf-card flex items-center gap-3 text-left"
            >
              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-[var(--color-surface-2)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.panels.find((pn) => pn.imageUrl)!.imageUrl} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-[var(--color-text)]">{p.title || "未命名短篇"}</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">
                  {p.panelCount} 格 · {new Date(p.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span
                className="flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold"
                style={{
                  background: p.exports > 0 ? "rgba(16,185,129,0.15)" : "var(--color-primary-bg)",
                  color: p.exports > 0 ? "var(--color-success)" : "var(--color-primary)",
                }}
              >
                {p.exports > 0 ? `已导出 ${p.exports} 次` : "未导出"}
              </span>
            </button>
          ))}
          {drafts.length > 0 && (
            <p className="mt-2 text-center text-[11px] text-[var(--color-text-dim)]">
              另有 {drafts.length} 个作品尚未生成图片，生成后可导出
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col pb-32">
      <div className="flex items-center justify-between px-5 pt-8 pb-3">
        <h1 className="text-lg font-extrabold text-[var(--color-text)]">导出稿件</h1>
        {!isPaid && (
          <button
            onClick={() =>
              // 演示付费墙自洽:不做一键假切换,与 /profile 页同口径价格预告
              alert("会员即将上线：预计 ¥19/月，高清无水印导出 + 每篇 3 次免费重抽。敬请期待～")
            }
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
            <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--color-text-dim)]">
              作品数据仅保存在本机浏览器,清除浏览器数据或长期不访问可能丢失——下载的图片请妥善保存
            </p>
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
