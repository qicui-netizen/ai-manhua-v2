"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, saveSession, type AuthMethod } from "@/lib/store";
import LegalDocView from "@/components/LegalDocView";
import { TERMS_DOC, PRIVACY_DOC } from "@/lib/legal";
import styles from "./login.module.css";

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TTL_MS = 5 * 60 * 1000; // 验证码5分钟有效
const RESEND_SECONDS = 60;

// 账号输入自动识别手机号/邮箱(设计稿为单账号输入框,替代旧版双 Tab)
function detectMethod(acc: string): AuthMethod | null {
  if (PHONE_RE.test(acc)) return "phone";
  if (EMAIL_RE.test(acc)) return "email";
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [socialTip, setSocialTip] = useState(false);
  // 演示版:验证码本机生成并直接展示。接真实短信/邮件服务时,把 sendCode 换成调用
  // 服务端发码 API,handleLogin 换成服务端校验,此 state 与演示提示一并删除。
  const [sent, setSent] = useState<{ account: string; code: string; expireAt: number } | null>(null);
  // 内嵌协议阅读视图:切视图不卸载组件,已填的账号/验证码/倒计时全部保留
  const [viewingDoc, setViewingDoc] = useState<"terms" | "privacy" | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 已登录的直接回工作台
  useEffect(() => {
    if (getSession()) router.replace("/");
  }, [router]);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    []
  );

  const method = detectMethod(account.trim());
  const accountValid = method !== null;

  function sendCode() {
    const acc = account.trim();
    if (!accountValid) {
      setError("请输入正确的手机号或邮箱地址");
      return;
    }
    const c = String(Math.floor(100000 + Math.random() * 900000));
    setSent({ account: acc, code: c, expireAt: Date.now() + CODE_TTL_MS });
    setError("");
    setCountdown(RESEND_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return Math.max(0, n - 1);
      });
    }, 1000);
  }

  function handleLogin() {
    const acc = account.trim();
    const m = detectMethod(acc);
    if (!m) {
      setError("请输入正确的手机号或邮箱地址");
      return;
    }
    if (!sent || sent.account !== acc) {
      setError("请先获取验证码");
      return;
    }
    if (Date.now() > sent.expireAt) {
      setError("验证码已过期,请重新获取");
      return;
    }
    if (code.trim() !== sent.code) {
      setError("验证码不正确");
      return;
    }
    if (!agreed) {
      setError("请先勾选同意《用户协议》与《隐私政策》");
      return;
    }
    saveSession({ account: acc, method: m, loginAt: Date.now() });
    router.replace("/");
  }

  if (viewingDoc) {
    const doc = viewingDoc === "terms" ? TERMS_DOC : PRIVACY_DOC;
    return (
      <div className="flex min-h-full flex-col">
        <div className="px-5 pt-8 pb-4">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setViewingDoc(null)}
              aria-label="返回登录"
              className="-ml-2 flex h-9 w-9 items-center justify-center"
            >
              <svg width="10" height="17" viewBox="0 0 10 17" fill="none">
                <path d="M9 1L1 8.5L9 16" stroke="var(--color-primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h1 className="text-xl font-extrabold text-[var(--color-text)]">{doc.title}</h1>
          </div>
        </div>
        <div className="flex-1 px-5">
          <LegalDocView doc={doc} />
        </div>
        <div className="sticky bottom-0 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-bg)] to-transparent px-6 pb-8 pt-6">
          <button
            onClick={() => {
              setAgreed(true);
              setError("");
              setViewingDoc(null);
            }}
            className="pf-btn pf-btn-primary w-full"
          >
            我已阅读并同意
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.bg} aria-hidden />
      <div className={styles.fade} aria-hidden />

      <div className={styles.scroll}>
        {/* 品牌区 */}
        <div className={styles.brand}>
          <div className={styles.logoWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/login/logo-ai-badge.png" alt="AI COMIC" className={styles.logo} />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/login/title-ai-comic.svg" alt="AI COMIC" className={styles.titleImg} />
          <div className={styles.slogan}>
            <span className={styles.sloganLine} />
            <span>Create. Imagine. Comicize.</span>
            <span className={styles.sloganLineR} />
          </div>
        </div>

        {/* 登录卡片 */}
        <div className={styles.card}>
          <div className={styles.field}>
            <span className={styles.fieldIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            </span>
            <input
              className={styles.input}
              type="text"
              maxLength={50}
              placeholder="手机号 / 邮箱"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                setError("");
              }}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.fieldIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="10" width="16" height="11" rx="2.5" />
                <path d="M8 10V7a4 4 0 018 0v3" />
              </svg>
            </span>
            <input
              className={styles.input}
              inputMode="numeric"
              maxLength={6}
              placeholder="验证码"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ""));
                setError("");
              }}
            />
            <button className={styles.codeBtn} onClick={sendCode} disabled={countdown > 0 || !accountValid}>
              {countdown > 0 ? `${countdown}s 重发` : "获取验证码"}
            </button>
          </div>

          {/* 演示模式提示:接入真实短信/邮件服务后删除 */}
          {sent && (
            <div className={styles.demoTip}>
              <span>🧪</span>
              <p className={styles.demoText}>
                演示模式:验证码已“发送”至 {sent.account},本机直接显示:
                <span className={styles.demoCode}>{sent.code}</span>
              </p>
              <button className={styles.demoFill} onClick={() => setCode(sent.code)}>
                填入
              </button>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {/* 协议勾选 */}
          <label className={styles.agree}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => {
                setAgreed(e.target.checked);
                setError("");
              }}
            />
            <span>
              已阅读并同意
              <button
                type="button"
                className={styles.agreeLink}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setViewingDoc("terms");
                }}
              >
                《用户协议》
              </button>
              与
              <button
                type="button"
                className={styles.agreeLink}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setViewingDoc("privacy");
                }}
              >
                《隐私政策》
              </button>
              ,未注册账号将自动完成注册
            </span>
          </label>

          <button className={styles.loginBtn} onClick={handleLogin}>
            <span className={styles.loginBtnText}>登录 / 注册</span>
          </button>
        </div>

        {/* 卡片下方 */}
        <button className={styles.skip} onClick={() => router.replace("/")}>
          暂不登录，先逛逛 →
        </button>

        <div className={styles.continueRow}>
          <span>其他登录方式</span>
        </div>
        <div className={styles.socials}>
          <button className={styles.social} aria-label="Google 登录(即将上线)" onClick={() => setSocialTip(true)}>
            <svg width="28" height="28" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" />
              <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 010-4.2V7.06H2.18a11 11 0 000 9.88l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 002.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
            </svg>
          </button>
          <button className={styles.social} aria-label="Apple 登录(即将上线)" onClick={() => setSocialTip(true)}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#000">
              <path d="M16.37 12.7c-.03-2.5 2.04-3.7 2.13-3.76-1.16-1.7-2.97-1.93-3.61-1.96-1.54-.16-3 .9-3.78.9-.78 0-1.98-.88-3.25-.86-1.67.02-3.21.97-4.07 2.47-1.73 3-.44 7.45 1.25 9.88.82 1.19 1.8 2.53 3.08 2.48 1.24-.05 1.7-.8 3.2-.8 1.49 0 1.91.8 3.22.77 1.33-.02 2.17-1.21 2.98-2.41.94-1.38 1.33-2.72 1.35-2.79-.03-.01-2.6-1-2.63-3.96zM14.16 5.1c.68-.83 1.14-1.98 1.02-3.13-.98.04-2.17.65-2.88 1.48-.63.73-1.19 1.9-1.04 3.02 1.09.09 2.21-.55 2.9-1.37z" />
            </svg>
          </button>
          <button className={styles.social} aria-label="Facebook 登录(即将上线)" onClick={() => setSocialTip(true)}>
            <svg width="28" height="28" viewBox="0 0 24 24">
              <path fill="#1877F2" d="M24 12a12 12 0 10-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0024 12z" />
              <path fill="#fff" d="M16.67 15.47L17.2 12h-3.32v-2.25c0-.95.46-1.87 1.95-1.87h1.51V4.93s-1.37-.24-2.68-.24c-2.74 0-4.53 1.66-4.53 4.67V12H7.08v3.47h3.04v8.38a12.1 12.1 0 003.76 0v-8.38h2.79z" />
            </svg>
          </button>
        </div>
        {socialTip && <p className={styles.socialTip}>第三方登录即将上线,现在可以用手机号 / 邮箱直接登录~</p>}

        <p className={styles.footnote}>
          演示版说明:登录信息仅保存在本机浏览器,
          <br />
          未接入真实短信/邮件服务,不会向外发送任何信息
        </p>
      </div>
    </div>
  );
}
