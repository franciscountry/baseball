import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";

// ── FIREBASE SETUP ─────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDwY7wA7TEhgJPgHrpdMF2qlKlOvIcl91g",
  authDomain: "pitchscout-d0e4f.firebaseapp.com",
  projectId: "pitchscout-d0e4f",
  storageBucket: "pitchscout-d0e4f.firebasestorage.app",
  messagingSenderId: "1096668739807",
  appId: "1:1096668739807:web:1c5f9b28ac6fa94f7f116a",
};
const fbApp = initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);

function genCode() {
  return Math.random().toString(36).substring(2,8).toUpperCase();
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const PITCH_TYPES  = ["FB","CB","SL","CH"];
const PITCH_LABELS = { FB:"Fastball", CB:"Curveball", SL:"Slider", CH:"Changeup" };
const PITCH_COLORS = { FB:"#22c55e",  CB:"#3b82f6",   SL:"#f59e0b", CH:"#ef4444" };

const COUNTS = ["0-0","0-1","0-2","1-0","1-1","1-2","2-0","2-1","2-2","3-0","3-1","3-2"];

const COUNT_SHORT = {
  "0-0":"1st","0-1":"0-1","0-2":"2K",
  "1-0":"H",  "1-1":"EVN","1-2":"2K",
  "2-0":"H",  "2-1":"2-1","2-2":"2K",
  "3-0":"TK", "3-1":"H",  "3-2":"FL",
};
const COUNT_FULL = {
  "0-0":"First Pitch","0-1":"0-1",     "0-2":"2-Strike",
  "1-0":"Hitter's",  "1-1":"Even",    "1-2":"2-Strike",
  "2-0":"Hitter's",  "2-1":"2-1",     "2-2":"2-Strike",
  "3-0":"Take Pitch","3-1":"Hitter's","3-2":"Full Count",
};

const RESULTS = ["Called Strike","Swinging Strike","Foul","Ball","In Play"];
const IN_PLAY_RESULTS = [
  "Fly Out","Line Out","Ground Out","Double Play",
  "Single","Double","Triple",
  "Sac Bunt","Sac Fly","Fielder's Choice","Reach on Error",
];
// For count advancement, map result to category
function resultCategory(result) {
  if(result==="Called Strike"||result==="Swinging Strike") return "Strike";
  if(result==="Called Strikeout"||result==="Swinging Strikeout") return "Strikeout";
  if(result==="Ball")  return "Ball";
  if(result==="Walk")  return "Walk";
  if(result==="Foul")  return "Foul";
  if(result==="In Play"||IN_PLAY_RESULTS.includes(result)) return "In Play";
  return result;
}
// For reporting, group display
const RESULT_GROUPS = {
  "Called Strike":"Strike","Swinging Strike":"Strike",
  "Foul":"Foul","Ball":"Ball",
};
IN_PLAY_RESULTS.forEach(r=>{ RESULT_GROUPS[r]="In Play"; });

const ZONES = [
  {id:1},{id:2},{id:3},
  {id:4},{id:5},{id:6},
  {id:7},{id:8},{id:9},
];
const ZONE_LABELS = {
  1:"In-Hi",2:"Mid-Hi",3:"Out-Hi",
  4:"In-Mid",5:"Heart", 6:"Out-Mid",
  7:"In-Lo", 8:"Mid-Lo",9:"Out-Lo",
};

const GAME_TYPES = { LIVE:"live", SCOUT:"scout" };

// ── COUNT LOGIC ───────────────────────────────────────────────────────────────
function advanceCount(count, result) {
  const [b,s] = count.split("-").map(Number);
  const cat = resultCategory(result);
  if (cat==="Ball")    { if(b>=3) return {next:"0-0",atBatOver:true,reason:"Walk"};      return {next:`${b+1}-${s}`,atBatOver:false}; }
  if (cat==="Strike")  { if(s>=2) return {next:"0-0",atBatOver:true,reason:"Strikeout"}; return {next:`${b}-${s+1}`,atBatOver:false}; }
  if (cat==="Foul")    { if(s>=2) return {next:count,atBatOver:false};                   return {next:`${b}-${s+1}`,atBatOver:false}; }
  if (cat==="In Play")             return {next:"0-0",atBatOver:true,reason:result};
  return {next:count,atBatOver:false};
}

// ── PERSISTENCE (localStorage as local cache) ────────────────────────────────
function load(key,fb){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):fb; }catch{return fb;} }
function save(key,v) { try{ localStorage.setItem(key,JSON.stringify(v)); }catch{} }
// Write all shared state to Firestore under the team's doc
async function pushToFirestore(teamCode, data) {
  if(!teamCode) return;
  try { await setDoc(doc(db,"teams",teamCode), data, {merge:true}); } catch(e){ console.error("Firestore write:",e); }
}

// ── DATA HELPERS ──────────────────────────────────────────────────────────────
function calcOverall(pitches) {
  const t={total:0}; PITCH_TYPES.forEach(p=>(t[p]=0));
  pitches.forEach(({pitch})=>{ t[pitch]=(t[pitch]||0)+1; t.total++; });
  return t;
}
function calcByCount(pitches) {
  const map={}; COUNTS.forEach(c=>{ map[c]={total:0}; PITCH_TYPES.forEach(p=>(map[c][p]=0)); });
  pitches.forEach(({count,pitch})=>{ if(map[count]){map[count][pitch]=(map[count][pitch]||0)+1; map[count].total++;} });
  return map;
}
function pct(n,total){ return total>0?Math.round((n/total)*100):0; }

// Returns { FB:{Strike,Ball,Foul,"In Play",total}, CB:{...}, ... }
// Buckets granular results into 4 categories for display
function calcResultsByPitch(pitches) {
  const map={};
  PITCH_TYPES.forEach(p=>{ map[p]={total:0,Strike:0,Strikeout:0,Ball:0,Walk:0,Foul:0,"In Play":0}; });
  pitches.forEach(({pitch,result})=>{
    if(map[pitch]&&result){
      const cat=resultCategory(result);
      map[pitch][cat]=(map[pitch][cat]||0)+1;
      map[pitch].total++;
    }
  });
  return map;
}

// ── THEME ─────────────────────────────────────────────────────────────────────
import { createContext, useContext } from "react";
const ThemeCtx = createContext(null);
const useTheme = () => useContext(ThemeCtx);

const DARK = {
  bg:"#0d1117", card:"#161b27", card2:"#1a1f2e", border:"#2d3748",
  text:"#e2e8f0", muted:"#718096", dim:"#4a5568",
  blue:"#3b82f6", blueDim:"#1e3a5f", green:"#16a34a", amber:"#f59e0b",
  headerBg:"linear-gradient(135deg,#1a1f2e 0%,#0d1117 100%)", headerBorder:"#1e3a5f",
  isDark:true,
};
const LIGHT = {
  bg:"#f1f5f9", card:"#ffffff", card2:"#f8fafc", border:"#e2e8f0",
  text:"#1e293b", muted:"#64748b", dim:"#94a3b8",
  blue:"#2563eb", blueDim:"#dbeafe", green:"#16a34a", amber:"#d97706",
  headerBg:"linear-gradient(135deg,#1e3a5f 0%,#1e40af 100%)", headerBorder:"#3b82f6",
  isDark:false,
};

// Static style helpers that don't need theme (used before ThemeCtx available)
const logBtn= (bg) => ({width:"100%", padding:"14px", background:bg, border:"none", borderRadius:8, color:"#fff", fontFamily:"'Oswald',sans-serif", fontSize:15, letterSpacing:2, textTransform:"uppercase", cursor:"pointer", transition:"background 0.2s", marginTop:4});
const badge = (color) => ({display:"inline-block", padding:"2px 7px", borderRadius:4, background:color+"22", color, fontSize:11, fontWeight:700, fontFamily:"'Oswald',sans-serif", letterSpacing:1});

// Theme-aware style helpers — call inside components after useTheme()
function mkStyles(C) {
  return {
    card:  {background:C.card,  border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px", marginBottom:10},
    lbl:   {fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:6, display:"block"},
    inp:   {width:"100%", background:C.card2, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, padding:"10px 12px", fontSize:14, fontFamily:"'Inter',sans-serif", boxSizing:"border-box", outline:"none"},
    pill:  (color,active) => ({padding:"8px 10px", borderRadius:6, border:active?`1px solid ${color}`:`1px solid ${C.border}`, background:active?color+"22":C.card2, color:active?color:C.muted, fontFamily:"'Oswald',sans-serif", fontSize:13, letterSpacing:1, cursor:"pointer", transition:"all 0.15s", fontWeight:active?700:400}),
    cBtn:  (active) => ({padding:"10px 4px", background:active?(C.isDark?"#1e40af":C.blueDim):C.card2, border:active?`1px solid ${C.blue}`:`1px solid ${C.border}`, borderRadius:6, color:active?(C.isDark?"#93c5fd":C.blue):C.muted, fontFamily:"'Oswald',sans-serif", fontSize:15, letterSpacing:1, cursor:"pointer", transition:"all 0.15s", fontWeight:active?700:400}),
  };
}

// Temporary module-level C for components that haven't been migrated (will pick up theme via context)
let C = DARK;

// ── PITCH BAR ─────────────────────────────────────────────────────────────────
function PitchBar({pitchCounts,total,height=20}) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  if (!total) return <div style={{color:C.dim,fontSize:10,fontStyle:"italic"}}>—</div>;
  return (
    <div style={{display:"flex",height,borderRadius:3,overflow:"hidden",gap:1}}>
      {PITCH_TYPES.map(p=>{
        const pp=(pitchCounts[p]||0)/total; if(!pp) return null;
        return <div key={p} style={{width:`${pp*100}%`,background:PITCH_COLORS[p],display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:"#fff",overflow:"hidden",transition:"width 0.3s"}}>{pp>0.12?`${Math.round(pp*100)}`:""}</div>;
      })}
    </div>
  );
}

// ── DUAL PERCENT (log screen: overall + current count) ────────────────────────
function DualPercent({overall,countData,currentCount}) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
      {PITCH_TYPES.map(p=>{
        const ov=pct(overall[p]||0,overall.total);
        const ct=countData?.total>0?pct(countData[p]||0,countData.total):null;
        return (
          <div key={p} style={{background:PITCH_COLORS[p]+"15",border:`1px solid ${PITCH_COLORS[p]}44`,borderRadius:7,padding:"7px 4px",textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,color:PITCH_COLORS[p],lineHeight:1}}>{ov}%</div>
            <div style={{fontSize:8,color:C.muted,margin:"2px 0 5px"}}>{p} OV</div>
            <div style={{height:1,background:PITCH_COLORS[p]+"33",marginBottom:5}}/>
            {ct!==null
              ? <><div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,color:PITCH_COLORS[p],lineHeight:1}}>{ct}%</div><div style={{fontSize:8,color:C.dim,marginTop:2}}>{currentCount}</div></>
              : <div style={{fontSize:8,color:C.dim,marginTop:2}}>no data</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── ZONE PICKER ───────────────────────────────────────────────────────────────
function ZonePicker({value,onChange}) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,width:150,margin:"0 auto"}}>
        {ZONES.map(z=>(
          <button key={z.id} onClick={()=>onChange(value===z.id?null:z.id)}
            style={{padding:"10px 4px",background:value===z.id?"#1e40af":C.card2,border:value===z.id?`1px solid ${C.blue}`:`1px solid ${C.border}`,borderRadius:5,color:value===z.id?"#93c5fd":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:11,cursor:"pointer",textAlign:"center"}}>
            {z.id}
          </button>
        ))}
      </div>
      <div style={{textAlign:"center",fontSize:10,color:value?C.muted:C.dim,marginTop:4}}>
        {value?`Zone ${value} · ${ZONE_LABELS[value]}`:"Tap zone to select (optional)"}
      </div>
    </div>
  );
}

// ── MIX BOXES (reusable overall pitch % grid) ─────────────────────────────────
function MixBoxes({overall,size=20}) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
      {PITCH_TYPES.map(p=>{
        const pp=pct(overall[p]||0,overall.total);
        return (
          <div key={p} style={{background:PITCH_COLORS[p]+"18",border:`1px solid ${PITCH_COLORS[p]}44`,borderRadius:7,padding:"7px 4px",textAlign:"center"}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:size,color:PITCH_COLORS[p],lineHeight:1}}>{pp}%</div>
            <div style={{fontSize:9,color:C.muted,marginTop:2}}>{p}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── PITCH RESULT BREAKDOWN ───────────────────────────────────────────────────
// Shows for each pitch type: usage %, then strike/ball/foul/in-play breakdown
const RESULT_COLORS = {
  "Called Strike":"#ef4444","Swinging Strike":"#ef4444",
  "Ball":"#22c55e","Foul":"#eab308","In Play":"#3b82f6",
  ...Object.fromEntries(IN_PLAY_RESULTS.map(r=>[r,"#3b82f6"])),
};
// Category colors for bar charts
const RESULT_CAT_COLORS = { Strike:"#ef4444", Ball:"#22c55e", Foul:"#eab308", "In Play":"#3b82f6" };

function PitchResultBreakdown({pitches, label, labelColor}) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  const overall = calcOverall(pitches);
  const byResult = calcResultsByPitch(pitches);
  if(!overall.total) return null;

  return (
    <div>
      {label&&<div style={{fontSize:10,color:labelColor||C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{label}</div>}
      {PITCH_TYPES.filter(p=>(overall[p]||0)>0).map(p=>{
        const usagePct = pct(overall[p]||0, overall.total);
        const rd = byResult[p];
        return (
          <div key={p} style={{marginBottom:10}}>
            {/* Pitch label + usage */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}>
              <span style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:PITCH_COLORS[p],fontWeight:700}}>
                {PITCH_LABELS[p]}
              </span>
              <span style={{fontSize:11,color:C.muted}}>{usagePct}% of pitches · {rd.total} thrown</span>
            </div>
            {/* Result bar */}
            {rd.total>0&&(
              <>
                <div style={{display:"flex",height:16,borderRadius:3,overflow:"hidden",gap:1,marginBottom:4}}>
                  {["Strike","Ball","Foul","In Play"].map(r=>{
                    const rp=(rd[r]||0)/rd.total; if(!rp) return null;
                    return <div key={r} style={{width:`${rp*100}%`,background:RESULT_CAT_COLORS[r],display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:"#fff",overflow:"hidden"}}>{rp>0.12?`${Math.round(rp*100)}`:""}</div>;
                  })}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Strike","Ball","Foul","In Play"].filter(r=>(rd[r]||0)>0).map(r=>(
                    <span key={r} style={{fontSize:10,color:RESULT_CAT_COLORS[r],fontWeight:600}}>
                      {r} {pct(rd[r]||0,rd.total)}%
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── ROSTER PANEL ─────────────────────────────────────────────────────────────
function RosterPanel({ team, onSaveTeams, teams }) {
  const C = useTheme();
  const {card,lbl,inp} = mkStyles(C);
  const roster = team.roster || [];
  const [num,   setNum]   = useState("");
  const [first, setFirst] = useState("");
  const [last,  setLast]  = useState("");

  const handleAdd = () => {
    const lastName=last.trim(), firstName=first.trim();
    if(!lastName) return;
    const player={id:Date.now(), number:num.trim(), firstName, lastName,
      // also store as name for backward compat with pitcher refs
      name:lastName+(firstName?`, ${firstName}`:""),
      teamId:team.id, teamName:team.name,
    };
    const updated=teams.map(t=>t.id===team.id?{...t,
      roster:[...(t.roster||[]),player],
      // keep pitchers array in sync — roster players ARE the pitchers
      pitchers:[...(t.pitchers||[]),player],
    }:t);
    onSaveTeams(updated);
    setNum(""); setFirst(""); setLast("");
  };

  const handleDelete = (pid) => {
    const updated=teams.map(t=>t.id===team.id?{...t,
      roster:(t.roster||[]).filter(p=>p.id!==pid),
      pitchers:(t.pitchers||[]).filter(p=>p.id!==pid),
    }:t);
    onSaveTeams(updated);
  };

  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        <input style={{...inp,marginBottom:0,width:48,flex:"0 0 48px",textAlign:"center",padding:"8px 4px"}}
          placeholder="#" value={num} onChange={e=>setNum(e.target.value)}/>
        <input style={{...inp,marginBottom:0,flex:1}} placeholder="Last Name" value={last}
          onChange={e=>setLast(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()}/>
        <input style={{...inp,marginBottom:0,flex:1}} placeholder="First Name" value={first}
          onChange={e=>setFirst(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()}/>
        <button onClick={handleAdd} disabled={!last.trim()}
          style={{padding:"10px 12px",background:last.trim()?C.green:C.card2,border:"none",borderRadius:6,color:last.trim()?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:12,cursor:last.trim()?"pointer":"default",whiteSpace:"nowrap"}}>
          + Add
        </button>
      </div>
      {roster.length===0&&<div style={{fontSize:12,color:C.dim,textAlign:"center",padding:"8px 0"}}>No players yet.</div>}
      {[...roster].sort((a,b)=>a.lastName.localeCompare(b.lastName)).map(p=>(
        <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:7,background:C.card2,border:`1px solid ${C.border}`,marginBottom:5}}>
          {p.number&&<span style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:C.dim,minWidth:24}}>#{p.number}</span>}
          <span style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:C.text,flex:1}}>
            {p.lastName}{p.firstName?`, ${p.firstName}`:""}
          </span>
          <button onClick={()=>handleDelete(p.id)}
            style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:16,padding:"0 4px",lineHeight:1}}>×</button>
        </div>
      ))}
    </div>
  );
}

// ── OPPONENT LINEUP PANEL ────────────────────────────────────────────────────
function OpponentLineupPanel({ team, onSaveTeams, teams }) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  const saved = team.lineup || [];
  const [slots, setSlots] = useState(()=>{
    // 9 slots: {number, name}
    if(saved.length) return saved.map(p=>({number:p.number||"",name:p.name||""}));
    return Array(9).fill(0).map((_,i)=>({number:"",name:""}));
  });
  const [saved2, setSaved2] = useState(false);

  const handleSave = () => {
    const lineup = slots.map((s,i)=>({
      order:i+1,
      number:s.number.trim(),
      name:s.name.trim()||`Batter ${i+1}`,
    }));
    const updated = teams.map(t=>t.id===team.id?{...t,lineup}:t);
    onSaveTeams(updated);
    setSaved2(true); setTimeout(()=>setSaved2(false),1500);
  };

  return (
    <div>
      <div style={{fontSize:11,color:C.muted,marginBottom:10}}>
        Enter their batting order. Number is optional — use placeholders if unknown.
      </div>
      {slots.map((slot,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:C.dim,minWidth:18,textAlign:"right"}}>{i+1}</div>
          <input style={{...inp,marginBottom:0,width:48,flex:"0 0 48px",textAlign:"center",padding:"8px 4px"}}
            placeholder="#" value={slot.number}
            onChange={e=>{const n=[...slots];n[i]={...n[i],number:e.target.value};setSlots(n);}}/>
          <input style={{...inp,marginBottom:0,flex:1}}
            placeholder={`Batter ${i+1}`} value={slot.name}
            onChange={e=>{const n=[...slots];n[i]={...n[i],name:e.target.value};setSlots(n);}}/>
        </div>
      ))}
      <button onClick={handleSave}
        style={{width:"100%",padding:"10px",background:saved2?C.green:C.blue,border:"none",borderRadius:7,color:"#fff",fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:"pointer",marginTop:8,transition:"background 0.2s"}}>
        {saved2?"✓ Saved!":"Save Their Lineup"}
      </button>
      {saved.length>0&&(
        <div style={{marginTop:10,fontSize:11,color:C.dim,textAlign:"center"}}>
          Last saved: {saved.filter(p=>p.name&&!p.name.startsWith("Batter")).length} named · {saved.length} slots
        </div>
      )}
    </div>
  );
}

// ── SETUP GAME PANEL ─────────────────────────────────────────────────────────
function SetupGamePanel({ teams, games, onAddGame, onDeleteGame, activeGameId, onSetActiveGame, selectedPitcherId, onSelectPitcher, onGameStart }) {
  const C = useTheme();
  const {card,lbl,inp} = mkStyles(C);
  const activeGame = games.find(g=>g.id===activeGameId);
  const [confirmEnd,    setConfirmEnd]    = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // game id pending delete

  const [gameDate,   setGameDate]   = useState(()=>new Date().toISOString().slice(0,10));
  const [gameType,   setGameType]   = useState(GAME_TYPES.LIVE);
  // Live: opponent team selector; Scout: separate pitch + off team selectors
  const [liveOppTeam,  setLiveOppTeam]  = useState(""); // team id of opponent (live)
  const [pitchTeam,    setPitchTeam]    = useState(""); // team id of pitching team (scout)
  const [offTeam,      setOffTeam]      = useState(""); // team id of offensive team (scout)

  const allPitchers = teams.flatMap(t=>t.pitchers.map(p=>({...p,teamName:t.name})));
  const activePitcher = allPitchers.find(p=>p.id===selectedPitcherId);

  // Pitchers to show: for live, filter to selected opponent team; for scout, filter to pitchTeam
  const filteredTeamId = gameType===GAME_TYPES.LIVE ? liveOppTeam : pitchTeam;
  const visibleTeams = filteredTeamId
    ? teams.filter(t=>String(t.id)===filteredTeamId)
    : [];

  // When opponent team changes, clear pitcher selection
  const handleLiveOppTeamChange = (tid) => {
    setLiveOppTeam(tid);
    onSelectPitcher(null);
  };
  const handlePitchTeamChange = (tid) => {
    setPitchTeam(tid);
    onSelectPitcher(null);
  };

  // Clear pitcher when game ends
  const handleEndGame = () => {
    onSetActiveGame(null);
    onSelectPitcher(null);
    setConfirmEnd(false);
  };

  const handleCreate = () => {
    if(!selectedPitcherId) return;
    const liveTeam=teams.find(t=>String(t.id)===liveOppTeam);
    const pTeam=teams.find(t=>String(t.id)===pitchTeam);
    const oTeam=teams.find(t=>String(t.id)===offTeam);
    const opponent=gameType===GAME_TYPES.LIVE?(liveTeam?.name||"Opponent")
                  :(pTeam&&oTeam?`${pTeam.name} vs ${oTeam.name}`:"Scout Game");
    const g={
      id:Date.now(), opponent, date:gameDate, type:gameType,
      pitchTeamId: gameType===GAME_TYPES.SCOUT?(pitchTeam||null)
                 : gameType===GAME_TYPES.LIVE?(liveOppTeam||null):null,
      offTeamId:   gameType===GAME_TYPES.SCOUT?(offTeam||null):null,
    };
    onAddGame(g);
    onSetActiveGame(g.id);
    setLiveOppTeam(""); setPitchTeam(""); setOffTeam("");
    setGameType(GAME_TYPES.LIVE);
    onGameStart(); // navigate to log + reset batter/count
  };

  const gameLabel = (g) => {
    if(!g) return "";
    if(g.type===GAME_TYPES.SCOUT){
      const pt=teams.find(t=>String(t.id)===String(g.pitchTeamId));
      const ot=teams.find(t=>String(t.id)===String(g.offTeamId));
      return `🔭 ${g.date} · ${pt?.name||g.opponent} vs ${ot?.name||"?"}`;
    }
    const ot=teams.find(t=>String(t.id)===String(g.pitchTeamId));
    return `🏟 ${g.date} vs ${ot?.name||g.opponent}`;
  };

  const canStart = selectedPitcherId && (gameType===GAME_TYPES.LIVE?liveOppTeam:pitchTeam&&offTeam);

  return (
    <div>
      {/* Active game card */}
      {activeGame ? (
        <div style={{...card,borderColor:C.green,marginBottom:16}}>
          <div style={{fontSize:10,color:C.green,textTransform:"uppercase",letterSpacing:1,marginBottom:6,fontFamily:"'Oswald',sans-serif"}}>Active Game</div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:C.text,marginBottom:4}}>{gameLabel(activeGame)}</div>
          {activePitcher&&<div style={{fontSize:12,color:C.muted,marginBottom:10}}>Pitcher: {activePitcher.number?`#${activePitcher.number} `:""}{activePitcher.lastName||activePitcher.name}{activePitcher.firstName?`, ${activePitcher.firstName}`:""} · {activePitcher.teamName}</div>}
          {!confirmEnd
            ? <button onClick={()=>setConfirmEnd(true)}
                style={{width:"100%",padding:"10px",borderRadius:7,border:"1px solid #ef4444",background:"transparent",color:"#ef4444",fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:"pointer"}}>
                End Game
              </button>
            : <div style={{display:"flex",gap:8}}>
                <button onClick={handleEndGame}
                  style={{flex:1,padding:"10px",borderRadius:7,border:"none",background:"#ef4444",color:"#fff",fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:"pointer"}}>
                  Confirm End
                </button>
                <button onClick={()=>setConfirmEnd(false)}
                  style={{flex:1,padding:"10px",borderRadius:7,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:"pointer"}}>
                  Cancel
                </button>
              </div>
          }
        </div>
      ) : (
        <div style={{...card,borderColor:C.border,marginBottom:16,background:C.card2,textAlign:"center"}}>
          <div style={{fontSize:13,color:C.muted,padding:"8px 0"}}>No active game. Create one below to start logging.</div>
        </div>
      )}

      {/* Blocked message if game is active */}
      {activeGame && (
        <div style={{...card,background:C.card2,borderColor:C.border,marginBottom:16,textAlign:"center"}}>
          <div style={{fontSize:12,color:C.dim}}>End the current game before starting a new one.</div>
        </div>
      )}

      {/* New game form — only when no active game */}
      {!activeGame && (
        <div style={{...card,borderColor:C.blueDim}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#60a5fa",letterSpacing:1,marginBottom:12,textTransform:"uppercase"}}>New Game</div>

          {/* Live / Scout toggle */}
          <div style={{display:"flex",gap:4,marginBottom:10}}>
            {[[GAME_TYPES.LIVE,"🏟 Live"],[GAME_TYPES.SCOUT,"🔭 Scout"]].map(([t,l])=>(
              <button key={t} onClick={()=>{setGameType(t); onSelectPitcher(null); setLiveOppTeam(""); setPitchTeam(""); setOffTeam(""); }}
                style={{flex:1,padding:"9px 4px",background:gameType===t?(t===GAME_TYPES.LIVE?C.blue:"#7c3aed"):C.card2,border:`1px solid ${gameType===t?(t===GAME_TYPES.LIVE?C.blue:"#7c3aed"):C.border}`,borderRadius:6,color:gameType===t?"#fff":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,cursor:"pointer",transition:"all 0.15s"}}>
                {l}
              </button>
            ))}
          </div>

          {/* Date */}
          <div style={{marginBottom:10}}>
            <label style={lbl}>Date</label>
            <input style={{...inp,marginBottom:0}} type="date" value={gameDate} onChange={e=>setGameDate(e.target.value)}/>
          </div>

          {/* Live: opponent team selector */}
          {gameType===GAME_TYPES.LIVE&&(
            <div style={{marginBottom:10}}>
              <label style={lbl}>Opponent Team</label>
              <select value={liveOppTeam} onChange={e=>handleLiveOppTeamChange(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
                <option value="">— Select opponent —</option>
                {teams.map(t=><option key={t.id} value={String(t.id)}>{t.name}</option>)}
              </select>
            </div>
          )}

          {/* Scout: separate pitching + offensive team selectors */}
          {gameType===GAME_TYPES.SCOUT&&(
            <>
              <div style={{marginBottom:10}}>
                <label style={lbl}>Pitching Team</label>
                <select value={pitchTeam} onChange={e=>handlePitchTeamChange(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
                  <option value="">— Select pitching team —</option>
                  {teams.map(t=><option key={t.id} value={String(t.id)}>{t.name}</option>)}
                </select>
              </div>
              <div style={{marginBottom:10}}>
                <label style={lbl}>Offensive Team (batters)</label>
                <select value={offTeam} onChange={e=>setOffTeam(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
                  <option value="">— Select batting team —</option>
                  {teams.map(t=><option key={t.id} value={String(t.id)}>{t.name}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Pitcher selector — only shows after team is selected */}
          <div style={{marginBottom:10}}>
            <label style={lbl}>Active Pitcher</label>
            {!filteredTeamId ? (
              <div style={{fontSize:12,color:C.dim,padding:"6px 0"}}>
                {gameType===GAME_TYPES.LIVE?"Select an opponent team above to see their pitchers.":"Select a pitching team above to see their pitchers."}
              </div>
            ) : visibleTeams.flatMap(t=>t.pitchers).length===0 ? (
              <div style={{fontSize:12,color:C.dim,padding:"6px 0"}}>No pitchers found for this team. Add them in Teams & Pitchers.</div>
            ) : (
              visibleTeams.map(team=>{
                const players=[...(team.roster||team.pitchers||[])].sort((a,b)=>a.lastName?a.lastName.localeCompare(b.lastName||""):0);
                return (
                  <div key={team.id} style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {players.map(p=>{
                      const isActive=selectedPitcherId===p.id;
                      return (
                        <button key={p.id} onClick={()=>onSelectPitcher(isActive?null:p.id)}
                          style={{padding:"6px 14px",borderRadius:20,border:isActive?`1px solid ${C.blue}`:`1px solid ${C.border}`,background:isActive?C.blueDim:C.card2,color:isActive?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,cursor:"pointer"}}>
                          {p.number?`#${p.number} `:""}{p.lastName||p.name}{p.firstName?`, ${p.firstName}`:""}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          <button onClick={handleCreate} disabled={!canStart}
            style={{width:"100%",padding:"12px",background:canStart?C.blue:C.card2,border:"none",borderRadius:7,color:canStart?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:14,letterSpacing:1,textTransform:"uppercase",cursor:canStart?"pointer":"default",transition:"all 0.2s"}}>
            Start Game
          </button>
        </div>
      )}

      {/* Past games list */}
      {games.length>0&&(
        <div style={{marginTop:16}}>
          <label style={lbl}>Past Games</label>
          {[...games].reverse().map(g=>{
            const isActive=g.id===activeGameId;
            const isPendingDelete=confirmDelete===g.id;
            return (
              <div key={g.id} style={{...card,borderColor:isPendingDelete?"#ef4444":isActive?C.green:C.border,marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:isActive?C.green:C.text}}>{gameLabel(g)}</div>
                    {isActive&&<div style={{fontSize:10,color:C.green,marginTop:2,fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>ACTIVE</div>}
                  </div>
                  <div style={{display:"flex",gap:6,marginLeft:8,flexShrink:0}}>
                    {!activeGame&&!isActive&&(
                      <button onClick={()=>onSetActiveGame(g.id)}
                        style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,cursor:"pointer"}}>
                        Resume
                      </button>
                    )}
                    {!isActive&&(
                      <button onClick={()=>setConfirmDelete(isPendingDelete?null:g.id)}
                        style={{padding:"5px 10px",borderRadius:6,border:"1px solid #ef4444",background:"transparent",color:"#ef4444",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,cursor:"pointer"}}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {/* Confirm delete row */}
                {isPendingDelete&&(
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid #ef4444`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontSize:11,color:"#ef4444"}}>Delete this game and all its pitch data?</span>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>{onDeleteGame(g.id);setConfirmDelete(null);}}
                        style={{padding:"5px 12px",borderRadius:6,border:"none",background:"#ef4444",color:"#fff",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,cursor:"pointer"}}>
                        Confirm
                      </button>
                      <button onClick={()=>setConfirmDelete(null)}
                        style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,cursor:"pointer"}}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── TEAM CARD (reusable, used inside season) ──────────────────────────────────
function TeamCard({ team, teams, onSaveTeams, myTeamId, onSetMyTeam, selectedPitcherId, onSelectPitcher }) {
  const C = useTheme();
  const {card,lbl,inp} = mkStyles(C);
  const [isOpen,            setIsOpen]            = useState(false);
  const [teamPanelTab,      setTeamPanelTab]      = useState("roster");
  const [confirmDeleteTeam, setConfirmDeleteTeam] = useState(false);

  const handleDelete = () => {
    onSaveTeams(teams.filter(t=>t.id!==team.id));
    if(String(myTeamId)===String(team.id)) onSetMyTeam(null);
  };

  const isMyTeam = String(myTeamId)===String(team.id);

  return (
    <div style={{...card,borderColor:isOpen?C.blue:C.border,marginBottom:6}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>setIsOpen(v=>!v)}>
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,color:isOpen?"#60a5fa":C.text}}>{team.name}</div>
          <div style={{fontSize:10,color:C.dim,marginTop:1}}>{(team.roster||team.pitchers||[]).length} player{(team.roster||team.pitchers||[]).length!==1?"s":""}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div onClick={e=>{e.stopPropagation();onSetMyTeam(isMyTeam?null:team.id);}}
            style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",padding:"3px 7px",borderRadius:10,border:`1px solid ${isMyTeam?C.green:C.border}`,background:isMyTeam?C.green+"22":"transparent",transition:"all 0.2s"}}>
            <div style={{width:12,height:12,borderRadius:2,border:`2px solid ${isMyTeam?C.green:C.border}`,background:isMyTeam?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:"#fff"}}>
              {isMyTeam?"✓":""}
            </div>
            <span style={{fontSize:9,color:isMyTeam?C.green:C.dim,fontFamily:"'Oswald',sans-serif",whiteSpace:"nowrap"}}>My Team</span>
          </div>
          <span style={{color:C.muted,fontSize:16}}>{isOpen?"▲":"▼"}</span>
          {confirmDeleteTeam
            ? <div style={{display:"flex",gap:4}} onClick={e=>e.stopPropagation()}>
                <button onClick={handleDelete} style={{padding:"3px 8px",borderRadius:5,border:"none",background:"#ef4444",color:"#fff",fontFamily:"'Oswald',sans-serif",fontSize:10,cursor:"pointer"}}>Confirm</button>
                <button onClick={()=>setConfirmDeleteTeam(false)} style={{padding:"3px 8px",borderRadius:5,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:10,cursor:"pointer"}}>Cancel</button>
              </div>
            : <button onClick={e=>{e.stopPropagation();setConfirmDeleteTeam(true);}} style={{background:"none",border:"1px solid #ef4444",borderRadius:5,color:"#ef4444",cursor:"pointer",fontSize:10,padding:"3px 7px",fontFamily:"'Oswald',sans-serif"}}>Delete</button>
          }
        </div>
      </div>
      {isOpen&&(
        <div style={{marginTop:10,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
          {isMyTeam ? (
            <>
              <div style={{fontSize:9,color:C.green,fontFamily:"'Oswald',sans-serif",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>My Team Roster</div>
              <RosterPanel team={team} onSaveTeams={onSaveTeams} teams={teams}/>
            </>
          ) : (
            <>
              <div style={{display:"flex",gap:0,marginBottom:10,borderRadius:6,overflow:"hidden",border:`1px solid ${C.border}`}}>
                {[["roster","Roster"],["lineup","Their Lineup"]].map(([t,l])=>(
                  <button key={t} onClick={e=>{e.stopPropagation();setTeamPanelTab(t);}}
                    style={{flex:1,padding:"7px 4px",background:teamPanelTab===t?C.blueDim:C.card2,border:"none",color:teamPanelTab===t?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,textTransform:"uppercase",cursor:"pointer"}}>
                    {l}
                  </button>
                ))}
              </div>
              {teamPanelTab==="roster"&&<RosterPanel team={team} onSaveTeams={onSaveTeams} teams={teams}/>}
              {teamPanelTab==="lineup"&&<OpponentLineupPanel team={team} onSaveTeams={onSaveTeams} teams={teams}/>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── TEAMS TAB ─────────────────────────────────────────────────────────────────
function TeamsTab({ teams, onSaveTeams, selectedPitcherId, onSelectPitcher, myTeamId, onSetMyTeam, seasons, onSaveSeasons }) {
  const C = useTheme();
  const {card,lbl,inp} = mkStyles(C);
  const [openSeasonId,    setOpenSeasonId]    = useState(null);
  const [confirmDelSeason,setConfirmDelSeason]= useState(null);
  // New season form
  const [showNewSeason,   setShowNewSeason]   = useState(false);
  const [seasonName,      setSeasonName]      = useState(()=>`${new Date().getFullYear()} Spring`);
  // New team form (per season)
  const [addingTeamTo,    setAddingTeamTo]    = useState(null); // seasonId
  const [newTeamName,     setNewTeamName]     = useState("");
  // Carry-forward state
  const [showCarryFwd,    setShowCarryFwd]    = useState(false);
  const [carryFromId,     setCarryFromId]     = useState("");
  const [carryTeamIds,    setCarryTeamIds]    = useState(new Set());

  // Auto-open first season
  useEffect(()=>{ if(seasons.length>0&&!openSeasonId) setOpenSeasonId(seasons[seasons.length-1].id); },[seasons.length]);

  const handleCreateSeason = () => {
    const n=seasonName.trim(); if(!n) return;
    const id=Date.now();
    let carryTeams=[];
    if(showCarryFwd&&carryFromId){
      // Copy selected teams from source season, strip ids to create fresh copies
      const srcTeams=teams.filter(t=>String(t.seasonId)===carryFromId&&carryTeamIds.has(String(t.id)));
      carryTeams=srcTeams.map(t=>({...t,id:Date.now()+Math.random(),seasonId:id,roster:[...(t.roster||[]).map(p=>({...p,id:Date.now()+Math.random()}))],pitchers:[]}));
    }
    onSaveSeasons([...seasons,{id,name:n,year:new Date().getFullYear()}]);
    if(carryTeams.length) onSaveTeams([...teams,...carryTeams]);
    setShowNewSeason(false); setShowCarryFwd(false); setCarryFromId(""); setCarryTeamIds(new Set());
    setOpenSeasonId(id);
    setSeasonName(`${new Date().getFullYear()} Spring`);
  };

  const handleDeleteSeason = (sid) => {
    onSaveSeasons(seasons.filter(s=>s.id!==sid));
    onSaveTeams(teams.filter(t=>String(t.seasonId)!==String(sid)));
    setConfirmDelSeason(null);
    if(String(openSeasonId)===String(sid)) setOpenSeasonId(null);
  };

  const handleAddTeam = (seasonId) => {
    const n=newTeamName.trim(); if(!n) return;
    const t={id:Date.now(),name:n,pitchers:[],roster:[],seasonId};
    onSaveTeams([...teams,t]);
    setNewTeamName(""); setAddingTeamTo(null);
  };

  const seasonLabel = (s) => s?.name || s?.year || "Season";

  return (
    <div style={{padding:"14px 16px"}}>

      {/* My Team note */}
      {!myTeamId&&<div style={{...card,borderColor:C.amber,background:C.isDark?"#f59e0b11":"#fffbeb",marginBottom:12}}>
        <div style={{fontSize:11,color:C.amber}}>Tip: Add your team and check "My Team" so your lineup and hitting stats work correctly.</div>
      </div>}

      {/* New season button */}
      {!showNewSeason&&(
        <button onClick={()=>setShowNewSeason(true)}
          style={{...card,width:"100%",border:`2px dashed ${C.border}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:"pointer",textAlign:"center",padding:"14px",marginBottom:12,borderRadius:10,display:"block"}}>
          + New Season
        </button>
      )}

      {/* New season form */}
      {showNewSeason&&(
        <div style={{...card,borderColor:C.blueDim,marginBottom:16}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#60a5fa",letterSpacing:1,marginBottom:12,textTransform:"uppercase"}}>New Season</div>
          <div style={{marginBottom:10}}>
            <label style={lbl}>Season Name</label>
            <input style={inp} placeholder="e.g. 2026 Spring" value={seasonName} onChange={e=>setSeasonName(e.target.value)}/>
          </div>
          {/* Carry forward option */}
          {seasons.length>0&&(
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:8}} onClick={()=>setShowCarryFwd(v=>!v)}>
                <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${showCarryFwd?C.blue:C.border}`,background:showCarryFwd?C.blue:"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff"}}>
                  {showCarryFwd?"✓":""}
                </div>
                <span style={{fontSize:12,color:C.muted}}>Carry forward teams from a previous season</span>
              </div>
              {showCarryFwd&&(
                <>
                  <label style={lbl}>Copy from season</label>
                  <select value={carryFromId} onChange={e=>{setCarryFromId(e.target.value);setCarryTeamIds(new Set());}} style={{...inp,cursor:"pointer",marginBottom:8}}>
                    <option value="">— Select season —</option>
                    {[...seasons].reverse().map(s=><option key={s.id} value={String(s.id)}>{seasonLabel(s)}</option>)}
                  </select>
                  {carryFromId&&(
                    <>
                      <label style={lbl}>Select teams to carry forward</label>
                      {teams.filter(t=>String(t.seasonId)===carryFromId).map(t=>(
                        <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,cursor:"pointer"}}
                          onClick={()=>setCarryTeamIds(prev=>{const n=new Set(prev);n.has(String(t.id))?n.delete(String(t.id)):n.add(String(t.id));return n;})}>
                          <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${carryTeamIds.has(String(t.id))?C.blue:C.border}`,background:carryTeamIds.has(String(t.id))?C.blue:"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff",flexShrink:0}}>
                            {carryTeamIds.has(String(t.id))?"✓":""}
                          </div>
                          <span style={{fontSize:13,color:C.text}}>{t.name}</span>
                          <span style={{fontSize:10,color:C.dim}}>{(t.roster||[]).length} players</span>
                        </div>
                      ))}
                      {teams.filter(t=>String(t.seasonId)===carryFromId).length===0&&<div style={{fontSize:12,color:C.dim}}>No teams in that season.</div>}
                    </>
                  )}
                </>
              )}
            </div>
          )}
          <div style={{display:"flex",gap:8}}>
            <button onClick={handleCreateSeason} disabled={!seasonName.trim()}
              style={{flex:1,padding:"11px",background:seasonName.trim()?C.blue:C.card2,border:"none",borderRadius:7,color:seasonName.trim()?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:"pointer"}}>
              Create Season
            </button>
            <button onClick={()=>setShowNewSeason(false)}
              style={{padding:"11px 16px",background:"none",border:`1px solid ${C.border}`,borderRadius:7,color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:13,cursor:"pointer"}}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {seasons.length===0&&!showNewSeason&&(
        <div style={{textAlign:"center",color:C.dim,fontSize:13,marginTop:16}}>No seasons yet. Create your first season above.</div>
      )}

      {/* Season list — newest first */}
      {[...seasons].reverse().map(season=>{
        const seasonTeams=teams.filter(t=>String(t.seasonId)===String(season.id));
        const isOpen=String(openSeasonId)===String(season.id);
        const isPendingDel=confirmDelSeason===season.id;
        return (
          <div key={season.id} style={{marginBottom:10}}>
            {/* Season header */}
            <div style={{...card,borderColor:isOpen?C.blue:C.border,marginBottom:0,borderRadius:isOpen?"10px 10px 0 0":"10px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>setOpenSeasonId(isOpen?null:season.id)}>
                <div>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:17,color:isOpen?"#60a5fa":C.text}}>{seasonLabel(season)}</div>
                  <div style={{fontSize:10,color:C.dim,marginTop:1}}>{seasonTeams.length} team{seasonTeams.length!==1?"s":""}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{color:C.muted,fontSize:16}}>{isOpen?"▲":"▼"}</span>
                  {isPendingDel
                    ? <div style={{display:"flex",gap:4}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>handleDeleteSeason(season.id)} style={{padding:"4px 8px",borderRadius:5,border:"none",background:"#ef4444",color:"#fff",fontFamily:"'Oswald',sans-serif",fontSize:10,cursor:"pointer"}}>Confirm</button>
                        <button onClick={()=>setConfirmDelSeason(null)} style={{padding:"4px 8px",borderRadius:5,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:10,cursor:"pointer"}}>Cancel</button>
                      </div>
                    : <button onClick={e=>{e.stopPropagation();setConfirmDelSeason(season.id);}} style={{background:"none",border:"1px solid #ef4444",borderRadius:5,color:"#ef4444",cursor:"pointer",fontSize:10,padding:"3px 7px",fontFamily:"'Oswald',sans-serif"}}>Delete</button>
                  }
                </div>
              </div>
            </div>

            {/* Season body */}
            {isOpen&&(
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderTop:"none",borderRadius:"0 0 10px 10px",padding:"10px 12px",marginBottom:0}}>
                {seasonTeams.map(team=>(
                  <TeamCard key={team.id} team={team} teams={teams} onSaveTeams={onSaveTeams}
                    myTeamId={myTeamId} onSetMyTeam={onSetMyTeam}
                    selectedPitcherId={selectedPitcherId} onSelectPitcher={onSelectPitcher}/>
                ))}
                {seasonTeams.length===0&&<div style={{fontSize:12,color:C.dim,textAlign:"center",padding:"8px 0"}}>No teams yet. Add one below.</div>}

                {/* Add team to this season */}
                {addingTeamTo===season.id
                  ? <div style={{display:"flex",gap:8,marginTop:8}}>
                      <input style={{...inp,marginBottom:0,flex:1}} placeholder="Team name" value={newTeamName}
                        onChange={e=>setNewTeamName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddTeam(season.id)} autoFocus/>
                      <button onClick={()=>handleAddTeam(season.id)} disabled={!newTeamName.trim()}
                        style={{padding:"10px 14px",background:newTeamName.trim()?C.green:C.card2,border:"none",borderRadius:6,color:newTeamName.trim()?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                        + Add
                      </button>
                      <button onClick={()=>{setAddingTeamTo(null);setNewTeamName("");}}
                        style={{padding:"10px 12px",background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,cursor:"pointer"}}>
                        ×
                      </button>
                    </div>
                  : <button onClick={()=>{setAddingTeamTo(season.id);setNewTeamName("");}}
                      style={{width:"100%",marginTop:8,padding:"9px",background:"none",border:`1px dashed ${C.border}`,borderRadius:7,color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,cursor:"pointer"}}>
                      + Add Team to {seasonLabel(season)}
                    </button>
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── SETUP ─────────────────────────────────────────────────────────────────────
function Setup({ teams, onSaveTeams, selectedPitcherId, onSelectPitcher, lineup, onSaveLineup, games, onAddGame, onDeleteGame, activeGameId, onSetActiveGame, myTeamId, onGameStart }) {
  const C = useTheme();
  const {card,lbl,inp} = mkStyles(C);
  const [setupTab, setSetupTab] = useState("game");
  const myTeam = myTeamId ? teams.find(t=>String(t.id)===String(myTeamId)) : null;
  const myRoster = myTeam ? [...(myTeam.roster||[])].sort((a,b)=>a.lastName?.localeCompare(b.lastName||"")||0) : [];
  // Slots: if myTeam has a roster, use it as basis; else fall back to saved lineup or empty
  const initSlots = () => {
    if(lineup.length) return lineup.map(p=>p.name);
    return Array(9).fill("");
  };
  const [slots, setSlots] = useState(initSlots);

  const handleSaveLineup = () => {
    const players=slots.map((name,i)=>({order:i+1,name:name.trim()})).filter(p=>p.name);
    onSaveLineup(players);
  };

  return (
    <div style={{padding:"14px 16px"}}>
      <div style={{display:"flex",gap:0,marginBottom:16,borderRadius:8,overflow:"hidden",border:`1px solid ${C.border}`}}>
        {[["game","Game"],["lineup","Our Lineup"]].map(([t,l])=>(
          <button key={t} onClick={()=>setSetupTab(t)}
            style={{flex:1,padding:"10px 4px",background:setupTab===t?C.blueDim:C.card2,border:"none",color:setupTab===t?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,textTransform:"uppercase",cursor:"pointer"}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── GAME ── */}
      {setupTab==="game" && (
        <SetupGamePanel
          teams={teams}
          games={games}
          onAddGame={onAddGame}
          onDeleteGame={onDeleteGame}
          activeGameId={activeGameId}
          onSetActiveGame={onSetActiveGame}
          selectedPitcherId={selectedPitcherId}
          onSelectPitcher={onSelectPitcher}
          onGameStart={onGameStart}
        />
      )}

      {/* ── OUR LINEUP ── */}
      {setupTab==="lineup" && (
        <>
          <div style={{...card,borderColor:C.blueDim,marginBottom:16}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#60a5fa",letterSpacing:1,marginBottom:8,textTransform:"uppercase"}}>Starting Lineup</div>
            <div style={{fontSize:11,color:C.muted,marginBottom:12}}>Enter starters in batting order. Persists game to game — use Sub/PH during a game to make changes.</div>
            {Array(9).fill(0).map((_,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,color:C.dim,minWidth:22,textAlign:"right"}}>{i+1}</div>
                {myRoster.length>0 ? (
                  <select value={slots[i]||""} onChange={e=>{const n=[...slots];n[i]=e.target.value;setSlots(n);}} style={{...inp,marginBottom:0,cursor:"pointer"}}>
                    <option value="">— Pick player —</option>
                    {myRoster.map(p=>(
                      <option key={p.id} value={p.lastName+(p.firstName?`, ${p.firstName}`:"")}>
                        {p.number?`#${p.number} `:""}{p.lastName}{p.firstName?`, ${p.firstName}`:""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input style={{...inp,marginBottom:0}} placeholder={`Batter ${i+1}`} value={slots[i]||""}
                    onChange={e=>{const n=[...slots]; n[i]=e.target.value; setSlots(n);}}/>
                )}
              </div>
            ))}
            {!myTeam&&<div style={{fontSize:11,color:C.dim,marginBottom:8}}>Tip: Mark your team in the Teams tab to pick from your roster.</div>}
            <button onClick={handleSaveLineup} disabled={!slots.some(s=>s.trim())}
              style={{width:"100%",padding:"11px",background:slots.some(s=>s.trim())?C.blue:C.card2,border:"none",borderRadius:7,color:slots.some(s=>s.trim())?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:"pointer",marginTop:8}}>
              Save Lineup
            </button>
          </div>
          {lineup.length>0&&(
            <>
              <label style={lbl}>Current Saved Lineup</label>
              {lineup.map(p=>(
                <div key={p.order} style={{...card,display:"flex",alignItems:"center",gap:12,padding:"9px 14px"}}>
                  <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,color:C.dim,minWidth:24}}>{p.order}</div>
                  <div style={{fontSize:14,color:C.text}}>{p.name}</div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── LOG PITCH ─────────────────────────────────────────────────────────────────
function LogPitch({ teams, selectedPitcherId, onSelectPitcher, pitches, onLog, onUndo, lineup, games, selectedGame, onSelectGame, currentBatter, onBatterChange, currentCount, onCountChange }) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  const count   = currentCount;
  const setCount = onCountChange;
  const batter  = currentBatter;
  const setBatter = onBatterChange;
  const [pitch,    setPitch]    = useState(null);
  const [result,   setResult]   = useState(null);
  const [inPlayResult, setInPlayResult] = useState(null);
  const [zone,     setZone]     = useState(null);
  const [flashMsg, setFlashMsg] = useState(null);
  const [lastEntry,setLastEntry]= useState(null);
  const [showZone,         setShowZone]         = useState(false);
  const [outOfZone,        setOutOfZone]        = useState(false);
  const [confirmEnd,       setConfirmEnd]       = useState(false);
  const [showPitcherChange,setShowPitcherChange] = useState(false);
  const [showSub,  setShowSub]  = useState(false);
  const [subSlot,  setSubSlot]  = useState(null);
  const [subName,  setSubName]  = useState("");
  const [lineupOverrides,setLineupOverrides] = useState({});


  // Find active pitcher across teams
  const pitcher = useMemo(()=>teams.flatMap(t=>t.pitchers).find(p=>p.id===selectedPitcherId), [teams,selectedPitcherId]);
  // Show only this game's pitches in Log — keeps count/% scoped to active game
  const pitcherPitches = useMemo(()=>selectedPitcherId
    ? pitches.filter(p=>p.pitcherId===selectedPitcherId&&(!selectedGame||String(p.gameId)===String(selectedGame)))
    : [], [pitches,selectedPitcherId,selectedGame]);
  const overall   = useMemo(()=>calcOverall(pitcherPitches),  [pitcherPitches]);
  const byCount   = useMemo(()=>calcByCount(pitcherPitches),  [pitcherPitches]);
  const countData = byCount[count]||{total:0};

  // Determine game mode and appropriate lineup
  const activeGame = games.find(g=>g.id===selectedGame||g.id===Number(selectedGame));
  const isScoutGame = activeGame?.type===GAME_TYPES.SCOUT;

  // Resolve effective lineup — scout uses offensive team's saved lineup, live uses ours
  const effectiveLineup = useMemo(()=>{
    if(isScoutGame){
      const offTeamId = activeGame?.offTeamId;
      const offTeam = offTeamId ? teams.find(t=>String(t.id)===String(offTeamId)) : null;
      const raw = (offTeam?.lineup?.length)
        ? offTeam.lineup
        : Array(9).fill(0).map((_,i)=>({order:i+1,number:"",name:`Batter ${i+1}`}));
      return raw.map(p=>({
        order:p.order,
        name:lineupOverrides[p.order]||p.name,
        number:p.number||"",
        subbed:!!lineupOverrides[p.order],
      }));
    }
    return lineup.map(p=>({
      ...p, name:lineupOverrides[p.order]||p.name, subbed:!!lineupOverrides[p.order],
    }));
  },[lineup,lineupOverrides,isScoutGame,activeGame,teams]);

  // Only seed batter when genuinely blank — don't override current batter on tab re-mount
  useEffect(()=>{
    if(effectiveLineup.length>0 && (!batter||batter==="")) setBatter(effectiveLineup[0].name);
  },[selectedPitcherId, selectedGame]);

  const nextBatterInOrder = (currentName) => {
    if(effectiveLineup.length===0) return "";
    const idx=effectiveLineup.findIndex(p=>p.name===currentName);
    if(idx===-1) return effectiveLineup[0].name;
    return effectiveLineup[(idx+1)%effectiveLineup.length].name;
  };

  const handleLog = () => {
    if(!pitcher||!pitch||!result) return;
    const finalResult = result==="In Play" ? (inPlayResult||IN_PLAY_RESULTS[0]) : result;
    const entry={
      id:Date.now(), pitcherId:pitcher.id, pitcherName:pitcher.name,
      pitcherTeam:pitcher.teamName, batter:batter.trim()||"—",
      gameId:selectedGame||null, count, pitch, result:finalResult, zone,
      outOfZone: outOfZone||false,
    };
    // Override result to "Walk" if this ball ends the at-bat
    const {next,atBatOver,reason}=advanceCount(count,finalResult);
    const finalCat=resultCategory(finalResult);
    const loggedResult = (atBatOver && reason==="Walk") ? "Walk"
                       : (atBatOver && reason==="Strikeout") ? (finalResult==="Called Strike" ? "Called Strikeout" : "Swinging Strikeout")
                       : finalResult;
    const logEntry = {...entry, result:loggedResult};
    setLastEntry({entry:logEntry,prevCount:count,prevBatter:batter,prevPitch:pitch,prevResult:result,prevInPlayResult:inPlayResult,prevZone:zone});
    onLog(logEntry);
    if(atBatOver){
      setCount("0-0"); setZone(null); setOutOfZone(false);
      setBatter(nextBatterInOrder(batter.trim()));
      setPitch(null); setResult(null); setInPlayResult(null);
      const msg=finalCat==="In Play"?`${finalResult} — next batter`:reason==="Walk"?"Walk — next batter":"Strikeout — next batter";
      setFlashMsg(msg); setTimeout(()=>setFlashMsg(null),2500);
    } else {
      setCount(next); setZone(null); setOutOfZone(false);
      setPitch(null); setResult(null); setInPlayResult(null);
      setFlashMsg("✓ Logged"); setTimeout(()=>setFlashMsg(null),600);
    }
  };

  const handleUndo = () => {
    if(!lastEntry) return;
    onUndo(lastEntry.entry.id);
    setCount(lastEntry.prevCount); setBatter(lastEntry.prevBatter);
    setPitch(null); setResult(null); setInPlayResult(null);
    setZone(lastEntry.prevZone); setLastEntry(null);
    setFlashMsg("↩ Undone"); setTimeout(()=>setFlashMsg(null),1200);
  };

  const handleSub = () => {
    if(!subSlot||!subName.trim()) return;
    setLineupOverrides(prev=>({...prev,[subSlot]:subName.trim()}));
    if(batter===(lineup.find(p=>p.order===subSlot)?.name||"")) setBatter(subName.trim());
    setShowSub(false); setSubSlot(null); setSubName("");
  };



  if(!pitcher) return (
    <div style={{padding:"14px 16px",textAlign:"center",paddingTop:56}}>
      <div style={{fontSize:40,marginBottom:14}}>⚾</div>
      <div style={{color:C.dim,fontSize:14}}>Go to Setup, expand a team, and tap a pitcher to activate.</div>
    </div>
  );

  // Label helper: scout games show "PitchTeam vs OffTeam", live shows date + opponent
  const gameLabel = (g) => {
    if(!g) return "";
    if(g.type===GAME_TYPES.SCOUT){
      const pt = teams.find(t=>String(t.id)===String(g.pitchTeamId));
      const ot = teams.find(t=>String(t.id)===String(g.offTeamId));
      const ptName = pt?.name || g.opponent;
      const otName = ot?.name || "?";
      return `🔭 ${g.date} · ${ptName} vs ${otName}`;
    }
    return `🏟 ${g.date} vs ${g.opponent}`;
  };

  const isAtBatOver = flashMsg&&flashMsg.includes("batter");
  const btnBg = isAtBatOver||flashMsg==="✓ Logged"?C.green:C.blue;

  if(!activeGame) return (
    <div style={{padding:"14px 16px",textAlign:"center",paddingTop:72}}>
      <div style={{fontSize:40,marginBottom:16}}>⚾</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:18,color:C.muted,letterSpacing:1,marginBottom:8}}>No Active Game</div>
      <div style={{fontSize:13,color:C.dim}}>Go to the Games tab to create a new one.</div>
    </div>
  );

  return (
    <div style={{padding:"14px 16px"}}>

      {/* Flash */}
      {flashMsg&&(
        <div style={{background:isAtBatOver?"#16a34a22":"#1e40af22",border:`1px solid ${isAtBatOver?C.green:C.blue}`,borderRadius:8,padding:"10px 14px",marginBottom:12,textAlign:"center"}}>
          <div style={{fontFamily:"'Oswald',sans-serif",color:isAtBatOver?"#86efac":"#93c5fd",fontSize:13,letterSpacing:1}}>{flashMsg}</div>
        </div>
      )}

      {/* Active game banner — read only, managed in Setup */}
      {activeGame ? (
        <div style={{...card,marginBottom:14,borderColor:C.green,background:C.isDark?"#16a34a11":"#f0fdf4"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:10,color:C.green,textTransform:"uppercase",letterSpacing:1,marginBottom:2,fontFamily:"'Oswald',sans-serif"}}>Active Game</div>
              <div style={{fontSize:13,color:C.text,fontFamily:"'Oswald',sans-serif",letterSpacing:0.5}}>{gameLabel(activeGame)}</div>
            </div>
            <div style={{display:"flex",gap:6,marginLeft:10,flexShrink:0}}>
              {!confirmEnd
                ? <button onClick={()=>setConfirmEnd(true)}
                    style={{padding:"6px 12px",borderRadius:6,border:"1px solid #ef4444",background:"transparent",color:"#ef4444",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,cursor:"pointer",whiteSpace:"nowrap"}}>
                    End
                  </button>
                : <>
                    <button onClick={()=>{onSelectGame(null);setConfirmEnd(false);}}
                      style={{padding:"6px 12px",borderRadius:6,border:"none",background:"#ef4444",color:"#fff",fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,cursor:"pointer"}}>
                      Confirm
                    </button>
                    <button onClick={()=>setConfirmEnd(false)}
                      style={{padding:"6px 12px",borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,cursor:"pointer"}}>
                      Cancel
                    </button>
                  </>
              }
            </div>
          </div>
        </div>
      ) : (
        <div style={{...card,marginBottom:14,textAlign:"center",padding:"14px"}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,color:C.muted,marginBottom:4,letterSpacing:1}}>No Active Game</div>
          <div style={{fontSize:11,color:C.dim}}>Go to the Games tab to create a new one.</div>
        </div>
      )}

      {/* Pitcher header */}
      <div style={{...card,borderColor:C.blueDim,background:C.isDark?C.blueDim+"22":"#eff6ff",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div style={{minWidth:0}}>
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:2}}>
              <div style={{fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:1}}>Now Tracking</div>
              {isScoutGame&&<span style={{fontSize:9,background:"#7c3aed22",color:"#a78bfa",border:"1px solid #7c3aed44",borderRadius:4,padding:"1px 5px",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>SCOUT</span>}
              {!isScoutGame&&activeGame&&<span style={{fontSize:9,background:C.blue+"22",color:C.isDark?"#93c5fd":C.blue,border:`1px solid ${C.blue}44`,borderRadius:4,padding:"1px 5px",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>LIVE</span>}
            </div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:17,color:"#60a5fa"}}>
              {pitcher.lastName||pitcher.name}{pitcher.firstName?`, ${pitcher.firstName}`:""}
              {pitcher.number?<span style={{fontSize:12,color:C.muted,marginLeft:6}}>#{pitcher.number}</span>:null}
            </div>
            <div style={{fontSize:11,color:C.muted}}>{pitcher.teamName}</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:10,color:C.dim}}>PITCHES</div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,color:C.text}}>{overall.total}</div>
            </div>
            <button onClick={()=>setShowPitcherChange(v=>!v)}
              style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${C.amber}`,background:"transparent",color:C.amber,fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:1,cursor:"pointer",whiteSpace:"nowrap"}}>
              ⇄ P-Change
            </button>
          </div>
        </div>
        {overall.total>0&&<div style={{marginTop:8}}><PitchBar pitchCounts={overall} total={overall.total} height={14}/></div>}

        {/* Pitcher change panel */}
        {showPitcherChange&&(()=>{
          const pitchingTeamId = activeGame?.pitchTeamId ||
            (pitcher ? String(teams.find(t=>t.name===pitcher.teamName)?.id||"") : "");
          const pitchingTeam = teams.find(t=>String(t.id)===pitchingTeamId);
          const rosterOrPitchers=[...(pitchingTeam?.roster||pitchingTeam?.pitchers||[])];
          const options=rosterOrPitchers.filter(p=>p.id!==selectedPitcherId).sort((a,b)=>a.lastName?a.lastName.localeCompare(b.lastName||""):0);
          return (
            <div style={{marginTop:10,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
              <div style={{fontSize:10,color:C.amber,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontFamily:"'Oswald',sans-serif"}}>
                Pitching Change — select new pitcher
              </div>
              {options.length===0
                ? <div style={{fontSize:12,color:C.dim}}>No other pitchers on this team.</div>
                : <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {options.map(p=>(
                      <button key={p.id} onClick={()=>{
                        onSelectPitcher(p.id);
                        setShowPitcherChange(false);
                        setPitch(null); setResult(null); setInPlayResult(null);
                        setCount("0-0"); setZone(null);
                      }}
                        style={{padding:"7px 14px",borderRadius:20,border:`1px solid ${C.amber}`,background:C.isDark?"#f59e0b11":"#fffbeb",color:C.amber,fontFamily:"'Oswald',sans-serif",fontSize:12,cursor:"pointer"}}>
                        {p.number?`#${p.number} `:""}{p.lastName||p.name}{p.firstName?`, ${p.firstName}`:""}
                      </button>
                    ))}
                  </div>
              }
              <button onClick={()=>setShowPitcherChange(false)}
                style={{marginTop:8,width:"100%",padding:"6px",borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,cursor:"pointer"}}>
                Cancel
              </button>
            </div>
          );
        })()}
      </div>

      {/* Pitch % — above batter */}
      {overall.total>0&&(
        <div style={{...card,marginBottom:12}}>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Pitch % — Overall · {count}</div>
          <DualPercent overall={overall} countData={countData} currentCount={count}/>
        </div>
      )}

      {/* Batter */}
      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <label style={{...lbl,margin:0}}>Batter</label>
          <button onClick={()=>setShowSub(v=>!v)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,color:C.muted,fontSize:11,padding:"3px 8px",cursor:"pointer",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>
            {isScoutGame?"Update Name":"Sub / PH"}
          </button>
        </div>
        {effectiveLineup.length>0
          ? <select value={batter} onChange={e=>setBatter(e.target.value)} style={{...inp,borderColor:isAtBatOver?C.green:C.border,cursor:"pointer",marginBottom:0}}>
              <option value="">— Select batter —</option>
              {effectiveLineup.map(p=><option key={p.order} value={p.name}>{p.order}. {p.number?`#${p.number} `:""}{p.name}{p.subbed?" (sub)":""}</option>)}
              <option value="__other__">Other…</option>
            </select>
          : <input style={{...inp,borderColor:isAtBatOver?C.green:C.border}} placeholder="Enter batter name…" value={batter} onChange={e=>setBatter(e.target.value)}/>
        }
        {batter==="__other__"&&<input style={{...inp,marginTop:6}} placeholder="Enter name…" value="" onChange={e=>setBatter(e.target.value)} autoFocus/>}

        {showSub&&effectiveLineup.length>0&&(
          <div style={{marginTop:8,padding:"10px",background:C.card2,borderRadius:8,border:`1px solid ${C.border}`}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#60a5fa",letterSpacing:1,marginBottom:8,textTransform:"uppercase"}}>{isScoutGame?"Update Batter Name":"Sub / Pinch Hitter"}</div>
            <div style={{marginBottom:8}}>
              <label style={lbl}>{isScoutGame?"Select slot to name":"Replace slot"}</label>
              <select value={subSlot||""} onChange={e=>setSubSlot(Number(e.target.value))} style={{...inp,cursor:"pointer",marginBottom:0}}>
                <option value="">— Select slot —</option>
                {effectiveLineup.map(p=><option key={p.order} value={p.order}>{p.order}. {p.name}</option>)}
              </select>
            </div>
            <div style={{marginBottom:8}}>
              <label style={lbl}>{isScoutGame?"Player name / #":"Sub / PH name"}</label>
              <input style={inp} placeholder={isScoutGame?"Name or #12 Smith":"Player name"} value={subName} onChange={e=>setSubName(e.target.value)}/>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={handleSub} disabled={!subSlot||!subName.trim()} style={{flex:1,padding:"8px",background:subSlot&&subName.trim()?C.green:C.card2,border:"none",borderRadius:6,color:subSlot&&subName.trim()?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,cursor:"pointer"}}>
                {isScoutGame?"Update Name":"Confirm Sub"}
              </button>
              <button onClick={()=>{setShowSub(false);setSubSlot(null);setSubName("");}} style={{flex:1,padding:"8px",background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Count */}
      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <label style={{...lbl,margin:0}}>Count (B-S)</label>
          <span style={{fontSize:10,color:C.dim}}>auto-advances · tap to override</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
          {COUNTS.map(c=><button key={c} onClick={()=>setCount(c)} style={cBtn(count===c)}>{c}</button>)}
        </div>
        <div style={{fontSize:11,color:C.muted,marginTop:5,textAlign:"center",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>
          {count} · {COUNT_FULL[count]}
        </div>
      </div>

      {/* Pitch type */}
      <div style={{marginBottom:12}}>
        <label style={lbl}>Pitch Type</label>
        <div style={{display:"flex",gap:6}}>
          {PITCH_TYPES.map(p=><button key={p} onClick={()=>setPitch(p)} style={{...pill(PITCH_COLORS[p],pitch===p),flex:1}}>{p}</button>)}
        </div>
      </div>

      {/* Result */}
      <div style={{marginBottom:12}}>
        <label style={lbl}>Result</label>
        {/* Row 1: strikes */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
          {["Called Strike","Swinging Strike"].map(r=>(
            <button key={r} onClick={()=>setResult(r)}
              style={pill(result===r?"#ef4444":C.muted,result===r)}>
              {r==="Called Strike"?"Called K":"Swing K"}
            </button>
          ))}
        </div>
        {/* Row 2: foul + ball */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
          {["Foul","Ball"].map(r=>(
            <button key={r} onClick={()=>setResult(r)}
              style={pill(result===r?(r==="Foul"?"#eab308":"#22c55e"):C.muted,result===r)}>
              {r}
            </button>
          ))}
        </div>
        {/* Row 3: In Play toggle */}
        <button onClick={()=>setResult("In Play")}
          style={{...pill(result==="In Play"?"#3b82f6":C.muted,result==="In Play"),width:"100%",marginBottom:result==="In Play"?6:0}}>
          In Play
        </button>
        {/* In-play submenu */}
        {result==="In Play"&&result!==null&&(
          <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:8,padding:8}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
              {IN_PLAY_RESULTS.map(r=>(
                <button key={r} onClick={()=>setInPlayResult(r)}
                  style={{padding:"7px 6px",borderRadius:6,border:inPlayResult===r?`1px solid ${C.blue}`:`1px solid ${C.border}`,background:inPlayResult===r?C.blueDim:C.card,color:inPlayResult===r?(C.isDark?"#60a5fa":C.blue):C.muted,fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:0.5,cursor:"pointer",transition:"all 0.15s",textAlign:"center"}}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button onClick={handleLog} disabled={!pitch||!result}
        style={{...logBtn(!pitch||!result?C.border:btnBg), opacity:!pitch||!result?0.4:1}}>
        {isAtBatOver?"✓ At-Bat Over":flashMsg==="✓ Logged"?"✓ Logged!":"Log Pitch"}
      </button>
      {/* Out of Zone toggle */}
      <div onClick={()=>setOutOfZone(v=>!v)}
        style={{...card, marginBottom:12, cursor:"pointer", borderColor:outOfZone?"#f59e0b":C.border, background:outOfZone?(C.isDark?"#f59e0b11":"#fffbeb"):C.card, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", transition:"all 0.2s"}}>
        <div>
          <div style={{fontFamily:"'Oswald',sans-serif", fontSize:13, color:outOfZone?"#f59e0b":C.muted, letterSpacing:1}}>Out of Zone</div>
          <div style={{fontSize:10, color:C.dim, marginTop:2}}>Pitch was outside the strike zone</div>
        </div>
        {/* Toggle switch */}
        <div style={{width:44, height:24, borderRadius:12, background:outOfZone?"#f59e0b":"#2d3748", position:"relative", transition:"background 0.2s", flexShrink:0}}>
          <div style={{position:"absolute", top:3, left:outOfZone?23:3, width:18, height:18, borderRadius:9, background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
        </div>
      </div>

      {lastEntry&&(
        <button onClick={handleUndo} style={{width:"100%",padding:"11px",background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:"pointer",marginTop:8}}>
          ↩ Undo Last Pitch
        </button>
      )}

      {/* Location — toggle below log button */}
      <div style={{marginTop:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:showZone?10:0}}>
          <span style={{fontSize:11,color:C.muted,fontFamily:"'Oswald',sans-serif",letterSpacing:1,textTransform:"uppercase"}}>Location</span>
          {/* Toggle switch */}
          <div onClick={()=>{setShowZone(v=>!v); if(showZone) setZone(null);}}
            style={{width:44,height:24,borderRadius:12,background:showZone?"#2563eb":"#2d3748",cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:showZone?23:3,width:18,height:18,borderRadius:9,background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
          </div>
        </div>
        {showZone&&(
          <div style={{...card,marginBottom:0,marginTop:0}}>
            <ZonePicker value={zone} onChange={setZone}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ── GAME VIEW ─────────────────────────────────────────────────────────────────
function GameView({ pitches, teams, selectedPitcherId, onSelectPitcher }) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  const [expandedCount,setExpandedCount]=useState(null);
  const pitcher = useMemo(()=>teams.flatMap(t=>t.pitchers).find(p=>p.id===selectedPitcherId),[teams,selectedPitcherId]);
  const pitcherPitches = useMemo(()=>selectedPitcherId?pitches.filter(p=>p.pitcherId===selectedPitcherId):[],[pitches,selectedPitcherId]);
  const overall  = useMemo(()=>calcOverall(pitcherPitches),  [pitcherPitches]);
  const byCount  = useMemo(()=>calcByCount(pitcherPitches),  [pitcherPitches]);
  const allPitchers = teams.flatMap(t=>t.pitchers.map(p=>({...p,teamName:t.name})));

  if(allPitchers.length===0) return (
    <div style={{padding:"14px 16px",textAlign:"center",paddingTop:56}}>
      <div style={{fontSize:40,marginBottom:14}}>⚾</div>
      <div style={{color:C.dim,fontSize:13}}>Add teams and pitchers in Setup first.</div>
    </div>
  );

  return (
    <div style={{padding:"14px 16px"}}>
      <div style={{marginBottom:14}}>
        {teams.filter(t=>t.pitchers.length>0).map(team=>(
          <div key={team.id} style={{marginBottom:10}}>
            <div style={{fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:1,marginBottom:6,paddingLeft:2}}>
              {team.name}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {[...(team.roster||team.pitchers||[])].sort((a,b)=>a.lastName?a.lastName.localeCompare(b.lastName||""):0).map(p=>{
                const isActive=selectedPitcherId===p.id;
                return (
                  <button key={p.id} onClick={()=>onSelectPitcher(p.id)}
                    style={{padding:"6px 14px",borderRadius:20,border:isActive?`1px solid ${C.blue}`:`1px solid ${C.border}`,background:isActive?C.blueDim:C.card2,color:isActive?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,cursor:"pointer"}}>
                    {p.number?`#${p.number} `:""}{p.lastName||p.name}{p.firstName?`, ${p.firstName}`:""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {!pitcher&&<div style={{color:C.dim,fontSize:13,textAlign:"center",paddingTop:24}}>Select a pitcher above.</div>}
      {pitcher&&pitcherPitches.length===0&&<div style={{color:C.dim,fontSize:13,textAlign:"center",paddingTop:24}}>No pitches logged for {pitcher.name} yet.</div>}
      {pitcher&&pitcherPitches.length>0&&(
        <>
          <div style={{background:C.blueDim+"22",border:`1px solid ${C.blueDim}`,borderRadius:8,padding:"8px 12px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:"#60a5fa"}}>{pitcher.name}</div><div style={{fontSize:11,color:C.muted}}>{pitcher.teamName}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:10,color:C.dim}}>PITCHES</div><div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,color:C.text}}>{overall.total}</div></div>
          </div>
          <div style={{...card,marginBottom:14}}>
            <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Overall Mix</div>
            <PitchBar pitchCounts={overall} total={overall.total} height={26}/>
            <MixBoxes overall={overall} size={20}/>
          </div>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>By Count — tap for breakdown</div>
          <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
            {PITCH_TYPES.map(p=><div key={p} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:8,height:8,borderRadius:2,background:PITCH_COLORS[p]}}/><span style={{fontSize:10,color:C.muted}}>{p}</span></div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
            {COUNTS.map(count=>{
              const data=byCount[count]||{total:0};
              const isOpen=expandedCount===count;
              const dom=data.total>0?PITCH_TYPES.reduce((a,b)=>(data[a]||0)>=(data[b]||0)?a:b):null;
              return (
                <div key={count} onClick={()=>setExpandedCount(isOpen?null:count)}
                  style={{background:isOpen?"#1e2d45":C.card,border:`1px solid ${isOpen?C.blue:C.border}`,borderRadius:8,padding:"8px 8px 6px",cursor:"pointer",transition:"all 0.15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                    <span style={{fontFamily:"'Oswald',sans-serif",fontSize:15,color:C.text}}>{count}</span>
                    <span style={{fontSize:9,color:C.dim}}>{COUNT_SHORT[count]}</span>
                  </div>
                  <PitchBar pitchCounts={data} total={data.total} height={13}/>
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                    {dom?<span style={{fontSize:10,color:PITCH_COLORS[dom],fontWeight:700}}>{dom} {pct(data[dom]||0,data.total)}%</span>:<span style={{fontSize:10,color:C.dim}}>—</span>}
                    <span style={{fontSize:9,color:C.dim}}>{data.total}p</span>
                  </div>
                  {isOpen&&data.total>0&&(
                    <div style={{marginTop:8,borderTop:`1px solid ${C.border}`,paddingTop:6}}>
                      {PITCH_TYPES.filter(p=>(data[p]||0)>0).map(p=>{
                        const pp=pct(data[p]||0,data.total),ov=pct(overall[p]||0,overall.total);
                        return (
                          <div key={p} style={{marginBottom:5}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                              <span style={{fontSize:10,color:PITCH_COLORS[p],fontWeight:700}}>{p}</span>
                              <span style={{fontSize:10}}><span style={{color:PITCH_COLORS[p]}}>{pp}%</span><span style={{color:C.dim}}> / {ov}% OV</span></span>
                            </div>
                            <div style={{height:5,background:C.border,borderRadius:2,overflow:"hidden"}}>
                              <div style={{width:`${pp}%`,height:"100%",background:PITCH_COLORS[p],borderRadius:2}}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── TENDENCIES — career vs this game ─────────────────────────────────────────
function Tendencies({ pitches, teams, games, activeGameId, seasons }) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  const allPitchers = teams.flatMap(t=>t.pitchers.map(p=>({...p,teamName:t.name})));
  const [viewPitcher, setViewPitcher] = useState("all");
  const [viewMode,    setViewMode]    = useState("game");
  const [viewGame,    setViewGame]    = useState(()=>activeGameId||"");
  const [viewBatter,  setViewBatter]  = useState("all");
  const [viewSeason,  setViewSeason]  = useState("all");

  // Keep viewGame in sync with active game when tab is first opened
  useEffect(()=>{ if(activeGameId&&!viewGame) setViewGame(activeGameId); },[activeGameId]);

  // career mode  → show all-time data only
  // game mode    → show selected game only
  // split mode   → show both side by side
  // Season-filtered teams
  const seasonTeams = viewSeason==="all" ? teams : teams.filter(t=>String(t.seasonId)===viewSeason);
  const basePitcherFilter = p => {
    if(viewPitcher!=="all"&&String(p.pitcherId)!==viewPitcher) return false;
    if(viewSeason!=="all"){
      const allPitchers=seasonTeams.flatMap(t=>(t.roster||t.pitchers||[]).map(pp=>pp.id));
      if(!allPitchers.some(id=>String(id)===String(p.pitcherId))) return false;
    }
    return true;
  };
  const baseBatterFilter  = p => viewBatter==="all"||p.batter===viewBatter;

  const careerPitches = useMemo(()=>
    viewMode==="game"
      ? []   // career col not shown in game-only mode
      : pitches.filter(basePitcherFilter).filter(baseBatterFilter),
  [pitches,viewPitcher,viewBatter,viewMode]);

  const thisGamePitches = useMemo(()=>
    (viewMode==="career"||!viewGame) ? [] :
    pitches.filter(basePitcherFilter)
           .filter(p=>String(p.gameId)===viewGame)
           .filter(baseBatterFilter),
  [pitches,viewPitcher,viewGame,viewBatter,viewMode]);

  // For display purposes, "all pitches" in game-only mode is thisGamePitches
  const displayPitches = viewMode==="game" ? thisGamePitches : careerPitches;

  const careerOverall     = useMemo(()=>calcOverall(careerPitches),         [careerPitches]);
  const careerByCount     = useMemo(()=>calcByCount(careerPitches),         [careerPitches]);
  const careerByResult    = useMemo(()=>calcResultsByPitch(careerPitches),  [careerPitches]);
  const gameOverall       = useMemo(()=>calcOverall(thisGamePitches),       [thisGamePitches]);
  const gameByCount       = useMemo(()=>calcByCount(thisGamePitches),       [thisGamePitches]);
  const gameByResult      = useMemo(()=>calcResultsByPitch(thisGamePitches),[thisGamePitches]);

  const pitcher    = allPitchers.find(p=>String(p.id)===viewPitcher);
  const activeGame = games.find(g=>String(g.id)===viewGame);
  const batters    = useMemo(()=>[...new Set(pitches.map(p=>p.batter).filter(b=>b&&b!=="—"))].sort(),[pitches]);
  const showSplit  = viewMode==="split" && thisGamePitches.length>0;
  const showGameOnly = viewMode==="game";

  return (
    <div style={{padding:"14px 16px"}}>
      {/* Filters */}
      <div style={{...card,marginBottom:14}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#60a5fa",letterSpacing:1,marginBottom:10,textTransform:"uppercase"}}>Filters</div>
        {seasons.length>0&&<div style={{marginBottom:8}}>
          <label style={lbl}>Season</label>
          <select value={viewSeason} onChange={e=>{setViewSeason(e.target.value);setViewPitcher("all");}} style={{...inp,cursor:"pointer",marginBottom:0}}>
            <option value="all">All Seasons</option>
            {[...seasons].reverse().map(s=><option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        </div>}
        <div style={{marginBottom:8}}>
          <label style={lbl}>Pitcher</label>
          <select value={viewPitcher} onChange={e=>setViewPitcher(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
            <option value="all">All Pitchers</option>
            {(viewSeason==="all"?teams:seasonTeams).map(t=>(
              <optgroup key={t.id} label={t.name}>
                {(t.roster||t.pitchers||[]).map(p=><option key={p.id} value={String(p.id)}>{p.lastName?`${p.lastName}${p.firstName?`, ${p.firstName}`:""}`:p.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{marginBottom:8}}>
          <label style={lbl}>View Mode</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:viewMode!=="career"?8:0}}>
            {[["career","Career"],["game","This Game"],["split","vs Career"]].map(([mode,label])=>(
              <button key={mode} onClick={()=>setViewMode(mode)}
                style={{padding:"8px 4px",background:viewMode===mode?C.blueDim:C.card2,border:`1px solid ${viewMode===mode?C.blue:C.border}`,borderRadius:6,color:viewMode===mode?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,cursor:"pointer",transition:"all 0.15s"}}>
                {label}
              </button>
            ))}
          </div>
          {viewMode!=="career"&&(
            <select value={viewGame} onChange={e=>setViewGame(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
              <option value="">— Select a game —</option>
              {[...games].reverse().map(g=><option key={g.id} value={String(g.id)}>{g.date} vs {g.opponent}</option>)}
            </select>
          )}
        </div>
        <div>
          <label style={lbl}>Batter</label>
          <select value={viewBatter} onChange={e=>setViewBatter(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
            <option value="all">All Batters</option>
            {batters.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {pitcher&&(
        <div style={{...card,borderColor:C.blueDim,background:C.blueDim+"22",marginBottom:14}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:"#60a5fa"}}>{pitcher.name}</div>
          <div style={{fontSize:12,color:C.muted}}>{pitcher.teamName}</div>
        </div>
      )}

      {displayPitches.length===0&&thisGamePitches.length===0&&<div style={{textAlign:"center",color:C.dim,fontSize:13,marginTop:24}}>No pitches match these filters.</div>}

      {(displayPitches.length>0||thisGamePitches.length>0)&&(
        <>
          {/* ── OVERALL MIX ── */}
          {showGameOnly ? (
            <div style={{...card,marginBottom:14,borderColor:C.amber}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:C.amber,letterSpacing:1}}>THIS GAME</span>
                <span style={{fontSize:11,color:C.muted}}>{thisGamePitches.length} pitches · {activeGame?.date}</span>
              </div>
              <PitchBar pitchCounts={gameOverall} total={gameOverall.total} height={22}/>
              <div style={{marginTop:10}}><MixBoxes overall={gameOverall} size={20}/></div>
            </div>
          ) : showSplit ? (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              {/* Career */}
              <div style={{...card,marginBottom:0,borderColor:C.border}}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Career</div>
                <div style={{fontSize:10,color:C.dim,marginBottom:6}}>{careerPitches.length}p</div>
                <PitchBar pitchCounts={careerOverall} total={careerOverall.total} height={16}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginTop:8}}>
                  {PITCH_TYPES.map(p=>{
                    const pp=pct(careerOverall[p]||0,careerOverall.total);
                    return <div key={p} style={{background:PITCH_COLORS[p]+"18",border:`1px solid ${PITCH_COLORS[p]}44`,borderRadius:5,padding:"5px 3px",textAlign:"center"}}><div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:PITCH_COLORS[p],lineHeight:1}}>{pp}%</div><div style={{fontSize:8,color:C.muted,marginTop:1}}>{p}</div></div>;
                  })}
                </div>
              </div>
              {/* This game */}
              <div style={{...card,marginBottom:0,borderColor:C.amber}}>
                <div style={{fontSize:10,color:C.amber,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>This Game</div>
                <div style={{fontSize:10,color:C.dim,marginBottom:6}}>{thisGamePitches.length}p · {activeGame?.date}</div>
                <PitchBar pitchCounts={gameOverall} total={gameOverall.total} height={16}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginTop:8}}>
                  {PITCH_TYPES.map(p=>{
                    const gp=pct(gameOverall[p]||0,gameOverall.total);
                    const cp=pct(careerOverall[p]||0,careerOverall.total);
                    const diff=gp-cp;
                    return (
                      <div key={p} style={{background:PITCH_COLORS[p]+"18",border:`1px solid ${PITCH_COLORS[p]}44`,borderRadius:5,padding:"5px 3px",textAlign:"center"}}>
                        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:PITCH_COLORS[p],lineHeight:1}}>{gp}%</div>
                        <div style={{fontSize:8,color:C.muted,marginTop:1}}>{p}</div>
                        {diff!==0&&<div style={{fontSize:8,color:diff>0?"#86efac":"#fca5a5",marginTop:1}}>{diff>0?"+":""}{diff}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div style={{...card,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#a0aec0",letterSpacing:1}}>CAREER MIX</span>
                <span style={{fontSize:11,color:C.muted}}>{careerPitches.length} pitches</span>
              </div>
              <PitchBar pitchCounts={careerOverall} total={careerOverall.total} height={22}/>
              <div style={{marginTop:10}}><MixBoxes overall={careerOverall} size={20}/></div>
            </div>
          )}

          {/* ── RESULT BREAKDOWNS ── */}
          {showGameOnly ? (
            thisGamePitches.length>0&&<div style={{...card,marginBottom:14,borderColor:C.amber}}><PitchResultBreakdown pitches={thisGamePitches} label="This Game Results" labelColor={C.amber}/></div>
          ) : showSplit ? (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              <div style={card}><PitchResultBreakdown pitches={careerPitches} label="Career Results" labelColor={C.muted}/></div>
              <div style={{...card,borderColor:C.amber}}><PitchResultBreakdown pitches={thisGamePitches} label="This Game Results" labelColor={C.amber}/></div>
            </div>
          ) : (
            careerPitches.length>0&&<div style={{...card,marginBottom:14}}><PitchResultBreakdown pitches={careerPitches}/></div>
          )}

          {/* ── BY COUNT ── */}
          <label style={lbl}>By Count{showSplit?" — Career / This Game":showGameOnly?" — This Game":""}</label>
          {COUNTS.map(count=>{
            const cd=showGameOnly?{total:0}:(careerByCount[count]||{total:0});
            const gd=gameByCount[count]||{total:0};
            const activeData=showGameOnly?gd:cd;
            return (
              <div key={count} style={card}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,alignItems:"center"}}>
                  <span style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:C.text,letterSpacing:1}}>{count}</span>
                  <span style={{fontSize:10,color:C.dim}}>{COUNT_FULL[count]}</span>
                  <span style={{fontSize:11,color:C.muted}}>
                    {showSplit?`${cd.total}p / ${gd.total}p`:showGameOnly?`${gd.total}p`:`${cd.total}p`}
                  </span>
                </div>

                {showSplit ? (
                  // Side-by-side bars
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                    <div>
                      <div style={{fontSize:9,color:C.muted,marginBottom:3,textTransform:"uppercase",letterSpacing:1}}>Career</div>
                      <PitchBar pitchCounts={cd} total={cd.total} height={14}/>
                      {cd.total>0&&PITCH_TYPES.filter(p=>(cd[p]||0)>0).map(p=>(
                        <div key={p} style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                          <span style={{fontSize:9,color:PITCH_COLORS[p],fontWeight:700}}>{p}</span>
                          <span style={{fontSize:9,color:C.muted}}>{pct(cd[p]||0,cd.total)}%</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{fontSize:9,color:C.amber,marginBottom:3,textTransform:"uppercase",letterSpacing:1}}>This Game</div>
                      <PitchBar pitchCounts={gd} total={gd.total} height={14}/>
                      {gd.total>0&&PITCH_TYPES.filter(p=>(gd[p]||0)>0).map(p=>{
                        const gpp=pct(gd[p]||0,gd.total), cpp=pct(cd[p]||0,cd.total), diff=gpp-cpp;
                        return (
                          <div key={p} style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                            <span style={{fontSize:9,color:PITCH_COLORS[p],fontWeight:700}}>{p}</span>
                            <span style={{fontSize:9}}>
                              <span style={{color:PITCH_COLORS[p]}}>{gpp}%</span>
                              {diff!==0&&<span style={{color:diff>0?"#86efac":"#fca5a5",marginLeft:3}}>{diff>0?"+":""}{diff}</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  activeData.total>0&&PITCH_TYPES.filter(p=>(activeData[p]||0)>0).map(p=>{
                    const pp=pct(activeData[p]||0,activeData.total), ov=pct(showGameOnly?(gameOverall[p]||0):(careerOverall[p]||0),showGameOnly?gameOverall.total:careerOverall.total);
                    return (
                      <div key={p} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{fontSize:11,color:PITCH_COLORS[p],fontWeight:700,minWidth:24}}>{p}</span>
                        <div style={{flex:1,height:6,background:C.border,borderRadius:3,overflow:"hidden"}}>
                          <div style={{width:`${pp}%`,height:"100%",background:PITCH_COLORS[p],borderRadius:3}}/>
                        </div>
                        <span style={{fontSize:11,color:PITCH_COLORS[p],minWidth:32,textAlign:"right",fontWeight:700}}>{pp}%</span>
                        {!showGameOnly&&<span style={{fontSize:10,color:C.dim,minWidth:44}}>/ {ov}% OV</span>}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
function Export({ pitches, teams, games, seasons }) {
  const C = useTheme();
  const {card,lbl,inp} = mkStyles(C);

  // All pitchers as flat list with team name
  const allPitchers = useMemo(()=>
    teams.flatMap(t=>(t.roster||t.pitchers||[]).map(p=>({...p,teamName:t.name}))),
  [teams]);

  // Step 1: pick a game
  const [viewSeason,     setViewSeason]     = useState("all");
  const [viewGame,       setViewGame]       = useState("all");
  const [selectedPIds,   setSelectedPIds]   = useState(new Set());
  const [copied,         setCopied]         = useState(false);

  // When game changes, reset pitcher selection
  const handleGameChange = (gid) => { setViewGame(gid); setSelectedPIds(new Set()); };

  // Pitchers who threw in the selected game
  const pitchersInGame = useMemo(()=>{
    const gamePitches = viewGame==="all" ? pitches : pitches.filter(p=>String(p.gameId)===viewGame);
    const ids = [...new Set(gamePitches.map(p=>p.pitcherId))];
    return ids.map(id=>allPitchers.find(p=>p.id===id)).filter(Boolean);
  },[pitches,viewGame,allPitchers]);

  // Toggle pitcher selection
  const togglePitcher = (id) => {
    setSelectedPIds(prev=>{
      const next=new Set(prev);
      next.has(id)?next.delete(id):next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedPIds(new Set(pitchersInGame.map(p=>p.id)));
  const clearAll  = () => setSelectedPIds(new Set());

  // Build report for each selected pitcher
  const gameObj = games.find(g=>String(g.id)===viewGame);
  const gameLabel = viewGame==="all"?"All Games (Career)"
    : gameObj?`${gameObj.date} vs ${gameObj.opponent}`:"";

  const buildPitcherReport = (pitcher) => {
    const filtered = pitches
      .filter(p=>p.pitcherId===pitcher.id)
      .filter(p=>viewGame==="all"||String(p.gameId)===viewGame);
    if(!filtered.length) return null;
    const overall  = calcOverall(filtered);
    const byCount  = calcByCount(filtered);
    const pitcherName = pitcher.lastName
      ? `${pitcher.lastName}${pitcher.firstName?`, ${pitcher.firstName}`:""}`
      : pitcher.name;
    let lines=[];
    lines.push(`${pitcherName.toUpperCase()} (${pitcher.teamName})`);
    lines.push(`${filtered.length} pitches`);
    lines.push("OVERALL MIX");
    PITCH_TYPES.forEach(p=>{if((overall[p]||0)>0)lines.push(`  ${PITCH_LABELS[p].padEnd(12)} ${pct(overall[p]||0,overall.total)}%  (${overall[p]} pitches)`);});
    lines.push("BY COUNT");
    COUNTS.forEach(count=>{
      const d=byCount[count]||{total:0}; if(!d.total) return;
      lines.push(`  ${count} (${COUNT_FULL[count]}) — ${d.total} pitches`);
      PITCH_TYPES.forEach(p=>{if((d[p]||0)>0)lines.push(`    ${PITCH_LABELS[p].padEnd(12)} ${pct(d[p]||0,d.total)}%  / ${pct(overall[p]||0,overall.total)}% OV`);});
    });
    return lines.join("\n");
  };

  const report = useMemo(()=>{
    if(!selectedPIds.size) return "";
    const selected = pitchersInGame.filter(p=>selectedPIds.has(p.id));
    let lines=[];
    lines.push(`PITCH SCOUT REPORT`);
    lines.push(`${gameLabel}`);
    lines.push("═".repeat(40));
    selected.forEach((pitcher,i)=>{
      const r=buildPitcherReport(pitcher);
      if(r){ if(i>0) lines.push(""); lines.push(r); lines.push("─".repeat(40)); }
    });
    lines.push(`Generated: ${new Date().toLocaleDateString()}`);
    return lines.join("\n");
  },[selectedPIds,pitchersInGame,viewGame,pitches]);

  const handleCopy=()=>{ navigator.clipboard.writeText(report).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}); };

  if(games.length===0&&pitches.length===0) return (
    <div style={{padding:"14px 16px",textAlign:"center",paddingTop:56,color:C.dim,fontSize:13}}>No game data to export yet.</div>
  );

  return (
    <div style={{padding:"14px 16px"}}>
      {/* Step 1: Game */}
      <div style={{...card,marginBottom:12}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#60a5fa",letterSpacing:1,marginBottom:10,textTransform:"uppercase"}}>1 · Select Game</div>
        {seasons.length>0&&<select value={viewSeason} onChange={e=>{setViewSeason(e.target.value);handleGameChange("all");}} style={{...inp,cursor:"pointer",marginBottom:8}}>
          <option value="all">All Seasons</option>
          {[...seasons].reverse().map(s=><option key={s.id} value={String(s.id)}>{s.name}</option>)}
        </select>}
        <select value={viewGame} onChange={e=>handleGameChange(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
          <option value="all">All Games (career)</option>
          {[...games].filter(g=>viewSeason==="all"||String(g.seasonId)===viewSeason).reverse().map(g=><option key={g.id} value={String(g.id)}>{g.date} vs {g.opponent}</option>)}
        </select>
      </div>

      {/* Step 2: Pitchers */}
      <div style={{...card,marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#60a5fa",letterSpacing:1,textTransform:"uppercase"}}>2 · Select Pitchers</div>
          {pitchersInGame.length>0&&(
            <div style={{display:"flex",gap:6}}>
              <button onClick={selectAll} style={{padding:"3px 8px",borderRadius:5,border:`1px solid ${C.blue}`,background:"transparent",color:C.blue,fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:1,cursor:"pointer"}}>All</button>
              <button onClick={clearAll}  style={{padding:"3px 8px",borderRadius:5,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:10,letterSpacing:1,cursor:"pointer"}}>None</button>
            </div>
          )}
        </div>
        {pitchersInGame.length===0
          ? <div style={{fontSize:12,color:C.dim}}>No pitches logged for this game yet.</div>
          : <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {pitchersInGame.map(p=>{
                const isSelected=selectedPIds.has(p.id);
                const name=p.lastName?`${p.lastName}${p.firstName?`, ${p.firstName}`:""}`:p.name;
                return (
                  <button key={p.id} onClick={()=>togglePitcher(p.id)}
                    style={{padding:"7px 14px",borderRadius:20,border:isSelected?`1px solid ${C.blue}`:`1px solid ${C.border}`,background:isSelected?C.blueDim:C.card2,color:isSelected?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>
                    {p.number?`#${p.number} `:""}{name}
                  </button>
                );
              })}
            </div>
        }
      </div>

      {/* Report */}
      {report?(
        <>
          <button onClick={handleCopy} style={{...logBtn(copied?C.green:C.blue),marginBottom:12}}>
            {copied?"✓ Copied!":"Copy Scouting Report"}
          </button>
          <div style={{...card,fontFamily:"'Courier New',monospace",fontSize:12,color:C.muted,whiteSpace:"pre-wrap",lineHeight:1.7,overflowX:"auto"}}>{report}</div>
        </>
      ) : selectedPIds.size>0
        ? <div style={{textAlign:"center",color:C.dim,fontSize:13,marginTop:16}}>No pitch data for selected pitcher(s) in this game.</div>
        : <div style={{textAlign:"center",color:C.dim,fontSize:13,marginTop:16}}>Select a game and pitcher(s) above to generate a report.</div>
      }
    </div>
  );
}

// ── BATTER CARD HELPERS (top-level so JSX parser handles them correctly) ────
const RESULT_CATS = ["Called Strike","Swinging Strike","Called Strikeout","Swinging Strikeout","Foul","Ball","Walk","In Play"];
const CAT_COLORS = {
  "Called Strike":"#ef4444","Swinging Strike":"#ef4444",
  "Called Strikeout":"#b91c1c","Swinging Strikeout":"#b91c1c",
  "Foul":"#eab308","Ball":"#22c55e","Walk":"#a78bfa","In Play":"#3b82f6",
};

function buildStats(ps) {
  const total = ps.length;
  const byPitch = {};
  PITCH_TYPES.forEach(pt=>{ byPitch[pt]={ total:0, "Called Strike":0, "Swinging Strike":0, "Called Strikeout":0, "Swinging Strikeout":0, Foul:0, Ball:0, Walk:0, "In Play":0, chase:0, outOfZone:0 }; });
  let totalOOZ=0, totalChase=0;
  ps.forEach(({pitch,result,outOfZone})=>{
    if(!byPitch[pitch]) return;
    byPitch[pitch].total++;
    const cat = resultCategory(result);
    if(cat==="Strike"){
      if(result==="Called Strike") byPitch[pitch]["Called Strike"]++;
      else byPitch[pitch]["Swinging Strike"]++;
    } else if(cat==="Strikeout"){
      if(result==="Called Strikeout") byPitch[pitch]["Called Strikeout"]++;
      else byPitch[pitch]["Swinging Strikeout"]++;
    } else if(cat==="In Play") byPitch[pitch]["In Play"]++;
    else if(cat==="Walk") byPitch[pitch]["Walk"]++;
    else if(cat==="Ball") byPitch[pitch]["Ball"]++;
    else if(cat==="Foul") byPitch[pitch]["Foul"]++;
    if(outOfZone){
      byPitch[pitch].outOfZone++;
      totalOOZ++;
      if(cat==="Strike"||cat==="Strikeout"||cat==="Foul"||cat==="In Play"){
        byPitch[pitch].chase++;
        totalChase++;
      }
    }
  });
  return {total, byPitch, totalOOZ, totalChase};
}

function BatterCard({name, ps, highlight}) {
  const C = useTheme();
  const {card} = mkStyles(C);
  const {total,byPitch,totalOOZ,totalChase} = buildStats(ps);
  if(total===0) return (
    <div style={{...card,borderColor:highlight?C.blue:C.border}}>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:highlight?"#60a5fa":C.text,marginBottom:4}}>{name}</div>
      <div style={{fontSize:12,color:C.dim}}>No pitches seen yet.</div>
    </div>
  );
  return (
    <div style={{...card,borderColor:highlight?C.blue:C.border,background:highlight?(C.isDark?C.blueDim+"22":"#eff6ff"):C.card}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,color:highlight?"#60a5fa":C.text}}>{name}</div>
        <div style={{fontSize:11,color:C.muted}}>{total} pitches</div>
      </div>
      {totalOOZ>0&&(()=>{
        const chaseRate = pct(totalChase, total); // chases vs ALL pitches seen
        const isHigh = chaseRate > 30;
        return (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,padding:"8px 12px",borderRadius:7,background:isHigh?(C.isDark?"#ef444411":"#fef2f2"):(C.isDark?"#22c55e11":"#f0fdf4"),border:`1px solid ${isHigh?"#ef4444":"#22c55e"}`}}>
            <div>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:10,color:isHigh?"#ef4444":"#22c55e",letterSpacing:1,textTransform:"uppercase",marginBottom:2}}>Chase Rate</div>
              <div style={{fontSize:10,color:C.dim}}>{totalChase} swings on OOZ / {total} total pitches</div>
            </div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,color:isHigh?"#ef4444":"#22c55e",lineHeight:1}}>{chaseRate}%</div>
          </div>
        );
      })()}
      <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:5,fontFamily:"'Oswald',sans-serif"}}>Overall Pitch Mix</div>
      <div style={{display:"flex",height:18,borderRadius:3,overflow:"hidden",gap:1,marginBottom:4}}>
        {PITCH_TYPES.map(pt=>{
          const pp=byPitch[pt].total/total; if(!pp) return null;
          return <div key={pt} style={{width:`${pp*100}%`,background:PITCH_COLORS[pt],display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:"#fff",overflow:"hidden"}}>{pp>0.12?`${Math.round(pp*100)}`:""}</div>;
        })}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
        {PITCH_TYPES.filter(pt=>byPitch[pt].total>0).map(pt=>(
          <span key={pt} style={{fontSize:10,color:PITCH_COLORS[pt],fontWeight:700}}>
            {PITCH_LABELS[pt]} {pct(byPitch[pt].total,total)}%
          </span>
        ))}
      </div>
      <div style={{height:1,background:C.border,marginBottom:10}}/>
      <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8,fontFamily:"'Oswald',sans-serif"}}>Results by Pitch Type</div>
      {PITCH_TYPES.filter(pt=>byPitch[pt].total>0).map(pt=>{
        const d=byPitch[pt];
        return (
          <div key={pt} style={{marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:10,height:10,borderRadius:2,background:PITCH_COLORS[pt],flexShrink:0}}/>
                <span style={{fontFamily:"'Oswald',sans-serif",fontSize:13,color:PITCH_COLORS[pt]}}>{PITCH_LABELS[pt]}</span>
              </div>
              <span style={{fontSize:11,color:C.muted}}>{pct(d.total,total)}% seen · {d.total}x</span>
            </div>
            <div style={{display:"flex",height:14,borderRadius:3,overflow:"hidden",gap:1,marginBottom:3}}>
              {RESULT_CATS.map(r=>{
                const count=d[r]||0; if(!count) return null;
                const rp=count/d.total;
                const col=r==="Called Strike"||r==="Swinging Strike"?"#ef4444":r==="Called Strikeout"||r==="Swinging Strikeout"?"#b91c1c":CAT_COLORS[r]||"#94a3b8";
                return <div key={r} style={{width:`${rp*100}%`,background:col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:700,color:"#fff",overflow:"hidden"}}>{rp>0.15?`${Math.round(rp*100)}`:""}</div>;
              })}
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {RESULT_CATS.filter(r=>(d[r]||0)>0).map(r=>{
                const col=r==="Called Strike"||r==="Swinging Strike"?"#ef4444":CAT_COLORS[r]||C.muted;
                const shortR=r==="Called Strike"?"CK":r==="Swinging Strike"?"SW":r==="Called Strikeout"?"CKO":r==="Swinging Strikeout"?"SWO":r==="In Play"?"IP":r==="Foul"?"FO":r==="Walk"?"BB":r==="Ball"?"BA":r;
                return <span key={r} style={{fontSize:9,color:col,fontWeight:700}}>{shortR} {pct(d[r]||0,d.total)}%</span>;
              })}
            </div>
            {d.outOfZone>0&&(
              <div style={{fontSize:9,color:"#f59e0b",marginTop:3,fontWeight:700}}>
                Chase: {d.chase}/{d.total} pitches ({pct(d.chase,d.total)}%)
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── HITTING TAB ──────────────────────────────────────────────────────────────
function HittingTab({ pitches, games, lineup, activeGameId, currentBatter, myTeamId, teams }) {
  const C = useTheme();
  const {card,lbl,inp} = mkStyles(C);
  const [hittingTab, setHittingTab] = useState("active");
  const [selectedGame, setSelectedGame] = useState(activeGameId||"all");
  const [selectedBatter, setSelectedBatter] = useState(currentBatter||"");

  // Keep selectedGame in sync when activeGameId changes
  useEffect(()=>{ if(activeGameId) setSelectedGame(activeGameId); },[activeGameId]);
  useEffect(()=>{ if(currentBatter) setSelectedBatter(currentBatter); },[currentBatter]);

  const activeGame = games.find(g=>g.id===activeGameId||g.id===Number(activeGameId));

  // My team roster names for filtering
  const myTeam = myTeamId ? teams.find(t=>String(t.id)===String(myTeamId)) : null;
  const myRosterNames = useMemo(()=>{
    if(!myTeam) return null; // null = no filter, show all
    const r=myTeam.roster||[];
    return new Set(r.map(p=>p.lastName+(p.firstName?`, ${p.firstName}`:"")));
  },[myTeam]);

  // Filter pitches to selected game + my team batters only
  const gamePitches = useMemo(()=>{
    const byGame = selectedGame==="all" ? pitches : pitches.filter(p=>String(p.gameId)===String(selectedGame));
    if(!myRosterNames) return byGame;
    return byGame.filter(p=>myRosterNames.has(p.batter));
  },[pitches,selectedGame,myRosterNames]);

  // All batters who have faced pitches — ordered by lineup if available
  const allBatters = useMemo(()=>{
    const seen=[...new Set(gamePitches.map(p=>p.batter).filter(b=>b&&b!=="—"))];
    if(lineup.length>0){
      const lineupOrder=lineup.map(p=>p.name);
      return [...seen].sort((a,b)=>{
        const ai=lineupOrder.indexOf(a), bi=lineupOrder.indexOf(b);
        if(ai===-1&&bi===-1) return a.localeCompare(b);
        if(ai===-1) return 1; if(bi===-1) return -1;
        return ai-bi;
      });
    }
    return seen.sort();
  },[gamePitches,lineup]);

  // Build stats for a set of pitches (from one batter's perspective)
  const gameLabel = (g) => g ? `${g.date} vs ${g.opponent}` : "";

  return (
    <div style={{padding:"14px 16px"}}>
      {/* Game selector */}
      <div style={{marginBottom:14}}>
        <label style={lbl}>Game</label>
        <select value={selectedGame} onChange={e=>setSelectedGame(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
          <option value="all">All Games</option>
          {[...games].reverse().map(g=><option key={g.id} value={String(g.id)}>{gameLabel(g)}</option>)}
        </select>
      </div>

      {/* Sub-tabs */}
      <div style={{display:"flex",gap:0,marginBottom:14,borderRadius:8,overflow:"hidden",border:`1px solid ${C.border}`}}>
        {[["active","Active"],["individual","Individual"],["team","Team"]].map(([t,l])=>(
          <button key={t} onClick={()=>setHittingTab(t)}
            style={{flex:1,padding:"10px 4px",background:hittingTab===t?C.blueDim:C.card2,border:"none",color:hittingTab===t?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,textTransform:"uppercase",cursor:"pointer"}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── ACTIVE BATTER ── */}
      {hittingTab==="active"&&(
        currentBatter&&currentBatter!=="—"
          ? <BatterCard
              name={`${currentBatter} — At Bat`}
              ps={gamePitches.filter(p=>p.batter===currentBatter)}
              highlight={true}
            />
          : <div style={{...card,textAlign:"center",padding:"24px 14px"}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,color:C.muted,letterSpacing:1}}>No Active Batter</div>
              <div style={{fontSize:11,color:C.dim,marginTop:4}}>Batter will appear here once selected in Log.</div>
            </div>
      )}

      {/* ── INDIVIDUAL ── */}
      {hittingTab==="individual"&&(
        <>
          <div style={{marginBottom:12}}>
            <label style={lbl}>Select Batter</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {(allBatters.length>0?allBatters:lineup.map(p=>p.name).filter(Boolean)).map(name=>(
                <button key={name} onClick={()=>setSelectedBatter(name)}
                  style={{padding:"6px 14px",borderRadius:20,border:selectedBatter===name?`1px solid ${C.blue}`:`1px solid ${C.border}`,background:selectedBatter===name?C.blueDim:C.card2,color:selectedBatter===name?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,cursor:"pointer"}}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          {selectedBatter
            ? <BatterCard name={selectedBatter} ps={gamePitches.filter(p=>p.batter===selectedBatter)} highlight={false}/>
            : <div style={{...card,textAlign:"center",padding:"20px",color:C.dim,fontSize:12}}>Select a batter above.</div>
          }
        </>
      )}

      {/* ── TEAM ── */}
      {hittingTab==="team"&&(
        allBatters.length===0
          ? <div style={{...card,textAlign:"center",padding:"24px 14px"}}>
              <div style={{fontFamily:"'Oswald',sans-serif",fontSize:15,color:C.muted,letterSpacing:1}}>No Data Yet</div>
              <div style={{fontSize:11,color:C.dim,marginTop:4}}>Pitch data will appear here once the game is underway.</div>
            </div>
          : (()=>{
              const teamPs = gamePitches.filter(p=>p.batter&&p.batter!=="—");
              const totalPitches = teamPs.length;
              // Called strikes by pitch type
              const calledByPitch = {};
              PITCH_TYPES.forEach(pt=>{ calledByPitch[pt]={called:0,strikeout:0,total:0}; });
              teamPs.forEach(({pitch,result})=>{
                if(calledByPitch[pitch]){
                  calledByPitch[pitch].total++;
                  if(result==="Called Strike") calledByPitch[pitch].called++;
                  if(result==="Called Strikeout"||result==="Swinging Strikeout") calledByPitch[pitch].strikeout++;
                }
              });
              return (
                <>
                  {/* Called strikes summary card — 4 boxes */}
                  <div style={{...card,marginBottom:10}}>
                    <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:10,fontFamily:"'Oswald',sans-serif"}}>
                      Called Strikes (CK) &amp; Strikeouts (KO) by Pitch Type
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                      {PITCH_TYPES.map(pt=>{
                        const {called,total:ptTotal}=calledByPitch[pt];
                        const calledPct=ptTotal>0?pct(called,ptTotal):0;
                        return (
                          <div key={pt} style={{background:PITCH_COLORS[pt]+"18",border:`1px solid ${PITCH_COLORS[pt]}44`,borderRadius:8,padding:"10px 6px",textAlign:"center"}}>
                            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:28,color:PITCH_COLORS[pt],lineHeight:1}}>{called}</div>
                            <div style={{fontSize:9,color:C.muted,margin:"2px 0 1px",fontFamily:"'Oswald',sans-serif",letterSpacing:0.5}}>{PITCH_LABELS[pt]}</div>
                            <div style={{fontSize:8,color:C.dim,marginBottom:4}}>CK · {calledPct}%</div>
                            <div style={{height:1,background:PITCH_COLORS[pt]+"33",marginBottom:4}}/>
                            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:20,color:"#b91c1c",lineHeight:1}}>{calledByPitch[pt].strikeout}</div>
                            <div style={{fontSize:8,color:C.dim,marginTop:2}}>KO · {pct(calledByPitch[pt].strikeout,ptTotal)}%</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Team overall BatterCard */}
                  <BatterCard name="Full Lineup" ps={teamPs} highlight={false}/>
                  {/* Each batter */}
                  <label style={{...lbl,marginTop:8}}>By Batter</label>
                  {allBatters.map(name=>(
                    <BatterCard key={name} name={name} ps={gamePitches.filter(p=>p.batter===name)} highlight={name===currentBatter}/>
                  ))}
                </>
              );
            })()
      )}
    </div>
  );
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
function History({ pitches, onDelete, onClearAll }) {
  const C = useTheme();
  const {card,lbl,inp,pill,cBtn} = mkStyles(C);
  const [confirmClear,setConfirmClear]=useState(false);
  if(pitches.length===0) return <div style={{padding:"14px 16px",textAlign:"center",paddingTop:56,color:C.dim,fontSize:13}}>No pitches logged yet.</div>;
  return (
    <div style={{padding:"14px 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <span style={{fontSize:11,color:C.dim}}>{pitches.length} pitches · saved locally</span>
        {!confirmClear
          ?<button onClick={()=>setConfirmClear(true)} style={{padding:"5px 10px",borderRadius:6,border:"1px solid #ef4444",background:"transparent",color:"#ef4444",fontFamily:"'Oswald',sans-serif",fontSize:11,cursor:"pointer"}}>Clear All</button>
          :<div style={{display:"flex",gap:6}}>
            <button onClick={()=>{onClearAll();setConfirmClear(false);}} style={{padding:"5px 10px",borderRadius:6,border:"none",background:"#ef4444",color:"#fff",fontFamily:"'Oswald',sans-serif",fontSize:11,cursor:"pointer"}}>Confirm</button>
            <button onClick={()=>setConfirmClear(false)} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${C.muted}`,background:"transparent",color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:11,cursor:"pointer"}}>Cancel</button>
          </div>
        }
      </div>
      {[...pitches].reverse().slice(0,100).map(entry=>(
        <div key={entry.id} style={{...card,display:"flex",alignItems:"center",gap:10,padding:"9px 12px"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              <span style={badge(PITCH_COLORS[entry.pitch])}>{entry.pitch}</span>
              <span style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:C.text}}>{entry.count}</span>
              <span style={{fontSize:11,color:C.muted}}>{entry.result}</span>
              {entry.zone&&<span style={{fontSize:10,color:C.dim}}>Z{entry.zone}</span>}
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>{entry.pitcherName} · {entry.pitcherTeam}</div>
            {entry.batter&&entry.batter!=="—"&&<div style={{fontSize:10,color:C.dim}}>vs {entry.batter}</div>}
          </div>
          <button onClick={()=>onDelete(entry.id)} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:18,padding:"0 4px",lineHeight:1}}>×</button>
        </div>
      ))}
    </div>
  );
}

// ── TEAM JOIN / CREATE SCREEN ────────────────────────────────────────────────
function TeamCodeScreen({ onJoin }) {
  const C = useTheme();
  const {card,lbl,inp} = mkStyles(C);
  const [mode,    setMode]    = useState("join"); // "join" | "create"
  const [code,    setCode]    = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const handleCreate = async () => {
    setLoading(true); setError("");
    const newCode = genCode();
    const initial = { teams:[], pitches:[], games:[], lineup:[], activeGameId:null, selectedPitcherId:null, currentBatter:"", currentCount:"0-0", myTeamId:null };
    await setDoc(doc(db,"teams",newCode), initial);
    save("ps_teamCode", newCode);
    onJoin(newCode, initial);
  };

  const handleJoin = async () => {
    const c = code.trim().toUpperCase();
    if(c.length < 4) { setError("Enter a valid team code."); return; }
    setLoading(true); setError("");
    const snap = await getDoc(doc(db,"teams",c));
    if(!snap.exists()) { setError("Team code not found. Check and try again."); setLoading(false); return; }
    save("ps_teamCode", c);
    onJoin(c, snap.data());
  };

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Inter:wght@400;500&display=swap" rel="stylesheet"/>
      <div style={{fontSize:48,marginBottom:12}}>⚾</div>
      <div style={{fontFamily:"'Oswald',sans-serif",fontSize:26,letterSpacing:2,color:"#60a5fa",textTransform:"uppercase",marginBottom:4}}>Pitch Scout</div>
      <div style={{fontSize:12,color:C.muted,marginBottom:32,letterSpacing:1}}>Opposing Pitcher Tendencies</div>

      <div style={{width:"100%",maxWidth:360}}>
        {/* Mode toggle */}
        <div style={{display:"flex",gap:0,marginBottom:20,borderRadius:8,overflow:"hidden",border:`1px solid ${C.border}`}}>
          {[["join","Join Team"],["create","Create Team"]].map(([m,l])=>(
            <button key={m} onClick={()=>{setMode(m);setError("");}}
              style={{flex:1,padding:"12px 4px",background:mode===m?C.blueDim:C.card2,border:"none",color:mode===m?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,textTransform:"uppercase",cursor:"pointer"}}>
              {l}
            </button>
          ))}
        </div>

        {mode==="join" && (
          <div style={card}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#60a5fa",letterSpacing:1,marginBottom:12,textTransform:"uppercase"}}>Enter Team Code</div>
            <input style={{...inp,fontSize:22,textAlign:"center",letterSpacing:4,fontFamily:"'Oswald',sans-serif",textTransform:"uppercase",marginBottom:12}}
              placeholder="ABC123" maxLength={6} value={code}
              onChange={e=>setCode(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==="Enter"&&handleJoin()}/>
            {error&&<div style={{fontSize:12,color:"#ef4444",marginBottom:8,textAlign:"center"}}>{error}</div>}
            <button onClick={handleJoin} disabled={loading}
              style={{width:"100%",padding:"13px",background:loading?C.card2:C.blue,border:"none",borderRadius:7,color:loading?C.dim:"#fff",fontFamily:"'Oswald',sans-serif",fontSize:14,letterSpacing:2,textTransform:"uppercase",cursor:loading?"default":"pointer"}}>
              {loading?"Joining…":"Join Team"}
            </button>
          </div>
        )}

        {mode==="create" && (
          <div style={card}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#60a5fa",letterSpacing:1,marginBottom:8,textTransform:"uppercase"}}>Create a New Team</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:16,lineHeight:1.5}}>
              A unique 6-character code will be generated. Share it with your coaches so they can join and see the same data in real time.
            </div>
            {error&&<div style={{fontSize:12,color:"#ef4444",marginBottom:8,textAlign:"center"}}>{error}</div>}
            <button onClick={handleCreate} disabled={loading}
              style={{width:"100%",padding:"13px",background:loading?C.card2:C.green,border:"none",borderRadius:7,color:loading?C.dim:"#fff",fontFamily:"'Oswald',sans-serif",fontSize:14,letterSpacing:2,textTransform:"uppercase",cursor:loading?"default":"pointer"}}>
              {loading?"Creating…":"Create Team"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [darkMode,  setDarkMode]  = useState(()=>load("ps_darkmode",false));
  const [teamCode,  setTeamCode]  = useState(()=>load("ps_teamCode",null));
  const [syncing,   setSyncing]   = useState(false);
  const theme = darkMode ? DARK : LIGHT;
  useEffect(()=>save("ps_darkmode",darkMode),[darkMode]);

  // ── Shared state (synced via Firestore) ──────────────────────────────────
  const [seasons,          setSeasonsRaw]      = useState(()=>load("ps_seasons",[]));
  const [teams,            setTeamsRaw]        = useState(()=>load("ps_teams",[]));
  const [pitches,          setPitchesRaw]      = useState(()=>load("ps_pitches",[]));
  const [games,            setGamesRaw]        = useState(()=>load("ps_games",[]));
  const [lineup,           setLineupRaw]       = useState(()=>load("ps_lineup",[]));
  const [activeGameId,     setActiveGameIdRaw] = useState(()=>load("ps_activeGame",null));
  const [selectedPitcherId,setSelectedPRaw]   = useState(()=>load("ps_selPitcher",null));
  const [currentBatter,    setCurrentBatterRaw]= useState(()=>load("ps_batter",""));
  const [currentCount,     setCurrentCountRaw] = useState(()=>load("ps_count","0-0"));
  const [myTeamId,         setMyTeamIdRaw]     = useState(()=>load("ps_myTeam",null));
  const [tab,              setTab]             = useState("setup");

  // Debounce ref — avoid writing on every keystroke
  const pushTimer = useRef(null);
  const stateRef  = useRef({});

  // Always keep stateRef current
  stateRef.current = { seasons, teams, pitches, games, lineup, activeGameId, selectedPitcherId, currentBatter, currentCount, myTeamId };

  // Push to Firestore (debounced 800ms)
  const schedulePush = useCallback(() => {
    if(!teamCode) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(()=>{
      pushToFirestore(teamCode, stateRef.current);
    }, 800);
  }, [teamCode]);

  // Wrapped setters that also update localStorage + schedule Firestore push
  const mk = (setter, lsKey) => (val) => {
    const v = typeof val === "function" ? val(stateRef.current[lsKey.replace("ps_","").replace("Game","GameId")] ?? []) : val;
    setter(v); save(lsKey, v); schedulePush();
  };

  const setSeasons      = (v) => { const r=typeof v==="function"?v(seasons):v;      setSeasonsRaw(r);      save("ps_seasons",r);      schedulePush(); };
  const setTeams        = (v) => { const r=typeof v==="function"?v(teams):v;        setTeamsRaw(r);        save("ps_teams",r);        schedulePush(); };
  const setPitches      = (v) => { const r=typeof v==="function"?v(pitches):v;      setPitchesRaw(r);      save("ps_pitches",r);      schedulePush(); };
  const setGames        = (v) => { const r=typeof v==="function"?v(games):v;        setGamesRaw(r);        save("ps_games",r);        schedulePush(); };
  const setLineup       = (v) => { const r=typeof v==="function"?v(lineup):v;       setLineupRaw(r);       save("ps_lineup",r);       schedulePush(); };
  const setActiveGameId = (v) => { const r=typeof v==="function"?v(activeGameId):v; setActiveGameIdRaw(r); save("ps_activeGame",r);   schedulePush(); };
  const setSelectedPitcher=(v)=> { const r=typeof v==="function"?v(selectedPitcherId):v; setSelectedPRaw(r); save("ps_selPitcher",r); schedulePush(); };
  const setCurrentBatter= (v) => { const r=typeof v==="function"?v(currentBatter):v; setCurrentBatterRaw(r); save("ps_batter",r);   schedulePush(); };
  const setCurrentCount = (v) => { const r=typeof v==="function"?v(currentCount):v;  setCurrentCountRaw(r);  save("ps_count",r);    schedulePush(); };
  const setMyTeamId     = (v) => { const r=typeof v==="function"?v(myTeamId):v;      setMyTeamIdRaw(r);      save("ps_myTeam",r);   schedulePush(); };

  // ── Subscribe to Firestore real-time updates ─────────────────────────────
  useEffect(()=>{
    if(!teamCode) return;
    setSyncing(true);
    const unsub = onSnapshot(doc(db,"teams",teamCode), (snap)=>{
      if(!snap.exists()) return;
      const d = snap.data();
      // Update state from Firestore (other coaches' changes)
      if(d.seasons)          { setSeasonsRaw(d.seasons);             save("ps_seasons",d.seasons); }
      if(d.teams)            { setTeamsRaw(d.teams);               save("ps_teams",d.teams); }
      if(d.pitches)          { setPitchesRaw(d.pitches);           save("ps_pitches",d.pitches); }
      if(d.games)            { setGamesRaw(d.games);               save("ps_games",d.games); }
      if(d.lineup)           { setLineupRaw(d.lineup);             save("ps_lineup",d.lineup); }
      if(d.activeGameId!==undefined) { setActiveGameIdRaw(d.activeGameId); save("ps_activeGame",d.activeGameId); }
      if(d.selectedPitcherId!==undefined){ setSelectedPRaw(d.selectedPitcherId); save("ps_selPitcher",d.selectedPitcherId); }
      if(d.currentBatter!==undefined){ setCurrentBatterRaw(d.currentBatter); save("ps_batter",d.currentBatter); }
      if(d.currentCount!==undefined){ setCurrentCountRaw(d.currentCount); save("ps_count",d.currentCount); }
      if(d.myTeamId!==undefined){ setMyTeamIdRaw(d.myTeamId); save("ps_myTeam",d.myTeamId); }
      setSyncing(false);
    }, (err)=>{ console.error("Firestore listen:",err); setSyncing(false); });
    return ()=>unsub();
  },[teamCode]);

  // ── Join handler ─────────────────────────────────────────────────────────
  const handleJoin = (code, data) => {
    setTeamCode(code);
    if(data.seasons)           setSeasonsRaw(data.seasons);
    if(data.teams)             setTeamsRaw(data.teams);
    if(data.pitches)           setPitchesRaw(data.pitches);
    if(data.games)             setGamesRaw(data.games);
    if(data.lineup)            setLineupRaw(data.lineup);
    if(data.activeGameId!==undefined) setActiveGameIdRaw(data.activeGameId);
    if(data.selectedPitcherId!==undefined) setSelectedPRaw(data.selectedPitcherId);
    if(data.currentBatter!==undefined) setCurrentBatterRaw(data.currentBatter);
    if(data.currentCount!==undefined)  setCurrentCountRaw(data.currentCount);
    if(data.myTeamId!==undefined)      setMyTeamIdRaw(data.myTeamId);
  };

  const handleLeaveTeam = () => {
    localStorage.removeItem("ps_teamCode");
    setTeamCode(null);
  };

  // ── Gate on team code ─────────────────────────────────────────────────────
  if(!teamCode) return (
    <ThemeCtx.Provider value={theme}>
      <TeamCodeScreen onJoin={handleJoin}/>
    </ThemeCtx.Provider>
  );

  const TABS=[
    {id:"setup",   label:"Games"},
    {id:"log",     label:"Log"},
    {id:"trends",  label:"Trends"},
    {id:"hitting", label:"Hitting"},
    {id:"export",  label:"Export"},
    {id:"history", label:"History"},
    {id:"game",    label:"Scout"},
    {id:"teams",   label:"Teams"},
  ];

  return (
    <ThemeCtx.Provider value={theme}>
    <div style={{minHeight:"100vh",background:theme.bg,color:theme.text,fontFamily:"'Inter',sans-serif",paddingBottom:80}}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Inter:wght@400;500&display=swap" rel="stylesheet"/>
      <div style={{background:theme.headerBg,borderBottom:`2px solid ${theme.headerBorder}`,padding:"14px 16px 10px",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:19,letterSpacing:2,color:"#60a5fa",textTransform:"uppercase",margin:0}}>⚾ Pitch Scout</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:1}}>
              <div style={{fontSize:11,color:theme.isDark?"#4a5568":"#bfdbfe",letterSpacing:1}}>
                Team: <span style={{color:"#60a5fa",fontFamily:"'Oswald',sans-serif",letterSpacing:2}}>{teamCode}</span>
              </div>
              {syncing&&<div style={{fontSize:9,color:theme.muted}}>↻ syncing</div>}
              <button onClick={handleLeaveTeam} style={{background:"none",border:"none",fontSize:9,color:theme.dim,cursor:"pointer",padding:0,letterSpacing:1}}>leave</button>
            </div>
          </div>
          <div onClick={()=>setDarkMode(v=>!v)}
            style={{width:44,height:24,borderRadius:12,background:darkMode?"#2d3748":"#bfdbfe",cursor:"pointer",position:"relative",transition:"background 0.3s",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:darkMode?23:3,width:18,height:18,borderRadius:9,background:darkMode?"#e2e8f0":"#1e40af",transition:"left 0.3s",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10}}>
              {darkMode?"🌙":"☀️"}
            </div>
          </div>
        </div>
      </div>
      <div style={{display:"flex",borderBottom:`1px solid ${theme.border}`,background:theme.card,position:"sticky",top:58,zIndex:99,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{flex:"0 0 auto",padding:"11px 10px",background:"none",border:"none",borderBottom:tab===t.id?`2px solid ${theme.blue}`:"2px solid transparent",color:tab===t.id?theme.blue:theme.dim,fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,textTransform:"uppercase",cursor:"pointer",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>
      {tab==="game"    && <GameView    pitches={pitches} teams={teams} selectedPitcherId={selectedPitcherId} onSelectPitcher={setSelectedPitcher}/>}
      {tab==="teams"   && <TeamsTab    teams={teams} onSaveTeams={setTeams} selectedPitcherId={selectedPitcherId} onSelectPitcher={setSelectedPitcher} myTeamId={myTeamId} onSetMyTeam={setMyTeamId} seasons={seasons} onSaveSeasons={setSeasons}/>}
      {tab==="setup"   && <Setup       teams={teams} onSaveTeams={setTeams} selectedPitcherId={selectedPitcherId} onSelectPitcher={setSelectedPitcher} lineup={lineup} onSaveLineup={setLineup} games={games} onAddGame={g=>setGames(prev=>[...prev,g])} onDeleteGame={id=>{setGames(prev=>prev.filter(g=>g.id!==id)); setPitches(prev=>prev.filter(p=>String(p.gameId)!==String(id)));}} activeGameId={activeGameId} onSetActiveGame={setActiveGameId} myTeamId={myTeamId} onGameStart={()=>{ setCurrentCount("0-0"); setCurrentBatter(""); setTab("log"); }}/>}
      {tab==="log"     && <LogPitch    teams={teams} selectedPitcherId={selectedPitcherId} onSelectPitcher={setSelectedPitcher} pitches={pitches} onLog={e=>setPitches(prev=>[...prev,e])} onUndo={id=>setPitches(prev=>prev.filter(p=>p.id!==id))} lineup={lineup} games={games} selectedGame={activeGameId} onSelectGame={setActiveGameId} currentBatter={currentBatter} onBatterChange={setCurrentBatter} currentCount={currentCount} onCountChange={setCurrentCount}/>}
      {tab==="hitting"  && <HittingTab  pitches={pitches} games={games} lineup={lineup} activeGameId={activeGameId} currentBatter={currentBatter} myTeamId={myTeamId} teams={teams}/>}
      {tab==="trends"  && <Tendencies  pitches={pitches} teams={teams} games={games} activeGameId={activeGameId} seasons={seasons}/>}
      {tab==="export"  && <Export      pitches={pitches} teams={teams} games={games} seasons={seasons}/>}
      {tab==="history" && <History     pitches={pitches} onDelete={id=>setPitches(prev=>prev.filter(p=>p.id!==id))} onClearAll={()=>{setPitches([]);setTeams([]);setSelectedPitcher(null);setGames([]);setActiveGameId(null);}}/>}
    </div>
    </ThemeCtx.Provider>
  );
}
