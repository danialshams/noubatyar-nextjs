import {PUBLIC_DEMO_MODE} from "@/lib/public-demo";
import {redirect} from "next/navigation";
import ManageReservation from "@/components/ManageReservation";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{token:string}>}){if(PUBLIC_DEMO_MODE)redirect("/app/dashboard");const{token}=await params;return <ManageReservation token={token}/>;}
