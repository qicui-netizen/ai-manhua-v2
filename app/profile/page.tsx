"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadProjects, getQuota, getPlanClient, setPlanClient, FREE_MONTHLY_QUOTA, type Plan } from "@/lib/store";
import type { Project } from "@/lib/types";

export default function ProfilePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [quota, setQuota] = useState(FREE_MONTHLY_QUOTA);
  const [plan, setPlan] = useState<Plan>("free");

  useEffect(() => {
    const refresh = () => {
      setProjects(loadProjects());
      setQuota(getQuota());
      setPlan(getPlanClient());
    };
    refresh();
    window.addEventListener("pf:update", refresh);
    return () => window.removeEventListener("pf:update", refresh);
  }, []);

  const exportedCount = projects.reduce((sum, p) => sum + p.exports, 0);
  const usedQuota = FREE_MONTHLY_QUOTA - quota;

  function handleUpgrade() {
    if (plan === "member") return;
    setPlanClient("member");
    alert("演示版：已切换为会员（未接入真实支付）");
  }

  return (
    <div className="flex min-h-full flex-col pb-24">
      <div className="px-5 pt-8 pb-3">
        <h1 className="text-xl font-extrabold text-[var(--color-text)]">我的</h1>
      </div>

      <div className="flex-1 px-5">
        {/* 套餐卡 */}
        <div className="pf-card mb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[15px] font-bold text-[var(--color-text)]">
                  {plan === "member" ? "会员版" : "免费版"}
                </span>
                {plan === "member" && (
                  <span className="rounded-full bg-[rgba(124,58,237,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary-light)]">
                    高清 · 无水印
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-sub)]">
                本月剩余额度 {quota}/{FREE_MONTHLY_QUOTA}
              </p>
            </div>
            {plan !== "member" && (
              <button onClick={handleUpgrade} className="pf-btn pf-btn-primary !min-h-9 !py-2 !px-4 text-sm">
                升级会员
              </button>
            )}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-light)]"
              style={{ width: `${FREE_MONTHLY_QUOTA ? (usedQuota / FREE_MONTHLY_QUOTA) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* 统计 */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="pf-card text-center">
            <p className="text-2xl font-extrabold text-[var(--color-text)]">{projects.length}</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-dim)]">创作作品</p>
          </div>
          <div className="pf-card text-center">
            <p className="text-2xl font-extrabold text-[var(--color-text)]">{exportedCount}</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-dim)]">导出次数</p>
          </div>
        </div>

        {/* 历史作品 */}
        <p className="mb-2 text-[13px] font-bold text-[var(--color-text)]">我的作品</p>
        {projects.length === 0 ? (
          <div className="pf-card flex flex-col items-center gap-2 py-8 text-center text-[var(--color-text-dim)]">
            <div className="text-3xl">🖋️</div>
            <p className="text-sm">还没有创作过短篇</p>
            <button onClick={() => router.push("/")} className="pf-btn pf-btn-secondary !min-h-9 !py-2 !px-4 text-sm">
              去创作
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => router.push(`/project/${p.id}/storyboard`)}
                className="pf-card flex cursor-pointer items-center gap-3"
              >
                <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl bg-[var(--color-surface-2)]">
                  {p.panels.find((pn) => pn.imageUrl)?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.panels.find((pn) => pn.imageUrl)!.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg">🖼️</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-[var(--color-text)]">{p.title}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">
                    {p.panelCount} 格 · {p.exports > 0 ? `已导出 ${p.exports} 次` : "未导出"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
