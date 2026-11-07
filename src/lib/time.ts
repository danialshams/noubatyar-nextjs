/** IANA-aware time helpers. UTC is persisted; local business time is used for scheduling. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone:string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
      hourCycle: 'h23', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'
    });
    formatters.set(zone,f);
  }
  return f;
}
function parts(date:Date,zone:string) {
  const p:Record<string,number>={};
  for (const part of formatter(zone).formatToParts(date)) if (part.type !== 'literal') p[part.type]=Number(part.value);
  return p;
}
function offset(date:Date,zone:string):number {
  const p=parts(date,zone);
  return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute,p.second) - Math.floor(date.getTime()/1000)*1000;
}
export const hminutes = (v: string) => {const p=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);if(!p)throw new Error('ساعت نامعتبر است');return Number(p[1])*60+Number(p[2]);};
export const timeString=(minutes:number)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
export function zonedDate(day:string,minutes:number,zone:string):Date {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new RangeError('تاریخ نامعتبر است');
  const wallClock=new Date(`${day}T00:00:00.000Z`);
  if(Number.isNaN(wallClock.getTime()) || !Number.isFinite(minutes))throw new RangeError('تاریخ یا زمان نامعتبر است');
  wallClock.setUTCMinutes(wallClock.getUTCMinutes()+minutes);
  const local=wallClock.getTime();let current=local;
  for(let i=0;i<4;i++){const next=local-offset(new Date(current),zone);if(next===current)break;current=next;}
  const result=new Date(current),p=parts(result,zone);
  if(Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute)!==local)throw new RangeError('این ساعت به دلیل تغییر ساعت رسمی وجود ندارد');
  return result;
}
export function todayAt(zone:string,date=new Date()):string {
  const p=parts(date,zone);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
/** Weekdays use Monday=0 ... Sunday=6 throughout database and UI. */
export function weekday(day:string):number {const d=new Date(`${day}T12:00:00Z`);if(Number.isNaN(d.getTime()))throw new RangeError('تاریخ نامعتبر است');return (d.getUTCDay()+6)%7;}
export function persianDate(input:Date|string,zone='Asia/Tehran') {return new Intl.DateTimeFormat('fa-IR-u-ca-persian',{year:'numeric',month:'long',day:'numeric',weekday:'long',timeZone:zone}).format(new Date(input));}
export function localTime(input:Date|string,zone='Asia/Tehran') {const p=parts(new Date(input),zone);return `${String(p.hour%24).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`;}
export function daysFrom(day:string,days:number):string {const d=new Date(`${day}T12:00:00Z`);if(Number.isNaN(d.getTime()))throw new RangeError('تاریخ نامعتبر است');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function validDate(day:string):boolean {if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;const d=new Date(`${day}T12:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===day;}
