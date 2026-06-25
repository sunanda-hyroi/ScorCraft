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

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
      setSuccess(
        "Account created successfully! Please check your email to verify, then log in."
      );
      // Redirect to login after 3 seconds.
      setTimeout(() => router.replace("/login"), 3000);
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
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              style={input}
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <div style={fieldLabel}>Confirm password</div>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              style={input}
            />
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
