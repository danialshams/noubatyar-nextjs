'use client';
import {useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,CalendarDays} from 'lucide-react';
import {daysFrom,todayAt,validDate} from '@/lib/time';
const fmt=new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
const numeric=new Intl.DateTimeFormat('en-u-ca-persian-nu-latn',{year:'numeric',month:'numeric',day:'numeric',timeZone:'UTC'});
const digits=(n:number)=>new Intl.NumberFormat('fa-IR').format(n);
function parts(day:string){const x=Object.fromEntries(numeric.formatToParts(new Date(day+'T12:00:00Z')).map(p=>[p.type,p.value]));return {year:Number(x.year),month:Number(x.month),day:Number(x.day)};}
function monthStart(day:string){let d=day;for(let i=0;i<32&&parts(d).day>1;i++)d=daysFrom(d,-1);return d;}
function nextMonth(day:string){const start=monthStart(day),p=parts(start);let d=daysFrom(start,27);for(let i=0;i<6;i++,d=daysFrom(d,1))if(parts(d).month!==p.month||parts(d).year!==p.year)return d;throw new Error('Month calculation failed');}
function prevMonth(day:string){return monthStart(daysFrom(monthStart(day),-1));}
const week=['ش','ی','د','س','چ','پ','ج'];
export default function PersianCalendar({value,onChange,timeZone='Asia/Tehran',maxDays=60}:{value:string;onChange:(d:string)=>void;timeZone?:string;maxDays?:number}){
 const current=todayAt(timeZone);const [view,setView]=useState(validDate(value)?monthStart(value):monthStart(current));
 const start=monthStart(view);const month=parts(start),firstDay=(new Date(start+'T12:00:00Z').getUTCDay()+1)%7;
 const days=useMemo(()=>Array.from({length:42},(_,i)=>daysFrom(start,i-firstDay)),[start,firstDay]);
 const heading=fmt.format(new Date(start+'T12:00:00Z')).replace(/\d+/g,'').trim();
 return <div className="jalali-calendar" role="group" aria-label="تقویم شمسی انتخاب نوبت">
   <div className="jalali-toolbar"><button type="button" className="icon-btn" title="ماه قبل" onClick={()=>setView(prevMonth(start))}><ChevronRight size={18}/></button><strong><CalendarDays size={16}/> {heading} {digits(month.year)}</strong><button type="button" className="icon-btn" title="ماه بعد" onClick={()=>setView(nextMonth(start))}><ChevronLeft size={18}/></button></div>
   <div className="jalali-grid">{week.map((d,i)=><span className="jalali-week" key={i}>{d}</span>)}{days.map(d=>{
    const visible=parts(d).month===month.month&&parts(d).year===month.year;
    const disabled=d<current||d>daysFrom(current,maxDays);
    return <button type="button" key={d} disabled={disabled} className={`${visible?'':'muted'} ${value===d?'selected':''} ${current===d?'today':''}`} title={fmt.format(new Date(d+'T12:00:00Z'))} aria-pressed={value===d} onClick={()=>onChange(d)}>{digits(parts(d).day)}</button>;
   })}</div><div className="jalali-footer"><span>تاریخ انتخابی: {value?fmt.format(new Date(value+'T12:00:00Z')):'انتخاب نشده'}</span><button type="button" onClick={()=>{setView(monthStart(current));onChange(current);}}>امروز</button></div>
 </div>;
}
