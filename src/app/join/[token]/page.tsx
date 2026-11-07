import {PUBLIC_DEMO_MODE} from "@/lib/public-demo";
import {redirect} from "next/navigation";
import JoinTeam from '@/components/JoinTeam';
export default async function Page({params}:{params:Promise<{token:string}>}) {if(PUBLIC_DEMO_MODE)redirect("/app/dashboard");const {token}=await params;return <JoinTeam token={token}/>;}
