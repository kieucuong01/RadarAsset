import { getPrisma } from "@/lib/db/prisma";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const release = process.env.DATAVEST_RELEASE_SHA ?? "unknown";

  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", service: "datavest-web", release }, { headers });
  } catch {
    return Response.json(
      { status: "unavailable", service: "datavest-web", release },
      { status: 503, headers },
    );
  }
}
