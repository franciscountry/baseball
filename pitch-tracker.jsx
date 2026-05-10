import { useState, useMemo, useEffect } from "react";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const PITCH_TYPES  = ["FB","CB","SL","CH"];
const PITCH_LABELS = { FB:"Fastball", CB:"Curveball", SL:"Slider", CH:"Changeup" };
const PITCH_COLORS = { FB:"#ef4444",  CB:"#3b82f6",   SL:"#f59e0b", CH:"#22c55e" };

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

const RESULTS = ["Strike","Ball","Foul","In Play"];

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

// ── COUNT LOGIC ───────────────────────────────────────────────────────────────
function advanceCount(count, result) {
  const [b,s] = count.split("-").map(Number);
  if (result==="Ball")    { if(b>=3) return {next:"0-0",atBatOver:true,reason:"Walk"};      return {next:`${b+1}-${s}`,atBatOver:false}; }
  if (result==="Strike")  { if(s>=2) return {next:"0-0",atBatOver:true,reason:"Strikeout"}; return {next:`${b}-${s+1}`,atBatOver:false}; }
  if (result==="Foul")    { if(s>=2) return {next:count,atBatOver:false};                   return {next:`${b}-${s+1}`,atBatOver:false}; }
  if (result==="In Play")            return {next:"0-0",atBatOver:true,reason:"In Play"};
  return {next:count,atBatOver:false};
}

// ── PERSISTENCE ───────────────────────────────────────────────────────────────
function load(key,fb){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):fb; }catch{return fb;} }
function save(key,v) { try{ localStorage.setItem(key,JSON.stringify(v)); }catch{} }

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
function calcResultsByPitch(pitches) {
  const map={};
  PITCH_TYPES.forEach(p=>{ map[p]={total:0}; ["Strike","Ball","Foul","In Play"].forEach(r=>(map[p][r]=0)); });
  pitches.forEach(({pitch,result})=>{
    if(map[pitch]&&result){ map[pitch][result]=(map[pitch][result]||0)+1; map[pitch].total++; }
  });
  return map;
}

// ── STYLE TOKENS ──────────────────────────────────────────────────────────────
const C = {
  bg:"#0d1117", card:"#161b27", card2:"#1a1f2e", border:"#2d3748",
  text:"#e2e8f0", muted:"#718096", dim:"#4a5568",
  blue:"#3b82f6", blueDim:"#1e3a5f", green:"#16a34a", amber:"#f59e0b",
};
const card  = {background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"12px 14px", marginBottom:10};
const lbl   = {fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:6, display:"block"};
const inp   = {width:"100%", background:C.card2, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, padding:"10px 12px", fontSize:14, fontFamily:"'Inter',sans-serif", boxSizing:"border-box", outline:"none"};
const pill  = (color,active) => ({padding:"8px 10px", borderRadius:6, border:active?`1px solid ${color}`:`1px solid ${C.border}`, background:active?color+"22":C.card2, color:active?color:C.muted, fontFamily:"'Oswald',sans-serif", fontSize:13, letterSpacing:1, cursor:"pointer", transition:"all 0.15s", fontWeight:active?700:400});
const cBtn  = (active) => ({padding:"10px 4px", background:active?"#1e40af":C.card2, border:active?`1px solid ${C.blue}`:`1px solid ${C.border}`, borderRadius:6, color:active?"#93c5fd":C.muted, fontFamily:"'Oswald',sans-serif", fontSize:15, letterSpacing:1, cursor:"pointer", transition:"all 0.15s", fontWeight:active?700:400});
const logBtn= (bg) => ({width:"100%", padding:"14px", background:bg, border:"none", borderRadius:8, color:"#fff", fontFamily:"'Oswald',sans-serif", fontSize:15, letterSpacing:2, textTransform:"uppercase", cursor:"pointer", transition:"background 0.2s", marginTop:4});
const badge = (color) => ({display:"inline-block", padding:"2px 7px", borderRadius:4, background:color+"22", color, fontSize:11, fontWeight:700, fontFamily:"'Oswald',sans-serif", letterSpacing:1});

// ── PITCH BAR ─────────────────────────────────────────────────────────────────
function PitchBar({pitchCounts,total,height=20}) {
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
const RESULT_COLORS = { Strike:"#22c55e", Ball:"#ef4444", Foul:"#f59e0b", "In Play":"#3b82f6" };

function PitchResultBreakdown({pitches, label, labelColor}) {
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
                    return <div key={r} style={{width:`${rp*100}%`,background:RESULT_COLORS[r],display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:"#fff",overflow:"hidden"}}>{rp>0.12?`${Math.round(rp*100)}`:""}</div>;
                  })}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Strike","Ball","Foul","In Play"].filter(r=>(rd[r]||0)>0).map(r=>(
                    <span key={r} style={{fontSize:10,color:RESULT_COLORS[r],fontWeight:600}}>
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

// ── SETUP ─────────────────────────────────────────────────────────────────────
// Data model: teams[] = [{id, name, pitchers:[{id,name}]}]
// Pitchers are nested under teams so the same pitcher carries career data across games.
function Setup({ teams, onSaveTeams, selectedPitcherId, onSelectPitcher, lineup, onSaveLineup }) {
  const [setupTab,  setSetupTab]  = useState("team");
  const [teamName,  setTeamName]  = useState("");
  const [editTeamId,setEditTeamId]= useState(null); // which team is expanded
  const [newPName,  setNewPName]  = useState("");
  // lineup slots
  const [slots, setSlots] = useState(()=>lineup.length?lineup.map(p=>p.name):Array(9).fill(""));

  const activeTeam = teams.find(t=>t.id===editTeamId);

  const handleAddTeam = () => {
    const n=teamName.trim(); if(!n) return;
    const t={id:Date.now(),name:n,pitchers:[]};
    onSaveTeams([...teams,t]);
    setTeamName(""); setEditTeamId(t.id);
  };

  const handleDeleteTeam = (tid) => {
    onSaveTeams(teams.filter(t=>t.id!==tid));
    if(editTeamId===tid) setEditTeamId(null);
  };

  const handleAddPitcher = () => {
    const n=newPName.trim(); if(!n||!activeTeam) return;
    const p={id:Date.now(),name:n,teamId:activeTeam.id,teamName:activeTeam.name};
    onSaveTeams(teams.map(t=>t.id===activeTeam.id?{...t,pitchers:[...t.pitchers,p]}:t));
    setNewPName("");
  };

  const handleDeletePitcher = (tid,pid) => {
    onSaveTeams(teams.map(t=>t.id===tid?{...t,pitchers:t.pitchers.filter(p=>p.id!==pid)}:t));
    if(selectedPitcherId===pid) onSelectPitcher(null);
  };

  const handleSaveLineup = () => {
    const players=slots.map((name,i)=>({order:i+1,name:name.trim()})).filter(p=>p.name);
    onSaveLineup(players);
  };

  // Flatten all pitchers for display
  const allPitchers = teams.flatMap(t=>t.pitchers.map(p=>({...p,teamName:t.name})));

  return (
    <div style={{padding:"14px 16px"}}>
      <div style={{display:"flex",gap:0,marginBottom:16,borderRadius:8,overflow:"hidden",border:`1px solid ${C.border}`}}>
        {["team","lineup"].map(t=>(
          <button key={t} onClick={()=>setSetupTab(t)}
            style={{flex:1,padding:"10px 4px",background:setupTab===t?C.blueDim:C.card2,border:"none",color:setupTab===t?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,textTransform:"uppercase",cursor:"pointer"}}>
            {t==="team"?"Teams & Pitchers":"Our Lineup"}
          </button>
        ))}
      </div>

      {/* ── TEAMS & PITCHERS ── */}
      {setupTab==="team" && (
        <>
          {/* Add team */}
          <div style={{...card,borderColor:C.blueDim,marginBottom:16}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:12,color:"#60a5fa",letterSpacing:1,marginBottom:10,textTransform:"uppercase"}}>Add Opposing Team</div>
            <div style={{display:"flex",gap:8}}>
              <input style={{...inp,marginBottom:0,flex:1}} placeholder="e.g. Easton Area" value={teamName}
                onChange={e=>setTeamName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddTeam()}/>
              <button onClick={handleAddTeam} disabled={!teamName.trim()}
                style={{padding:"10px 16px",background:teamName.trim()?C.blue:C.card2,border:"none",borderRadius:6,color:teamName.trim()?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:teamName.trim()?"pointer":"default",whiteSpace:"nowrap"}}>
                + Add
              </button>
            </div>
          </div>

          {teams.length===0 && <div style={{textAlign:"center",color:C.dim,fontSize:13,marginTop:24}}>No teams yet. Add your first opponent above.</div>}

          {/* Team list */}
          {teams.map(team=>{
            const isOpen=editTeamId===team.id;
            return (
              <div key={team.id} style={{...card,borderColor:isOpen?C.blue:C.border,marginBottom:8}}>
                {/* Team header row */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>setEditTeamId(isOpen?null:team.id)}>
                  <div>
                    <div style={{fontFamily:"'Oswald',sans-serif",fontSize:16,color:isOpen?"#60a5fa":C.text}}>{team.name}</div>
                    <div style={{fontSize:11,color:C.dim,marginTop:1}}>{team.pitchers.length} pitcher{team.pitchers.length!==1?"s":""}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{color:C.muted,fontSize:18}}>{isOpen?"▲":"▼"}</span>
                    <button onClick={e=>{e.stopPropagation();handleDeleteTeam(team.id);}}
                      style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:18,padding:"0 4px",lineHeight:1}}>×</button>
                  </div>
                </div>

                {/* Expanded: pitcher roster */}
                {isOpen && (
                  <div style={{marginTop:12,borderTop:`1px solid ${C.border}`,paddingTop:12}}>
                    {/* Add pitcher */}
                    <div style={{display:"flex",gap:8,marginBottom:10}}>
                      <input style={{...inp,marginBottom:0,flex:1}} placeholder="Pitcher name" value={newPName}
                        onChange={e=>setNewPName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddPitcher()}/>
                      <button onClick={handleAddPitcher} disabled={!newPName.trim()}
                        style={{padding:"10px 14px",background:newPName.trim()?C.green:C.card2,border:"none",borderRadius:6,color:newPName.trim()?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,cursor:newPName.trim()?"pointer":"default",whiteSpace:"nowrap"}}>
                        + Add
                      </button>
                    </div>

                    {team.pitchers.length===0 && <div style={{fontSize:12,color:C.dim,textAlign:"center",padding:"8px 0"}}>No pitchers yet.</div>}

                    {team.pitchers.map(p=>{
                      const isActive=selectedPitcherId===p.id;
                      return (
                        <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",borderRadius:7,background:isActive?C.blueDim+"44":C.card2,border:`1px solid ${isActive?C.blue:C.border}`,marginBottom:6,cursor:"pointer"}}
                          onClick={()=>onSelectPitcher(isActive?null:p.id)}>
                          <div style={{fontFamily:"'Oswald',sans-serif",fontSize:14,color:isActive?"#60a5fa":C.text}}>{p.name}</div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            {isActive&&<span style={badge(C.blue)}>ACTIVE</span>}
                            <button onClick={e=>{e.stopPropagation();handleDeletePitcher(team.id,p.id);}}
                              style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:16,padding:"0 4px",lineHeight:1}}>×</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
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
                <input style={{...inp,marginBottom:0}} placeholder={`Batter ${i+1}`} value={slots[i]}
                  onChange={e=>{const n=[...slots]; n[i]=e.target.value; setSlots(n);}}/>
              </div>
            ))}
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
function LogPitch({ teams, selectedPitcherId, onSelectPitcher, pitches, onLog, onUndo, lineup, games, onAddGame, selectedGame, onSelectGame, currentBatter, onBatterChange, currentCount, onCountChange }) {
  const count   = currentCount;
  const setCount = onCountChange;
  const batter  = currentBatter;
  const setBatter = onBatterChange;
  const [pitch,    setPitch]    = useState("FB");
  const [result,   setResult]   = useState("Strike");
  const [zone,     setZone]     = useState(null);
  const [flashMsg, setFlashMsg] = useState(null);
  const [lastEntry,setLastEntry]= useState(null);
  const [showSub,  setShowSub]  = useState(false);
  const [subSlot,  setSubSlot]  = useState(null);
  const [subName,  setSubName]  = useState("");
  const [lineupOverrides,setLineupOverrides] = useState({});
  const [showNewGame, setShowNewGame] = useState(false);
  const [newGameOpp,  setNewGameOpp]  = useState("");
  const [newGameDate, setNewGameDate] = useState(()=>new Date().toISOString().slice(0,10));

  // Find active pitcher across teams
  const pitcher = useMemo(()=>teams.flatMap(t=>t.pitchers).find(p=>p.id===selectedPitcherId), [teams,selectedPitcherId]);
  const pitcherPitches = useMemo(()=>selectedPitcherId?pitches.filter(p=>p.pitcherId===selectedPitcherId):[], [pitches,selectedPitcherId]);
  const overall   = useMemo(()=>calcOverall(pitcherPitches),  [pitcherPitches]);
  const byCount   = useMemo(()=>calcByCount(pitcherPitches),  [pitcherPitches]);
  const countData = byCount[count]||{total:0};

  const effectiveLineup = useMemo(()=>lineup.map(p=>({
    ...p, name:lineupOverrides[p.order]||p.name, subbed:!!lineupOverrides[p.order],
  })),[lineup,lineupOverrides]);

  // Seed batter with leadoff if none set yet, or when pitcher changes and batter is blank
  useEffect(()=>{
    if(currentBatter===""&&effectiveLineup.length>0) setBatter(effectiveLineup[0].name);
  },[selectedPitcherId]);

  const nextBatterInOrder = (currentName) => {
    if(effectiveLineup.length===0) return "";
    const idx=effectiveLineup.findIndex(p=>p.name===currentName);
    if(idx===-1) return effectiveLineup[0].name;
    return effectiveLineup[(idx+1)%effectiveLineup.length].name;
  };

  const handleLog = () => {
    if(!pitcher) return;
    const entry={
      id:Date.now(), pitcherId:pitcher.id, pitcherName:pitcher.name,
      pitcherTeam:pitcher.teamName, batter:batter.trim()||"—",
      gameId:selectedGame||null, count, pitch, result, zone,
    };
    setLastEntry({entry,prevCount:count,prevBatter:batter,prevPitch:pitch,prevResult:result,prevZone:zone});
    onLog(entry);
    const {next,atBatOver,reason}=advanceCount(count,result);
    if(atBatOver){
      setCount("0-0"); setZone(null);
      setBatter(nextBatterInOrder(batter.trim()));
      const msg=reason==="In Play"?"Ball in play — next batter":reason==="Walk"?"Walk — next batter":"Strikeout — next batter";
      setFlashMsg(msg); setTimeout(()=>setFlashMsg(null),2500);
    } else {
      setCount(next); setZone(null);
      setFlashMsg("✓ Logged"); setTimeout(()=>setFlashMsg(null),600);
    }
  };

  const handleUndo = () => {
    if(!lastEntry) return;
    onUndo(lastEntry.entry.id);
    setCount(lastEntry.prevCount); setBatter(lastEntry.prevBatter);
    setPitch(lastEntry.prevPitch); setResult(lastEntry.prevResult);
    setZone(lastEntry.prevZone); setLastEntry(null);
    setFlashMsg("↩ Undone"); setTimeout(()=>setFlashMsg(null),1200);
  };

  const handleSub = () => {
    if(!subSlot||!subName.trim()) return;
    setLineupOverrides(prev=>({...prev,[subSlot]:subName.trim()}));
    if(batter===(lineup.find(p=>p.order===subSlot)?.name||"")) setBatter(subName.trim());
    setShowSub(false); setSubSlot(null); setSubName("");
  };

  const handleAddGame = () => {
    if(!newGameOpp.trim()) return;
    const g={id:Date.now(),opponent:newGameOpp.trim(),date:newGameDate};
    onAddGame(g); onSelectGame(g.id); setShowNewGame(false); setNewGameOpp("");
  };

  // Pre-fill opponent field with active pitcher's team name when opening new game form
  const handleToggleNewGame = () => {
    if(!showNewGame && pitcher && !newGameOpp) setNewGameOpp(pitcher.teamName);
    setShowNewGame(v=>!v);
  };

  if(!pitcher) return (
    <div style={{padding:"14px 16px",textAlign:"center",paddingTop:56}}>
      <div style={{fontSize:40,marginBottom:14}}>⚾</div>
      <div style={{color:C.dim,fontSize:14}}>Go to Setup, expand a team, and tap a pitcher to activate.</div>
    </div>
  );

  const isAtBatOver = flashMsg&&flashMsg.includes("batter");
  const btnBg = isAtBatOver||flashMsg==="✓ Logged"?C.green:C.blue;

  return (
    <div style={{padding:"14px 16px"}}>

      {/* Flash */}
      {flashMsg&&(
        <div style={{background:isAtBatOver?"#16a34a22":"#1e40af22",border:`1px solid ${isAtBatOver?C.green:C.blue}`,borderRadius:8,padding:"10px 14px",marginBottom:12,textAlign:"center"}}>
          <div style={{fontFamily:"'Oswald',sans-serif",color:isAtBatOver?"#86efac":"#93c5fd",fontSize:13,letterSpacing:1}}>{flashMsg}</div>
        </div>
      )}

      {/* Game selector */}
      <div style={{...card,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <label style={{...lbl,margin:0}}>Game</label>
          <button onClick={handleToggleNewGame} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,color:C.muted,fontSize:11,padding:"3px 8px",cursor:"pointer",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>+ New Game</button>
        </div>
        {showNewGame&&(
          <div style={{marginBottom:10,padding:"10px",background:C.card2,borderRadius:8,border:`1px solid ${C.border}`}}>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <input style={{...inp,flex:2,marginBottom:0}} placeholder="Opponent" value={newGameOpp} onChange={e=>setNewGameOpp(e.target.value)}/>
              <input style={{...inp,flex:1,marginBottom:0}} type="date" value={newGameDate} onChange={e=>setNewGameDate(e.target.value)}/>
            </div>
            <button onClick={handleAddGame} style={{width:"100%",padding:"8px",background:newGameOpp.trim()?C.blue:C.card2,border:"none",borderRadius:6,color:newGameOpp.trim()?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,cursor:"pointer"}}>Create Game</button>
          </div>
        )}
        {games.length>0
          ? <select value={selectedGame||""} onChange={e=>onSelectGame(e.target.value?Number(e.target.value):null)} style={{...inp,cursor:"pointer",marginBottom:0}}>
              <option value="">— No game selected —</option>
              {[...games].reverse().map(g=><option key={g.id} value={g.id}>{g.date} vs {g.opponent}</option>)}
            </select>
          : <div style={{fontSize:12,color:C.dim}}>No games yet — create one above.</div>
        }
      </div>

      {/* Pitcher header */}
      <div style={{...card,borderColor:C.blueDim,background:C.blueDim+"22",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:1}}>Now Tracking</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:17,color:"#60a5fa"}}>{pitcher.name}</div>
            <div style={{fontSize:11,color:C.muted}}>{pitcher.teamName}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:10,color:C.dim}}>PITCHES</div>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:22,color:C.text}}>{overall.total}</div>
          </div>
        </div>
        {overall.total>0&&<div style={{marginTop:8}}><PitchBar pitchCounts={overall} total={overall.total} height={14}/></div>}
      </div>

      {/* Batter */}
      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <label style={{...lbl,margin:0}}>Batter</label>
          {lineup.length>0&&<button onClick={()=>setShowSub(v=>!v)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,color:C.muted,fontSize:11,padding:"3px 8px",cursor:"pointer",fontFamily:"'Oswald',sans-serif",letterSpacing:1}}>Sub / PH</button>}
        </div>
        {lineup.length>0
          ? <select value={batter} onChange={e=>setBatter(e.target.value)} style={{...inp,borderColor:isAtBatOver?C.green:C.border,cursor:"pointer",marginBottom:0}}>
              <option value="">— Select batter —</option>
              {effectiveLineup.map(p=><option key={p.order} value={p.name}>{p.order}. {p.name}{p.subbed?" (sub)":""}</option>)}
              <option value="__other__">Other…</option>
            </select>
          : <input style={{...inp,borderColor:isAtBatOver?C.green:C.border}} placeholder="Enter batter name…" value={batter} onChange={e=>setBatter(e.target.value)}/>
        }
        {batter==="__other__"&&<input style={{...inp,marginTop:6}} placeholder="Enter name…" value="" onChange={e=>setBatter(e.target.value)} autoFocus/>}

        {showSub&&lineup.length>0&&(
          <div style={{marginTop:8,padding:"10px",background:C.card2,borderRadius:8,border:`1px solid ${C.border}`}}>
            <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#60a5fa",letterSpacing:1,marginBottom:8,textTransform:"uppercase"}}>Sub / Pinch Hitter</div>
            <div style={{marginBottom:8}}>
              <label style={lbl}>Replace slot</label>
              <select value={subSlot||""} onChange={e=>setSubSlot(Number(e.target.value))} style={{...inp,cursor:"pointer",marginBottom:0}}>
                <option value="">— Select slot —</option>
                {effectiveLineup.map(p=><option key={p.order} value={p.order}>{p.order}. {p.name}</option>)}
              </select>
            </div>
            <div style={{marginBottom:8}}>
              <label style={lbl}>Sub / PH name</label>
              <input style={inp} placeholder="Player name" value={subName} onChange={e=>setSubName(e.target.value)}/>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={handleSub} disabled={!subSlot||!subName.trim()} style={{flex:1,padding:"8px",background:subSlot&&subName.trim()?C.green:C.card2,border:"none",borderRadius:6,color:subSlot&&subName.trim()?"#fff":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:12,letterSpacing:1,cursor:"pointer"}}>Confirm Sub</button>
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

      {/* Dual % */}
      {overall.total>0&&(
        <div style={{...card,marginBottom:12}}>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Pitch % — Overall · {count}</div>
          <DualPercent overall={overall} countData={countData} currentCount={count}/>
        </div>
      )}

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
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {RESULTS.map(r=><button key={r} onClick={()=>setResult(r)} style={pill(result===r?"#a78bfa":C.muted,result===r)}>{r}</button>)}
        </div>
      </div>

      {/* Zone */}
      <div style={{...card,marginBottom:14}}>
        <label style={{...lbl,marginBottom:10}}>Location (optional)</label>
        <ZonePicker value={zone} onChange={setZone}/>
      </div>

      {lastEntry&&(
        <button onClick={handleUndo} style={{width:"100%",padding:"11px",background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,fontFamily:"'Oswald',sans-serif",fontSize:13,letterSpacing:1,cursor:"pointer",marginBottom:8}}>
          ↩ Undo Last Pitch
        </button>
      )}
      <button onClick={handleLog} style={logBtn(btnBg)}>
        {isAtBatOver?"✓ At-Bat Over":flashMsg==="✓ Logged"?"✓ Logged!":"Log Pitch"}
      </button>
    </div>
  );
}

// ── GAME VIEW ─────────────────────────────────────────────────────────────────
function GameView({ pitches, teams, selectedPitcherId, onSelectPitcher }) {
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
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
        {allPitchers.map(p=>(
          <button key={p.id} onClick={()=>onSelectPitcher(p.id)}
            style={{padding:"6px 14px",borderRadius:20,border:selectedPitcherId===p.id?`1px solid ${C.blue}`:`1px solid ${C.border}`,background:selectedPitcherId===p.id?C.blueDim:C.card2,color:selectedPitcherId===p.id?"#60a5fa":C.muted,fontFamily:"'Oswald',sans-serif",fontSize:12,cursor:"pointer"}}>
            {p.name}
          </button>
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
function Tendencies({ pitches, teams, games }) {
  const allPitchers = teams.flatMap(t=>t.pitchers.map(p=>({...p,teamName:t.name})));
  const [viewPitcher, setViewPitcher] = useState("all");
  const [viewMode,    setViewMode]    = useState("career"); // "career" | "game" | "split"
  const [viewGame,    setViewGame]    = useState("");
  const [viewBatter,  setViewBatter]  = useState("all");

  // career mode  → show all-time data only
  // game mode    → show selected game only
  // split mode   → show both side by side
  const basePitcherFilter = p => viewPitcher==="all"||String(p.pitcherId)===viewPitcher;
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
        <div style={{marginBottom:8}}>
          <label style={lbl}>Pitcher</label>
          <select value={viewPitcher} onChange={e=>setViewPitcher(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
            <option value="all">All Pitchers</option>
            {teams.map(t=>(
              <optgroup key={t.id} label={t.name}>
                {t.pitchers.map(p=><option key={p.id} value={String(p.id)}>{p.name}</option>)}
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
function Export({ pitches, teams, games }) {
  const allPitchers = teams.flatMap(t=>t.pitchers.map(p=>({...p,teamName:t.name})));
  const [viewPitcher, setViewPitcher] = useState(allPitchers[0]?.id||null);
  const [viewGame,    setViewGame]    = useState("all");
  const [copied,      setCopied]      = useState(false);

  const pitcher  = allPitchers.find(p=>p.id===viewPitcher);
  const filtered = useMemo(()=>pitches.filter(p=>p.pitcherId===viewPitcher).filter(p=>viewGame==="all"||String(p.gameId)===viewGame),[pitches,viewPitcher,viewGame]);
  const overall  = useMemo(()=>calcOverall(filtered),  [filtered]);
  const byCount  = useMemo(()=>calcByCount(filtered),  [filtered]);

  const report = useMemo(()=>{
    if(!pitcher||!filtered.length) return "";
    const gameLabel=viewGame==="all"?"All Games (Career)":()=>{const g=games.find(g=>String(g.id)===viewGame);return g?`${g.date} vs ${g.opponent}`:"";};
    const gl=typeof gameLabel==="function"?gameLabel():gameLabel;
    let lines=[];
    lines.push(`PITCH SCOUT — ${pitcher.name.toUpperCase()} (${pitcher.teamName})`);
    lines.push(`${gl} · ${filtered.length} pitches`);
    lines.push("─".repeat(40));
    lines.push("OVERALL MIX");
    PITCH_TYPES.forEach(p=>{if((overall[p]||0)>0)lines.push(`  ${PITCH_LABELS[p].padEnd(12)} ${pct(overall[p]||0,overall.total)}%  (${overall[p]} pitches)`);});
    lines.push("");
    lines.push("BY COUNT");
    COUNTS.forEach(count=>{
      const d=byCount[count]||{total:0}; if(!d.total) return;
      lines.push(`  ${count} (${COUNT_FULL[count]}) — ${d.total} pitches`);
      PITCH_TYPES.forEach(p=>{if((d[p]||0)>0)lines.push(`    ${PITCH_LABELS[p].padEnd(12)} ${pct(d[p]||0,d.total)}%  / ${pct(overall[p]||0,overall.total)}% Career`);});
    });
    lines.push("─".repeat(40));
    lines.push(`Pitch Scout · ${new Date().toLocaleDateString()}`);
    return lines.join("\n");
  },[pitcher,filtered,overall,byCount,viewGame,games]);

  const handleCopy=()=>{ navigator.clipboard.writeText(report).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}); };

  if(allPitchers.length===0) return <div style={{padding:"14px 16px",textAlign:"center",paddingTop:56,color:C.dim,fontSize:13}}>No pitchers to export yet.</div>;

  return (
    <div style={{padding:"14px 16px"}}>
      <div style={{...card,marginBottom:14}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:11,color:"#60a5fa",letterSpacing:1,marginBottom:10,textTransform:"uppercase"}}>Report Options</div>
        <div style={{marginBottom:8}}>
          <label style={lbl}>Pitcher</label>
          <select value={viewPitcher||""} onChange={e=>setViewPitcher(Number(e.target.value))} style={{...inp,cursor:"pointer",marginBottom:0}}>
            {teams.map(t=><optgroup key={t.id} label={t.name}>{t.pitchers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Game</label>
          <select value={viewGame} onChange={e=>setViewGame(e.target.value)} style={{...inp,cursor:"pointer",marginBottom:0}}>
            <option value="all">All Games (career)</option>
            {[...games].reverse().map(g=><option key={g.id} value={String(g.id)}>{g.date} vs {g.opponent}</option>)}
          </select>
        </div>
      </div>
      {report?(
        <>
          <button onClick={handleCopy} style={{...logBtn(copied?C.green:C.blue),marginBottom:12}}>{copied?"✓ Copied!":"Copy Scouting Report"}</button>
          <div style={{...card,fontFamily:"'Courier New',monospace",fontSize:12,color:C.muted,whiteSpace:"pre-wrap",lineHeight:1.7}}>{report}</div>
        </>
      ):<div style={{textAlign:"center",color:C.dim,fontSize:13,marginTop:24}}>No pitch data for this selection.</div>}
    </div>
  );
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
function History({ pitches, onDelete, onClearAll }) {
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

// ── ROOT ──────────────────────────────────────────────────────────────────────
const SK = {teams:"ps_teams",pitches:"ps_pitches",selPitcher:"ps_selPitcher",lineup:"ps_lineup",games:"ps_games",selGame:"ps_selGame",batter:"ps_batter",count:"ps_count"};

export default function App() {
  const [tab,              setTab]             = useState("setup");
  const [teams,            setTeams]           = useState(()=>load(SK.teams,[]));
  const [selectedPitcherId,setSelectedPitcher] = useState(()=>load(SK.selPitcher,null));
  const [pitches,          setPitches]         = useState(()=>load(SK.pitches,[]));
  const [lineup,           setLineup]          = useState(()=>load(SK.lineup,[]));
  const [games,            setGames]           = useState(()=>load(SK.games,[]));
  const [selectedGame,     setSelectedGame]    = useState(()=>load(SK.selGame,null));
  const [currentBatter,    setCurrentBatter]   = useState(()=>load(SK.batter,""));
  const [currentCount,     setCurrentCount]    = useState(()=>load(SK.count,"0-0"));

  useEffect(()=>save(SK.teams,   teams),           [teams]);
  useEffect(()=>save(SK.pitches, pitches),          [pitches]);
  useEffect(()=>save(SK.selPitcher,selectedPitcherId),[selectedPitcherId]);
  useEffect(()=>save(SK.lineup,  lineup),           [lineup]);
  useEffect(()=>save(SK.games,   games),            [games]);
  useEffect(()=>save(SK.selGame, selectedGame),     [selectedGame]);
  useEffect(()=>save(SK.batter, currentBatter),     [currentBatter]);
  useEffect(()=>save(SK.count,  currentCount),      [currentCount]);

  const TABS=[
    {id:"game",    label:"⚾ Game"},
    {id:"setup",   label:"Setup"},
    {id:"log",     label:"Log"},
    {id:"trends",  label:"Trends"},
    {id:"export",  label:"Export"},
    {id:"history", label:"History"},
  ];

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Inter',sans-serif",paddingBottom:80}}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Inter:wght@400;500&display=swap" rel="stylesheet"/>
      <div style={{background:"linear-gradient(135deg,#1a1f2e 0%,#0d1117 100%)",borderBottom:"2px solid #1e3a5f",padding:"14px 16px 10px",position:"sticky",top:0,zIndex:100}}>
        <div style={{fontFamily:"'Oswald',sans-serif",fontSize:19,letterSpacing:2,color:"#60a5fa",textTransform:"uppercase",margin:0}}>⚾ Pitch Scout</div>
        <div style={{fontSize:11,color:C.dim,letterSpacing:1,marginTop:1}}>Opposing Pitcher Tendencies</div>
      </div>
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:C.card,position:"sticky",top:58,zIndex:99,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{flex:"0 0 auto",padding:"11px 10px",background:"none",border:"none",borderBottom:tab===t.id?`2px solid ${C.blue}`:"2px solid transparent",color:tab===t.id?"#60a5fa":C.dim,fontFamily:"'Oswald',sans-serif",fontSize:11,letterSpacing:1,textTransform:"uppercase",cursor:"pointer",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
      </div>
      {tab==="game"    && <GameView    pitches={pitches} teams={teams} selectedPitcherId={selectedPitcherId} onSelectPitcher={setSelectedPitcher}/>}
      {tab==="setup"   && <Setup       teams={teams} onSaveTeams={setTeams} selectedPitcherId={selectedPitcherId} onSelectPitcher={setSelectedPitcher} lineup={lineup} onSaveLineup={setLineup}/>}
      {tab==="log"     && <LogPitch    teams={teams} selectedPitcherId={selectedPitcherId} onSelectPitcher={setSelectedPitcher} pitches={pitches} onLog={e=>setPitches(prev=>[...prev,e])} onUndo={id=>setPitches(prev=>prev.filter(p=>p.id!==id))} lineup={lineup} games={games} onAddGame={g=>setGames(prev=>[...prev,g])} selectedGame={selectedGame} onSelectGame={setSelectedGame} currentBatter={currentBatter} onBatterChange={setCurrentBatter} currentCount={currentCount} onCountChange={setCurrentCount}/>}
      {tab==="trends"  && <Tendencies  pitches={pitches} teams={teams} games={games}/>}
      {tab==="export"  && <Export      pitches={pitches} teams={teams} games={games}/>}
      {tab==="history" && <History     pitches={pitches} onDelete={id=>setPitches(prev=>prev.filter(p=>p.id!==id))} onClearAll={()=>{setPitches([]);setTeams([]);setSelectedPitcher(null);setGames([]);setSelectedGame(null);}}/>}
    </div>
  );
}
