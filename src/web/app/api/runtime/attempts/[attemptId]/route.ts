import { runtimeClient, runtimeErrorResponse } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  try {
    const { attemptId } = await params;
    return Response.json(await runtimeClient().attempt(attemptId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
