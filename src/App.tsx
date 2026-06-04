import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Moon, Sun, Shield, Eye, Skull, ChevronRight, Send, RotateCcw, Swords, Crown, Wand2, Crosshair, Vote, Star } from 'lucide-react';
import { Player, Role, Phase, GameState, Side, SeerRecord } from './types';
import { ROLE_LABELS, ROLE_ICONS } from './constants';
import { initializePlayers, checkWinner, getSide } from './lib/gameUtils';
import {
  generateAIDiscussion, generateAIVote, generateAINightAction,
  generateAIGuardAction, generateAISheriffChoice, generateAISheriffAction,
  generateAIWolfKill
} from './services/geminiService';

// ── Constants ─────────────────────────────────────────────────────────────────
const RC: Record<Role, string> = {
  [Role.WEREWOLF]: '#e05252', [Role.SEER]: '#a78bfa', [Role.WITCH]: '#34d399',
  [Role.HUNTER]: '#fb923c', [Role.GUARD]: '#60a5fa', [Role.IDIOT]: '#fbbf24', [Role.VILLAGER]: '#94a3b8',
};
const PHASE_BG: Record<string, string> = {
  NIGHT: 'linear-gradient(135deg,#0f0c1a 0%,#1a0f2e 100%)',
  DAY:   'linear-gradient(135deg,#1a1200 0%,#2d1f00 100%)',
  VOTE:  'linear-gradient(135deg,#1a0000 0%,#2d0a0a 100%)',
  SHERIFF: 'linear-gradient(135deg,#001020 0%,#0a1a2e 100%)',
};
const INITIAL: GameState = {
  players:[], day:1, phase:Phase.INIT, logs:[],
  witchStatus:{hasSavePotion:true,hasPoisonPotion:true},
  seerRecords:[], currentDiscussionIndex:-1, votes:{},
  voteReasons:{}, lastNightDeaths:[], discussionDirection:1,
  sheriffCandidates:[], isSheriffElectionCompleted:false,
};

export default function App() {
  const [gs, setGs] = useState<GameState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [speech, setSpeech] = useState('');
  const [humanVoted, setHumanVoted] = useState(false);
  const [sheriffElectDone, setSheriffElectDone] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const processed = useRef<Set<number>>(new Set());

  useEffect(() => { logEnd.current?.scrollIntoView({ behavior:'smooth' }); }, [gs.logs]);

  // ── Init ──
  useEffect(() => {
    if (gs.phase !== Phase.INIT) return;
    const players = initializePlayers();
    setGs(prev => ({
      ...prev, players, phase: Phase.NIGHT_GUARD,
      logs: [{ id:'init', day:1, phase:Phase.INIT, type:'system',
        message:'游戏开始！共12人：4狼人 · 4平民 · 预言家 · 女巫 · 猎人 · 特殊神职。闭眼，夜晚降临...' }]
    }));
  }, [gs.phase === Phase.INIT]);

  const log = (entry: Omit<typeof gs.logs[0],'id'>) =>
    setGs(p => ({ ...p, logs:[...p.logs,{...entry,id:Math.random().toString(36).slice(2,9)}] }));

  const advance = (override?: Partial<GameState>) => {
    setGs(prev => {
      const m = {...prev,...override};
      const w = checkWinner(m.players);
      if (w) return {...m, phase:Phase.GAME_OVER, winner:w};
      let next = prev.phase, day = prev.day;
      switch(prev.phase) {
        case Phase.NIGHT_GUARD:   next=Phase.NIGHT_WOLVES; break;
        case Phase.NIGHT_WOLVES:  next=Phase.NIGHT_SEER; break;
        case Phase.NIGHT_SEER:    next=Phase.NIGHT_WITCH; break;
        case Phase.NIGHT_WITCH:   next=Phase.NIGHT_RESULT; break;
        case Phase.NIGHT_RESULT:
          next = prev.day===1 && !prev.isSheriffElectionCompleted ? Phase.SHERIFF_ELECT : Phase.DAY_DISCUSSION; break;
        case Phase.SHERIFF_ELECT:  next=Phase.SHERIFF_SPEECH; break;
        case Phase.SHERIFF_SPEECH: next=Phase.SHERIFF_VOTE; break;
        case Phase.SHERIFF_VOTE:   next=Phase.SHERIFF_RESULT; break;
        case Phase.SHERIFF_RESULT: next=Phase.DAY_DISCUSSION; break;
        case Phase.DAY_DISCUSSION: next=Phase.DAY_VOTING; break;
        case Phase.DAY_VOTING:     next=Phase.DAY_RESULT; break;
        case Phase.DAY_RESULT:     next=Phase.NIGHT_GUARD; day++; break;
        default: break;
      }
      return {...m, phase:next, day};
    });
  };

  // ── AI Triggers ──
  useEffect(() => {
    const hr = gs.players.find(p=>p.isHuman)?.role;
    if (gs.phase===Phase.NIGHT_GUARD && hr!==Role.GUARD) aiGuard();
    else if (gs.phase===Phase.NIGHT_WOLVES && hr!==Role.WEREWOLF) aiWolves();
    else if (gs.phase===Phase.NIGHT_SEER && hr!==Role.SEER) aiSeer();
    else if (gs.phase===Phase.NIGHT_WITCH && hr!==Role.WITCH) aiWitch();
    else if (gs.phase===Phase.NIGHT_RESULT) nightSettle();
    else if (gs.phase===Phase.SHERIFF_ELECT) { setSheriffElectDone(false); aiSheriffElect(); }
    else if (gs.phase===Phase.SHERIFF_SPEECH) aiSheriffSpeech();
    else if (gs.phase===Phase.SHERIFF_VOTE) aiSheriffVote();
    else if (gs.phase===Phase.SHERIFF_ACTION) aiSheriffHandoff();
  }, [gs.phase]);

  useEffect(() => {
    if (gs.phase!==Phase.DAY_DISCUSSION && gs.phase!==Phase.SHERIFF_SPEECH) processed.current.clear();
  }, [gs.phase]);

  // ── Night ──
  const aiGuard = async () => {
    setBusy(true);
    const g = gs.players.find(p=>p.role===Role.GUARD&&p.isAlive&&!p.isHuman);
    if (g) { const t=await generateAIGuardAction(g,gs); setGs(p=>({...p,guardTargetId:t??undefined})); }
    setBusy(false); advance();
  };
  const aiWolves = async () => {
    setBusy(true);
    const w = gs.players.find(p=>p.role===Role.WEREWOLF&&p.isAlive&&!p.isHuman);
    if (w) { const t=await generateAINightAction(w,gs,'KILL') as number; setGs(p=>({...p,nightKilledId:t})); }
    setBusy(false); advance();
  };
  const aiSeer = async () => {
    setBusy(true);
    const s = gs.players.find(p=>p.role===Role.SEER&&p.isAlive&&!p.isHuman);
    if (s) {
      const t=await generateAINightAction(s,gs,'CHECK') as number;
      if (t&&t!==-1) {
        const tgt=gs.players.find(p=>p.id===t)!;
        setGs(p=>({...p,seerRecords:[...p.seerRecords,{targetId:t,role:tgt.role,side:getSide(tgt.role)}]}));
      }
    }
    setBusy(false); advance();
  };
  const aiWitch = async () => {
    setBusy(true);
    const w=gs.players.find(p=>p.role===Role.WITCH&&p.isAlive&&!p.isHuman);
    if (w) {
      const r=await generateAINightAction(w,gs,'WITCH_ACTION') as {action:string;targetId?:number};
      if (r?.action==='save') setGs(p=>({...p,witchSavedId:p.nightKilledId,witchStatus:{...p.witchStatus,hasSavePotion:false}}));
      else if (r?.action==='poison'&&r.targetId) setGs(p=>({...p,witchPoisonedId:r.targetId,witchStatus:{...p.witchStatus,hasPoisonPotion:false}}));
    }
    setBusy(false); advance();
  };
  const nightSettle = async () => {
    let players=[...gs.players];
    const {nightKilledId,witchSavedId,witchPoisonedId,guardTargetId}=gs;
    const deaths:string[]=[]; let hunter=false; const ids:number[]=[];
    const milk=nightKilledId&&guardTargetId===nightKilledId&&witchSavedId===nightKilledId;
    const toKill:number[]=[];
    if (milk&&nightKilledId) toKill.push(nightKilledId);
    else if (nightKilledId&&guardTargetId!==nightKilledId&&witchSavedId!==nightKilledId) toKill.push(nightKilledId);
    if (witchPoisonedId) toKill.push(witchPoisonedId);
    for (const id of toKill) {
      const p=players.find(pl=>pl.id===id);
      if (!p||!p.isAlive) continue;
      p.isAlive=false; p.deathDay=gs.day; p.deathReason=id===witchPoisonedId?'女巫毒杀':'狼人猎杀';
      deaths.push(`${id}号(${ROLE_LABELS[p.role]})`); ids.push(id);
      if (p.role===Role.HUNTER) {
        if (p.isHuman) { hunter=true; }
        else {
          setBusy(true);
          const t=await generateAINightAction(p,{...gs,players},'HUNTER_SHOOT') as number;
          if (t&&t!==-1) { const s=players.find(pl=>pl.id===t); if(s?.isAlive){s.isAlive=false;s.deathDay=gs.day;s.deathReason='猎人带走';deaths.push(`${t}号[猎人带走]`);} }
          setBusy(false);
        }
      }
    }
    log({day:gs.day,phase:Phase.NIGHT_RESULT,type:'system',message:deaths.length>0?`昨夜出局：${deaths.join('、')}`:'昨夜平安，无人出局。'});
    const deadSheriff=gs.sheriffId&&!players.find(p=>p.id===gs.sheriffId&&p.isAlive);
    setGs(p=>({...p,players,nightKilledId:undefined,witchSavedId:undefined,witchPoisonedId:undefined,lastGuardTargetId:p.guardTargetId,guardTargetId:undefined,hunterMustShoot:hunter,sheriffMustAct:!!deadSheriff,lastNightDeaths:ids}));
    if (deadSheriff) setGs(p=>({...p,phase:Phase.SHERIFF_ACTION}));
    else if (!hunter) advance();
  };

  // ── Sheriff ──
  const aiSheriffElect = async () => {
    setBusy(true);
    const cands:number[]=[];
    for (const p of gs.players.filter(pl=>!pl.isHuman&&pl.isAlive)) {
      const run=await generateAISheriffChoice(p,{...gs,sheriffCandidates:cands});
      if (run) cands.push(p.id);
    }
    setBusy(false);
    // Update candidates AND mark done together so render sees both at once
    setGs(p=>({...p,sheriffCandidates:cands}));
    setSheriffElectDone(true);
  };
  const aiSheriffSpeech = () => {
    if (gs.sheriffCandidates.length===0){advance();return;}
    setGs(p=>({...p,currentDiscussionIndex:p.sheriffCandidates[0]}));
  };
  const aiSheriffVote = async () => {
    setBusy(true);
    const voters=gs.players.filter(p=>p.isAlive&&!gs.sheriffCandidates.includes(p.id)&&!p.isHuman);
    const votes={...gs.votes}, reasons={...gs.voteReasons};
    for (const v of voters) {
      const r=await generateAIVote(v,gs,gs.sheriffCandidates);
      if (r.voteId){votes[v.id]=r.voteId;reasons[v.id]=r.reason;}
    }
    setBusy(false);
    const humanIsVoter=gs.players.find(p=>p.isHuman&&p.isAlive&&!gs.sheriffCandidates.includes(1));
    if (!humanIsVoter) finalizeSheriff(votes,reasons);
    else setGs(p=>({...p,votes,voteReasons:reasons}));
  };
  const finalizeSheriff=(votes:Record<number,number>,reasons:Record<number,string>)=>{
    const counts:Record<number,number>={};
    Object.values(votes).forEach(id=>counts[id]=(counts[id]||0)+1);
    let mx=0,win:number[]=[];
    Object.entries(counts).forEach(([id,c])=>{if(c>mx){mx=c;win=[+id];}else if(c===mx)win.push(+id);});
    const eid=win.length===1?win[0]:null;
    log({day:gs.day,phase:Phase.SHERIFF_RESULT,type:'system',message:eid?`🏅 ${eid}号当选警长！`:'平票，本局无警长。'});
    setGs(p=>({...p,sheriffId:eid??undefined,isSheriffElectionCompleted:true,votes,voteReasons:reasons}));
    advance();
  };
  const aiSheriffHandoff=async()=>{
    const s=gs.players.find(p=>p.id===gs.sheriffId);
    if (!s||s.isHuman) return;
    setBusy(true);
    const t=await generateAISheriffAction(s,gs) as number|null;
    doHandoff(t); setBusy(false);
  };
  const doHandoff=(t:number|null)=>{
    if (t){log({day:gs.day,phase:Phase.SHERIFF_ACTION,type:'system',message:`🏅 警长将警徽传给${t}号。`});setGs(p=>({...p,sheriffId:t,sheriffMustAct:false}));}
    else{log({day:gs.day,phase:Phase.SHERIFF_ACTION,type:'system',message:'警长撕毁了警徽。'});setGs(p=>({...p,sheriffId:undefined,sheriffMustAct:false}));}
    if (!gs.hunterMustShoot) advance();
  };

  // ── Discussion ──
  useEffect(()=>{
    const {phase,currentDiscussionIndex:ci,players}=gs;
    if (phase!==Phase.DAY_DISCUSSION&&phase!==Phase.SHERIFF_SPEECH) return;
    if (ci<0||busy) return;
    const isSheriff=phase===Phase.SHERIFF_SPEECH;
    const parts=isSheriff?gs.sheriffCandidates:players.filter(p=>p.isAlive).map(p=>p.id).sort((a,b)=>a-b);
    if (!isSheriff&&processed.current.size>=parts.length){setTimeout(()=>{setGs(p=>({...p,currentDiscussionIndex:-1}));advance();},600);return;}
    const player=players.find(p=>p.id===ci);
    if (!player||processed.current.has(ci)){moveNext(parts,ci,isSheriff);return;}
    if (player.isHuman) return;
    const run=async()=>{
      setBusy(true);
      try{
        const s=await generateAIDiscussion(player,gs);
        log({day:gs.day,phase,type:'discussion',playerName:`${player.id}号`,message:s});
        processed.current.add(player.id);
        setTimeout(()=>moveNext(parts,ci,isSheriff),1000);
      }catch{processed.current.add(player.id);moveNext(parts,ci,isSheriff);}
      finally{setBusy(false);}
    };
    run();
  },[gs.phase,gs.currentDiscussionIndex,busy]);

  const moveNext=(parts:number[],cur:number,isSheriff:boolean)=>{
    const pos=parts.indexOf(cur);
    if (pos===-1||pos>=parts.length-1){
      setGs(p=>({...p,currentDiscussionIndex:-1}));
      if (isSheriff) advance();
      return;
    }
    const dir=gs.discussionDirection;
    const next=isSheriff?parts[pos+1]:parts[(pos+dir+parts.length)%parts.length];
    setGs(p=>({...p,currentDiscussionIndex:next}));
  };
  const startDiscussion=(dir:1|-1=1)=>{
    const alive=gs.players.filter(p=>p.isAlive).map(p=>p.id).sort((a,b)=>a-b);
    let start=alive[0];
    if (gs.lastNightDeaths.length>0){const ld=gs.lastNightDeaths[gs.lastNightDeaths.length-1];const af=alive.filter(id=>id>ld);start=af.length>0?af[0]:alive[0];}
    if (gs.sheriffId) log({day:gs.day,phase:Phase.DAY_DISCUSSION,type:'system',message:`警长决定${dir===1?'顺时针':'逆时针'}发言，从${start}号开始。`});
    setGs(p=>({...p,currentDiscussionIndex:start,discussionDirection:dir}));
  };
  const submitSpeech=()=>{
    const s=speech.trim()||'（过）';
    const isSheriff=gs.phase===Phase.SHERIFF_SPEECH;
    log({day:gs.day,phase:gs.phase,type:'discussion',playerName:'你',message:s});
    setSpeech('');
    processed.current.add(1);
    const parts=isSheriff?gs.sheriffCandidates:gs.players.filter(p=>p.isAlive).map(p=>p.id).sort((a,b)=>a-b);
    moveNext(parts,1,isSheriff);
  };

  // ── Day Vote ──
  const humanVote=async(tid:number|null)=>{
    setBusy(true); setHumanVoted(true);
    const votes:Record<number,number>={}, reasons:Record<number,string>={};
    if (tid){votes[1]=tid;reasons[1]='你的投票。';}
    for (const ai of gs.players.filter(p=>p.isAlive&&!p.isHuman&&gs.idiotRevealedId!==p.id)){
      const r=await generateAIVote(ai,gs);
      if (r.voteId){votes[ai.id]=r.voteId;reasons[ai.id]=r.reason;log({day:gs.day,phase:Phase.DAY_VOTING,type:'vote',playerName:`${ai.id}号`,message:`投${r.voteId}号。${r.reason}`});}
      else log({day:gs.day,phase:Phase.DAY_VOTING,type:'vote',playerName:`${ai.id}号`,message:`弃权。${r.reason}`});
    }
    const counts:Record<number,number>={};
    Object.entries(votes).forEach(([vid,t])=>{const w=+vid===gs.sheriffId?1.5:1;counts[t]=(counts[t]||0)+w;});
    let mx=0,top:number[]=[];
    Object.entries(counts).forEach(([id,c])=>{if(c>mx){mx=c;top=[+id];}else if(c===mx)top.push(+id);});
    const exid=top.length>0?top[Math.floor(Math.random()*top.length)]:null;
    let players=[...gs.players]; let deadSheriff=false; let idiotRev=gs.idiotRevealedId;
    if (exid){
      const p=players.find(pl=>pl.id===exid)!;
      if (p.role===Role.IDIOT&&!gs.idiotRevealedId){
        idiotRev=exid;
        log({day:gs.day,phase:Phase.DAY_RESULT,type:'idiot',message:`🃏 ${exid}号翻牌！是白痴，免疫本次放逐，失去投票权！`});
      } else {
        p.isAlive=false;p.deathDay=gs.day;p.deathReason='投票放逐';
        log({day:gs.day,phase:Phase.DAY_RESULT,type:'system',message:`⚖️ ${exid}号被放逐（得票${mx}），身份：${ROLE_LABELS[p.role]}`});
        if (exid===gs.sheriffId) deadSheriff=true;
        if (p.role===Role.HUNTER&&!p.isHuman){
          const t=await generateAINightAction(p,{...gs,players},'HUNTER_SHOOT') as number;
          if (t){const s=players.find(pl=>pl.id===t);if(s?.isAlive){s.isAlive=false;s.deathDay=gs.day;s.deathReason='猎人带走';log({day:gs.day,phase:Phase.DAY_RESULT,type:'system',message:`🏹 猎人${exid}号开枪带走${t}号！`});}}
        }
      }
    } else log({day:gs.day,phase:Phase.DAY_RESULT,type:'system',message:'无人被放逐（平票）。'});
    setBusy(false); setHumanVoted(false);
    setGs(p=>({...p,players,votes,voteReasons:reasons,idiotRevealedId:idiotRev,sheriffMustAct:deadSheriff}));
    if (deadSheriff) setGs(p=>({...p,phase:Phase.SHERIFF_ACTION}));
    else advance({players});
  };

  // ── Human Night ──
  const hGuard=(t:number|null)=>{setGs(p=>({...p,guardTargetId:t??undefined}));log({day:gs.day,phase:Phase.NIGHT_GUARD,type:'guard',message:t?`你守护了${t}号。`:'你选择空守。'});advance();};
  const hKillVote=async(myVote:number)=>{
    setBusy(true);
    const votes:Record<number,number>={1:myVote};
    for (const w of gs.players.filter(p=>p.role===Role.WEREWOLF&&p.isAlive&&!p.isHuman)){
      const t=await generateAIWolfKill(w,gs) as number|null;
      if (t) votes[w.id]=t;
    }
    const counts:Record<number,number>={};
    Object.values(votes).forEach(id=>counts[id]=(counts[id]||0)+1);
    const final=+Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
    log({day:gs.day,phase:Phase.NIGHT_WOLVES,type:'wolf',message:`[狼队] ${Object.entries(votes).map(([w,t])=>`${w}号→${t}号`).join(' ')} | 最终击杀：${final}号`});
    setGs(p=>({...p,nightKilledId:final}));
    setBusy(false); advance();
  };
  const hCheck=(id:number)=>{
    const t=gs.players.find(p=>p.id===id)!;
    const side=getSide(t.role);
    setGs(p=>({...p,seerRecords:[...p.seerRecords,{targetId:id,role:t.role,side}]}));
    log({day:gs.day,phase:Phase.NIGHT_SEER,type:'seer',message:`查验${id}号：${side===Side.GOOD?'✅ 好人':'❌ 狼人'}`});
    advance();
  };
  const hWitch=(action:'save'|'poison'|'skip',id?:number)=>{
    if (action==='save'){setGs(p=>({...p,witchSavedId:p.nightKilledId,witchStatus:{...p.witchStatus,hasSavePotion:false}}));log({day:gs.day,phase:Phase.NIGHT_WITCH,type:'witch',message:'你使用了解药。'});}
    else if (action==='poison'&&id){setGs(p=>({...p,witchPoisonedId:id,witchStatus:{...p.witchStatus,hasPoisonPotion:false}}));log({day:gs.day,phase:Phase.NIGHT_WITCH,type:'witch',message:`你毒杀了${id}号。`});}
    else log({day:gs.day,phase:Phase.NIGHT_WITCH,type:'witch',message:'你没有使用任何药。'});
    advance();
  };
  const hHunter=(id:number|null)=>{
    if (id){const p=[...gs.players];const s=p.find(pl=>pl.id===id)!;s.isAlive=false;s.deathDay=gs.day;s.deathReason='猎人带走';log({day:gs.day,phase:Phase.NIGHT_RESULT,type:'system',message:`🏹 你开枪带走了${id}号（${ROLE_LABELS[s.role]}）`});setGs(p2=>({...p2,players:p,hunterMustShoot:false}));}
    else setGs(p=>({...p,hunterMustShoot:false}));
    advance();
  };
  const hSheriffElect=(run:boolean)=>{
    const cands=run?[...gs.sheriffCandidates,1].sort((a,b)=>a-b):gs.sheriffCandidates;
    setGs(p=>({...p,sheriffCandidates:cands}));
    log({day:gs.day,phase:Phase.SHERIFF_ELECT,type:'system',message:`竞选名单确定：${cands.length>0?cands.map(id=>`${id}号`).join('、'):'无人上警（将跳过竞选）'}`});
    advance();
  };

  // ── Derived ──
  const hp=gs.players.find(p=>p.isHuman);
  const hr=hp?.role??Role.VILLAGER;
  const ha=hp?.isAlive??false;
  const {phase,day}=gs;
  const isNight=phase.startsWith('NIGHT');
  const alive=gs.players.filter(p=>p.isAlive);
  const bg=isNight?PHASE_BG.NIGHT:phase.startsWith('SHERIFF')?PHASE_BG.SHERIFF:phase===Phase.DAY_VOTING||phase===Phase.DAY_RESULT?PHASE_BG.VOTE:PHASE_BG.DAY;

  const phaseLabel: Record<string,string> = {
    NIGHT_GUARD:'守卫守护', NIGHT_WOLVES:'狼人出击', NIGHT_SEER:'预言家查验',
    NIGHT_WITCH:'女巫行动', NIGHT_RESULT:'黎明来临', SHERIFF_ELECT:'警长竞选',
    SHERIFF_SPEECH:'竞选发言', SHERIFF_VOTE:'选举投票', SHERIFF_RESULT:'选举结果',
    DAY_DISCUSSION:'白天辩论', DAY_VOTING:'投票放逐', DAY_RESULT:'放逐结果',
    SHERIFF_ACTION:'警徽移交', GAME_OVER:'游戏结束',
  };

  return (
    <div className="h-screen flex flex-col lg:flex-row overflow-hidden text-white"
      style={{background:bg,transition:'background 1s ease',fontFamily:"'Noto Serif SC',serif"}}>

      {/* ════ SIDEBAR ════ */}
      <aside className="w-full lg:w-64 flex-shrink-0 flex flex-col lg:h-full overflow-hidden"
        style={{background:'rgba(0,0,0,0.55)',backdropFilter:'blur(16px)',borderRight:'1px solid rgba(255,255,255,0.07)'}}>

        {/* Logo */}
        <div className="px-5 pt-5 pb-4 border-b" style={{borderColor:'rgba(255,255,255,0.07)'}}>
          <div className="flex items-center gap-3">
            <div className="text-3xl">🐺</div>
            <div>
              <div className="font-black tracking-[0.25em] text-base" style={{color:'#e8c97a'}}>狼 人 杀</div>
              <div className="text-[10px] tracking-widest opacity-30 uppercase">AI Battle · Day {day}</div>
            </div>
          </div>
        </div>

        {/* Role Card */}
        {hp && (
          <div className="mx-4 mt-4 p-4 rounded-2xl relative overflow-hidden"
            style={{background:`linear-gradient(135deg,${RC[hr]}22,${RC[hr]}08)`,border:`1px solid ${RC[hr]}44`}}>
            <div className="absolute -right-4 -top-4 text-6xl opacity-10">{ROLE_ICONS[hr]}</div>
            <div className="text-[10px] uppercase tracking-widest opacity-40 mb-2">你的身份</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{ROLE_ICONS[hr]}</span>
              <div>
                <div className="font-bold text-lg leading-tight" style={{color:RC[hr]}}>{ROLE_LABELS[hr]}</div>
                <div className="text-[10px] opacity-40">{getSide(hr)===Side.GOOD?'好人阵营':'狼人阵营'}</div>
              </div>
            </div>
            {hr===Role.WEREWOLF&&(
              <div className="mt-3 pt-3 border-t text-xs" style={{borderColor:`${RC[hr]}30`}}>
                <span className="opacity-40">队友：</span>
                <span style={{color:RC[hr]}}>
                  {gs.players.filter(p=>p.role===Role.WEREWOLF&&p.id!==1&&p.isAlive).map(p=>`${p.id}号`).join('、')||'无'}
                </span>
              </div>
            )}
            {hr===Role.SEER&&gs.seerRecords.length>0&&(
              <div className="mt-3 pt-3 border-t space-y-1" style={{borderColor:`${RC[hr]}30`}}>
                <div className="text-[10px] opacity-40 uppercase tracking-widest">查验记录</div>
                {gs.seerRecords.map((r,i)=>(
                  <div key={i} className="flex justify-between text-xs font-mono">
                    <span className="opacity-60">{r.targetId}号</span>
                    <span style={{color:r.side===Side.GOOD?'#52e090':'#e05252'}}>{r.side===Side.GOOD?'✅ 好人':'❌ 狼人'}</span>
                  </div>
                ))}
              </div>
            )}
            {hr===Role.WITCH&&(
              <div className="mt-3 pt-3 border-t flex gap-4 text-xs" style={{borderColor:`${RC[hr]}30`}}>
                <span style={{color:gs.witchStatus.hasSavePotion?'#52e090':'#555'}}>💊 解药{gs.witchStatus.hasSavePotion?'':'(已用)'}</span>
                <span style={{color:gs.witchStatus.hasPoisonPotion?'#e05252':'#555'}}>🧪 毒药{gs.witchStatus.hasPoisonPotion?'':'(已用)'}</span>
              </div>
            )}
          </div>
        )}

        {/* Players */}
        <div className="flex-1 overflow-y-auto px-4 mt-4 pb-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest opacity-30 mb-2">玩家列表</div>
          {gs.players.map(p=>(
            <div key={p.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all"
              style={{
                background:p.isAlive?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.3)',
                border:p.id===1?`1px solid ${RC[hr]}40`:'1px solid rgba(255,255,255,0.05)',
                opacity:p.isAlive?1:0.4,
              }}>
              <span className="text-[10px] font-mono opacity-20 w-4 text-right">{p.id}</span>
              <span className="text-base">{p.isAlive?'❓':ROLE_ICONS[p.role]}</span>
              <span className="text-xs flex-1 truncate" style={{color:p.id===1?RC[hr]:'#ccc',textDecoration:p.isAlive?'none':'line-through'}}>
                {p.id===1?'你':p.name}
              </span>
              {p.id===gs.sheriffId&&p.isAlive&&<Crown className="w-3 h-3 flex-shrink-0" style={{color:'#fbbf24'}}/>}
              {!p.isAlive&&<Skull className="w-3 h-3 opacity-20 flex-shrink-0"/>}
              {p.id===gs.idiotRevealedId&&<span className="text-[10px]">🃏</span>}
            </div>
          ))}
        </div>
      </aside>

      {/* ════ MAIN ════ */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* Header */}
        <header className="flex-shrink-0 px-5 py-3 flex items-center justify-between"
          style={{background:'rgba(0,0,0,0.4)',backdropFilter:'blur(12px)',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{background:isNight?'rgba(139,92,246,0.2)':'rgba(251,191,36,0.2)',border:isNight?'1px solid rgba(139,92,246,0.4)':'1px solid rgba(251,191,36,0.4)'}}>
              {isNight?<Moon className="w-4 h-4" style={{color:'#a78bfa'}}/>:<Sun className="w-4 h-4" style={{color:'#fbbf24'}}/>}
            </div>
            <div>
              <div className="text-[10px] opacity-30 uppercase tracking-widest">第 {day} 天</div>
              <div className="text-sm font-bold" style={{color:'#e8c97a'}}>{phaseLabel[phase]||phase}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {busy&&(
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest font-bold"
                style={{background:'rgba(251,191,36,0.1)',color:'#fbbf24',border:'1px solid rgba(251,191,36,0.2)'}}>
                <motion.div className="w-1.5 h-1.5 rounded-full bg-yellow-400"
                  animate={{opacity:[1,0.3,1]}} transition={{duration:1,repeat:Infinity}}/>
                AI 思考中
              </div>
            )}
            <button onClick={()=>{setGs(INITIAL);setSheriffElectDone(false);}}
              className="p-2 rounded-lg transition-opacity hover:opacity-80"
              style={{background:'rgba(255,255,255,0.05)',opacity:0.4}}>
              <RotateCcw className="w-3.5 h-3.5"/>
            </button>
          </div>
        </header>

        {/* Log */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          <AnimatePresence initial={false}>
            {gs.logs.map(l=>(
              <motion.div key={l.id} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-xs"
                  style={{
                    background:l.type==='wolf'?'rgba(224,82,82,0.15)':l.type==='seer'?'rgba(167,139,250,0.15)':l.type==='witch'?'rgba(52,211,153,0.15)':l.type==='discussion'?'rgba(255,255,255,0.06)':l.type==='vote'?'rgba(251,191,36,0.12)':'rgba(255,255,255,0.06)',
                    color:l.type==='wolf'?'#e05252':l.type==='seer'?'#a78bfa':l.type==='witch'?'#34d399':l.type==='vote'?'#fbbf24':'#888',
                  }}>
                  {l.type==='wolf'?'🐺':l.type==='seer'?'🔮':l.type==='witch'?'🧙':l.type==='guard'?'🛡':l.type==='hunter'?'🏹':l.type==='vote'?'⚖':l.type==='discussion'?'💬':'📜'}
                </div>
                <div className="flex-1 min-w-0">
                  {l.playerName&&<span className="text-[10px] font-bold uppercase tracking-widest mr-2" style={{color:'#e8c97a',opacity:0.7}}>{l.playerName}</span>}
                  <span className={`text-sm leading-relaxed ${l.type==='discussion'?'italic':''}`}
                    style={{color:l.type==='discussion'?'#e8d5b0':'rgba(255,255,255,0.55)'}}>
                    {l.message}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={logEnd}/>
        </div>

        {/* Action Panel */}
        <div className="flex-shrink-0 px-5 py-4 min-h-28 flex items-center justify-center"
          style={{background:'rgba(0,0,0,0.5)',borderTop:'1px solid rgba(255,255,255,0.06)'}}>
          <AnimatePresence mode="wait">
            {!busy?(
              <motion.div key={phase+gs.currentDiscussionIndex} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="w-full max-w-2xl">

                {/* Guard */}
                {phase===Phase.NIGHT_GUARD&&hr===Role.GUARD&&(
                  <Panel label="守卫：选择守护目标" color={RC[Role.GUARD]}>
                    <Btns>{alive.filter(p=>p.id!==gs.lastGuardTargetId).map(p=><Btn key={p.id} color={RC[Role.GUARD]} onClick={()=>hGuard(p.id)}>{p.id}号</Btn>)}<Btn color="#555" onClick={()=>hGuard(null)}>空守</Btn></Btns>
                  </Panel>
                )}

                {/* Wolf */}
                {phase===Phase.NIGHT_WOLVES&&hr===Role.WEREWOLF&&(
                  <Panel label="狼人：选择今晚击杀目标" color={RC[Role.WEREWOLF]}>
                    <div className="text-center text-xs mb-3 px-3 py-2 rounded-lg"
                      style={{background:'rgba(224,82,82,0.1)',border:'1px solid rgba(224,82,82,0.25)'}}>
                      <span className="opacity-50">🐺 队友：</span>
                      <span className="font-bold ml-1" style={{color:'#e05252'}}>
                        {gs.players.filter(p=>p.role===Role.WEREWOLF&&p.id!==1&&p.isAlive).map(p=>`${p.id}号`).join('、')||'无存活队友'}
                      </span>
                      <div className="text-[10px] opacity-30 mt-0.5">所有狼人各自投票，票数最多者被刀</div>
                    </div>
                    <Btns>{alive.filter(p=>p.role!==Role.WEREWOLF).map(p=><Btn key={p.id} color={RC[Role.WEREWOLF]} onClick={()=>hKillVote(p.id)}>{p.id}号</Btn>)}</Btns>
                  </Panel>
                )}

                {/* Seer */}
                {phase===Phase.NIGHT_SEER&&hr===Role.SEER&&(
                  <Panel label="预言家：选择查验目标" color={RC[Role.SEER]}>
                    <Btns>{alive.filter(p=>!p.isHuman&&!gs.seerRecords.find(r=>r.targetId===p.id)).map(p=><Btn key={p.id} color={RC[Role.SEER]} onClick={()=>hCheck(p.id)}>{p.id}号</Btn>)}</Btns>
                  </Panel>
                )}

                {/* Witch */}
                {phase===Phase.NIGHT_WITCH&&hr===Role.WITCH&&(
                  <Panel label="女巫：使用你的药" color={RC[Role.WITCH]}>
                    <Btns>
                      {gs.witchStatus.hasSavePotion&&gs.nightKilledId&&<Btn color={RC[Role.WITCH]} onClick={()=>hWitch('save')}>💊 救{gs.nightKilledId}号</Btn>}
                      {gs.witchStatus.hasPoisonPotion&&alive.filter(p=>!p.isHuman).map(p=><Btn key={p.id} color={RC[Role.WEREWOLF]} onClick={()=>hWitch('poison',p.id)}>🧪 毒{p.id}号</Btn>)}
                      <Btn color="#555" onClick={()=>hWitch('skip')}>不操作</Btn>
                    </Btns>
                  </Panel>
                )}

                {/* Night waiting */}
                {!phase.startsWith('SHERIFF')&&((phase===Phase.NIGHT_WOLVES&&hr!==Role.WEREWOLF)||(phase===Phase.NIGHT_SEER&&hr!==Role.SEER)||(phase===Phase.NIGHT_WITCH&&hr!==Role.WITCH)||(phase===Phase.NIGHT_GUARD&&hr!==Role.GUARD))&&(
                  <p className="text-center opacity-25 text-sm italic">黑夜漫漫，请闭眼...</p>
                )}

                {/* Night Result */}
                {phase===Phase.NIGHT_RESULT&&!gs.hunterMustShoot&&<CenterBtn onClick={()=>advance()}>确认，天亮了</CenterBtn>}

                {/* Hunter */}
                {gs.hunterMustShoot&&ha&&(
                  <Panel label="猎人！死前可开枪带走一人" color={RC[Role.HUNTER]}>
                    <Btns>{alive.filter(p=>!p.isHuman).map(p=><Btn key={p.id} color={RC[Role.HUNTER]} onClick={()=>hHunter(p.id)}>{p.id}号</Btn>)}<Btn color="#555" onClick={()=>hHunter(null)}>放弃开枪</Btn></Btns>
                  </Panel>
                )}

                {/* Sheriff Elect */}
                {phase===Phase.SHERIFF_ELECT&&(
                  <Panel label="警长竞选：你要上警吗？" color="#fbbf24">
                    <div className="text-xs text-center mb-3 opacity-40">
                      已上警AI：{gs.sheriffCandidates.length>0?gs.sheriffCandidates.map(id=>`${id}号`).join('、'):'暂无（AI还在决定中）'}
                    </div>
                    <Btns>
                      <Btn color="#fbbf24" onClick={()=>hSheriffElect(true)}>⬆️ 参与竞选</Btn>
                      <Btn color="#555" onClick={()=>hSheriffElect(false)}>放弃竞选</Btn>
                    </Btns>
                  </Panel>
                )}

                {/* Sheriff Speech */}
                {phase===Phase.SHERIFF_SPEECH&&gs.currentDiscussionIndex===1&&(
                  <SpeechBox value={speech} onChange={setSpeech} onSubmit={submitSpeech} placeholder="输入竞选发言..."/>
                )}
                {phase===Phase.SHERIFF_SPEECH&&gs.currentDiscussionIndex>1&&(
                  <p className="text-center opacity-40 text-sm italic">{gs.currentDiscussionIndex}号正在竞选发言...</p>
                )}
                {phase===Phase.SHERIFF_SPEECH&&gs.currentDiscussionIndex===0&&(
                  <p className="text-center opacity-25 text-sm italic">等待竞选发言开始...</p>
                )}

                {/* Sheriff Vote */}
                {phase===Phase.SHERIFF_VOTE&&(
                  <Panel label="投票选出警长" color="#fbbf24">
                    <Btns>
                      {gs.sheriffCandidates.map(id=><Btn key={id} color="#fbbf24" onClick={()=>{const v={...gs.votes,1:id};finalizeSheriff(v,gs.voteReasons);}}>投{id}号</Btn>)}
                      <Btn color="#555" onClick={()=>finalizeSheriff(gs.votes,gs.voteReasons)}>弃权</Btn>
                    </Btns>
                  </Panel>
                )}

                {/* Sheriff Result */}
                {phase===Phase.SHERIFF_RESULT&&<CenterBtn onClick={()=>advance()}>确认结果</CenterBtn>}

                {/* Sheriff Handoff */}
                {phase===Phase.SHERIFF_ACTION&&gs.players.find(p=>p.id===gs.sheriffId)?.isHuman&&(
                  <Panel label="你出局了，移交或撕毁警徽" color="#fbbf24">
                    <Btns>
                      {alive.filter(p=>!p.isHuman).map(p=><Btn key={p.id} color="#fbbf24" onClick={()=>doHandoff(p.id)}>传给{p.id}号</Btn>)}
                      <Btn color={RC[Role.WEREWOLF]} onClick={()=>doHandoff(null)}>撕毁警徽</Btn>
                    </Btns>
                  </Panel>
                )}

                {/* Discussion */}
                {phase===Phase.DAY_DISCUSSION&&gs.currentDiscussionIndex===-1&&(
                  <div className="flex flex-col items-center gap-3">
                    {gs.sheriffId===1?(
                      <>
                        <p className="text-xs opacity-40">你是警长，选择发言方向：</p>
                        <Btns><Btn color="#fbbf24" onClick={()=>startDiscussion(1)}>顺时针 →</Btn><Btn color="#fbbf24" onClick={()=>startDiscussion(-1)}>← 逆时针</Btn></Btns>
                      </>
                    ):<CenterBtn onClick={()=>startDiscussion()}>开始辩论</CenterBtn>}
                  </div>
                )}
                {phase===Phase.DAY_DISCUSSION&&gs.currentDiscussionIndex===1&&(
                  <SpeechBox value={speech} onChange={setSpeech} onSubmit={submitSpeech} placeholder="输入你的发言（留空跳过）..."/>
                )}
                {phase===Phase.DAY_DISCUSSION&&gs.currentDiscussionIndex>1&&(
                  <p className="text-center opacity-40 text-sm italic">{gs.currentDiscussionIndex}号玩家正在发言...</p>
                )}

                {/* Day Vote */}
                {phase===Phase.DAY_VOTING&&!humanVoted&&(
                  <Panel label={`投票放逐${gs.sheriffId?` · 警长${gs.sheriffId}号拥有1.5票`:''}`} color={RC[Role.WEREWOLF]}>
                    <Btns>
                      {alive.filter(p=>!p.isHuman&&gs.idiotRevealedId!==p.id).map(p=><Btn key={p.id} color={RC[Role.WEREWOLF]} onClick={()=>humanVote(p.id)}>投{p.id}号</Btn>)}
                      <Btn color="#555" onClick={()=>humanVote(null)}>弃权</Btn>
                    </Btns>
                  </Panel>
                )}
                {phase===Phase.DAY_VOTING&&humanVoted&&<p className="text-center opacity-25 text-sm italic">正在统计AI投票...</p>}

                {/* Day Result */}
                {phase===Phase.DAY_RESULT&&!gs.hunterMustShoot&&<CenterBtn onClick={()=>advance()}>进入夜晚</CenterBtn>}

                {/* Game Over */}
                {phase===Phase.GAME_OVER&&(
                  <div className="text-center space-y-4 py-2">
                    <div className="text-5xl">{gs.winner===Side.GOOD?'🎉':'🐺'}</div>
                    <div className="text-2xl font-black tracking-wider" style={{color:'#e8c97a'}}>
                      {gs.winner===Side.GOOD?'好人阵营胜利！':'狼人阵营胜利！'}
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {gs.players.map(p=>(
                        <span key={p.id} className="px-2 py-1 rounded-lg text-xs"
                          style={{background:`${RC[p.role]}18`,border:`1px solid ${RC[p.role]}30`,color:RC[p.role]}}>
                          {p.id}号 {ROLE_ICONS[p.role]} {ROLE_LABELS[p.role]}
                        </span>
                      ))}
                    </div>
                    <button onClick={()=>{setGs(INITIAL);setSheriffElectDone(false);}}
                      className="px-8 py-3 rounded-xl font-black text-sm transition-all hover:scale-105"
                      style={{background:'#e8c97a',color:'#1a0a00'}}>
                      再来一局
                    </button>
                  </div>
                )}

              </motion.div>
            ):(
              <motion.div className="flex items-center gap-3">
                {[0,1,2].map(i=>(
                  <motion.div key={i} className="w-2 h-2 rounded-full" style={{background:'#e8c97a'}}
                    animate={{scale:[1,1.6,1],opacity:[0.3,1,0.3]}}
                    transition={{duration:1,repeat:Infinity,delay:i*0.2}}/>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ── Mini Components ────────────────────────────────────────────────────────────
function Panel({label,color,children}:{label:string;color:string;children:React.ReactNode}){
  return(
    <div className="w-full space-y-3">
      <div className="text-center text-xs font-bold uppercase tracking-widest" style={{color,opacity:0.8}}>{label}</div>
      {children}
    </div>
  );
}
function Btns({children}:{children:React.ReactNode}){
  return <div className="flex flex-wrap gap-2 justify-center">{children}</div>;
}
function Btn({onClick,color,children}:{onClick:()=>void;color:string;children:React.ReactNode}){
  return(
    <button onClick={onClick}
      className="px-4 py-2 rounded-xl text-sm font-bold transition-all hover:scale-105 active:scale-95"
      style={{background:`${color}20`,border:`1px solid ${color}50`,color}}>
      {children}
    </button>
  );
}
function CenterBtn({onClick,children}:{onClick:()=>void;children:React.ReactNode}){
  return(
    <div className="flex justify-center">
      <button onClick={onClick}
        className="px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
        style={{background:'#e8c97a',color:'#1a0a00'}}>
        {children}<ChevronRight className="w-4 h-4"/>
      </button>
    </div>
  );
}
function SpeechBox({value,onChange,onSubmit,placeholder}:{value:string;onChange:(v:string)=>void;onSubmit:()=>void;placeholder:string}){
  return(
    <div className="flex gap-2 w-full">
      <input value={value} onChange={e=>onChange(e.target.value)}
        onKeyDown={e=>e.key==='Enter'&&onSubmit()}
        placeholder={placeholder}
        className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
        style={{background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',color:'#e8d5b0'}}/>
      <button onClick={onSubmit}
        className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all hover:scale-105"
        style={{background:'#e8c97a',color:'#1a0a00'}}>
        <Send className="w-3.5 h-3.5"/>发言
      </button>
    </div>
  );
}
