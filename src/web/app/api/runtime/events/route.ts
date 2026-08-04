import { runtimeErrorResponse, runtimeUrl } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const incoming = new URL(request.url);
    const after = incoming.searchParams.get("after") ?? "0";
    const response = await fetch(
      `${runtimeUrl()}/v1/events/stream?after=${encodeURIComponent(after)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return new Response(response.body, { status: response.status });
    return new Response(response.body, {
      status: 200,
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
