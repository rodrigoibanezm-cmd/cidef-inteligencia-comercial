// Integration boundary: only expose certified P1/P2/P3 outputs from the Azure backend.
// Until a verified engine/API transport and its auth are configured, fail closed.
// No Neon, local JSON snapshots, demo numbers or browser-facing credentials.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return Response.json(
    { error: "AZURE_ENGINE_INTEGRATION_PENDING", message: "No certified Azure engine API is configured." },
    { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
