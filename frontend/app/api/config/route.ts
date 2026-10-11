import { NextResponse } from "next/server";
import { appConfig } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(appConfig());
}
