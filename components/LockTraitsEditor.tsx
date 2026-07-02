"use client";
// 角色特征锁定编辑器:下拉选择三档锁定等级,三档颜色明确区分。
// 新建角色第2步与角色库的"再次调整"共用,保证交互一致。
import type { LockLevel } from "@/lib/types";

export type LockedTraits = { face: LockLevel; hair: LockLevel; outfit: LockLevel; color: LockLevel };

const LOCK_LEVELS: LockLevel[] = ["强锁定", "弱锁定", "不锁定"];

// 强=主题紫(醒目) / 弱=琥珀橙 / 不锁=暗灰,三档一眼可分
const LOCK_STYLE: Record<LockLevel, { color: string; bg: string; border: string }> = {
  强锁定: { color: "#fff", bg: "var(--color-primary)", border: "var(--color-primary)" },
  弱锁定: { color: "#F59E0B", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.5)" },
  不锁定: { color: "var(--color-text-dim)", bg: "var(--color-surface)", border: "var(--color-border)" },
};

const FIELDS = [
  { key: "face", label: "面部", emoji: "👤" },
  { key: "hair", label: "发色", emoji: "💇" },
  { key: "outfit", label: "主服装", emoji: "👗" },
  { key: "color", label: "色调", emoji: "🎨" },
] as const;

export default function LockTraitsEditor({
  value,
  onChange,
}: {
  value: LockedTraits;
  onChange: (v: LockedTraits) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {FIELDS.map((f) => {
        const level = value[f.key];
        const s = LOCK_STYLE[level];
        return (
          <div key={f.key} className="flex items-center gap-3 rounded-xl bg-[var(--color-surface-2)] p-3">
            <span className="text-xl">{f.emoji}</span>
            <p className="flex-1 text-[13px] text-[var(--color-text)]">{f.label}</p>
            <select
              value={level}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value as LockLevel })}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-bold"
              style={{ color: s.color, background: s.bg, borderColor: s.border }}
            >
              {LOCK_LEVELS.map((l) => (
                <option key={l} value={l} style={{ color: "#111", background: "#fff" }}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <p className="text-[11px] leading-relaxed text-[var(--color-text-dim)]">
        强锁定：AI 严格保持该特征 · 弱锁定：允许轻微变化 · 不锁定：交给 AI 自由发挥
      </p>
    </div>
  );
}
