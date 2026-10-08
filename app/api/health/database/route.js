import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only application connectivity test.
 * No database rows or credentials are returned to callers.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { ok: false, database: "unconfigured" },
      { status: 503, headers }
    );
  }
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT 1::integer AS connection_check`;
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
