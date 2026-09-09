import React, { useEffect, useRef } from 'react';
import { Player, Role, GameLog, SeerRecord, Side } from './types';
import { CHARACTER_ART, ROLE_ART } from './artAssets';
import { ROLE_LABELS } from './constants';

// Remove only neutral pixels connected to the outside of the supplied portrait.
// Interior details (eyes, clothes, tools) are never globally keyed out.
function Resident({ src, portrait }: { src: string; portrait: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      const canvas = ref.current;
      if (!canvas || cancelled) return;
      canvas.width = 420; canvas.height = Math.round(420 * image.height / image.width);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (!portrait) return;
      const { width:w, height:h } = canvas;
      const pixels = ctx.getImageData(0,0,w,h), d = pixels.data;
      const visited = new Uint8Array(w*h), queue = new Int32Array(w*h);
      let read=0, write=0;
      const add = (i:number) => {
        if (i<0 || i>=w*h || visited[i]) return;
        visited[i]=1;
        const p=i*4, max=Math.max(d[p],d[p+1],d[p+2]), min=Math.min(d[p],d[p+1],d[p+2]);
        if (max-min>5 || min<90 || max>155) return;
        queue[write++]=i; d[p+3]=0;
      };
      for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}
      for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}
      while(read<write){const i=queue[read++]; if(i%w>0)add(i-1);if(i%w<w-1)add(i+1);add(i-w);add(i+w);}
      ctx.putImageData(pixels,0,0);
    };
    image.src=src;
    return ()=>{cancelled=true;};
  },[src,portrait]);
  return <canvas ref={ref} className={portrait ? 'resident-art' : 'resident-art identity-resident'} aria-hidden="true"/>;
}

const positions = [
  [9,53,.85],[25,53,.85],[41,53,.85],[59,53,.85],[75,53,.85],[91,53,.85],
  [91,91,1],[75,91,1],[59,91,1],[41,91,1],[25,91,1],[9,91,1],
];

export function VillageStage({players,activeId,sheriffId,idiotId,humanRole,seerRecords,revealAll,selected,selectable,candidates,onSelect,logs,busy}:{
  players:Player[];activeId:number;sheriffId?:number;idiotId?:number;humanRole:Role;revealAll:boolean;
  selected:number|null;selectable:boolean;candidates:number[];onSelect:(id:number)=>void;logs:GameLog[];busy:boolean;
  seerRecords: SeerRecord[];
}) {
  const humanIndex=players.findIndex(p=>p.isHuman);
  const latest=logs[logs.length-1];
  const spoken=latest?.type==='discussion' ? latest : undefined;
  const spokenSeat=spoken?.playerName?.match(/^(\d+)号/);
  const speaker=spoken ? players.find(p=>p.id===Number(spokenSeat?.[1]) || spoken.playerName?.includes(p.name)) : undefined;
  return <section className="village-stage" aria-label="村庄广场，十二名村民">
    <div className="stage-haze"/><div className="council-ground"/>
    <div className="village-fire" aria-hidden="true"><i/><i/><i/><span/></div>
    {players.map((p,index)=>{
      const slot=(index-humanIndex+9+12)%12;
      const [x,y,scale]=positions[slot];
      const talking=p.id===(speaker?.id ?? activeId);
      const known=revealAll || p.isHuman || idiotId===p.id;
      const eligible=selectable && candidates.includes(p.id);
      const check=humanRole===Role.SEER ? seerRecords.find(r=>r.targetId===p.id) : undefined;
      return <div key={p.id} className={`resident ${p.isAlive?'':'departed'} ${talking?'speaking':''} ${selected===p.id?'chosen':''}`}
        style={{left:`${x}%`,top:`${y}%`,zIndex:talking?100:Math.round(y), '--scale':scale, '--delay':`${index*-.43}s`} as React.CSSProperties}>
        <button className={`resident-target ${eligible?'eligible':''}`} disabled={!eligible} onClick={()=>onSelect(p.id)} aria-label={`${p.id}号 ${p.isHuman?'你':p.name}${eligible?'，点击选择':''}`} aria-pressed={selected===p.id}>
          <div className="resident-shadow"/>
          <Resident src={p.isHuman?ROLE_ART[p.role]:CHARACTER_ART[p.name]} portrait={!p.isHuman}/>
          {humanRole===Role.WEREWOLF && p.role===Role.WEREWOLF && !p.isHuman && <span className="wolf-hood" title="狼人同伴">狼</span>}
          {sheriffId===p.id && <span className="sheriff-pin">♛</span>}
          {selected===p.id && <span className="vote-seal">选定</span>}
        </button>
        <div className="resident-name"><b>{p.id.toString().padStart(2,'0')}</b><span>{p.isHuman?'你':p.name}</span>{known && <small>{ROLE_LABELS[p.role]}</small>}{!p.isAlive && <small>已出局</small>}</div>
        {check && <span className={`seer-mark ${check.side===Side.GOOD?'good':'wolf'}`}>查验：{check.side===Side.GOOD?'好人':'狼人'} · 仅你可见</span>}
      </div>;
    })}
    {spoken && <div className="speech-bubble stage-dialogue" key={spoken.id}><small>{spoken.playerName} · 正在发言</small><p>{spoken.message}</p></div>}
    {!spoken && latest && <div className="scene-announcement" key={latest.id}><small>{busy?'村庄里的声音':'守夜人'}</small><p>{latest.message}</p></div>}
    <div className="foreground-fog"/>
  </section>;
}
