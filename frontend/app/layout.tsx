import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScorCraft by HYROI Solutions",
  description:
    "Score resumes with AI, then craft shortlisted ones into polished documents.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
