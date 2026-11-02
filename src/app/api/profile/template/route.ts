import { NextRequest, NextResponse } from "next/server";
import { makeTemplateZip } from "../../../../intake/archive";
import { checkLocalRequest } from "../../../../intake/local-store";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { checkLocalRequest(request); const bytes = makeTemplateZip(); return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/zip", "content-disposition": "attachment; filename=job-agent-template.zip", "cache-control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Template failed" }, { status: 400 }); }
}
