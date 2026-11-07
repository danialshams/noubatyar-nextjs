import BookingWizard from "@/components/BookingWizard";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{slug:string;staffSlug:string}>}){const{slug,staffSlug}=await params;return <BookingWizard slug={slug} staffSlug={staffSlug}/>;}
