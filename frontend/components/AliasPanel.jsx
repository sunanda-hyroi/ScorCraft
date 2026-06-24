"use client";
import { useState, useEffect } from "react";
import * as api from "@/lib/api";

// Ported from ScorQ (components/AliasPanel.tsx), restyled to ScorCraft branding
// (navy #1A2744 for aliases, gold #C8963E for equivalents). Suggests AI aliases
// + equivalents for a skill so the scorer can also match those in resumes.
export default function AliasPanel({
  skill,
  existingAliases = [],
  existingEquivalents = [],
  onSave,
  onDismiss,
}) {
  const [loading, setLoading] = useState(true);
  const [aliases, setAliases] = useState([]);
  const [equivalents, setEquivalents] = useState([]);
  const [selAliases, setSelAliases] = useState(new Set());
  const [selEquivs, setSelEquivs] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await api.suggestAliases(skill);
        if (cancelled) return;
        const newAliases = (data.aliases || []).filter((a) => !existingAliases.includes(a));
        const newEquivs = (data.equivalents || []).filter((e) => !existingEquivalents.includes(e));
        const allAliases = [...existingAliases, ...newAliases];
        const allEquivs = [...existingEquivalents, ...newEquivs];
        setAliases(allAliases);
        setEquivalents(allEquivs);
        setSelAliases(new Set(allAliases)); // pre-select all by default
        setSelEquivs(new Set(allEquivs));
      } catch {
        if (cancelled) return;
        setAliases(existingAliases);
        setEquivalents(existingEquivalents);
        setSelAliases(new Set(existingAliases));
        setSelEquivs(new Set(existingEquivalents));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill]);

  const toggle = (setter) => (val) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(val) ? next.delete(val) : next.add(val);
      return next;
    });
  const toggleAlias = toggle(setSelAliases);
  const toggleEquiv = toggle(setSelEquivs);

  const handleSave = () => onSave(Array.from(selAliases), Array.from(selEquivs));

  return (
    <div className="mt-2 mb-1 rounded-xl border border-[#1A2744]/20 bg-[#1A2744]/[0.04] p-3 text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-[#1A2744]">
          ✨ Also search for these in the resume
        </span>
        <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 text-xs">
          Dismiss
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-[#1A2744] animate-pulse">Finding similar keywords...</p>
      ) : (
        <>
          {aliases.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] font-semibold text-[#1A2744] uppercase tracking-wide mb-1.5">
                Same skill — different name (100% match if found)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {aliases.map((a) => (
                  <button
                    key={a}
                    onClick={() => toggleAlias(a)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition ${
                      selAliases.has(a)
                        ? "bg-[#1A2744] text-white border-[#1A2744]"
                        : "bg-white text-gray-400 border-gray-200 line-through"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}

          {equivalents.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] font-semibold text-[#C8963E] uppercase tracking-wide mb-1.5">
                Similar skill (90% match if found)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {equivalents.map((e) => (
                  <button
                    key={e}
                    onClick={() => toggleEquiv(e)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition ${
                      selEquivs.has(e)
                        ? "bg-[#C8963E] text-white border-[#C8963E]"
                        : "bg-white text-gray-400 border-gray-200 line-through"
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {aliases.length === 0 && equivalents.length === 0 && (
            <p className="text-xs text-gray-400 italic">No suggestions found for this skill.</p>
          )}

          <p className="text-[10px] text-gray-500 mb-2">
            Click to toggle. Solid = used in scoring. Strikethrough = excluded.
            These are NOT added as separate skills.
          </p>

          <div className="flex gap-2">
            <button
              onClick={onDismiss}
              className="px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs font-semibold bg-[#1A2744] text-white rounded-lg hover:bg-[#0F1B30]"
            >
              Save — attach to {skill}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
