export const dynamic = "force-dynamic";

function isSameOrigin(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const originHeader = request.headers.get("origin");
  if (originHeader) return originHeader === requestOrigin;

  const refererHeader = request.headers.get("referer");
  if (!refererHeader) return false;
  try {
    return new URL(refererHeader).origin === requestOrigin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }

  return Response.json(
    {
      error:
        "Quotation payment receipts are retired. Record any project collection in Finance > Cash In & Cash Out.",
    },
    { status: 410 },
  );
}
