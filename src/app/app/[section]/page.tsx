import {currentUser} from "@/lib/auth";
import {redirect,notFound} from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {PUBLIC_DEMO_MODE,demoOrg} from "@/lib/public-demo";
const sections=["dashboard","calendar","appointments","customers","services","staff","branches","resources","waitlist","payments","coupons","reports","notifications","settings","team","audit","packages","feedback","timeOff","holidays","outbox","customerPackages","creditTransactions","packageUsages"];
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{section:string}>}){const {section}=await params;if(!sections.includes(section))notFound();if(PUBLIC_DEMO_MODE)return <AdminShell section={section} org={{name:demoOrg.name,slug:demoOrg.slug}} user={{name:"بازدیدکننده",role:"viewer"}}/>;const a=await currentUser();if(!a)redirect("/login");return <AdminShell section={section} org={{name:a.org.name,slug:a.org.slug}} user={{name:a.user.name,role:a.member.role}}/>;}
