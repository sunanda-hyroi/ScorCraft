"use client";
import { useMemo, useState } from "react";

// Job Management Dashboard (Feature 2). Renders all jobs as a searchable,
// filterable, sortable card grid. Click a card to select it and advance to the
// upload step. Each card has a kebab menu (Edit / Duplicate / Archive / Delete).
// Branding: navy #1A2744, gold #C8963E.
const NAVY = "#1A2744";
const GOLD = "#C8963E";
const PAGE_SIZE = 12;

const STATUS_STYLES = {
  active: { bg: "#ECFDF5", color: "#059669", label: "Active" },
  draft: { bg: "#F3F4F6", color: "#6B7280", label: "Draft" },
  archived: { bg: "#FEF2F2", color: "#DC2626", label: "Archived" },
};

const TABS = ["All", "Active", "Draft", "Archived"];
const SORTS = [
  { key: "newest", label: "Newest first" },
  { key: "candidates", label: "Most candidates" },
  { key: "alpha", label: "Alphabetical" },
];

function statusOf(job) {
  return (job.status || "active").toLowerCase();
}

function skillsCount(job) {
  return (
    (job.must_have_skills?.length || 0) +
    (job.good_to_have_skills?.length || 0) +
    (job.bonus_skills?.length || 0)
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

export default function JobDashboard({ jobs, onSelect, onCreate, onEdit, onDuplicate, onArchive, onDelete, busy }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("All");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [menuFor, setMenuFor] = useState(null); // job id whose kebab menu is open

  const counts = useMemo(() => {
    const c = { All: jobs.length, Active: 0, Draft: 0, Archived: 0 };
    for (const j of jobs) {
      const s = statusOf(j);
      if (s === "active") c.Active++;
      else if (s === "draft") c.Draft++;
      else if (s === "archived") c.Archived++;
    }
    return c;
  }, [jobs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = jobs.filter((j) => {
      if (tab !== "All" && statusOf(j) !== tab.toLowerCase()) return false;
      if (!q) return true;
      return (
        (j.title || "").toLowerCase().includes(q) ||
        (j.company || "").toLowerCase().includes(q)
      );
    });
    list = [...list].sort((a, b) => {
      if (sort === "candidates") return (b.candidates_scored_count || 0) - (a.candidates_scored_count || 0);
      if (sort === "alpha") return (a.title || "").localeCompare(b.title || "");
      // newest
      return (b.created_at || "").localeCompare(a.created_at || "");
    });
    return list;
  }, [jobs, query, tab, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Empty state — no jobs at all in the workspace.
  if (jobs.length === 0) {
    return (
      <div className="max-w-5xl mx-auto py-16 text-center">
        <div className="text-5xl mb-4">📋</div>
        <h1 className="text-2xl font-bold text-[#1A2744] mb-2">No jobs yet</h1>
        <p className="text-gray-500 mb-6">Create your first job to start scoring resumes against it.</p>
        <button onClick={onCreate} className="px-8 py-3 bg-[#C8963E] text-white rounded-lg text-sm font-semibold hover:bg-[#B07F2E] transition">
          + Create your first job
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto" onClick={() => setMenuFor(null)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2744]">Jobs</h1>
          <p className="text-sm text-gray-500">{jobs.length} job{jobs.length === 1 ? "" : "s"} in your workspace</p>
        </div>
        <button onClick={onCreate} className="px-5 py-2.5 bg-[#C8963E] text-white rounded-lg text-sm font-semibold hover:bg-[#B07F2E] transition shrink-0">
          + Create new job
        </button>
      </div>

      {/* Controls: search + sort */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="🔍 Search by title or company…"
          className="flex-1 min-w-[220px] border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#1A2744]"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#1A2744] bg-white"
        >
          {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
        </select>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              tab === t ? "border-[#1A2744] text-[#1A2744]" : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            {t} <span className="text-xs text-gray-400">({counts[t] ?? 0})</span>
          </button>
        ))}
      </div>

      {busy && <div className="text-xs text-[#4338CA] mb-3">{busy}</div>}

      {/* No results for current filter/search */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-16 text-sm">No jobs match your search or filter.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pageItems.map((job) => {
            const st = STATUS_STYLES[statusOf(job)] || STATUS_STYLES.active;
            const version = job.version || 1;
            return (
              <div
                key={job.id}
                onClick={() => onSelect(job)}
                className="relative bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-[#1A2744]/30 transition cursor-pointer flex flex-col"
              >
                {/* Top row: status + version + kebab */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                    {version > 1 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EEF2FF] text-[#4338CA]">v{version}</span>
                    )}
                  </div>
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === job.id ? null : job.id); }}
                      className="text-gray-400 hover:text-gray-700 px-1.5 rounded text-lg leading-none"
                      aria-label="Job actions"
                    >
                      ⋯
                    </button>
                    {menuFor === job.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-7 z-10 w-36 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm"
                      >
                        <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setMenuFor(null); onEdit(job); }}>✏️ Edit</button>
                        <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setMenuFor(null); onDuplicate(job); }}>📑 Duplicate</button>
                        {statusOf(job) !== "archived" && (
                          <button className="w-full text-left px-3 py-1.5 hover:bg-gray-50" onClick={() => { setMenuFor(null); onArchive(job); }}>🗄️ Archive</button>
                        )}
                        <button className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600" onClick={() => { setMenuFor(null); onDelete(job); }}>🗑️ Delete</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Title + company */}
                <div className="font-semibold text-[#1A2744] leading-snug mb-0.5">{job.title || "Untitled job"}</div>
                <div className="text-xs text-gray-500 mb-3">{job.company || "No company"}</div>

                {/* Meta row */}
                <div className="mt-auto flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-100">
                  <span>💡 {skillsCount(job)} skill{skillsCount(job) === 1 ? "" : "s"}</span>
                  <span className="font-semibold text-[#1A2744]">
                    👥 {job.candidates_scored_count || 0} scored
                  </span>
                </div>
                <div className="text-[10px] text-gray-400 mt-2">Created {fmtDate(job.created_at)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500">Page {safePage} of {totalPages}</span>
          <button
            disabled={safePage >= totalPages}
            onClick={() => setPage(safePage + 1)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
