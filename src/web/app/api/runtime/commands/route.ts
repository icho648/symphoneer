import { runtimeClient, runtimeErrorResponse } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return Response.json(await runtimeClient().command(await request.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
