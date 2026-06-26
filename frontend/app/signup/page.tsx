"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Branding
const NAVY = "#1A2744";
const GOLD = "#C8963E";
const INDIGO = "#4338CA";
const BG = "#F7F8FA";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Eye / eye-off SVG toggle shown inside password fields. */
function PasswordToggle({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={visible ? "Hide password" : "Show password"}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        right: 10,
        top: "50%",
        transform: "translateY(-50%)",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        color: hover ? "#374151" : "#6B7280",
      }}
    >
      {visible ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      )}
    </button>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // ── Client-side validation ──────────────────────────────────
    const fullName = name.trim();
    const cleanEmail = email.trim();
    if (!fullName) {
      setError("Please enter your full name.");
      return;
    }
    if (!EMAIL_RE.test(cleanEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      // Store the full name as user metadata so the backend / dashboard can
      // resolve a display name (mirrors displayNameFromToken / _display_name).
      const { error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { full_name: fullName } },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      setSuccess("Account created successfully! Redirecting to login...");
      // Email confirmation is disabled, so the account is ready immediately.
      // Redirect to login after 2 seconds.
      setTimeout(() => router.replace("/login"), 2000);
    } catch (err) {
      setError((err as Error)?.message || "Sign up failed.");
    } finally {
      setLoading(false);
    }
  };

  const input: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #D1D5DB",
    borderRadius: 8,
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    fontFamily: "inherit",
  };

  const fieldLabel: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "#6B7280",
    marginBottom: 5,
  };

  return (
    <div
      style={{
        fontFamily: "'Segoe UI',-apple-system,sans-serif",
        background: BG,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ background: NAVY, padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>Recruit</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: GOLD }}>Craft</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: 8 }}>
              by HYROI Solutions
            </span>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
            Create your account
          </div>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} style={{ padding: 24 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={fieldLabel}>Full name</div>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Recruiter"
              style={input}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={fieldLabel}>Email</div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@hyroi.com"
              style={input}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={fieldLabel}>Password</div>
            <div style={{ position: "relative" }}>
              <input
                type={showPw ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                style={{ ...input, paddingRight: 40 }}
              />
              <PasswordToggle visible={showPw} onClick={() => setShowPw((v) => !v)} />
            </div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <div style={fieldLabel}>Confirm password</div>
            <div style={{ position: "relative" }}>
              <input
                type={showConfirm ? "text" : "password"}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                style={{ ...input, paddingRight: 40 }}
              />
              <PasswordToggle visible={showConfirm} onClick={() => setShowConfirm((v) => !v)} />
            </div>
          </div>

          {error && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                color: "#B91C1C",
                fontSize: 12,
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 14,
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              style={{
                background: "#ECFDF5",
                border: "1px solid #A7F3D0",
                color: "#047857",
                fontSize: 12,
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 14,
              }}
            >
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !!success}
            style={{
              width: "100%",
              padding: "11px 16px",
              background: loading || success ? "#9CA3AF" : INDIGO,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: loading || success ? "default" : "pointer",
            }}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>

          <div
            style={{
              marginTop: 16,
              textAlign: "center",
              fontSize: 12,
              color: "#6B7280",
            }}
          >
            Already have an account?{" "}
            <Link href="/login" style={{ color: INDIGO, fontWeight: 600, textDecoration: "none" }}>
              Log in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
