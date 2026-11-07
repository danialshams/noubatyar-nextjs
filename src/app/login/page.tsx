import {redirect} from "next/navigation";
import {PUBLIC_DEMO_MODE} from "@/lib/public-demo";
import AuthForm from "@/components/AuthForm";
export default function Page(){if(PUBLIC_DEMO_MODE)redirect("/app/dashboard");return <AuthForm mode="login"/>}
