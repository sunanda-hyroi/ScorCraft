"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import * as api from "@/lib/api";
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

// ─── Mock Data ───────────────────────────────────────────────────
const MOCK_JOB = {
  title: "Senior Data Engineer",
  skills: ["Python","SQL Server","ETL Pipelines","Power BI","Azure","Data Modeling"],
  mustHave: ["Python","SQL Server","ETL Pipelines"],
  goodToHave: ["Power BI","Azure"],
  bonus: ["Data Modeling"],
  weights: { technical: 40, experience: 25, education: 15, soft_skills: 10, stability: 10 },
};

const mkCandidate = (id,name,email,phone,location,score,cats,matched,missing,highlights,redFlags,gaps,reasoning,skillDetails,employment,education,certifications,summary,coreComp,techComp) => ({
  id,name,email,phone,location,score,categories:cats,matched,missing,highlights,redFlags,gaps,reasoning,skillDetails,employment,education,certifications,executive_summary:summary,core_competencies:coreComp,technical_competencies:techComp
});

const MOCK_CANDIDATES = [
  {
    id:"1",name:"Assadullah Buriro",email:"assadburiro30@gmail.com",phone:"+92 301 2078438",location:"Karachi, Pakistan",
    score:87,
    categories:{technical:87,experience:100,education:null,stability:90},
    matched:["Loan IQ","Finastra","implementations","API","Testing"],
    missing:["Testing frameworks"],
    highlights:[
      "Worked on Finastra Fusion Loan IQ implementations, showcasing relevant domain expertise.",
      "Designed RESTful APIs and conducted comprehensive unit testing, demonstrating strong technical skills."
    ],
    redFlags:[],
    gaps:["No specific mention of testing methodologies or frameworks","Limited evidence of leadership roles"],
    catReasoning:{
      technical:"The candidate has solid experience with Loan IQ, having worked on implementations and customizations for Finastra Fusion Loan IQ, which is directly relevant to the role. They also have strong skills in API development and testing, demonstrated through their work on various projects. However, there is no specific mention of testing methodologies or frameworks used in relation to Loan IQ, which could be a gap.",
      experience:"The candidate has over 14 years of experience, primarily in product companies, which is a positive signal. Their role at Telenor Bank involved direct work with Loan IQ, showcasing domain expertise. However, there is limited evidence of leadership roles or rapid career progression, which could enhance their experience score.",
      education:"The candidate holds a Bachelor's degree in Information Technology, which aligns well with the technical requirements of the role.",
      stability:"The candidate has a strong stability score, with tenure at companies like Telenor Bank and Systems Limited, indicating a consistent career path with durations ranging from 1.5 to 3 years."
    },
    reasoning:"The candidate demonstrates a strong technical fit with relevant experience in Loan IQ and API development, making them a suitable candidate for the role. Their extensive experience in product companies adds to their qualifications, although the lack of leadership roles may raise some concerns. Overall, I recommend considering this candidate for the position, given their relevant skills and experience.",
    skillDetails:[
      {skill:"Loan IQ",found:true,where:"Finastra implementations",level:"Expert"},
      {skill:"Finastra",found:true,where:"Direct product work",level:"Expert"},
      {skill:"implementations",found:true,where:"Multiple projects",level:"Advanced"},
      {skill:"API",found:true,where:"RESTful API design",level:"Advanced"},
      {skill:"Testing",found:true,where:"Unit testing",level:"Intermediate"},
    ],
    employment:[
      {company:"Telenor Bank",role:"Senior Software Engineer",duration:"Jan 2022 – Present",location:"Karachi",
        projects:[
          {name:"Loan IQ Core Implementation",duration:"Jun 2023 – Present",responsibilities:["Led Finastra Fusion Loan IQ implementation and customization","Designed RESTful APIs for banking integration","Conducted comprehensive unit testing for all modules"],skills:"Loan IQ, Finastra, Java, REST APIs"},
          {name:"Payment Gateway Integration",duration:"Jan 2022 – May 2023",responsibilities:["Integrated third-party payment systems with core banking","Developed API middleware for transaction processing"],skills:"Java, API Development, Integration"},
        ]},
      {company:"Systems Limited",role:"Software Engineer",duration:"Mar 2019 – Dec 2021",location:"Lahore",
        projects:[
          {name:"Enterprise Banking Platform",duration:"Mar 2019 – Dec 2021",responsibilities:["Developed microservices for banking operations","Implemented automated testing pipelines"],skills:"Java, Microservices, Testing"},
        ]},
      {company:"NetSol Technologies",role:"Junior Developer",duration:"Jul 2016 – Feb 2019",location:"Lahore",
        projects:[
          {name:"Financial Products Module",duration:"Jul 2016 – Feb 2019",responsibilities:["Built financial product configuration modules","Supported QA testing and bug resolution"],skills:"Java, SQL, Financial Products"},
        ]},
    ],
    education:[{degree:"Bachelor of Science in Information Technology",institution:"University of Karachi",year:"2016"}],
    certifications:[
      {name:"Oracle Certified Java Programmer",issuer:"Oracle",expiry:"No Expiry"},
      {name:"Finastra Fusion Loan IQ Specialist",issuer:"Finastra",expiry:null},
    ],
    executive_summary:[
      "14+ years of experience in software engineering with deep expertise in financial services and banking technology",
      "Hands-on implementation and customization experience with Finastra Fusion Loan IQ platform",
      "Strong API development skills with focus on RESTful service design for banking integrations",
      "Proven track record in product companies including Telenor Bank, Systems Limited, and NetSol Technologies",
      "Comprehensive testing experience including unit testing and quality assurance for banking modules",
      "Solid understanding of financial products, payment systems, and core banking operations",
    ],
    core_competencies:[
      {domain:"Banking Technology",skills:"Loan IQ, Core Banking, Payment Systems",tools:"Finastra Fusion, Java, Spring Boot"},
      {domain:"API Development",skills:"RESTful APIs, Integration, Middleware",tools:"Java, Spring, Swagger"},
      {domain:"Testing & QA",skills:"Unit Testing, Test Automation",tools:"JUnit, Mockito"},
    ],
    technical_competencies:{programming_languages:"Java, SQL, JavaScript",tools_technologies:"Finastra Fusion Loan IQ, Spring Boot, REST APIs, Git",platforms:"Linux, Oracle DB, Azure"},
  },
  {
    id:"2",name:"Priya Sharma",email:"priya.s@email.com",phone:"+91 9876543210",location:"Mumbai, India",
    score:91,categories:{technical:95,experience:88,education:85,stability:90},
    matched:["Python","SQL Server","ETL Pipelines","Power BI","Azure","Data Modeling"],missing:[],
    highlights:["8 yrs experience","All 6 skills matched","AWS + Azure dual certified"],redFlags:[],gaps:[],
    catReasoning:{
      technical:"Exceptional technical profile. All 6 required skills explicitly demonstrated with advanced to expert proficiency. Has led enterprise-scale data engineering projects with measurable outcomes.",
      experience:"8 years of directly relevant experience with progressive responsibility from engineer to lead. Led teams of 5+ engineers.",
      education:"M.Tech from IIT Bombay in Data Science — strong academic foundation directly aligned with role requirements.",
      stability:"Consistent career progression with reasonable tenures. No job-hopping concerns."
    },
    reasoning:"Exceptional candidate. All 6 required skills explicitly present with strong evidence. 8 years of directly relevant experience with progressive responsibility. Dual cloud certification demonstrates breadth. Top recommendation.",
    skillDetails:[
      {skill:"Python",found:true,where:"Primary language",level:"Expert"},
      {skill:"SQL Server",found:true,where:"Database admin + queries",level:"Expert"},
      {skill:"ETL Pipelines",found:true,where:"Enterprise pipelines",level:"Expert"},
      {skill:"Power BI",found:true,where:"20+ dashboards",level:"Advanced"},
      {skill:"Azure",found:true,where:"Certified",level:"Advanced"},
      {skill:"Data Modeling",found:true,where:"Led initiatives",level:"Advanced"},
    ],
    employment:[
      {company:"Infosys",role:"Lead Data Engineer",duration:"Jan 2022 – Present",location:"Mumbai",projects:[
        {name:"Cloud Data Platform Migration",duration:"Jun 2023 – Present",responsibilities:["Architected cloud-native data platform on Azure","Led team of 5 engineers"],skills:"Azure, Python, ETL"},
        {name:"Enterprise BI Modernization",duration:"Jan 2022 – May 2023",responsibilities:["Built 20+ Power BI dashboards","Implemented data modeling best practices"],skills:"Power BI, Data Modeling, SQL"},
      ]},
      {company:"Wipro",role:"Senior Data Engineer",duration:"Mar 2019 – Dec 2021",location:"Pune",projects:[
        {name:"Data Warehouse Consolidation",duration:"Mar 2019 – Dec 2021",responsibilities:["Consolidated 3 legacy data warehouses","Reduced processing time by 60%"],skills:"SQL Server, ETL, Python"},
      ]},
    ],
    education:[{degree:"Master of Technology in Data Science",institution:"IIT Bombay",year:"2018"}],
    certifications:[{name:"Azure Data Engineer Associate",issuer:"Microsoft",expiry:"Mar 2027"},{name:"AWS Certified Data Analytics",issuer:"Amazon",expiry:"Sep 2026"}],
    executive_summary:["8+ years in data engineering with full-stack BI capabilities","All required technical competencies at advanced/expert level","Led enterprise cloud migration with 60% performance improvement","Dual certified in Azure and AWS cloud platforms"],
    core_competencies:[{domain:"Data Engineering",skills:"ETL, Data Modeling, Cloud Architecture",tools:"Python, Azure, AWS, SQL Server"}],
    technical_competencies:{programming_languages:"Python, Scala, SQL",tools_technologies:"Power BI, Azure Data Factory, Databricks",platforms:"Azure, AWS"},
  },
  {
    id:"3",name:"Rahul Verma",email:"rahul.v@email.com",phone:"+91 7654321098",location:"Delhi, India",
    score:68,categories:{technical:62,experience:72,education:70,stability:75},
    matched:["Python","SQL Server","Power BI"],missing:["ETL Pipelines","Azure","Data Modeling"],
    highlights:["5 yrs BI experience","Strong SQL skills"],redFlags:["Missing must-have: ETL Pipelines"],
    gaps:["Email not verified","Certification details incomplete","No cloud experience documented"],
    catReasoning:{
      technical:"Has Python and SQL Server (must-haves) and Power BI. Missing ETL Pipelines (must-have) leads to score cap. No cloud or data modeling experience documented.",
      experience:"5 years in BI reporting. Relevant but limited to analyst-level work without engineering scope.",
      education:"B.E. in IT from DTU — solid technical foundation.",
      stability:"Stable tenure at TCS. No concerns."
    },
    reasoning:"Decent BI background but missing ETL Pipelines (must-have). Would need significant upskilling for this role. Technical score capped due to missing must-have skill.",
    skillDetails:[
      {skill:"Python",found:true,where:"Scripting",level:"Intermediate"},
      {skill:"SQL Server",found:true,where:"Reports",level:"Advanced"},
      {skill:"ETL Pipelines",found:false,where:"Not found",level:"—"},
      {skill:"Power BI",found:true,where:"Dashboards",level:"Intermediate"},
      {skill:"Azure",found:false,where:"Not found",level:"—"},
      {skill:"Data Modeling",found:false,where:"Not found",level:"—"},
    ],
    employment:[{company:"TCS",role:"BI Analyst",duration:"Jun 2021 – Present",location:"Delhi",projects:[
      {name:"Sales Reporting Platform",duration:"Jun 2021 – Present",responsibilities:["Created Power BI reports","Complex SQL queries for extraction"],skills:"Power BI, SQL Server, Python"},
    ]}],
    education:[{degree:"Bachelor of Engineering in IT",institution:"Delhi Technological University",year:"2020"}],
    certifications:[{name:"Power BI Certification",issuer:"Microsoft",expiry:null}],
    executive_summary:["5 years in BI with strong SQL","Power BI dashboard development"],
    core_competencies:[{domain:"BI",skills:"Reporting, Dashboards",tools:"Power BI, SQL Server"}],
    technical_competencies:{programming_languages:"Python, SQL",tools_technologies:"Power BI, SSRS",platforms:"Windows Server"},
  },
  {
    id:"4",name:"Sneha Patel",email:"sneha.p@email.com",phone:null,location:"Hyderabad, India",
    score:74,categories:{technical:75,experience:70,education:80,stability:68},
    matched:["Python","SQL Server","ETL Pipelines","Azure"],missing:["Power BI","Data Modeling"],
    highlights:["4 yrs cloud data eng","Azure certified"],redFlags:["Avg tenure < 2 yrs"],
    gaps:["Phone number missing","Notice period not mentioned"],
    catReasoning:{
      technical:"Has 3/3 must-have skills plus Azure. Missing Power BI and Data Modeling but has all critical requirements.",
      experience:"4 years cloud-focused data engineering. Good but limited progression.",
      education:"M.Sc from BITS Pilani — strong academic profile.",
      stability:"Short tenures across roles. 2 companies in 3 years raises mild concern."
    },
    reasoning:"Good technical foundation with all must-have skills. Missing Power BI and Data Modeling. Short tenures are a concern. Phone number missing — needs follow-up.",
    skillDetails:[
      {skill:"Python",found:true,where:"Pipeline scripts",level:"Advanced"},
      {skill:"SQL Server",found:true,where:"DB management",level:"Intermediate"},
      {skill:"ETL Pipelines",found:true,where:"Built with Airflow",level:"Advanced"},
      {skill:"Power BI",found:false,where:"Not found",level:"—"},
      {skill:"Azure",found:true,where:"Synapse & ADF",level:"Advanced"},
      {skill:"Data Modeling",found:false,where:"Not found",level:"—"},
    ],
    employment:[
      {company:"Deloitte",role:"Cloud Data Engineer",duration:"Apr 2023 – Present",location:"Hyderabad",projects:[
        {name:"Azure Data Lake Implementation",duration:"Apr 2023 – Present",responsibilities:["Built ETL pipelines using ADF","Managed Azure Synapse"],skills:"Azure, Python, ETL"},
      ]},
      {company:"Accenture",role:"Data Engineer",duration:"Jul 2021 – Mar 2023",location:"Hyderabad",projects:[
        {name:"Client Data Integration",duration:"Jul 2021 – Mar 2023",responsibilities:["Python-based extraction scripts","Managed SQL Server databases"],skills:"Python, SQL Server"},
      ]},
    ],
    education:[{degree:"Master of Science in Computer Science",institution:"BITS Pilani",year:"2021"}],
    certifications:[{name:"Azure Data Engineer Associate",issuer:"Microsoft",expiry:"Jun 2025"}],
    executive_summary:["4 years cloud-native data engineering","Production ETL pipelines on Azure"],
    core_competencies:[{domain:"Cloud Data Engineering",skills:"ETL, Data Lake",tools:"Azure, Python, Airflow"}],
    technical_competencies:{programming_languages:"Python, SQL",tools_technologies:"Azure Data Factory, Synapse",platforms:"Azure"},
  },
  {
    id:"5",name:"Vikram Singh",email:null,phone:"+91 9988776655",location:"Chennai, India",
    score:45,categories:{technical:35,experience:55,education:60,stability:50},
    matched:["Python"],missing:["SQL Server","ETL Pipelines","Power BI","Azure","Data Modeling"],
    highlights:["3 yrs Python dev"],redFlags:["5 of 6 skills missing","No data engineering experience"],
    gaps:["Email missing","No certifications listed","Education details incomplete","No data engineering projects"],
    catReasoning:{
      technical:"Only Python found. Missing all 3 must-have skills except Python. Score heavily penalized. No database, ETL, BI, or cloud skills.",
      experience:"3 years in web development. No data engineering relevance.",
      education:"B.Sc from Anna University. Adequate but not specialized.",
      stability:"Single employer — stable but short tenure."
    },
    reasoning:"Python developer without data engineering background. Only 1 of 6 required skills. Not suitable for this role.",
    skillDetails:[
      {skill:"Python",found:true,where:"Web dev",level:"Advanced"},
      {skill:"SQL Server",found:false,where:"Not found",level:"—"},
      {skill:"ETL Pipelines",found:false,where:"Not found",level:"—"},
      {skill:"Power BI",found:false,where:"Not found",level:"—"},
      {skill:"Azure",found:false,where:"Not found",level:"—"},
      {skill:"Data Modeling",found:false,where:"Not found",level:"—"},
    ],
    employment:[{company:"Zoho",role:"Python Developer",duration:"Jun 2022 – Present",location:"Chennai",projects:[
      {name:"CRM Module Development",duration:"Jun 2022 – Present",responsibilities:["Built REST APIs using Django","Unit tests for backend"],skills:"Python, Django"},
    ]}],
    education:[{degree:"Bachelor of Science in Computer Science",institution:"Anna University",year:"2021"}],
    certifications:[],
    executive_summary:["3 years Python development in web apps"],
    core_competencies:[{domain:"Web Dev",skills:"APIs, Backend",tools:"Python, Django"}],
    technical_competencies:{programming_languages:"Python, JavaScript",tools_technologies:"Django, PostgreSQL",platforms:"Linux"},
  },
  {
    id:"6",name:"Meera Krishnan",email:"meera.k@email.com",phone:"+91 8899776655",location:"Pune, India",
    score:58,categories:{technical:50,experience:65,education:70,stability:55},
    matched:["Python","SQL Server","Data Modeling"],missing:["ETL Pipelines","Power BI","Azure"],
    highlights:["4 yrs data analyst","Strong SQL"],redFlags:["Missing must-have: ETL Pipelines"],
    gaps:["Notice period not specified","No cloud certifications"],
    catReasoning:{
      technical:"Has Python, SQL Server (must-haves), and Data Modeling (bonus). Missing ETL Pipelines (must-have) caps the score. No cloud/BI experience.",
      experience:"4 years as data analyst. Relevant SQL work but no engineering-scope projects.",
      education:"B.Tech from Pune University — solid foundation.",
      stability:"Single company — fine but only 2 years total experience documented."
    },
    reasoning:"Data analyst transitioning to engineering. Has SQL and Python but lacks ETL and cloud. Could be considered if willing to upskill.",
    skillDetails:[
      {skill:"Python",found:true,where:"Analysis scripts",level:"Intermediate"},
      {skill:"SQL Server",found:true,where:"Primary tool",level:"Advanced"},
      {skill:"ETL Pipelines",found:false,where:"Not found",level:"—"},
      {skill:"Power BI",found:false,where:"Uses Tableau",level:"—"},
      {skill:"Azure",found:false,where:"Not found",level:"—"},
      {skill:"Data Modeling",found:true,where:"Dimensional models",level:"Intermediate"},
    ],
    employment:[{company:"Persistent Systems",role:"Data Analyst",duration:"Aug 2022 – Present",location:"Pune",projects:[
      {name:"Customer Analytics Platform",duration:"Aug 2022 – Present",responsibilities:["Data models for customer segmentation","Automated reporting with Python","Complex SQL queries"],skills:"Python, SQL Server, Data Modeling"},
    ]}],
    education:[{degree:"Bachelor of Technology in Computer Engineering",institution:"Pune University",year:"2022"}],
    certifications:[{name:"Tableau Desktop Specialist",issuer:"Tableau",expiry:"Mar 2026"}],
    executive_summary:["4 years data analytics with strong SQL and modeling"],
    core_competencies:[{domain:"Data Analytics",skills:"Data Modeling, SQL",tools:"Python, SQL Server, Tableau"}],
    technical_competencies:{programming_languages:"Python, SQL, R",tools_technologies:"Tableau, SQL Server, Excel",platforms:"Windows"},
  },
];

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
function ResumePreview({c,masked,letterhead,logoUrl}){
  const email=masked?null:c.email;
  const phone=masked?null:c.phone;
  return(
    <div style={{background:"#fff",border:"1px solid #D1D5DB",borderRadius:6,fontSize:11,lineHeight:1.6}}>
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

      {/* Footer */}
      <div style={{borderTop:`2px solid ${GOLD}`,padding:"8px 20px",background:"#F9FAFB",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {logoUrl?<img src={logoUrl} alt="Logo" style={{height:22,objectFit:"contain"}}/>:
            <div>
              <div style={{fontSize:10,fontWeight:700,color:NAVY}}>{letterhead?.company||"HYROI Solutions"}</div>
              <div style={{fontSize:8,color:"#9CA3AF"}}>{letterhead?.tagline||""}</div>
            </div>}
          {logoUrl&&letterhead?.company&&<div><div style={{fontSize:10,fontWeight:700,color:NAVY}}>{letterhead.company}</div><div style={{fontSize:8,color:"#9CA3AF"}}>{letterhead.email} · {letterhead.phone}</div></div>}
        </div>
        <div style={{fontSize:8,color:"#B0B0B0"}}>Generated by ScorCraft · Confidential</div>
      </div>
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
  const[logoUrl,setLogoUrl]=useState(null);
  const[showSettings,setShowSettings]=useState(false);
  const logoRef=useRef(null);

  // ── Backend wiring ────────────────────────────────────────────
  const[demoMode,setDemoMode]=useState(true);          // until /health proves live
  const[jobs,setJobs]=useState([]);                    // live jobs (if any)
  const[activeJob,setActiveJob]=useState(null);        // selected live job
  const[uploadFileObjs,setUploadFileObjs]=useState([]);// real File objects for scoring
  const[busy,setBusy]=useState("");                    // small status message
  const resumeRef=useRef(null);                        // hidden resume file input

  const SAMPLE_FILES=[{name:"Assadullah_Buriro_Resume.pdf",size:"245 KB"},{name:"Priya_Sharma_CV.pdf",size:"312 KB"},{name:"Rahul_Verma_Resume.docx",size:"189 KB"},{name:"Sneha_Patel_CV.pdf",size:"267 KB"},{name:"Vikram_Singh_Resume.pdf",size:"198 KB"},{name:"Meera_Krishnan_CV.docx",size:"223 KB"}];
  const handleResumeFiles=(e)=>{
    const files=Array.from(e.target.files||[]);
    if(!files.length)return;
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
    })();
    return()=>{cancelled=true;};
  },[fallbackToDemo,loadJobResults]);

  // Switch the active live job and reload its persisted scores.
  const selectJob=useCallback((job)=>{
    setActiveJob(job);
    setSelected(new Set());
    if(!demoMode&&job?.id)loadJobResults(job.id);
  },[demoMode,loadJobResults]);

  const jobIdForScoring=activeJob?.id||null;
  const jobTitle=activeJob?.title||MOCK_JOB.title;

  const runScoring=useCallback(async()=>{
    setStep("scoring");setScoringProgress(0);
    // Live path: real files + a real job id + configured backend.
    if(!demoMode&&jobIdForScoring&&uploadFileObjs.length){
      const iv=setInterval(()=>setScoringProgress(p=>Math.min(p+8,90)),400);
      try{
        const resp=await api.scoreBatch(uploadFileObjs,jobIdForScoring,`Batch ${uploadFileObjs.length} resumes`);
        clearInterval(iv);setScoringProgress(100);
        const mapped=(resp.results||[]).map(scoreResultToCandidate).sort((a,b)=>b.score-a.score);
        setCandidates(mapped);
        setTimeout(()=>setStep("results"),400);
        return;
      }catch(e){
        clearInterval(iv);
        fallbackToDemo(e);
        // fall through to mock simulation below
      }
    }
    // Demo path: simulated progress + mock candidates.
    let i=0;const iv=setInterval(()=>{i++;setScoringProgress(Math.min(i*18,100));if(i>=6){clearInterval(iv);setCandidates(MOCK_CANDIDATES.sort((a,b)=>b.score-a.score));setTimeout(()=>setStep("results"),400);}},500);
  },[demoMode,jobIdForScoring,uploadFileObjs,fallbackToDemo]);

  // ── Craft handlers ────────────────────────────────────────────
  const craftSettings=()=>craftSettingsFrom(letterhead,maskPI);

  const craftOne=useCallback(async(cand)=>{
    // Live: call API if we have a real score id; else just mark crafted (demo).
    if(!demoMode&&cand.scoreId){
      setBusy(`Crafting ${cand.name}…`);
      try{
        const res=await api.craftSingle(cand.scoreId,craftSettings());
        const merged=applyCraftResult(cand,res);
        setCraftQueue(p=>p.map(x=>x.id===cand.id?merged:x));
        setBusy("");
        return;
      }catch(e){fallbackToDemo(e);setBusy("");}
    }
    setCraftQueue(p=>p.map(x=>x.id===cand.id?{...x,crafted:true}:x));
  },[demoMode,letterhead,maskPI,fallbackToDemo]);

  const craftAll=useCallback(async()=>{
    const ids=craftQueue.filter(c=>c.scoreId&&!c.crafted).map(c=>c.scoreId);
    if(!demoMode&&ids.length){
      setBusy(`Crafting ${ids.length} resumes…`);
      try{
        const resp=await api.craftBatch(ids,craftSettings());
        const byScore=new Map((resp.results||[]).map(r=>[r.score_id,r]));
        setCraftQueue(p=>p.map(c=>byScore.has(c.scoreId)?applyCraftResult(c,byScore.get(c.scoreId)):c));
        setBusy("");
        return;
      }catch(e){fallbackToDemo(e);setBusy("");}
    }
    setCraftQueue(p=>p.map(c=>({...c,crafted:true})));
  },[craftQueue,demoMode,letterhead,maskPI,fallbackToDemo]);

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
      "Combined: Resume + Scorecard":{PDF:"combined-pdf"},
    };
    const endpoint=kindMap[kind]?.[format];
    if(!demoMode&&cand.craftId&&endpoint){
      try{
        await api.downloadCraft(cand.craftId,endpoint,`${cand.name}_${endpoint}.${format.toLowerCase()}`);
        return;
      }catch(e){fallbackToDemo(e);}
    }
    alert(`Demo mode — downloads need a live backend.\n\nWould download: ${kind} (${format})\nPI masked: ${maskPI} · Logo: ${logoUrl?"Yes":"No"}\n\nAdd credentials to backend/.env and craft a resume to enable real downloads.`);
  },[demoMode,maskPI,logoUrl,fallbackToDemo]);

  const filtered=candidates.filter(c=>c.score>=scoreRange[0]&&c.score<=scoreRange[1]);
  const toggleSelect=id=>{setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});};
  const selectAll=()=>{const ids=new Set(filtered.map(c=>c.id));setSelected(filtered.every(c=>selected.has(c.id))?new Set():ids);};

  const handleLogo=(e)=>{
    const file=e.target.files?.[0];
    if(file){const reader=new FileReader();reader.onload=ev=>setLogoUrl(ev.target.result);reader.readAsDataURL(file);}
  };

  const steps=[{key:"job",label:"Select job"},{key:"upload",label:"Upload resumes"},{key:"scoring",label:"Scoring"},{key:"results",label:"Review & filter"},{key:"craft",label:"Craft resumes"}];
  const ci=steps.findIndex(s=>s.key===step);

  // ─── Job ───────────────────────────────────────────────────────
  const renderJob=()=>(
    <div style={S.container}><div style={S.card}>
      <div style={S.h2}>Select or create a job</div>
      <p style={{...S.sub,marginBottom:14}}>Configure the role and required skills</p>
      {jobs.length>0&&(
        <div style={{marginBottom:14}}>
          <div style={S.label}>Live jobs (from backend)</div>
          <select style={{...S.input,maxWidth:360}} value={activeJob?.id||""}
            onChange={e=>selectJob(jobs.find(j=>j.id===e.target.value)||null)}>
            {jobs.map(j=><option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
          {!demoMode&&candidates.length>0&&(
            <div style={{marginTop:10,display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:12,color:"#6B7280"}}>{candidates.length} previously scored candidate{candidates.length>1?"s":""} for this job.</span>
              <button style={{...S.btnO,padding:"5px 12px",fontSize:12}} onClick={()=>setStep("results")}>Review results →</button>
            </div>
          )}
        </div>
      )}
      <div style={{background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:10,padding:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
          <div><div style={{fontSize:15,fontWeight:700,color:NAVY}}>{jobTitle}</div><div style={S.sub}>Weights: Tech {MOCK_JOB.weights.technical}% · Exp {MOCK_JOB.weights.experience}% · Edu {MOCK_JOB.weights.education}% · Stability {MOCK_JOB.weights.stability}%</div></div>
          <span style={S.chip("#EEF2FF",INDIGO)}>Active</span>
        </div>
        <div style={S.label}>Must have</div><div style={{marginBottom:8}}>{MOCK_JOB.mustHave.map(s=><span key={s} style={S.chip("#FEE2E2","#991B1B")}>{s}</span>)}</div>
        <div style={S.label}>Good to have</div><div style={{marginBottom:8}}>{MOCK_JOB.goodToHave.map(s=><span key={s} style={S.chip("#FEF3C7","#92400E")}>{s}</span>)}</div>
        <div style={S.label}>Bonus</div><div>{MOCK_JOB.bonus.map(s=><span key={s} style={S.chip("#EEF2FF","#4338CA")}>{s}</span>)}</div>
      </div>
      <div style={{marginTop:14,display:"flex",gap:10}}><button style={S.btn} onClick={()=>setStep("upload")}>Use this job →</button><button style={S.btnO} onClick={async()=>{
        if(demoMode){alert("Creating jobs needs a live backend.\nAdd credentials to backend/.env (and a Supabase auth token) to create real jobs.");return;}
        const title=prompt("New job title:");
        if(!title)return;
        try{const job=await api.createJob({title});setJobs(p=>[job,...p]);setActiveJob(job);}
        catch(e){fallbackToDemo(e);alert("Could not create job: "+(e?.message||e));}
      }}>+ Create new job</button></div>
    </div></div>
  );

  // ─── Upload ────────────────────────────────────────────────────
  const renderUpload=()=>(
    <div style={S.container}><div style={S.card}>
      <div style={S.h2}>Upload resumes</div>
      <p style={{...S.sub,marginBottom:12}}>Score against: <strong>{jobTitle}</strong></p>
      <input ref={resumeRef} type="file" accept=".pdf,.docx,.doc" multiple style={{display:"none"}} onChange={handleResumeFiles}/>
      <div style={{border:"2px dashed #D1D5DB",borderRadius:10,padding:"32px 16px",textAlign:"center",background:uploadFiles.length?"#EEF2FF":"#F9FAFB",cursor:"pointer",marginBottom:12}}
        onClick={()=>resumeRef.current?.click()}>
        {uploadFiles.length===0?(<><div style={{fontSize:28,marginBottom:4}}>📄</div><div style={{fontSize:14,fontWeight:600,color:"#374151"}}>Drop resumes here or click to browse</div><div style={S.sub}>PDF or DOCX · Up to 20 files</div></>):(<><div style={{fontSize:14,fontWeight:600,color:INDIGO}}>{uploadFiles.length} files ready</div></>)}
      </div>
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
  const renderResults=()=>(
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
                <span title="Recommended: PNG or SVG, 300×80px minimum, 3:1 to 5:1 width-to-height ratio, transparent background, max 2MB"
                  style={{width:16,height:16,borderRadius:8,background:"#E5E7EB",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#6B7280",cursor:"help"}}>i</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div onClick={()=>logoRef.current?.click()}
                  style={{width:160,height:48,border:"2px dashed #D1D5DB",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",background:logoUrl?"#fff":"#F9FAFB",overflow:"hidden"}}>
                  {logoUrl?<img src={logoUrl} alt="Logo" style={{maxHeight:40,maxWidth:150,objectFit:"contain"}}/>:<span style={{fontSize:11,color:"#9CA3AF"}}>Click to upload</span>}
                </div>
                <input ref={logoRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleLogo}/>
                <div style={{fontSize:10,color:"#9CA3AF",lineHeight:1.5}}>
                  <div>PNG or SVG recommended</div>
                  <div>300×80px min · 3:1 to 5:1 ratio</div>
                  <div>Transparent background · Max 2MB</div>
                </div>
                {logoUrl&&<button style={{fontSize:11,color:"#DC2626",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}} onClick={()=>setLogoUrl(null)}>Remove</button>}
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
        <CandidateRow key={c.id} c={c} job={MOCK_JOB} cutoff={cutoff} selected={selected.has(c.id)} masked={maskPI} logoUrl={logoUrl}
          onToggle={()=>toggleSelect(c.id)} onCraft={()=>{setCraftQueue([c]);setStep("craft");}} onViewScorecard={()=>setViewScorecard(c)} onDownload={()=>setDownloadModal(c)}/>
      ))}
    </div>
  );

  // ─── Craft ─────────────────────────────────────────────────────
  const renderCraft=()=>(
    <div style={S.container}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
        <div><div style={S.h2}>Craft resumes ({craftQueue.length})</div><p style={S.sub}>Format, edit, and download</p></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>{busy&&<span style={{fontSize:11,color:INDIGO}}>{busy}</span>}<button style={S.btn} onClick={craftAll}>Batch craft all</button><button style={S.btnO} onClick={()=>setStep("results")}>← Back</button></div>
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
              </>):(<button style={S.btn} onClick={()=>craftOne(c)}>Craft resume</button>)}
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
                </div>
              ))}

              <div style={{...S.label,marginTop:14}}>Employment & projects</div>
              {c.employment?.map((emp,i)=>(
                <div key={i} style={{background:"#F9FAFB",borderRadius:8,padding:10,marginBottom:8,border:"1px solid #E5E7EB"}}>
                  <div style={{display:"flex",gap:6,marginBottom:6}}>
                    <input style={{...S.input,fontWeight:600}} value={emp.company} onChange={e=>u(n=>{n.employment[i].company=e.target.value})}/>
                    <input style={S.input} value={emp.role} onChange={e=>u(n=>{n.employment[i].role=e.target.value})}/>
                  </div>
                  {emp.projects?.map((proj,j)=>(
                    <div key={j} style={{marginLeft:8,paddingLeft:8,borderLeft:`2px solid ${GOLD}50`,marginBottom:6}}>
                      <input style={{...S.input,fontSize:12,fontWeight:600,marginBottom:4}} value={proj.name} onChange={e=>u(n=>{n.employment[i].projects[j].name=e.target.value})}/>
                      {proj.responsibilities?.map((r,k)=>(
                        <div key={k} style={{display:"flex",gap:4,marginBottom:3}}>
                          <span style={{color:"#D1D5DB",marginTop:7}}>•</span>
                          <input style={{...S.input,fontSize:11}} value={r} onChange={e=>u(n=>{n.employment[i].projects[j].responsibilities[k]=e.target.value})}/>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}

              <div style={{...S.label,marginTop:14}}>Certifications</div>
              {c.certifications?.map((cert,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:6,marginBottom:4}}>
                  <input style={S.input} value={cert.name} onChange={e=>u(n=>{n.certifications[i].name=e.target.value})}/>
                  <input style={S.input} value={cert.issuer} onChange={e=>u(n=>{n.certifications[i].issuer=e.target.value})}/>
                  <input style={S.input} placeholder="Expiry date" value={cert.expiry||""} onChange={e=>u(n=>{n.certifications[i].expiry=e.target.value})}/>
                </div>
              ))}
            </div>

            {/* Live preview */}
            <div style={{padding:18,overflowY:"auto",background:"#F3F4F6",maxHeight:"70vh"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#6B7280",marginBottom:8}}>Live preview</div>
              <ResumePreview c={c} masked={maskPI} letterhead={letterhead} logoUrl={logoUrl}/>
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
          <div style={{padding:20,overflowY:"auto",flex:1,maxHeight:"78vh"}}><Scorecard c={viewScorecard} job={MOCK_JOB} logoUrl={logoUrl}/></div>
        </div>
      </div>
    );
  };

  // ─── Download Modal ────────────────────────────────────────────
  const renderDownloadModal=()=>{
    if(!downloadModal)return null;
    const c=downloadModal;
    return(
      <div style={S.modal} onClick={()=>setDownloadModal(null)}>
        <div style={{...S.modalBox,maxWidth:460}} onClick={e=>e.stopPropagation()}>
          <div style={{padding:"14px 20px",borderBottom:"1px solid #E5E7EB"}}>
            <div style={{fontSize:15,fontWeight:700,color:NAVY}}>Download: {c.name}</div>
            <div style={{fontSize:11,color:"#9CA3AF"}}>{maskPI?"PI will be masked in output":"PI included in output"}</div>
          </div>
          <div style={{padding:18}}>
            {[
              {icon:"📄",label:"Resume only",sub:"Formatted resume"+(maskPI?" (PI masked)":""),formats:["PDF","DOCX"]},
              {icon:"📊",label:"Scorecard only",sub:"Full ScorQ scorecard with AI reasoning",formats:["PDF"]},
              {icon:"📦",label:"Combined: Resume + Scorecard",sub:"Crafted resume followed by full scorecard as last page",formats:["PDF"]},
            ].map(opt=>(
              <div key={opt.label} style={{background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:8,padding:12,marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:16}}>{opt.icon}</span>
                  <div><div style={{fontSize:13,fontWeight:600,color:"#1F2937"}}>{opt.label}</div><div style={{fontSize:11,color:"#6B7280"}}>{opt.sub}</div></div>
                </div>
                <div style={{display:"flex",gap:6,marginLeft:24}}>
                  {opt.formats.map(f=>(
                    <button key={f} style={{padding:"5px 14px",background:f==="PDF"?"#DC2626":"#2563EB",color:"#fff",border:"none",borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer"}}
                      onClick={()=>doDownload(c,opt.label,f)}>{f}</button>
                  ))}
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
          <span style={{fontSize:19,fontWeight:800,color:"#fff"}}>Scor</span><span style={{fontSize:19,fontWeight:800,color:GOLD}}>Craft</span>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.4)",marginLeft:8}}>by HYROI Solutions</span>
        </div>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.35)"}}>Powered by OpenAI GPT-4o</div>
      </header>
      <div style={S.stepBar}>{steps.map((s,i)=><div key={s.key} style={S.stepItem(step===s.key,i<ci)} onClick={()=>i<ci?setStep(s.key):null}>{i<ci?"✓ ":""}{s.label}</div>)}</div>
      {demoMode&&(
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CANDIDATE ROW
// ═══════════════════════════════════════════════════════════════════
function CandidateRow({c,job,cutoff,selected,masked,logoUrl,onToggle,onCraft,onViewScorecard,onDownload}){
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
            <button style={S.btnO} onClick={e=>{e.stopPropagation();onDownload();}}>Download</button>
          </div>
        </div>
      )}
    </div>
  );
}
