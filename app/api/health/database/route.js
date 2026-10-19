import { NextResponse } from "next/server";
import { db } from "../../../../lib/db.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only Azure PostgreSQL connectivity test.
 * No database rows or credentials are returned to callers.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!process.env.AZURE_DATABASE_URL) {
    return NextResponse.json(
      { ok: false, database: "unconfigured" },
      { status: 503, headers }
    );
  }
  try {
    const rows = await db()`SELECT 1::integer AS connection_check`;
    if (rows?.[0]?.connection_check !== 1) {
      return NextResponse.json(
        { ok: false, database: "unavailable" },
        { status: 503, headers }
      );
    }
    return NextResponse.json(
      { ok: true, database: "connected", mode: "read-only-check" },
      { headers }
    );
  } catch (error) {
    console.error("[db-health] Connection check failed:", error?.name || "UnknownError");
    return NextResponse.json(
      { ok: false, database: "unavailable" },
      { status: 503, headers }
    );
  }
}
