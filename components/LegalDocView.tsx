import type { LegalDoc } from "@/lib/legal";

// 协议/政策正文展示:登录页内嵌阅读视图与 /terms、/privacy 独立页共用
export default function LegalDocView({ doc }: { doc: LegalDoc }) {
  return (
    <div className="pb-10">
      <p className="mb-5 text-[11px] text-[var(--color-text-dim)]">更新日期:{doc.updated}</p>
      <div className="space-y-5">
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="mb-1.5 text-sm font-bold text-[var(--color-text)]">{s.heading}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="mb-1.5 text-[13px] leading-relaxed text-[var(--color-text-sub)]">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
