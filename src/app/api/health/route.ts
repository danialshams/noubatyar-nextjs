import { NextResponse } from "next/server";
export function GET(){return NextResponse.json({status:"ok",product:"noubatyar",version:"1.0.0",runtime:"nextjs"});}
