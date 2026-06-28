"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import * as api from "@/lib/api";
import { supabase, TOKEN_KEY } from "@/lib/supabase";
import JobCreator from "@/components/JobCreator";
import JobDashboard from "@/components/JobDashboard";
import {
  scoreResultToCandidate,
  dbScoreRowToCandidate,
  applyCraftResult,
  candidateToStructured,
  craftSettingsFrom,
} from "@/lib/mappers";

// ─── Colors ──────────────────────────────────────────────────────
const NAVY = "#1A2744";
const GOLD = "#C8963E";
const INDIGO = "#4338CA";
const BG = "#F7F8FA";

// Hardcoded ScorQ scoring weights — shown for reference only; the backend owns
// these and they are not user-configurable. Also used as the display fallback
// when a job row predates the weight_* columns.
const DEFAULT_WEIGHTS = { technical: 40, experience: 25, education: 15, soft_skills: 10, stability: 10 };

// Neutral display shape for the results/scorecard views when no live job is
// selected (no mock job — real jobs come from GET /api/v1/jobs).
const EMPTY_JOB_VIEW = { title: "Job", weights: DEFAULT_WEIGHTS, mustHave: [], goodToHave: [], bonus: [], skills: [] };

// Derive a readable current-user name from the Supabase JWT (user_metadata
// name, else the email local-part) — mirrors the backend _display_name so the
// dashboard can auto-select the logged-in user in the "Created by" filter.
function displayNameFromToken(token) {
  try {
    if (!token) return "";
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const meta = payload.user_metadata || {};
    const nm = meta.name || meta.full_name || meta.display_name;
    if (nm && String(nm).trim()) return String(nm).trim();
    const email = payload.email || "";
    return email ? email.split("@")[0] : "";
  } catch {
    return "";
  }
}

// ─── Action items (Feature 1) ────────────────────────────────────
// Build the recruiter's INTERNAL action-item checklist for a candidate. The SET
// of items is stable (driven by the craft-time missing_report + the score's
// missing must-have skills); resolution is computed live against the candidate's
// current editor state. `auto` semantics:
//   true      → auto-resolved (field now filled) → auto-ticked + grayed, locked
//   false     → field still empty → recruiter can tick manually if they prefer
//   undefined → manual-only (not editable here, e.g. notice period / LinkedIn)
// NOTE: action items are internal only — they live in editor state, never in
// structured_data, and are never written to any downloaded document.
function buildActionItems(c, mustHave = []) {
  const mr = c.missingReport || {};
  const flagged = [...(mr.missing_sections || []), ...(mr.warnings || [])];
  const txt = (v) => !!(v && String(v).trim());
  const items = [];
  // Every flagged issue becomes an item; ones tied to an editable field get an
  // `auto` predicate so filling the field auto-resolves them (the rest are
  // manual — e.g. notice period / LinkedIn aren't editable in this form).
  flagged.forEach((label, idx) => {
    let auto; // undefined = manual checkbox
    if (/email/i.test(label)) auto = txt(c.email);
    else if (/phone/i.test(label)) auto = txt(c.phone);
    else if (/location/i.test(label)) auto = txt(c.location);
    else if (/education/i.test(label)) auto = (c.education?.length || 0) > 0;
    else if (/summary/i.test(label)) auto = (c.executive_summary?.length || 0) >= 5;
    else if (/expiry/i.test(label)) {
      const certs = c.certifications || [];
      auto = certs.length > 0 && certs.every((ct) => txt(ct.expiry));
    }
    items.push({ id: "mr-" + idx, label: label.replace(/\s*—\s*ask candidate\s*$/i, ""), auto });
  });
  // Missing must-have skills from the score (manual acknowledgement).
  const mh = (mustHave || []).map((m) => String(m).toLowerCase());
  (c.missing || []).filter((s) => mh.includes(String(s).toLowerCase()))
    .forEach((s) => items.push({ id: "skill-" + s, label: `Missing must-have skill: ${s}` }));
  return items;
}

// Normalize a live job row into the shape the UI renders (chips + weights).
function jobView(job) {
  if (!job) return null;
  // Real job_descriptions schema: must/good/bonus arrays + weight_* columns.
  const weights = {
    technical: job.weight_technical ?? DEFAULT_WEIGHTS.technical,
    experience: job.weight_experience ?? DEFAULT_WEIGHTS.experience,
    education: job.weight_education ?? DEFAULT_WEIGHTS.education,
    soft_skills: job.weight_soft_skills ?? DEFAULT_WEIGHTS.soft_skills,
    stability: job.weight_stability ?? DEFAULT_WEIGHTS.stability,
  };
  const mustHave = job.must_have_skills || [];
  const goodToHave = job.good_to_have_skills || [];
  const bonus = job.bonus_skills || [];
  return {
    title: job.title,
    weights,
    mustHave,
    goodToHave,
    bonus,
    skills: [...mustHave, ...goodToHave, ...bonus],
  };
}

// Mock candidate data removed — the results view is driven entirely by live
// scored data from the backend (POST /api/v1/scoring/batch and
// GET /api/v1/results?job_id=...). When nothing has been scored, the results
// step renders an empty state instead of placeholder candidates.

// ─── Helpers ─────────────────────────────────────────────────────
const sColor = s => s >= 75 ? "#059669" : s >= 55 ? "#D97706" : "#DC2626";
const sBg = s => s >= 75 ? "#ECFDF5" : s >= 55 ? "#FFFBEB" : "#FEF2F2";
const catColors = {technical:"#2563EB",experience:"#059669",education:"#7C3AED",stability:"#EA580C"};
const today = new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});

const S = {
  page:{fontFamily:"'Segoe UI',-apple-system,sans-serif",background:BG,minHeight:"100vh"},
  header:{background:NAVY,padding:"0 24px",height:50,display:"flex",alignItems:"center",justifyContent:"space-between"},
  stepBar:{display:"flex",background:"#fff",borderBottom:"1px solid #E5E7EB"},
  stepItem:(a,d)=>({flex:1,padding:"9px 12px",textAlign:"center",fontSize:12,fontWeight:a?700:400,color:a?INDIGO:d?"#059669":"#B0B0B0",borderBottom:a?`3px solid ${INDIGO}`:d?"3px solid #059669":"3px solid transparent",cursor:d?"pointer":"default"}),
  container:{maxWidth:1100,margin:"0 auto",padding:"20px"},
  card:{background:"#fff",borderRadius:10,boxShadow:"0 1px 4px rgba(0,0,0,0.05)",padding:16,marginBottom:10},
  btn:{padding:"8px 16px",background:INDIGO,color:"#fff",border:"none",borderRadius:7,fontSize:13,fontWeight:600,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5},
  btnO:{padding:"8px 16px",background:"#fff",color:"#374151",border:"1px solid #D1D5DB",borderRadius:7,fontSize:13,cursor:"pointer"},
  btnG:{padding:"8px 16px",background:GOLD,color:"#fff",border:"none",borderRadius:7,fontSize:13,fontWeight:600,cursor:"pointer"},
  btnS:{padding:"8px 16px",background:"#059669",color:"#fff",border:"none",borderRadius:7,fontSize:13,fontWeight:600,cursor:"pointer"},
  label:{fontSize:11,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:0.5,marginBottom:5},
  h2:{fontSize:16,fontWeight:700,color:NAVY,marginBottom:3},
  sub:{fontSize:12,color:"#6B7280"},
  chip:(bg,c)=>({display:"inline-block",fontSize:10,fontWeight:600,background:bg,color:c,padding:"3px 9px",borderRadius:20,marginRight:4,marginBottom:4}),
  input:{width:"100%",padding:"8px 12px",border:"1px solid #D1D5DB",borderRadius:7,fontSize:13,boxSizing:"border-box",outline:"none",fontFamily:"inherit"},
  modal:{position:"fixed",top:0,left:0,width:"100%",height:"100%",background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16},
  modalBox:{background:"#fff",borderRadius:14,width:"100%",maxHeight:"92vh",overflow:"hidden",display:"flex",flexDirection:"column"},
};

// ─── Spinner ─────────────────────────────────────────────────────
// Small inline spinning ring for loading buttons/banners. Color follows the
// surrounding text (currentColor) unless overridden.
function Spinner({size=13,color="currentColor"}){
  return(
    <span className="scc-spin" style={{
      display:"inline-block",width:size,height:size,
      border:`2px solid ${color}`,borderTopColor:"transparent",
      borderRadius:"50%",flexShrink:0,
    }}/>
  );
}

// ─── Job dashboard loading skeleton ──────────────────────────────
// Shown while live jobs are being fetched so the user never sees a blank
// screen (Fix 2). Mirrors the JobDashboard card grid layout.
function JobsSkeleton(){
  const card={background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",padding:20};
  const bar=(w,h=12,mt=0)=>(<div className="scc-pulse" style={{width:w,height:h,marginTop:mt,background:"#E5E7EB",borderRadius:6}}/>);
  return(
    <div style={{maxWidth:1100,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>{bar(120,24)}{bar(180,12,8)}</div>
        {bar(140,40)}
      </div>
      <div style={{display:"flex",gap:12,marginBottom:20}}>{bar(280,42)}{bar(160,42)}{bar(160,42)}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
        {Array.from({length:6}).map((_,i)=>(
          <div key={i} style={card}>
            {bar(70,18)}{bar("80%",16,12)}{bar("55%",12,6)}{bar("40%",10,6)}
            <div style={{borderTop:"1px solid #F3F4F6",marginTop:16,paddingTop:12,display:"flex",justifyContent:"space-between"}}>{bar(60,12)}{bar(70,12)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Toast ───────────────────────────────────────────────────────
// Brief bottom-center notification (download complete / errors).
function Toast({toast}){
  if(!toast)return null;
  const ok=toast.type!=="error";
  return(
    <div className="scc-toast" style={{
      position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:2000,
      background:ok?"#065F46":"#991B1B",color:"#fff",padding:"10px 18px",borderRadius:10,
      fontSize:13,fontWeight:600,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",display:"flex",alignItems:"center",gap:8,maxWidth:"90vw",
    }}>
      <span>{ok?"✓":"⚠"}</span><span>{toast.msg}</span>
    </div>
  );
}

// ─── Toggle ──────────────────────────────────────────────────────
function Toggle({on,onChange,label}){
  return(
    <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"#374151"}}>
      <button type="button" style={{width:38,height:20,borderRadius:10,background:on?"#059669":"#D1D5DB",position:"relative",cursor:"pointer",border:"none",padding:0}} onClick={()=>onChange(!on)}>
        <span style={{width:16,height:16,borderRadius:8,background:"#fff",position:"absolute",top:2,left:on?20:2,transition:"left 0.2s",boxShadow:"0 1px 2px rgba(0,0,0,0.15)"}}/>
      </button>
      {label}
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SCORECARD — exact match of ScorQ PDF design
// ═══════════════════════════════════════════════════════════════════
function Scorecard({c, job, logoUrl}){
  const CATS = [
    {key:"technical",icon:"💻",label:"Technical Skills",color:"#2563EB",barColor:"#3B82F6"},
    {key:"experience",icon:"🏢",label:"Experience",color:"#059669",barColor:"#10B981"},
    {key:"education",icon:"🎓",label:"Education",color:"#7C3AED",barColor:"#8B5CF6"},
    {key:"stability",icon:"📊",label:"Stability",color:"#059669",barColor:"#10B981"},
  ];

  return(
    <div style={{background:"#fff",borderRadius:10,overflow:"hidden",border:"1px solid #E5E7EB"}}>
      {/* Header — navy bar with ScorQ branding */}
      <div style={{background:NAVY,padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{display:"flex",alignItems:"baseline",gap:2}}>
            <span style={{fontSize:18,fontWeight:800,color:"#fff"}}>Scor</span>
            <span style={{fontSize:18,fontWeight:800,color:GOLD}}>Q</span>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.45)",marginLeft:8}}>by HYROI Solutions</span>
          </div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",marginTop:2}}>AI-powered resume scoring</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:0.5}}>Candidate scorecard</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>{today}</div>
        </div>
      </div>

      {/* Candidate info + score boxes */}
      <div style={{padding:"16px 20px",background:"#F8FAFC",borderBottom:"1px solid #E5E7EB",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:20,fontWeight:800,color:NAVY}}>{c.name}</div>
          <div style={{fontSize:12,color:"#6B7280",marginTop:4}}>
            {c.email && <span>✉ {c.email}</span>}
            {c.email && c.phone && <span style={{margin:"0 8px"}}>·</span>}
            {c.phone && <span>📞 {c.phone}</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {CATS.map(cat => {
            const val = c.categories[cat.key];
            return(
              <div key={cat.key} style={{textAlign:"center",minWidth:72,background:"#fff",borderRadius:8,padding:"6px 10px",border:"1px solid #E5E7EB"}}>
                <div style={{fontSize:10,fontWeight:700,color:cat.color}}>{cat.label.replace("Technical Skills","Technical")}</div>
                <div style={{fontSize:22,fontWeight:800,color:val!=null?cat.color:"#D1D5DB",margin:"2px 0"}}>{val!=null?`${val}%`:"—"}</div>
                <div style={{height:4,background:"#E5E7EB",borderRadius:2}}>
                  <div style={{height:4,width:val!=null?`${val}%`:"0%",background:cat.barColor,borderRadius:2}}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Score breakdown */}
      <div style={{padding:"16px 20px"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:0.5,marginBottom:12}}>Score breakdown</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {CATS.map(cat=>{
            const val=c.categories[cat.key];
            const reason=c.catReasoning?.[cat.key]||"";
            return(
              <div key={cat.key} style={{background:"#F9FAFB",borderRadius:10,padding:14,border:"1px solid #E5E7EB"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:14}}>{cat.icon}</span>
                    <span style={{fontSize:13,fontWeight:700,color:"#1F2937"}}>{cat.label}</span>
                  </div>
                  <span style={{fontSize:16,fontWeight:800,color:val!=null?cat.color:"#D1D5DB"}}>{val!=null?`${val}%`:"—"}</span>
                </div>
                <div style={{height:5,background:"#E5E7EB",borderRadius:99,marginBottom:8}}>
                  <div style={{height:5,width:val!=null?`${val}%`:"0%",background:cat.barColor,borderRadius:99}}/>
                </div>
                <div style={{fontSize:11,color:"#4B5563",lineHeight:1.6}}>{reason}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Matched skills */}
      <div style={{padding:"0 20px 16px"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Matched skills</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {c.matched.map(s=>(
            <span key={s} style={{fontSize:12,fontWeight:500,padding:"5px 14px",borderRadius:6,background:"#EEF2FF",color:"#4338CA"}}>{s}</span>
          ))}
        </div>
      </div>

      {/* Highlights */}
      <div style={{padding:"0 20px 16px"}}>
        <div style={{background:"#F9FAFB",borderRadius:10,padding:14,border:"1px solid #E5E7EB"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>Highlights</div>
          {c.highlights.map((h,i)=><div key={i} style={{fontSize:12,color:"#374151",marginBottom:3,paddingLeft:8}}>▸ {h}</div>)}
        </div>
      </div>

      {/* AI Assessment */}
      <div style={{padding:"0 20px 16px"}}>
        <div style={{background:"#FFF7ED",borderRadius:10,padding:14,border:"1px solid #FED7AA"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#C2410C",textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>AI assessment</div>
          <div style={{fontSize:12,color:"#9A3412",lineHeight:1.7}}>{c.reasoning}</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{borderTop:"2px solid #E5E7EB",padding:"10px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" style={{height:24,objectFit:"contain"}} />
          ) : (
            <div style={{display:"flex",alignItems:"baseline",gap:1}}>
              <span style={{fontSize:12,fontWeight:800,color:NAVY}}>Scor</span>
              <span style={{fontSize:12,fontWeight:800,color:GOLD}}>Q</span>
              <span style={{fontSize:9,color:"#9CA3AF",marginLeft:4}}>· HYROI Solutions</span>
            </div>
          )}
        </div>
        <div style={{fontSize:10,color:"#9CA3AF"}}>{today}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RESUME PREVIEW
// ═══════════════════════════════════════════════════════════════════
function ResumePreview({c,masked,letterhead,logoUrl,includeHeader=true,includeFooter=true}){
  const email=masked?null:c.email;
  const phone=masked?null:c.phone;
  return(
    <div style={{background:"#fff",border:"1px solid #D1D5DB",borderRadius:6,fontSize:11,lineHeight:1.6}}>
      {/* Branded banner (header toggle) — logo left, company right, gold rule */}
      {includeHeader&&(
        <div style={{background:"#F8FAFC",borderBottom:`2px solid ${GOLD}`,padding:"8px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>{logoUrl?<img src={logoUrl} alt="Logo" style={{height:24,objectFit:"contain"}}/>:<span style={{fontSize:12,fontWeight:700,color:NAVY}}>{letterhead?.company||"HYROI Solutions"}</span>}</div>
          <div style={{textAlign:"right"}}><div style={{fontSize:11,fontWeight:700,color:NAVY}}>{letterhead?.company||"HYROI Solutions"}</div>{letterhead?.tagline&&<div style={{fontSize:9,color:"#9CA3AF"}}>{letterhead.tagline}</div>}</div>
        </div>
      )}
      <div style={{background:NAVY,padding:"14px 20px",color:"#fff"}}>
        <div style={{fontSize:16,fontWeight:700,letterSpacing:0.5}}>{c.name}</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.7)",marginTop:3}}>
          {[email,phone,c.location].filter(Boolean).join(" · ")||c.location||""}
        </div>
      </div>
      <div style={{padding:"14px 20px"}}>
        {/* Summary */}
        <div style={{fontWeight:700,fontSize:12,color:NAVY,borderBottom:`2px solid ${GOLD}`,paddingBottom:3,marginBottom:8}}>Executive summary</div>
        {c.executive_summary?.slice(0,6).map((p,i)=><div key={i} style={{marginBottom:2,paddingLeft:8,borderLeft:"2px solid #E5E7EB"}}>• {p}</div>)}

        {/* Competencies */}
        <div style={{fontWeight:700,fontSize:12,color:NAVY,borderBottom:`2px solid ${GOLD}`,paddingBottom:3,marginBottom:8,marginTop:12}}>Core competencies</div>
        <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed",marginBottom:12}}>
          <thead><tr style={{background:"#F9FAFB"}}>
            <th style={{textAlign:"left",padding:"4px 8px",borderBottom:"1px solid #E5E7EB",fontSize:10,fontWeight:600,width:"25%"}}>Domain</th>
            <th style={{textAlign:"left",padding:"4px 8px",borderBottom:"1px solid #E5E7EB",fontSize:10,fontWeight:600,width:"40%"}}>Skills</th>
            <th style={{textAlign:"left",padding:"4px 8px",borderBottom:"1px solid #E5E7EB",fontSize:10,fontWeight:600,width:"35%"}}>Tools</th>
          </tr></thead>
          <tbody>{c.core_competencies?.map((comp,i)=>(
            <tr key={i} style={{borderBottom:"1px solid #F3F4F6"}}>
              <td style={{padding:"4px 8px",fontWeight:600,verticalAlign:"top",wordBreak:"break-word"}}>{comp.domain}</td>
              <td style={{padding:"4px 8px",color:"#374151",verticalAlign:"top",wordBreak:"break-word"}}>{comp.skills}</td>
              <td style={{padding:"4px 8px",color:"#6B7280",verticalAlign:"top",wordBreak:"break-word"}}>{comp.tools}</td>
            </tr>
          ))}</tbody>
        </table>

        {/* Employment with nested projects */}
        <div style={{fontWeight:700,fontSize:12,color:NAVY,borderBottom:`2px solid ${GOLD}`,paddingBottom:3,marginBottom:8}}>Employment history</div>
        {c.employment?.map((emp,i)=>(
          <div key={i} style={{marginBottom:12,borderLeft:"3px solid #E5E7EB",paddingLeft:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap"}}>
              <div><span style={{fontWeight:700,fontSize:12,color:"#1F2937"}}>{emp.company}</span><span style={{color:"#6B7280"}}> — {emp.role}</span></div>
              <span style={{fontSize:10,color:"#9CA3AF",flexShrink:0}}>{emp.duration}</span>
            </div>
            {emp.location&&<div style={{fontSize:10,color:"#9CA3AF",marginBottom:4}}>{emp.location}</div>}
            {emp.projects?.map((proj,j)=>(
              <div key={j} style={{marginLeft:10,marginBottom:6,borderLeft:`2px solid ${GOLD}50`,paddingLeft:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap"}}>
                  <span style={{fontWeight:600,fontSize:11,color:INDIGO}}>{proj.name}</span>
                  <span style={{fontSize:9,color:"#9CA3AF",flexShrink:0}}>{proj.duration}</span>
                </div>
                {proj.responsibilities?.map((r,k)=><div key={k} style={{paddingLeft:6,marginTop:1,color:"#374151"}}>• {r}</div>)}
                {proj.skills&&<div style={{marginTop:2,fontSize:10,color:"#6B7280"}}>Tech: {proj.skills}</div>}
              </div>
            ))}
          </div>
        ))}

        {/* Education + Certs */}
        <div style={{fontWeight:700,fontSize:12,color:NAVY,borderBottom:`2px solid ${GOLD}`,paddingBottom:3,marginBottom:8}}>Education & certifications</div>
        {c.education?.map((e,i)=><div key={i} style={{marginBottom:3}}><span style={{fontWeight:600}}>{e.degree}</span><span style={{color:"#6B7280"}}> — {e.institution}, {e.year}</span></div>)}
        {c.certifications?.length>0&&(
          <table style={{width:"100%",borderCollapse:"collapse",marginTop:6,tableLayout:"fixed"}}>
            <thead><tr style={{background:"#F9FAFB"}}>
              <th style={{textAlign:"left",padding:"3px 8px",borderBottom:"1px solid #E5E7EB",fontSize:10,fontWeight:600,width:"50%"}}>Certification</th>
              <th style={{textAlign:"left",padding:"3px 8px",borderBottom:"1px solid #E5E7EB",fontSize:10,fontWeight:600,width:"25%"}}>Issuer</th>
              <th style={{textAlign:"left",padding:"3px 8px",borderBottom:"1px solid #E5E7EB",fontSize:10,fontWeight:600,width:"25%"}}>Expiry</th>
            </tr></thead>
            <tbody>{c.certifications.map((cert,i)=>(
              <tr key={i} style={{borderBottom:"1px solid #F3F4F6"}}>
                <td style={{padding:"3px 8px",fontWeight:500,verticalAlign:"top",wordBreak:"break-word"}}>{cert.name}</td>
                <td style={{padding:"3px 8px",color:"#6B7280",verticalAlign:"top"}}>{cert.issuer}</td>
                <td style={{padding:"3px 8px",verticalAlign:"top"}}>{cert.expiry?<span style={{color:"#374151"}}>{cert.expiry}</span>:<span style={{color:"#DC2626",fontWeight:600,fontSize:10}}>⚠ Missing</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {/* Footer (footer toggle) */}
      {includeFooter&&(
        <div style={{borderTop:`2px solid ${GOLD}`,padding:"8px 20px",background:"#F9FAFB",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontSize:10,fontWeight:700,color:NAVY}}>{letterhead?.company||"HYROI Solutions"}</div>
          </div>
          <div style={{fontSize:8,color:"#B0B0B0"}}>CONFIDENTIAL · {new Date().toLocaleDateString()}</div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function ScorCraft(){
  const[step,setStep]=useState("job");
  const[candidates,setCandidates]=useState([]);
  const[selected,setSelected]=useState(new Set());
  const[scoreRange,setScoreRange]=useState([0,100]);
  const[cutoff,setCutoff]=useState(70);
  const[craftQueue,setCraftQueue]=useState([]);
  const[craftingId,setCraftingId]=useState(null);
  const[viewScorecard,setViewScorecard]=useState(null);
  const[downloadModal,setDownloadModal]=useState(null);
  const[editCandidate,setEditCandidate]=useState(null);
  const[uploadFiles,setUploadFiles]=useState([]);
  const[scoringProgress,setScoringProgress]=useState(0);
  const[maskPI,setMaskPI]=useState(false);
  const[letterhead,setLetterhead]=useState({company:"HYROI Solutions",tagline:"Talent Acquisition & Recruitment",email:"recruit@hyroi.com",phone:"+91 9100000000"});
  const[logoUrl,setLogoUrl]=useState(null);       // data URL, for preview
  const[logoPath,setLogoPath]=useState(null);     // Supabase storage path, for PDFs
  const[logoErr,setLogoErr]=useState("");         // upload error surfaced to the user
  const[showSettings,setShowSettings]=useState(false);
  const[includeHeader,setIncludeHeader]=useState(true); // branded banner on resume pages
  const[includeFooter,setIncludeFooter]=useState(true); // letterhead footer on resume pages
  const logoRef=useRef(null);

  // ── Backend wiring ────────────────────────────────────────────
  const[demoMode,setDemoMode]=useState(true);          // until /health proves live
  const[configured,setConfigured]=useState(true);      // /health configured flag — drives the demo banner
  const[jobs,setJobs]=useState([]);                    // live jobs (if any)
  const[jobsLoading,setJobsLoading]=useState(true);    // job dashboard fetch in flight (skeleton)
  const[activeJob,setActiveJob]=useState(null);        // selected live job
  const[uploadFileObjs,setUploadFileObjs]=useState([]);// real File objects for scoring
  const[uploadErr,setUploadErr]=useState("");          // resume upload validation error
  const[busy,setBusy]=useState("");                    // small status message
  const[craftingAll,setCraftingAll]=useState(false);   // batch craft in flight
  const[downloading,setDownloading]=useState(null);    // active download key (button loading)
  const[toast,setToast]=useState(null);                // transient success/error notice
  const resumeRef=useRef(null);                        // hidden resume file input

  // Show a transient toast (auto-dismiss). type: "success" | "error".
  const showToast=useCallback((msg,type="success")=>{
    setToast({msg,type});
    setTimeout(()=>setToast(null),type==="error"?4500:2500);
  },[]);

  // ── Auth ──────────────────────────────────────────────────────
  const router=useRouter();
  const[currentUserName,setCurrentUserName]=useState(""); // logged-in user's display name
  // Require a Supabase session; bounce to /login if there's no token. Also
  // derive the current user's display name (for the dashboard "Created by" filter).
  useEffect(()=>{
    if(typeof window==="undefined")return;
    const tok=api.getToken();
    if(!tok){router.replace("/login");return;}
    setCurrentUserName(displayNameFromToken(tok));
  },[router]);
  const signOut=useCallback(async()=>{
    try{await supabase.auth.signOut();}catch{/* ignore */}
    if(typeof window!=="undefined")window.localStorage.removeItem(TOKEN_KEY);
    router.replace("/login");
  },[router]);

  // ── Rehydrate the previously-uploaded company logo ────────────
  // logoPath is ephemeral React state, but the logo file lives permanently in
  // storage at the deterministic path logos/{uid}_logo.png. Without this, a
  // page reload (or any fresh craft session where the user doesn't re-upload)
  // would craft with logo_storage_path=null — which is exactly why downloaded
  // PDFs were losing the logo. On mount, re-derive logoPath (+ a preview URL)
  // so the logo is sent on every craft once it has ever been uploaded.
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const {data:{session}}=await supabase.auth.getSession();
        const uid=session?.user?.id;
        if(!uid)return;
        const name=`${uid}_logo.png`;
        const {data:files}=await supabase.storage.from("formatted-resumes").list("logos",{search:name});
        if(cancelled||!files?.some(f=>f.name===name))return;
        const path=`logos/${name}`;
        setLogoPath(path);
        const {data:signed}=await supabase.storage.from("formatted-resumes").createSignedUrl(path,3600);
        if(!cancelled&&signed?.signedUrl)setLogoUrl(signed.signedUrl);
        console.log("[ScorCraft] rehydrated existing logo:",path);
      }catch(err){console.warn("[ScorCraft] logo rehydrate skipped:",err);}
    })();
    return()=>{cancelled=true;};
  },[]);

  // ── Create / edit / duplicate job flow (ported ScorQ JobCreator) ──
  const[showCreateJob,setShowCreateJob]=useState(false);
  const[editingJob,setEditingJob]=useState(null);     // job being edited
  const[duplicatingJob,setDuplicatingJob]=useState(null); // job being duplicated
  const[jobBusy,setJobBusy]=useState("");             // dashboard status message
  // Job create/edit/duplicate/archive/delete handlers are defined below, after
  // fallbackToDemo/loadJobResults/selectJob (they depend on those callbacks).

  const SAMPLE_FILES=[{name:"Assadullah_Buriro_Resume.pdf",size:"245 KB"},{name:"Priya_Sharma_CV.pdf",size:"312 KB"},{name:"Rahul_Verma_Resume.docx",size:"189 KB"},{name:"Sneha_Patel_CV.pdf",size:"267 KB"},{name:"Vikram_Singh_Resume.pdf",size:"198 KB"},{name:"Meera_Krishnan_CV.docx",size:"223 KB"}];
  // Accepted resume formats + size — kept in sync with the backend
  // (ALLOWED_EXTENSIONS / MAX_UPLOAD_BYTES in api/scoring.py).
  const ALLOWED_RESUME_EXT=[".pdf",".docx"];
  const MAX_RESUME_BYTES=10*1024*1024; // 10 MB
  const handleResumeFiles=(e)=>{
    const files=Array.from(e.target.files||[]);
    if(!files.length)return;
    setUploadErr("");
    const bad=files.find(f=>!ALLOWED_RESUME_EXT.some(ext=>f.name.toLowerCase().endsWith(ext)));
    if(bad){setUploadErr("Unsupported file format. Please upload a PDF or DOCX file.");if(e.target)e.target.value="";return;}
    const tooBig=files.find(f=>f.size>MAX_RESUME_BYTES);
    if(tooBig){setUploadErr("File too large. Maximum size is 10MB.");if(e.target)e.target.value="";return;}
    setUploadFileObjs(files);
    setUploadFiles(files.map(f=>({name:f.name,size:`${Math.round(f.size/1024)} KB`})));
  };

  // Drop to demo mode + surface a one-time note whenever the backend can't serve live data.
  const fallbackToDemo=useCallback((err)=>{
    setDemoMode(true);
    if(err) console.warn("[ScorCraft] live call failed → demo mode:",err?.message||err);
  },[]);

  // Reload a job's previously scored candidates from the backend. Lets a
  // recruiter reopen the app (or switch jobs) and pick up where they left off
  // without re-scoring. Returns the loaded count.
  const loadJobResults=useCallback(async(jobId)=>{
    if(!jobId)return 0;
    try{
      const rows=await api.getResults(jobId);
      const mapped=(rows||[]).map(dbScoreRowToCandidate).sort((a,b)=>b.score-a.score);
      setCandidates(mapped);
      return mapped.length;
    }catch(e){
      fallbackToDemo(e);
      return 0;
    }
  },[fallbackToDemo]);

  // On mount: probe backend; if configured, load live jobs + their results.
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const live=await api.isLive();
        if(cancelled)return;
        setConfigured(live);
        setDemoMode(!live);
        if(live){
          const js=await api.listJobs();
          if(cancelled)return;
          setJobs(js);
          if(js.length){
            setActiveJob(js[0]);
            await loadJobResults(js[0].id);
          }
        }
      }catch(e){fallbackToDemo(e);}
      finally{if(!cancelled)setJobsLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[fallbackToDemo,loadJobResults]);

  // Switch the active live job and reload its persisted scores.
  const selectJob=useCallback((job)=>{
    setActiveJob(job);
    setSelected(new Set());
    if(!demoMode&&job?.id)loadJobResults(job.id);
  },[demoMode,loadJobResults]);

  // ── Job dashboard: reload + create/edit/duplicate/archive/delete ──
  // Reload the live jobs list (refreshes candidate counts, versions, statuses).
  const reloadJobs=useCallback(async()=>{
    try{
      const js=await api.listJobs();
      setJobs(js);
      return js;
    }catch(e){fallbackToDemo(e);return [];}
  },[fallbackToDemo]);

  // Called by <JobCreator/> once a job is persisted (create, edit, or duplicate).
  const handleJobCreated=useCallback(async(job)=>{
    setShowCreateJob(false);setEditingJob(null);setDuplicatingJob(null);
    if(!job)return;
    const js=await reloadJobs();
    // Re-resolve the saved job from the fresh list (edit may have created a new
    // version with a different id); fall back to the returned row.
    const fresh=(js||[]).find(j=>j.id===job.id)||job;
    setActiveJob(fresh);
    setSelected(new Set());
    setCandidates([]);
  },[reloadJobs]);

  const handleEditJob=useCallback((job)=>{setDuplicatingJob(null);setEditingJob(job);},[]);
  const handleDuplicateJob=useCallback((job)=>{setEditingJob(null);setDuplicatingJob(job);},[]);
  const handleArchiveJob=useCallback(async(job)=>{
    setJobBusy(`Archiving “${job.title}”…`);
    try{await api.archiveJob(job.id);await reloadJobs();}
    catch(e){fallbackToDemo(e);}
    setJobBusy("");
  },[reloadJobs,fallbackToDemo]);
  const handleDeleteJob=useCallback(async(job)=>{
    const scored=job.candidates_scored_count||0;
    if(scored>0){
      window.alert(`“${job.title}” has ${scored} scored candidate(s). Archive it instead of deleting to preserve those scores.`);
      return;
    }
    if(!window.confirm(`Permanently delete “${job.title}”? This cannot be undone.`))return;
    setJobBusy(`Deleting “${job.title}”…`);
    try{
      await api.deleteJob(job.id);
      if(activeJob?.id===job.id){setActiveJob(null);setCandidates([]);}
      await reloadJobs();
    }catch(e){fallbackToDemo(e);}
    setJobBusy("");
  },[reloadJobs,fallbackToDemo,activeJob]);

  const jobIdForScoring=activeJob?.id||null;
  const jobTitle=activeJob?.title||"the selected job";
  // Real job (normalized) for display; neutral fallback if none selected.
  const activeView=activeJob?jobView(activeJob):null;
  const jobForDisplay=activeView||EMPTY_JOB_VIEW;

  const runScoring=useCallback(async()=>{
    setStep("scoring");setScoringProgress(0);
    // Live path: real files + a real job id + configured backend. This is the
    // only path that produces candidates — scored results come straight from
    // the backend. There is no mock fallback; if scoring can't run or returns
    // nothing, the results step shows its empty state.
    if(!demoMode&&jobIdForScoring&&uploadFileObjs.length){
      const iv=setInterval(()=>setScoringProgress(p=>Math.min(p+8,90)),400);
      try{
        const resp=await api.scoreBatch(uploadFileObjs,jobIdForScoring,`Batch ${uploadFileObjs.length} resumes`);
        clearInterval(iv);setScoringProgress(100);
        const mapped=(resp.results||[]).map(scoreResultToCandidate).sort((a,b)=>b.score-a.score);
        setCandidates(mapped);
        // Surface per-file failures (e.g. corrupted/unsupported/too-large) so the
        // recruiter knows some files were skipped instead of silently vanishing.
        if(resp.errors?.length){
          const lines=resp.errors.map(er=>`• ${er.filename}: ${er.error}`).join("\n");
          setUploadErr(`${resp.errors.length} file(s) could not be scored:\n${lines}`);
        }
        setTimeout(()=>setStep("results"),400);
        return;
      }catch(e){
        clearInterval(iv);
        // A genuine client error (400 validation / bad file) is NOT a backend
        // outage — show it and stay on upload instead of dropping to demo.
        if(e?.name==="DemoModeError"){
          fallbackToDemo(e);
        }else{
          setUploadErr(e?.message||"Scoring failed. Please check your files and try again.");
          setStep("upload");
          return;
        }
      }
    }
    // No live scoring available (demo mode, no job, or no real files) — go to
    // results with whatever has been scored (often nothing → empty state).
    setScoringProgress(100);
    setTimeout(()=>setStep("results"),400);
  },[demoMode,jobIdForScoring,uploadFileObjs,fallbackToDemo]);

  // ── Craft handlers ────────────────────────────────────────────
  const craftSettings=()=>craftSettingsFrom(letterhead,maskPI,logoPath,includeHeader,includeFooter);

  const craftOne=useCallback(async(cand)=>{
    // Live: call API if we have a real score id; else just mark crafted (demo).
    if(!demoMode&&cand.scoreId){
      setCraftingId(cand.id);
      setBusy(`Crafting ${cand.name}…`);
      try{
        const res=await api.craftSingle(cand.scoreId,craftSettings());
        const merged=applyCraftResult(cand,res);
        setCraftQueue(p=>p.map(x=>x.id===cand.id?merged:x));
        setBusy("");setCraftingId(null);
        showToast(`Crafted ${cand.name}`);
        return;
      }catch(e){
        setBusy("");setCraftingId(null);
        if(e?.name!=="DemoModeError"){showToast(e?.message||"Crafting failed. Please try again.","error");return;}
        fallbackToDemo(e);
      }
    }
    setCraftQueue(p=>p.map(x=>x.id===cand.id?{...x,crafted:true}:x));
  },[demoMode,letterhead,maskPI,logoPath,includeHeader,includeFooter,fallbackToDemo,showToast]);

  const craftAll=useCallback(async()=>{
    const ids=craftQueue.filter(c=>c.scoreId&&!c.crafted).map(c=>c.scoreId);
    if(!demoMode&&ids.length){
      setCraftingAll(true);
      setBusy(`Crafting ${ids.length} resume${ids.length>1?"s":""}…`);
      try{
        const resp=await api.craftBatch(ids,craftSettings());
        const byScore=new Map((resp.results||[]).map(r=>[r.score_id,r]));
        setCraftQueue(p=>p.map(c=>byScore.has(c.scoreId)?applyCraftResult(c,byScore.get(c.scoreId)):c));
        setBusy("");setCraftingAll(false);
        const failed=resp.failed||0;
        showToast(failed?`Crafted ${resp.crafted||0}, ${failed} failed`:`Crafted ${resp.crafted||ids.length} resumes`,failed?"error":"success");
        return;
      }catch(e){
        setBusy("");setCraftingAll(false);
        if(e?.name!=="DemoModeError"){showToast(e?.message||"Batch craft failed. Please try again.","error");return;}
        fallbackToDemo(e);
      }
    }
    setCraftQueue(p=>p.map(c=>({...c,crafted:true})));
  },[craftQueue,demoMode,letterhead,maskPI,logoPath,includeHeader,includeFooter,fallbackToDemo,showToast]);

  // ── Editor save ───────────────────────────────────────────────
  const saveEdited=useCallback(async(cand)=>{
    if(!demoMode&&cand.craftId){
      setBusy("Saving changes…");
      try{
        await api.updateCraft(cand.craftId,candidateToStructured(cand));
      }catch(e){fallbackToDemo(e);}
      setBusy("");
    }
    setCraftQueue(p=>p.map(x=>x.id===cand.id?{...cand,crafted:true}:x));
  },[demoMode,fallbackToDemo]);

  // ── Download ──────────────────────────────────────────────────
  const doDownload=useCallback(async(cand,kind,format)=>{
    const kindMap={
      "Resume only":{PDF:"resume-pdf",DOCX:"docx"},
      "Scorecard only":{PDF:"scorecard-pdf"},
      "Combined: Resume + Scorecard":{PDF:"combined-pdf",DOCX:"combined-docx"},
    };
    const endpoint=kindMap[kind]?.[format];
    const key=`${kind}-${format}`;
    if(!demoMode&&cand.craftId&&endpoint){
      setDownloading(key);
      try{
        await api.downloadCraft(cand.craftId,endpoint,`${cand.name}_${endpoint}.${format.toLowerCase()}`);
        setDownloading(null);
        showToast("Download complete");
        return;
      }catch(e){
        setDownloading(null);
        // A real backend error (not an outage) → show it; don't fall to demo.
        if(e?.name!=="DemoModeError"){showToast(e?.message||"Download failed. Please try again.","error");return;}
        fallbackToDemo(e);
      }
    }
    alert(`Demo mode — downloads need a live backend.\n\nWould download: ${kind} (${format})\nPI masked: ${maskPI} · Logo: ${logoUrl?"Yes":"No"}\n\nAdd credentials to backend/.env and craft a resume to enable real downloads.`);
  },[demoMode,maskPI,logoUrl,fallbackToDemo,showToast]);

  // Review & Filter stage: download the scorecard PDF straight from the score
  // (no craft_id needed) via /api/v1/download/score/:scoreId/scorecard-pdf.
  const downloadScorecard=useCallback(async(cand)=>{
    if(!demoMode&&cand.scoreId){
      setDownloading(`sc-${cand.scoreId}`);
      try{
        await api.downloadScoreScorecard(cand.scoreId,`${cand.name}_scorecard.pdf`);
        setDownloading(null);
        showToast("Download complete");
        return;
      }catch(e){
        setDownloading(null);
        if(e?.name!=="DemoModeError"){showToast(e?.message||"Download failed. Please try again.","error");return;}
        fallbackToDemo(e);
      }
    }
    alert(`Demo mode — the scorecard download needs a live backend and a scored candidate.`);
  },[demoMode,fallbackToDemo,showToast]);

  const filtered=candidates.filter(c=>c.score>=scoreRange[0]&&c.score<=scoreRange[1]);
  const toggleSelect=id=>{setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});};
  const selectAll=()=>{const ids=new Set(filtered.map(c=>c.id));setSelected(filtered.every(c=>selected.has(c.id))?new Set():ids);};

  const handleLogo=async(e)=>{
    const file=e.target.files?.[0];
    if(!file)return;
    setLogoErr("");
    // Validate before doing anything (logos are images, keep them small).
    if(!/^image\//.test(file.type||"")){setLogoErr("Logo must be an image (PNG or JPG).");return;}
    if(file.size>5*1024*1024){setLogoErr("Logo is too large. Maximum size is 5MB.");return;}
    // Upload via the BACKEND (POST /api/v1/craft/upload-logo), which writes to
    // storage with the service key and bypasses the Storage RLS policy that was
    // rejecting direct frontend uploads ("new row violates row-level security
    // policy"). Only show the preview after the backend confirms the path, so it
    // always reflects a file that actually landed in storage and reaches PDFs.
    try{
      const res=await api.uploadLogo(file);
      if(!res?.logo_storage_path){setLogoErr("Logo upload failed. It will not appear in PDFs.");return;}
      setLogoPath(res.logo_storage_path);
      // Prefer a local FileReader preview (instant, no extra round-trip).
      const reader=new FileReader();reader.onload=ev=>setLogoUrl(ev.target.result);reader.readAsDataURL(file);
    }catch(err){setLogoErr(`Logo upload failed: ${err?.message||err}. It will not appear in PDFs.`);}
  };

  const steps=[{key:"job",label:"Select job"},{key:"upload",label:"Upload resumes"},{key:"scoring",label:"Scoring"},{key:"results",label:"Review & filter"},{key:"craft",label:"Craft resumes"}];
  const ci=steps.findIndex(s=>s.key===step);

  // ─── Job ───────────────────────────────────────────────────────
  const skillChips=(arr,bg,c)=>arr.length
    ? arr.map(s=><span key={s} style={S.chip(bg,c)}>{s}</span>)
    : <span style={{fontSize:11,color:"#9CA3AF"}}>None</span>;

  const renderJob=()=>{
    // Editing or duplicating an existing job → JobCreator pre-filled.
    if(editingJob||duplicatingJob){
      const j=editingJob||duplicatingJob;
      return(
        <div style={{padding:"20px"}}>
          <JobCreator
            job={j}
            duplicate={!!duplicatingJob}
            scoredCount={j.candidates_scored_count||0}
            onCreated={handleJobCreated}
            onCancel={()=>{setEditingJob(null);setDuplicatingJob(null);}}
          />
        </div>
      );
    }
    // "+ Create new job" → blank ScorQ creation flow.
    if(showCreateJob){
      return(
        <div style={{padding:"20px"}}>
          <JobCreator onCreated={handleJobCreated} onCancel={()=>setShowCreateJob(false)}/>
        </div>
      );
    }
    // Still fetching the live jobs → skeleton instead of a blank/black screen.
    if(jobsLoading){
      return <div style={{padding:"20px"}}><JobsSkeleton/></div>;
    }
    // Default → job management dashboard (its own empty state when no jobs).
    return(
      <div style={{padding:"20px"}}>
        <JobDashboard
          jobs={jobs}
          busy={jobBusy}
          currentUserName={currentUserName}
          onSelect={(job)=>{selectJob(job);setStep("upload");}}
          onCreate={()=>setShowCreateJob(true)}
          onDuplicate={handleDuplicateJob}
          onArchive={handleArchiveJob}
          onDelete={handleDeleteJob}
        />
      </div>
    );
  };

  // ─── Upload ────────────────────────────────────────────────────
  const renderUpload=()=>(
    <div style={S.container}><div style={S.card}>
      <div style={S.h2}>Upload resumes</div>
      <p style={{...S.sub,marginBottom:12}}>Score against: <strong>{jobTitle}</strong></p>
      <input ref={resumeRef} type="file" accept=".pdf,.docx" multiple style={{display:"none"}} onChange={handleResumeFiles}/>
      <div style={{border:"2px dashed #D1D5DB",borderRadius:10,padding:"32px 16px",textAlign:"center",background:uploadFiles.length?"#EEF2FF":"#F9FAFB",cursor:"pointer",marginBottom:6}}
        onClick={()=>resumeRef.current?.click()}>
        {uploadFiles.length===0?(<><div style={{fontSize:28,marginBottom:4}}>📄</div><div style={{fontSize:14,fontWeight:600,color:"#374151"}}>Drop resumes here or click to browse</div><div style={S.sub}>PDF or DOCX · Up to 20 files</div></>):(<><div style={{fontSize:14,fontWeight:600,color:INDIGO}}>{uploadFiles.length} files ready</div></>)}
      </div>
      <div style={{fontSize:11,color:"#9CA3AF",marginBottom:8}}>Supported formats: PDF, DOCX · Max size: 10MB</div>
      {uploadErr&&<div style={{marginBottom:12,fontSize:12,color:"#DC2626",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"8px 12px",whiteSpace:"pre-line"}}>{uploadErr}</div>}
      {uploadFiles.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:12}}>{uploadFiles.map(f=><div key={f.name} style={{display:"flex",alignItems:"center",gap:5,background:"#F9FAFB",borderRadius:6,padding:"5px 8px"}}><span>📄</span><div><div style={{fontSize:11,fontWeight:600}}>{f.name}</div><div style={{fontSize:9,color:"#9CA3AF"}}>{f.size}</div></div></div>)}</div>}
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        <button style={{...S.btn,opacity:uploadFiles.length?1:0.5}} disabled={!uploadFiles.length} onClick={runScoring}>Score {uploadFiles.length} resumes →</button>
        {demoMode&&<button style={{fontSize:11,color:INDIGO,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}} onClick={()=>{setUploadFiles(SAMPLE_FILES);setUploadFileObjs([]);}}>Load sample set (demo)</button>}
      </div>
    </div></div>
  );

  // ─── Scoring ───────────────────────────────────────────────────
  const renderScoring=()=>(
    <div style={S.container}><div style={{...S.card,textAlign:"center",padding:48}}>
      <div style={{fontSize:32,marginBottom:10}}>⚡</div><div style={S.h2}>Scoring resumes...</div>
      <p style={{...S.sub,marginBottom:18}}>ScorQ engine · OpenAI GPT-4o</p>
      <div style={{width:"100%",maxWidth:340,margin:"0 auto",background:"#E5E7EB",borderRadius:99,height:6}}>
        <div style={{width:`${scoringProgress}%`,height:6,borderRadius:99,background:INDIGO,transition:"width 0.3s"}}/></div>
      <div style={{marginTop:8,fontSize:13,fontWeight:600,color:INDIGO}}>{scoringProgress}%</div>
    </div></div>
  );

  // ─── Results ───────────────────────────────────────────────────
  const renderResults=()=>{
    // Empty state — nothing has been scored for this job yet.
    if(!candidates.length) return(
      <div style={S.container}>
        <div style={{...S.card,textAlign:"center",padding:"48px 24px"}}>
          <div style={{fontSize:32,marginBottom:10}}>📭</div>
          <div style={S.h2}>No candidates scored yet</div>
          <p style={{...S.sub,marginBottom:18}}>Upload resumes to begin.</p>
          <button style={S.btn} onClick={()=>setStep("upload")}>Upload resumes →</button>
        </div>
      </div>
    );
    return(
    <div style={S.container}>
      {/* Stats */}
      <div style={{display:"flex",gap:10,marginBottom:10}}>
        {[{l:"Total",v:candidates.length,bg:"#F3F4F6",c:"#374151"},{l:`≥ ${cutoff} (above cutoff)`,v:candidates.filter(x=>x.score>=cutoff).length,bg:"#ECFDF5",c:"#059669"},{l:`< ${cutoff} (below cutoff)`,v:candidates.filter(x=>x.score<cutoff).length,bg:"#FEF2F2",c:"#DC2626"}].map(s=>
          <div key={s.l} style={{flex:1,background:s.bg,borderRadius:8,padding:"9px 12px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:800,color:s.c}}>{s.v}</div><div style={{fontSize:10,fontWeight:600,color:s.c,opacity:.7}}>{s.l}</div></div>
        )}
      </div>

      {/* Controls */}
      <div style={{...S.card,padding:"10px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:11,fontWeight:600,color:"#6B7280"}}>Cutoff:</span>
            <input type="range" min={0} max={100} value={cutoff} onChange={e=>setCutoff(+e.target.value)} style={{width:110,accentColor:INDIGO}}/>
            <span style={{fontSize:12,fontWeight:700,color:INDIGO,minWidth:30}}>{cutoff}%</span>
          </div>
          <div style={{width:1,height:22,background:"#E5E7EB"}}/>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:11,fontWeight:600,color:"#6B7280"}}>Range:</span>
            <input type="number" value={scoreRange[0]} min={0} max={100} onChange={e=>setScoreRange([+e.target.value,scoreRange[1]])} style={{width:44,padding:"3px 5px",border:"1px solid #D1D5DB",borderRadius:5,fontSize:11,textAlign:"center"}}/>
            <span style={{color:"#9CA3AF",fontSize:10}}>–</span>
            <input type="number" value={scoreRange[1]} min={0} max={100} onChange={e=>setScoreRange([scoreRange[0],+e.target.value])} style={{width:44,padding:"3px 5px",border:"1px solid #D1D5DB",borderRadius:5,fontSize:11,textAlign:"center"}}/>
          </div>
          <div style={{width:1,height:22,background:"#E5E7EB"}}/>
          <Toggle on={maskPI} onChange={setMaskPI} label="Mask PI"/>
          <button style={{padding:"5px 12px",fontSize:11,borderRadius:6,border:"none",cursor:"pointer",fontWeight:600,background:showSettings?"#EEF2FF":"#F3F4F6",color:showSettings?INDIGO:"#374151"}} onClick={()=>setShowSettings(!showSettings)}>⚙ Craft settings</button>
          <div style={{marginLeft:"auto",fontSize:11,color:"#6B7280"}}>{filtered.length} shown · {selected.size} selected</div>
        </div>

        {/* Settings panel */}
        {showSettings&&(
          <div style={{marginTop:10,padding:14,background:"#F9FAFB",borderRadius:8,border:"1px solid #E5E7EB"}}>
            <div style={{fontSize:13,fontWeight:700,color:NAVY,marginBottom:10}}>Craft settings</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div>
                <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>Company name</div>
                <input style={S.input} value={letterhead.company} onChange={e=>setLetterhead({...letterhead,company:e.target.value})}/>
              </div>
              <div>
                <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>Tagline</div>
                <input style={S.input} value={letterhead.tagline} onChange={e=>setLetterhead({...letterhead,tagline:e.target.value})}/>
              </div>
              <div>
                <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>Contact email</div>
                <input style={S.input} value={letterhead.email} onChange={e=>setLetterhead({...letterhead,email:e.target.value})}/>
              </div>
            </div>
            {/* Logo upload */}
            <div style={{marginTop:12}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                <span style={{fontSize:11,fontWeight:600,color:"#6B7280"}}>Company logo</span>
                <span title={"For best results:\n• Crop your logo tightly — remove any whitespace/padding around the logo\n• Use PNG with transparent background\n• Recommended size: 400×100px (4:1 ratio)\n• Minimum: 200×50px\n• Maximum file size: 2MB"}
                  style={{width:16,height:16,borderRadius:8,background:"#E5E7EB",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#6B7280",cursor:"help"}}>i</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div onClick={()=>logoRef.current?.click()}
                  style={{width:160,height:48,border:"2px dashed #D1D5DB",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",background:logoUrl?"#fff":"#F9FAFB",overflow:"hidden"}}>
                  {logoUrl?<img src={logoUrl} alt="Logo" style={{maxHeight:40,maxWidth:150,objectFit:"contain"}}/>:<span style={{fontSize:11,color:"#9CA3AF"}}>Click to upload</span>}
                </div>
                <input ref={logoRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleLogo}/>
                <div style={{fontSize:10,color:"#9CA3AF",lineHeight:1.5}}>
                  <div>Crop tightly — remove whitespace around the logo</div>
                  <div>PNG with transparent background</div>
                  <div>Recommended 400×100px (4:1) · min 200×50px · max 2MB</div>
                </div>
                {logoUrl&&<button style={{fontSize:11,color:"#DC2626",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}} onClick={()=>{setLogoUrl(null);setLogoPath(null);setLogoErr("");}}>Remove</button>}
              </div>
              {logoUrl&&!logoErr&&<div style={{marginTop:8,fontSize:11,color:"#92400E",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:6,padding:"6px 10px"}}>💡 Tip: If your logo appears too small, try cropping the whitespace around it and re-uploading.</div>}
              {logoErr&&<div style={{marginTop:8,fontSize:11,color:"#DC2626",background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:6,padding:"6px 10px"}}>{logoErr}</div>}
            </div>
            {/* Resume header / footer toggles (scorecard keeps its own ScorQ header/footer) */}
            <div style={{marginTop:14,paddingTop:12,borderTop:"1px solid #E5E7EB"}}>
              <div style={{display:"flex",alignItems:"center",gap:24,flexWrap:"wrap"}}>
                <Toggle on={includeHeader} onChange={setIncludeHeader} label="Include header"/>
                <Toggle on={includeFooter} onChange={setIncludeFooter} label="Include footer"/>
              </div>
              <div style={{marginTop:6,fontSize:10,color:"#9CA3AF",lineHeight:1.5}}>
                Header = branded banner (logo + company) atop the resume. Footer = company · CONFIDENTIAL · date · page number. These apply to the resume pages only — the scorecard always keeps its own ScorQ header &amp; footer.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Selection */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,padding:"0 4px"}}>
        <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,cursor:"pointer",color:"#6B7280"}}><input type="checkbox" checked={filtered.length>0&&filtered.every(c=>selected.has(c.id))} onChange={selectAll}/>Select all ({filtered.length})</label>
        {selected.size>0&&<><span style={{fontSize:11,fontWeight:600,color:INDIGO}}>{selected.size} selected</span><button style={S.btnG} onClick={()=>{setCraftQueue(candidates.filter(c=>selected.has(c.id)));setStep("craft");}}>Move to craft →</button><button style={{fontSize:11,color:"#6B7280",background:"none",border:"none",cursor:"pointer"}} onClick={()=>setSelected(new Set())}>Clear</button></>}
      </div>

      {/* Rows */}
      {filtered.map(c=>(
        <CandidateRow key={c.id} c={c} job={jobForDisplay} cutoff={cutoff} selected={selected.has(c.id)} masked={maskPI} logoUrl={logoUrl}
          downloading={downloading===`sc-${c.scoreId}`}
          onToggle={()=>toggleSelect(c.id)} onCraft={()=>{setCraftQueue([c]);setStep("craft");}} onViewScorecard={()=>setViewScorecard(c)} onDownload={()=>downloadScorecard(c)}/>
      ))}
    </div>
    );
  };

  // ─── Craft ─────────────────────────────────────────────────────
  const renderCraft=()=>(
    <div style={S.container}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
        <div><div style={S.h2}>Craft resumes ({craftQueue.length})</div><p style={S.sub}>Format, edit, and download</p></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>{busy&&<span style={{fontSize:11,color:INDIGO}}>{busy}</span>}<button style={{...S.btn,opacity:craftingAll?0.7:1,cursor:craftingAll?"default":"pointer"}} disabled={craftingAll} onClick={craftAll}>{craftingAll&&<Spinner size={12} color="#fff"/>}{craftingAll?"Crafting…":"Batch craft all"}</button><button style={S.btnO} onClick={()=>setStep("results")}>← Back</button></div>
      </div>
      {craftQueue.map(c=>(
        <div key={c.id} style={{...S.card,padding:0,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:38,height:38,borderRadius:8,background:sBg(c.score),display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${sColor(c.score)}20`}}>
                <span style={{fontSize:15,fontWeight:800,color:sColor(c.score)}}>{c.score}</span>
              </div>
              <div><div style={{fontSize:13,fontWeight:600,color:"#1F2937"}}>{c.name}</div><div style={{fontSize:11,color:"#6B7280"}}>{maskPI?"PI masked":c.email||"No email"}</div></div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {c.crafted?(<>
                <span style={S.chip("#ECFDF5","#059669")}>Crafted ✓</span>
                <button style={S.btnO} onClick={()=>setViewScorecard(c)}>Scorecard</button>
                <button style={S.btnO} onClick={()=>setEditCandidate(JSON.parse(JSON.stringify(c)))}>Edit</button>
                <button style={S.btnS} onClick={()=>setDownloadModal(c)}>Download</button>
              </>):(()=>{const loading=craftingId===c.id;return(<button style={{...S.btn,opacity:loading?0.7:1,cursor:loading?"default":"pointer"}} disabled={loading||craftingAll} onClick={()=>craftOne(c)}>{loading&&<Spinner size={12} color="#fff"/>}{loading?"Crafting…":"Craft resume"}</button>);})()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  // ─── Editor Modal ──────────────────────────────────────────────
  const renderEditor=()=>{
    if(!editCandidate)return null;
    const c=editCandidate;
    const u=(fn)=>setEditCandidate(prev=>{const n=JSON.parse(JSON.stringify(prev));fn(n);return n;});
    // Subtle gold dashed "+ Add" button for inserting new blocks into any section.
    const addBtnStyle={fontSize:11,fontWeight:600,color:GOLD,background:"none",border:`1px dashed ${GOLD}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",marginTop:6,marginBottom:4,display:"inline-flex",alignItems:"center",gap:4};
    const AddBtn=({onClick,children})=>(<button type="button" style={addBtnStyle} onClick={onClick}>＋ {children}</button>);
    const delBtn={background:"none",border:"none",color:"#DC2626",cursor:"pointer",fontSize:12,fontWeight:700,padding:"0 4px",flexShrink:0};
    return(
      <div style={S.modal} onClick={()=>setEditCandidate(null)}>
        <div style={{...S.modalBox,maxWidth:900}} onClick={e=>e.stopPropagation()}>
          <div style={{padding:"14px 20px",borderBottom:"1px solid #E5E7EB",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#F8FAFC"}}>
            <div><div style={{fontSize:15,fontWeight:700,color:NAVY}}>Edit resume: {c.name}</div><div style={{fontSize:11,color:"#9CA3AF"}}>Changes saved for download</div></div>
            <button style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:"#9CA3AF"}} onClick={()=>setEditCandidate(null)}>✕</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",flex:1,overflow:"hidden"}}>
            {/* Edit form */}
            <div style={{padding:18,overflowY:"auto",borderRight:"1px solid #E5E7EB",maxHeight:"70vh"}}>
              <div style={S.label}>Contact info</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                {[["Name","name"],["Email","email"],["Phone","phone"],["Location","location"]].map(([l,k])=>(
                  <div key={k}><div style={{fontSize:10,color:"#6B7280",marginBottom:3}}>{l}</div>
                  <input style={S.input} value={c[k]||""} onChange={e=>u(n=>{n[k]=e.target.value})}/></div>
                ))}
              </div>

              <div style={S.label}>Executive summary</div>
              {c.executive_summary?.map((p,i)=>(
                <div key={i} style={{display:"flex",gap:6,marginBottom:4}}>
                  <span style={{color:"#9CA3AF",fontSize:10,marginTop:8,minWidth:16}}>{i+1}.</span>
                  <textarea style={{...S.input,height:40,resize:"vertical",fontSize:12}} value={p}
                    onChange={e=>u(n=>{n.executive_summary[i]=e.target.value})}/>
                  <button style={delBtn} title="Remove bullet" onClick={()=>u(n=>{n.executive_summary.splice(i,1)})}>✕</button>
                </div>
              ))}
              <AddBtn onClick={()=>u(n=>{(n.executive_summary=n.executive_summary||[]).push("")})}>Add bullet point</AddBtn>

              <div style={{...S.label,marginTop:14}}>Employment & projects</div>
              {c.employment?.map((emp,i)=>(
                <div key={i} style={{background:"#F9FAFB",borderRadius:8,padding:10,marginBottom:8,border:"1px solid #E5E7EB"}}>
                  <div style={{display:"flex",gap:6,marginBottom:6}}>
                    <input style={{...S.input,fontWeight:600}} placeholder="Company" value={emp.company} onChange={e=>u(n=>{n.employment[i].company=e.target.value})}/>
                    <input style={S.input} placeholder="Role" value={emp.role} onChange={e=>u(n=>{n.employment[i].role=e.target.value})}/>
                    <button style={delBtn} title="Remove company" onClick={()=>u(n=>{n.employment.splice(i,1)})}>✕</button>
                  </div>
                  {emp.projects?.map((proj,j)=>(
                    <div key={j} style={{marginLeft:8,paddingLeft:8,borderLeft:`2px solid ${GOLD}50`,marginBottom:6}}>
                      <div style={{display:"flex",gap:4,marginBottom:4}}>
                        <input style={{...S.input,fontSize:12,fontWeight:600}} placeholder="Project name" value={proj.name} onChange={e=>u(n=>{n.employment[i].projects[j].name=e.target.value})}/>
                        <button style={delBtn} title="Remove project" onClick={()=>u(n=>{n.employment[i].projects.splice(j,1)})}>✕</button>
                      </div>
                      {proj.responsibilities?.map((r,k)=>(
                        <div key={k} style={{display:"flex",gap:4,marginBottom:3}}>
                          <span style={{color:"#D1D5DB",marginTop:7}}>•</span>
                          <input style={{...S.input,fontSize:11}} value={r} onChange={e=>u(n=>{n.employment[i].projects[j].responsibilities[k]=e.target.value})}/>
                          <button style={delBtn} title="Remove responsibility" onClick={()=>u(n=>{n.employment[i].projects[j].responsibilities.splice(k,1)})}>✕</button>
                        </div>
                      ))}
                      <AddBtn onClick={()=>u(n=>{(n.employment[i].projects[j].responsibilities=n.employment[i].projects[j].responsibilities||[]).push("")})}>Add responsibility</AddBtn>
                    </div>
                  ))}
                  <AddBtn onClick={()=>u(n=>{(n.employment[i].projects=n.employment[i].projects||[]).push({name:"",duration:"",responsibilities:[],skills:""})})}>Add project</AddBtn>
                </div>
              ))}
              <AddBtn onClick={()=>u(n=>{(n.employment=n.employment||[]).push({company:"",role:"",duration:"",location:"",projects:[]})})}>Add company</AddBtn>

              <div style={{...S.label,marginTop:14}}>Certifications</div>
              {c.certifications?.map((cert,i)=>(
                <div key={i} style={{display:"flex",gap:6,marginBottom:4}}>
                  <input style={{...S.input,flex:2}} placeholder="Certification" value={cert.name} onChange={e=>u(n=>{n.certifications[i].name=e.target.value})}/>
                  <input style={{...S.input,flex:1}} placeholder="Issuer" value={cert.issuer} onChange={e=>u(n=>{n.certifications[i].issuer=e.target.value})}/>
                  <input style={{...S.input,flex:1}} placeholder="Expiry date" value={cert.expiry||""} onChange={e=>u(n=>{n.certifications[i].expiry=e.target.value})}/>
                  <button style={delBtn} title="Remove certification" onClick={()=>u(n=>{n.certifications.splice(i,1)})}>✕</button>
                </div>
              ))}
              <AddBtn onClick={()=>u(n=>{(n.certifications=n.certifications||[]).push({name:"",issuer:"",expiry:""})})}>Add certification</AddBtn>

              <div style={{...S.label,marginTop:14}}>Education</div>
              {c.education?.map((ed,i)=>(
                <div key={i} style={{display:"flex",gap:6,marginBottom:4}}>
                  <input style={{...S.input,flex:2}} placeholder="Degree" value={ed.degree||""} onChange={e=>u(n=>{n.education[i].degree=e.target.value})}/>
                  <input style={{...S.input,flex:2}} placeholder="Institution" value={ed.institution||""} onChange={e=>u(n=>{n.education[i].institution=e.target.value})}/>
                  <input style={{...S.input,flex:1}} placeholder="Year" value={ed.year||""} onChange={e=>u(n=>{n.education[i].year=e.target.value})}/>
                  <button style={delBtn} title="Remove education" onClick={()=>u(n=>{n.education.splice(i,1)})}>✕</button>
                </div>
              ))}
              <AddBtn onClick={()=>u(n=>{(n.education=n.education||[]).push({level:"",degree:"",institution:"",year:""})})}>Add education</AddBtn>

              <div style={{...S.label,marginTop:14}}>Core competencies</div>
              {c.core_competencies?.map((comp,i)=>(
                <div key={i} style={{display:"flex",gap:6,marginBottom:4}}>
                  <input style={{...S.input,flex:1}} placeholder="Domain" value={comp.domain||""} onChange={e=>u(n=>{n.core_competencies[i].domain=e.target.value})}/>
                  <input style={{...S.input,flex:2}} placeholder="Skills" value={comp.skills||""} onChange={e=>u(n=>{n.core_competencies[i].skills=e.target.value})}/>
                  <input style={{...S.input,flex:2}} placeholder="Tools" value={comp.tools||""} onChange={e=>u(n=>{n.core_competencies[i].tools=e.target.value})}/>
                  <button style={delBtn} title="Remove competency" onClick={()=>u(n=>{n.core_competencies.splice(i,1)})}>✕</button>
                </div>
              ))}
              <AddBtn onClick={()=>u(n=>{(n.core_competencies=n.core_competencies||[]).push({domain:"",skills:"",tools:""})})}>Add competency</AddBtn>

              <div style={{...S.label,marginTop:14}}>Technical competencies</div>
              {[["programming_languages","Programming languages"],["tools_technologies","Tools & technologies"],["platforms","Platforms"]].map(([k,label])=>{
                const tc=c.technical_competencies||{};
                const has=tc[k]!==undefined&&tc[k]!==null;
                return has?(
                  <div key={k} style={{marginBottom:4}}>
                    <div style={{fontSize:10,color:"#6B7280",marginBottom:3}}>{label}</div>
                    <div style={{display:"flex",gap:6}}>
                      <input style={S.input} value={tc[k]||""} onChange={e=>u(n=>{n.technical_competencies={...(n.technical_competencies||{}),[k]:e.target.value}})}/>
                      <button style={delBtn} title="Remove field" onClick={()=>u(n=>{const t={...(n.technical_competencies||{})};delete t[k];n.technical_competencies=t})}>✕</button>
                    </div>
                  </div>
                ):(
                  <AddBtn key={k} onClick={()=>u(n=>{n.technical_competencies={...(n.technical_competencies||{}),[k]:""}})}>Add {label.toLowerCase()}</AddBtn>
                );
              })}

              {/* ── Action Items (internal only — never in downloads) ── */}
              {(()=>{
                const items=buildActionItems(c, jobForDisplay.mustHave||[]);
                if(items.length===0) return null;
                const checks=c._actionChecks||{};
                const done=it=>!!(it.auto||checks[it.id]);
                const remaining=items.filter(it=>!done(it)).length;
                return(
                  <div style={{marginTop:18,background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:12}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#92400E"}}>Action Items ({remaining} remaining)</div>
                      <span style={{fontSize:9,color:"#D97706",background:"#FEF3C7",padding:"2px 7px",borderRadius:10}}>Internal — not included in downloads</span>
                    </div>
                    {items.map(it=>{
                      const isDone=done(it);
                      const locked=it.auto===true; // auto-resolved → checkbox locked
                      return(
                        <label key={it.id} style={{display:"flex",alignItems:"flex-start",gap:7,marginBottom:5,cursor:locked?"default":"pointer",opacity:isDone?0.5:1}}>
                          <input type="checkbox" checked={isDone} disabled={locked} style={{marginTop:2}}
                            onChange={e=>u(n=>{n._actionChecks={...(n._actionChecks||{}),[it.id]:e.target.checked};})}/>
                          <span style={{fontSize:11,color:"#374151",textDecoration:isDone?"line-through":"none"}}>
                            {it.label}
                            {it.auto===false&&<span style={{color:"#9CA3AF"}}> · fill the field above to auto-resolve</span>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Live preview */}
            <div style={{padding:18,overflowY:"auto",background:"#F3F4F6",maxHeight:"70vh"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#6B7280",marginBottom:8}}>Live preview</div>
              {/* Masking only removes email + phone — everything else stays visible.
                  Guard: if the resume has no crafted content yet (structured_data
                  empty, e.g. craft failed), show a hint instead of a blank card. */}
              {(c.executive_summary?.length || c.employment?.length || c.core_competencies?.length) ? (
                <ResumePreview c={c} masked={maskPI} letterhead={letterhead} logoUrl={logoUrl} includeHeader={includeHeader} includeFooter={includeFooter}/>
              ) : (
                <div style={{padding:"28px 18px",textAlign:"center",color:"#9CA3AF",fontSize:12,background:"#fff",border:"1px dashed #D1D5DB",borderRadius:8}}>
                  No crafted content yet — craft this resume to see the formatted preview.
                </div>
              )}
            </div>
          </div>
          <div style={{padding:"12px 20px",borderTop:"1px solid #E5E7EB",display:"flex",gap:8}}>
            <button style={S.btnS} onClick={async()=>{await saveEdited(c);setEditCandidate(null);}}>Save changes</button>
            <button style={S.btn} onClick={async()=>{await saveEdited(c);setEditCandidate(null);setDownloadModal(c);}}>Save &amp; download</button>
            <button style={S.btnO} onClick={()=>setEditCandidate(null)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Scorecard Modal ───────────────────────────────────────────
  const renderScorecardModal=()=>{
    if(!viewScorecard)return null;
    return(
      <div style={S.modal} onClick={()=>setViewScorecard(null)}>
        <div style={{...S.modalBox,maxWidth:700}} onClick={e=>e.stopPropagation()}>
          <div style={{padding:"12px 20px",borderBottom:"1px solid #E5E7EB",display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:14,fontWeight:700,color:NAVY}}>Scorecard: {viewScorecard.name}</span>
            <button style={{background:"none",border:"none",fontSize:16,cursor:"pointer",color:"#9CA3AF"}} onClick={()=>setViewScorecard(null)}>✕</button>
          </div>
          <div style={{padding:20,overflowY:"auto",flex:1,maxHeight:"78vh"}}><Scorecard c={viewScorecard} job={jobForDisplay} logoUrl={logoUrl}/></div>
        </div>
      </div>
    );
  };

  // ─── Download Modal ────────────────────────────────────────────
  const renderDownloadModal=()=>{
    if(!downloadModal)return null;
    const c=downloadModal;
    // Before crafting (Review & Filter stage) only the scorecard exists, so
    // offer just the Scorecard PDF. The full set (resume PDF/DOCX, scorecard,
    // combined) only appears in the Craft stage once a resume is crafted.
    const preCraft=step==="results";
    const allOptions=[
      {icon:"📄",label:"Resume only",sub:"Formatted resume"+(maskPI?" (PI masked)":""),formats:["PDF","DOCX"]},
      {icon:"📊",label:"Scorecard only",sub:"Full ScorQ scorecard with AI reasoning",formats:["PDF"]},
      {icon:"📦",label:"Combined: Resume + Scorecard",sub:"Crafted resume followed by full scorecard as last page",formats:["PDF","DOCX"]},
    ];
    const options=preCraft?allOptions.filter(o=>o.label==="Scorecard only"):allOptions;
    return(
      <div style={S.modal} onClick={()=>setDownloadModal(null)}>
        <div style={{...S.modalBox,maxWidth:460}} onClick={e=>e.stopPropagation()}>
          <div style={{padding:"14px 20px",borderBottom:"1px solid #E5E7EB"}}>
            <div style={{fontSize:15,fontWeight:700,color:NAVY}}>Download: {c.name}</div>
            <div style={{fontSize:11,color:"#9CA3AF"}}>{preCraft?"Scorecard only — craft the resume to unlock resume & combined downloads":(maskPI?"PI will be masked in output":"PI included in output")}</div>
          </div>
          {downloading&&(
            <div style={{margin:"14px 18px 0",display:"flex",alignItems:"center",gap:8,background:"#EEF2FF",border:"1px solid #C7D2FE",borderRadius:8,padding:"9px 12px",fontSize:12,color:INDIGO,fontWeight:600}}>
              <Spinner color={INDIGO}/> Generating your document… This may take a few seconds.
            </div>
          )}
          <div style={{padding:18}}>
            {options.map(opt=>(
              <div key={opt.label} style={{background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:8,padding:12,marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:16}}>{opt.icon}</span>
                  <div><div style={{fontSize:13,fontWeight:600,color:"#1F2937"}}>{opt.label}</div><div style={{fontSize:11,color:"#6B7280"}}>{opt.sub}</div></div>
                </div>
                <div style={{display:"flex",gap:6,marginLeft:24}}>
                  {opt.formats.map(f=>{
                    const isLoading=downloading===`${opt.label}-${f}`;
                    const anyLoading=!!downloading;
                    return(
                      <button key={f} disabled={anyLoading}
                        style={{padding:"5px 14px",background:f==="PDF"?"#DC2626":"#2563EB",color:"#fff",border:"none",borderRadius:5,fontSize:11,fontWeight:600,cursor:anyLoading?"default":"pointer",opacity:anyLoading&&!isLoading?0.5:1,display:"inline-flex",alignItems:"center",gap:6}}
                        onClick={()=>doDownload(c,opt.label,f)}>
                        {isLoading&&<Spinner size={11} color="#fff"/>}{isLoading?"Preparing…":f}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div style={{padding:"10px 20px",borderTop:"1px solid #E5E7EB"}}><button style={S.btnO} onClick={()=>setDownloadModal(null)}>Close</button></div>
        </div>
      </div>
    );
  };

  // ─── Layout ────────────────────────────────────────────────────
  return(
    <div style={S.page}>
      <header style={S.header}>
        <div style={{display:"flex",alignItems:"baseline",gap:2}}>
          <span style={{fontSize:19,fontWeight:800,color:"#fff"}}>Recruit</span><span style={{fontSize:19,fontWeight:800,color:GOLD}}>Craft</span>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginLeft:8}}>by HYROI Solutions</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.35)"}}>Powered by OpenAI GPT-4o</span>
          <button onClick={signOut} style={{fontSize:11,fontWeight:600,color:"#fff",background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.25)",borderRadius:6,padding:"4px 10px",cursor:"pointer"}}>Sign out</button>
        </div>
      </header>
      <div style={S.stepBar}>{steps.map((s,i)=><div key={s.key} style={S.stepItem(step===s.key,i<ci)} onClick={()=>i<ci?setStep(s.key):null}>{i<ci?"✓ ":""}{s.label}</div>)}</div>
      {!configured&&(
        <div style={{background:"#FFFBEB",borderBottom:"1px solid #FDE68A",padding:"7px 24px",fontSize:12,color:"#92400E",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontWeight:700}}>Demo mode</span>
          <span>Running on sample data — add credentials to <code style={{background:"#FEF3C7",padding:"1px 5px",borderRadius:4}}>backend/.env</code> (Supabase + OpenAI) and a Supabase auth token to enable live scoring &amp; crafting.</span>
        </div>
      )}
      {step==="job"&&renderJob()}
      {step==="upload"&&renderUpload()}
      {step==="scoring"&&renderScoring()}
      {step==="results"&&renderResults()}
      {step==="craft"&&renderCraft()}
      {viewScorecard&&renderScorecardModal()}
      {editCandidate&&renderEditor()}
      {downloadModal&&renderDownloadModal()}
      <Toast toast={toast}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CANDIDATE ROW
// ═══════════════════════════════════════════════════════════════════
function CandidateRow({c,job,cutoff,selected,masked,logoUrl,downloading,onToggle,onCraft,onViewScorecard,onDownload}){
  const[expanded,setExpanded]=useState(false);
  const above=c.score>=cutoff;
  const email=masked?"••••••@••••.com":c.email;
  const phone=masked?"••••••••••":c.phone;
  const CATS=[{key:"technical",label:"Tech",color:"#2563EB"},{key:"experience",label:"Exp",color:"#059669"},{key:"education",label:"Edu",color:"#7C3AED"},{key:"stability",label:"Stab",color:"#EA580C"}];

  return(
    <div style={{background:"#fff",borderRadius:8,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:6,border:selected?`2px solid ${INDIGO}`:`1px solid ${above?"#BBF7D0":"#E5E7EB"}`,overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",cursor:"pointer"}} onClick={()=>setExpanded(!expanded)}>
        <input type="checkbox" checked={selected} onChange={e=>{e.stopPropagation();onToggle();}} onClick={e=>e.stopPropagation()}/>
        <div style={{width:40,height:40,borderRadius:8,background:sBg(c.score),display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <span style={{fontSize:15,fontWeight:800,color:sColor(c.score),lineHeight:1}}>{c.score}</span>
          <span style={{fontSize:7,fontWeight:700,color:sColor(c.score)}}>SCORE</span>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:600,color:"#1F2937"}}>{c.name}</div>
          <div style={{fontSize:10,color:"#6B7280"}}>{email||"No email"}{phone?` · ${phone}`:""}</div>
        </div>
        <div style={{display:"flex",gap:4}}>
          {CATS.map(cat=>{const v=c.categories[cat.key];return(
            <div key={cat.key} style={{textAlign:"center",minWidth:40}}>
              <div style={{fontSize:8,fontWeight:600,color:cat.color}}>{cat.label}</div>
              <div style={{fontSize:11,fontWeight:700,color:v!=null?sColor(v):"#D1D5DB"}}>{v!=null?`${v}%`:"—"}</div>
            </div>
          );})}
        </div>
        <span style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:20,background:above?"#ECFDF5":"#FEF2F2",color:above?"#059669":"#DC2626"}}>{above?"Above":"Below"} cutoff</span>
        {c.gaps.length>0&&<span style={{fontSize:9,background:"#FEF3C7",color:"#92400E",padding:"2px 7px",borderRadius:20,fontWeight:600}}>{c.gaps.length} gap{c.gaps.length>1?"s":""}</span>}
        <span style={{fontSize:12,color:"#9CA3AF",transform:expanded?"rotate(180deg)":"none",transition:"transform 0.2s"}}>▼</span>
      </div>

      {expanded&&(
        <div style={{borderTop:"1px solid #E5E7EB",padding:14}}>
          {/* Score bars */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
            {CATS.map(cat=>{const v=c.categories[cat.key];return(
              <div key={cat.key} style={{background:sBg(v||0),borderRadius:8,padding:8}}>
                <div style={{fontSize:10,fontWeight:600,color:cat.color,marginBottom:2}}>{cat.label} ({job.weights[cat.key]}%)</div>
                <div style={{fontSize:16,fontWeight:800,color:v!=null?sColor(v):"#D1D5DB"}}>{v!=null?`${v}%`:"—"}</div>
                <div style={{height:4,background:"#E5E7EB",borderRadius:99,marginTop:3}}><div style={{height:4,width:v!=null?`${v}%`:"0%",background:cat.color,borderRadius:99}}/></div>
              </div>
            );})}
          </div>

          {/* Skills */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            <div><div style={{fontSize:10,fontWeight:600,color:"#059669",marginBottom:3}}>Matched ({c.matched.length})</div>{c.matched.map(s=><span key={s} style={S.chip("#ECFDF5","#059669")}>{s}</span>)}</div>
            <div><div style={{fontSize:10,fontWeight:600,color:"#DC2626",marginBottom:3}}>Missing ({c.missing.length})</div>{c.missing.length?c.missing.map(s=><span key={s} style={S.chip("#FEF2F2","#DC2626")}>{s}</span>):<span style={{fontSize:10,color:"#9CA3AF"}}>All matched</span>}</div>
          </div>

          {/* AI reasoning */}
          <div style={{background:"#FFF7ED",borderRadius:8,padding:10,border:"1px solid #FED7AA",marginBottom:12}}>
            <div style={{fontSize:10,fontWeight:700,color:"#C2410C",marginBottom:3}}>AI assessment</div>
            <div style={{fontSize:11,color:"#9A3412",lineHeight:1.6}}>{c.reasoning}</div>
          </div>

          {/* Action items — internal only for recruiter */}
          {c.gaps.length>0&&(
            <div style={{background:"#FFFBEB",borderRadius:8,padding:10,border:"1px solid #FDE68A",marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:4}}>
                <span style={{fontSize:10,fontWeight:700,color:"#92400E"}}>Action items</span>
                <span style={{fontSize:9,color:"#D97706",background:"#FEF3C7",padding:"1px 6px",borderRadius:10}}>internal only</span>
              </div>
              {c.gaps.map((g,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:5,marginBottom:2}}><span style={{width:11,height:11,borderRadius:3,border:"2px solid #F59E0B",flexShrink:0,display:"inline-block"}}/><span style={{fontSize:11,color:"#374151"}}>{g}</span></div>)}
              {c.certifications?.some(cert=>!cert.expiry)&&<div style={{display:"flex",alignItems:"center",gap:5,marginBottom:2}}><span style={{width:11,height:11,borderRadius:3,border:"2px solid #F59E0B",flexShrink:0,display:"inline-block"}}/><span style={{fontSize:11,color:"#374151"}}>Certification expiry date missing</span></div>}
            </div>
          )}

          {/* Actions */}
          <div style={{display:"flex",gap:6}}>
            <button style={S.btnO} onClick={e=>{e.stopPropagation();onViewScorecard();}}>View scorecard</button>
            {above&&<button style={S.btnG} onClick={e=>{e.stopPropagation();onCraft();}}>Craft resume →</button>}
            <button style={{...S.btnO,opacity:downloading?0.6:1,cursor:downloading?"default":"pointer",display:"inline-flex",alignItems:"center",gap:6}} disabled={downloading} onClick={e=>{e.stopPropagation();onDownload();}}>{downloading&&<Spinner size={11} color="#6B7280"/>}{downloading?"Preparing…":"Download scorecard"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
