'use client';
import {useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {CalendarCheck2} from 'lucide-react';
import {api,post} from '@/lib/client';
export default function JoinTeam({token}:{token:string}){
 const router=useRouter();const[invite,setInvite]=useState<{business:string;role:string;email:string}|null>(null);
 const[error,setError]=useState(''),[busy,setBusy]=useState(false),[name,setName]=useState(''),[password,setPassword]=useState('');
 useEffect(()=>{void api<{business:string;role:string;email:string}>('/api/auth/invite?token='+encodeURIComponent(token)).then(setInvite).catch((e:Error)=>setError(e.message));},[token]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await post('/api/auth/accept-invite',{token,name,password});router.replace('/app/dashboard');router.refresh();}catch(e){setError(e instanceof Error?e.message:'دعوت‌نامه قابل استفاده نیست');}finally{setBusy(false);}}
 return <main className="auth-page"><div className="auth-center" style={{width:'100%'}}><div className="auth-card"><Link href="/" className="logo"><CalendarCheck2/> نوبت‌یار</Link><h1>پیوستن به تیم</h1>{invite?<><p>برای پیوستن به مجموعه <strong>{invite.business}</strong> با نقش <strong>{invite.role==='manager'?'مدیر':'متخصص'}</strong> دعوت شده‌اید.</p><p>ایمیل دعوت‌شده: <strong dir="ltr">{invite.email}</strong></p><form className="form-stack" onSubmit={submit}><label>نام نمایشی (اگر قبلاً حساب ندارید)<input minLength={2} value={name} onChange={e=>setName(e.target.value)}/></label><label>رمز عبور حساب (برای ساخت حساب جدید حداقل ۱۰ کاراکتر)<input type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="btn btn-primary" disabled={busy} type="submit">{busy?'در حال تأیید...':'پیوستن به مجموعه'}</button></form></>:!error?<p>در حال بررسی دعوت‌نامه...</p>:null}{error&&<div className="error-box">{error}</div>}</div></div></main>;
}
