import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"نوبت‌یار | مدیریت رزرو و نوبت‌دهی",description:"پنل حرفه‌ای رزرو آنلاین، تقویم شمسی، مدیریت مشتریان و نوبت‌دهی چندشعبه‌ای"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fa" dir="rtl"><body>{children}</body></html>;}
