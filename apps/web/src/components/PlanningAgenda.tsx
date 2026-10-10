'use client';
import { tr } from '@/lib/ui-language';
import { Truck, Users, Plus, AlertTriangle } from 'lucide-react';
import type { PlanningEv } from './planningTypes';
import { vehicleLabel } from '@/lib/vehicle';
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function PlanningAgenda({days, events, onOpen, onNew, onMove}: {
  days: Date[]; events: PlanningEv[]; onOpen: (event: PlanningEv) => void;
  onNew: (date: string) => void; onMove: (event: PlanningEv, date: string) => void;
}) {
  return <section className="agenda-week" aria-label="Agenda des affectations">
    {days.map(day => {
      const key=dayKey(day);
      const entries=events.filter(e => new Date(e.startAt)<new Date(day.getFullYear(),day.getMonth(),day.getDate()+1) && new Date(e.endAt)>day).sort((a,b)=>a.startAt.localeCompare(b.startAt));
      return <section key={key} className={`agenda-day ${key===dayKey(new Date())?'is-today':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const ev=events.find(x=>x.id===e.dataTransfer.getData('text/plain'));if(ev)onMove(ev,key);}}>
        <header><span>{day.toLocaleDateString('fr-BE',{weekday:'short'})}</span><strong>{day.getDate()}</strong><small>{entries.length} affectation{entries.length!==1?'s':''}</small></header>
        {entries.map(event => {
          const seats=event.vehicles.reduce((n,v)=>n+(v.vehicle.seats??0),0);
          const unknownSeats=event.vehicles.some(v=>v.vehicle.seats===null);
          const missingDriver=event.vehicles.some(v=>!v.driver);
          const transportWarning=missingDriver || (!unknownSeats && event.vehicles.length>0 && seats<event.assignments.length);
          return <button key={event.id} draggable onDragStart={e=>e.dataTransfer.setData('text/plain',event.id)} className={`agenda-event ${event.kind==='meeting'?'meeting kind-meeting':'kind-intervention'}`} onClick={()=>onOpen(event)}>
            <div className="agenda-event-time">{new Date(event.startAt).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})} – {new Date(event.endAt).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})}</div>
            <small>{event.kind==='meeting'?tr("Rendez-vous"):'Travaux'} · {event.worksite.ref}</small>
            <strong>{event.title || event.worksite.title}</strong><span>{event.worksite.city}</span>
            <div className="agenda-team"><Users size={14}/>{event.assignments.length} personne{event.assignments.length!==1?'s':''}</div>
            <span className="agenda-names">{event.assignments.map(a=>a.person.displayName||a.person.firstName).join(', ') || 'Équipe à affecter'}</span>
            {event.vehicles.map(v=><div key={v.vehicle.id} className="agenda-vehicle"><Truck size={14}/><span>{vehicleLabel(v.vehicle)} · {v.driver?.displayName||v.driver?.firstName||'Conducteur à définir'}</span></div>)}
            {event.vehicles.length>0 && <small>{unknownSeats?'Capacité à vérifier':`${event.assignments.length} personnes / ${seats} places au total`}</small>}
            {transportWarning && <span className="agenda-warning"><AlertTriangle size={14}/>Transport à vérifier</span>}
            {event.status==='tentative' && <span className="agenda-warning">Provisoire</span>}
          </button>;
        })}
        <button className="agenda-add" onClick={()=>onNew(key)}><Plus size={16}/> {tr("Ajouter")}</button>
      </section>;
    })}
  </section>;
}
