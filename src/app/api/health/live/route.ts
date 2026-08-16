const headers = { "Cache-Control": "no-store" };

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "datavest-web",
      release: process.env.DATAVEST_RELEASE_SHA ?? "unknown",
    },
    { headers },
  );
}
