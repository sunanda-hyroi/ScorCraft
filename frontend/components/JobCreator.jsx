"use client";
import { useState } from "react";
import * as api from "@/lib/api";
import AliasPanel from "@/components/AliasPanel";

// Ported from ScorQ (app/jobs/new/page.tsx) into ScorCraft as an embedded
// component. Same flow — JD paste → AI keyword extraction → manual skill add →
// must/good/bonus importance → per-skill alias suggestions → experience /
// education / custom instructions. Restyled to ScorCraft branding
// (navy #1A2744, gold #C8963E). On save it calls onCreated(job).
//
// Note: scoring weights (Technical 40%, Experience 25%, Education 15%,
// Soft Skills 10%, Stability 10%) are hardcoded in the ScorQ backend scoring
// logic — they are NOT user-configurable, so there is no weights UI here and
// no weight fields are sent on save.
// Build the editor form state from an existing job row (edit/duplicate), or a
// blank form for a brand-new job. Reconstructs required_skills:[{skill,importance}]
// from the job's required_skills column if present, else from the
// must/good/bonus arrays.
function buildInitialForm(job) {
  if (!job) {
    return {
      title: "", description: "", experience_min: 0, experience_max: 0,
      education_required: "", custom_instructions: "", required_skills: [],
      nice_to_have_skills: [], skill_importance: {}, skill_aliases: {}, skill_equivalents: {},
    };
  }
  let req = Array.isArray(job.required_skills) && job.required_skills.length
    ? job.required_skills.map((s) => (typeof s === "string"
        ? { skill: s, importance: "must" }
        : { skill: s.skill, importance: s.importance || "must" }))
    : null;
  if (!req) {
    req = [];
    (job.must_have_skills || []).forEach((s) => req.push({ skill: s, importance: "must" }));
    (job.good_to_have_skills || []).forEach((s) => req.push({ skill: s, importance: "good" }));
    (job.bonus_skills || []).forEach((s) => req.push({ skill: s, importance: "bonus" }));
  }
  const skill_importance = {};
  req.forEach((r) => { skill_importance[r.skill] = r.importance; });
  return {
    title: job.title || "", description: job.description || "",
    experience_min: job.experience_min || 0, experience_max: job.experience_max || 0,
    education_required: job.education_required || "", custom_instructions: job.custom_instructions || "",
    required_skills: req, nice_to_have_skills: job.nice_to_have_skills || [],
    skill_importance, skill_aliases: job.skill_aliases || {}, skill_equivalents: job.skill_equivalents || {},
  };
}

// `job` (optional): when provided, the form opens pre-filled for editing. When
// `duplicate` is true, the job's fields seed a brand-new job (saved via create,
// not update). `scoredCount` drives the versioning notice (Feature 3).
export default function JobCreator({ onCreated, onCancel, job = null, duplicate = false, scoredCount = 0 }) {
  const isEdit = !!job && !duplicate;
  const [saving, setSaving] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState("");

  // Extracted keywords preview (before adding to required skills)
  const [extracted, setExtracted] = useState([]);
  const [showExtracted, setShowExtracted] = useState(false);

  // Manual skill input + alias state
  const [skillInput, setSkillInput] = useState("");
  const [showAlias, setShowAlias] = useState(null);
  const [skillAliases, setSkillAliases] = useState(job?.skill_aliases || {});
  const [skillEquivalents, setSkillEquivalents] = useState(job?.skill_equivalents || {});

  const [form, setForm] = useState(() => buildInitialForm(duplicate && job
    ? { ...job, title: `${job.title || "Job"} (Copy)` }
    : job));

  // ── Extract keywords from JD ─────────────────────────────────────────────
  const handleExtract = async () => {
    if (!form.description.trim()) {
      setError("Please paste a JD first");
      return;
    }
    setAnalysing(true);
    setError("");
    try {
      const skills = await api.extractSkills(form.description);
      if (skills && skills.length > 0) {
        const existing = new Set(form.required_skills.map((s) => s.skill.toLowerCase()));
        const fresh = skills.filter((s) => !existing.has(s.toLowerCase()));
        setExtracted(fresh);
        setShowExtracted(true);
      } else {
        setError("Could not extract keywords. Please add skills manually below.");
      }
    } catch (e) {
      setError(`Extraction failed: ${e?.message || "Unknown error"}`);
    } finally {
      setAnalysing(false);
    }
  };

  const removeExtracted = (skill) => setExtracted((prev) => prev.filter((s) => s !== skill));

  const handleAddToRequired = () => {
    if (extracted.length === 0) return;
    const newSkills = extracted.map((skill) => ({ skill, importance: "must" }));
    const newImp = {};
    extracted.forEach((s) => { newImp[s] = "must"; });
    setForm((f) => ({
      ...f,
      required_skills: [...f.required_skills, ...newSkills],
      skill_importance: { ...f.skill_importance, ...newImp },
    }));
    setExtracted([]);
    setShowExtracted(false);
  };

  // ── Manual skill add ─────────────────────────────────────────────────────
  const addSkill = () => {
    const skill = skillInput.trim();
    if (!skill) return;
    if (form.required_skills.find((s) => s.skill.toLowerCase() === skill.toLowerCase())) {
      setSkillInput("");
      return;
    }
    setForm((f) => ({
      ...f,
      required_skills: [...f.required_skills, { skill, importance: "must" }],
      skill_importance: { ...f.skill_importance, [skill]: "must" },
    }));
    setSkillInput("");
    setShowAlias(skill); // auto-open alias panel for the new skill
  };

  const handleAliasSave = (skill, aliases, equivalents) => {
    setSkillAliases((prev) => ({ ...prev, [skill]: aliases }));
    setSkillEquivalents((prev) => ({ ...prev, [skill]: equivalents }));
    setShowAlias(null);
    setForm((f) => ({
      ...f,
      skill_aliases: { ...f.skill_aliases, [skill]: aliases },
      skill_equivalents: { ...f.skill_equivalents, [skill]: equivalents },
    }));
  };

  const removeSkill = (skill) =>
    setForm((f) => ({
      ...f,
      required_skills: f.required_skills.filter((s) => s.skill !== skill),
      skill_importance: Object.fromEntries(
        Object.entries(f.skill_importance).filter(([k]) => k !== skill)
      ),
    }));

  const setImportance = (skill, importance) =>
    setForm((f) => ({
      ...f,
      required_skills: f.required_skills.map((s) =>
        s.skill === skill ? { ...s, importance } : s
      ),
      skill_importance: { ...f.skill_importance, [skill]: importance },
    }));

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.title.trim()) { setError("Job title is required"); return; }
    setSaving(true);
    setError("");
    try {
      // Edit → PUT (may create a new version server-side when the job has scored
      // candidates). Create / Duplicate → POST a brand-new job.
      const saved = isEdit ? await api.updateJob(job.id, form) : await api.createJob(form);
      onCreated?.(saved);
    } catch (e) {
      setError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        {onCancel && (
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-sm">
            ← Back
          </button>
        )}
        <h1 className="text-2xl font-bold text-[#1A2744]">
          {isEdit ? "Edit Job" : duplicate ? "Duplicate Job" : "New Job Description"}
        </h1>
      </div>

      {/* Versioning notice — editing a job with scored candidates creates v(N+1). */}
      {isEdit && scoredCount > 0 && (
        <div className="bg-[#EEF2FF] border border-[#4338CA]/30 text-[#3730A3] px-4 py-3 rounded-lg mb-5 text-sm">
          This job has <strong>{scoredCount}</strong> scored candidate{scoredCount === 1 ? "" : "s"}. Saving will
          create <strong>version {(job.version || 1) + 1}</strong> — the previous scores stay preserved under
          version {job.version || 1}.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-5 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-5">
        {/* ── Basic Info ── */}
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-5 space-y-4">
          <h2 className="font-semibold text-[#1A2744]">📋 Basic Information</h2>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Job Title *
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#1A2744]"
              placeholder="e.g. Senior Power BI Developer"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Min Experience (yrs)
              </label>
              <input
                type="number"
                min={0}
                value={form.experience_min}
                onChange={(e) => setForm((f) => ({ ...f, experience_min: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#1A2744]"
              />
              {form.experience_min === 0 && form.experience_max === 0 && (
                <p className="text-xs text-gray-400 mt-1">0 = any experience accepted</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Max Experience (yrs)
              </label>
              <input
                type="number"
                min={0}
                value={form.experience_max}
                onChange={(e) => setForm((f) => ({ ...f, experience_max: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#1A2744]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Minimum Qualification
              </label>
              <select
                value={form.education_required}
                onChange={(e) => setForm((f) => ({ ...f, education_required: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#1A2744]"
              >
                <option value="">Not Specified</option>
                <option value="High School">High School / 12th</option>
                <option value="Diploma">Diploma / ITI</option>
                <option value="Bachelor's">Bachelor's / B.Tech / B.E</option>
                <option value="Master's">Master's / M.Tech / MBA</option>
                <option value="PhD">PhD / Doctorate</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── JD Text + Keyword Extraction ── */}
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-5 space-y-4">
          <div>
            <h2 className="font-semibold text-[#1A2744]">📄 Job Description (optional)</h2>
            <p className="text-xs text-gray-400 mt-1">
              Paste your JD and click Extract Keywords — or skip and add skills directly below.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                JD Text
              </label>
              <button
                onClick={handleExtract}
                disabled={analysing || !form.description.trim()}
                className="flex items-center gap-1.5 text-xs font-semibold bg-[#1A2744] text-white px-3 py-1.5 rounded-lg hover:bg-[#0F1B30] disabled:opacity-40 transition"
              >
                {analysing ? "⏳ Extracting..." : "🔍 Extract Keywords"}
              </button>
            </div>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={5}
              className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#1A2744] resize-none"
              placeholder="Paste your full job description here..."
            />
          </div>

          {showExtracted && extracted.length > 0 && (
            <div className="bg-[#1A2744]/[0.04] border border-[#1A2744]/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[#1A2744]">
                  ✨ {extracted.length} keywords found — remove any you don't want, then add to skills
                </p>
                <button
                  onClick={() => { setShowExtracted(false); setExtracted([]); }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Dismiss
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {extracted.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 bg-white border border-[#1A2744]/20 text-[#1A2744] text-xs font-medium px-3 py-1.5 rounded-full"
                  >
                    {skill}
                    <button
                      onClick={() => removeExtracted(skill)}
                      className="text-gray-300 hover:text-red-500 font-bold ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <button
                onClick={handleAddToRequired}
                className="w-full bg-[#1A2744] text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-[#0F1B30] transition"
              >
                → Add {extracted.length} keyword{extracted.length > 1 ? "s" : ""} to Required Skills
              </button>
            </div>
          )}
        </div>

        {/* ── Required Skills ── */}
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-5 space-y-4">
          <div>
            <h2 className="font-semibold text-[#1A2744]">💡 Required Skills</h2>
            <p className="text-xs text-gray-400 mt-1">
              Set importance for each skill. Missing{" "}
              <span className="text-red-600 font-medium">Must Have</span> skills significantly
              reduce the technical score.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSkill()}
              className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#1A2744]"
              placeholder="Type a skill and press Enter (e.g. Power BI, Python, AWS)"
            />
            <button
              onClick={addSkill}
              className="bg-[#1A2744] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#0F1B30]"
            >
              Add
            </button>
          </div>

          {form.required_skills.length === 0 ? (
            <div className="bg-[#C8963E]/10 border border-[#C8963E]/30 rounded-lg px-4 py-3 text-sm text-[#8a6320]">
              ⚠️ No skills added yet. Extract from JD above or add manually.
            </div>
          ) : (
            <div className="space-y-2">
              {form.required_skills.map(({ skill, importance }) => (
                <div key={skill} className="space-y-1">
                  <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="flex-1 text-sm font-medium text-gray-800">{skill}</span>
                    <div className="flex gap-1">
                      {["must", "good", "bonus"].map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setImportance(skill, opt)}
                          className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
                            importance === opt
                              ? opt === "must"
                                ? "bg-red-100 text-red-700"
                                : opt === "good"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-green-100 text-green-700"
                              : "bg-white border border-gray-200 text-gray-400 hover:bg-gray-100"
                          }`}
                        >
                          {opt === "must" ? "Must Have" : opt === "good" ? "Good to Have" : "Bonus"}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => removeSkill(skill)}
                      className="text-red-400 hover:text-red-600 text-xs font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  {showAlias === skill && (
                    <AliasPanel
                      skill={skill}
                      existingAliases={skillAliases[skill] || []}
                      existingEquivalents={skillEquivalents[skill] || []}
                      onSave={(aliases, equivalents) => handleAliasSave(skill, aliases, equivalents)}
                      onDismiss={() => setShowAlias(null)}
                    />
                  )}

                  {showAlias !== skill &&
                    (skillAliases[skill]?.length > 0 || skillEquivalents[skill]?.length > 0) && (
                      <div className="flex items-center gap-2 px-1 flex-wrap">
                        {skillAliases[skill]?.map((a) => (
                          <span
                            key={a}
                            className="text-[10px] bg-[#1A2744]/[0.06] text-[#1A2744] border border-[#1A2744]/15 px-2 py-0.5 rounded-full"
                          >
                            {a}
                          </span>
                        ))}
                        {skillEquivalents[skill]?.map((e) => (
                          <span
                            key={e}
                            className="text-[10px] bg-[#C8963E]/10 text-[#8a6320] border border-[#C8963E]/30 px-2 py-0.5 rounded-full"
                          >
                            ~{e}
                          </span>
                        ))}
                        <button
                          onClick={() => setShowAlias(skill)}
                          className="text-[10px] text-[#1A2744] hover:underline"
                        >
                          edit
                        </button>
                      </div>
                    )}

                  {showAlias !== skill &&
                    !skillAliases[skill]?.length &&
                    !skillEquivalents[skill]?.length && (
                      <button
                        onClick={() => setShowAlias(skill)}
                        className="text-[10px] text-[#1A2744]/70 hover:text-[#1A2744] px-1"
                      >
                        + suggest aliases
                      </button>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Custom Instructions ── */}
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-5 space-y-3">
          <div>
            <h2 className="font-semibold text-[#1A2744]">🤖 Custom AI Instructions</h2>
            <p className="text-xs text-gray-400 mt-1">
              Optional hints for the AI. E.g. "Prefer product company backgrounds."
            </p>
          </div>
          <textarea
            value={form.custom_instructions}
            onChange={(e) => setForm((f) => ({ ...f, custom_instructions: e.target.value }))}
            rows={2}
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#1A2744]"
            placeholder='e.g. "Prefer candidates from product companies. Penalise frequent job changes."'
          />
        </div>

        {/* ── Save ── */}
        <div className="flex justify-end gap-3 pb-8">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-6 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-8 py-2.5 bg-[#C8963E] text-white rounded-lg text-sm font-semibold hover:bg-[#B07F2E] disabled:opacity-50 transition"
          >
            {saving ? "Saving..." : isEdit ? "💾 Save changes" : "💾 Save Job"}
          </button>
        </div>
      </div>
    </div>
  );
}
