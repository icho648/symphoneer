import { runtimeClient, runtimeErrorResponse } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await runtimeClient().health(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
