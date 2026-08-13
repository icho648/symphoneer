export type SseFrame = {
  event: string;
  data: string;
};

export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  const dispatch = (): SseFrame | undefined => {
    const frame = dataLines.length ? { event: eventName, data: dataLines.join("\n") } : undefined;
    eventName = "message";
    dataLines = [];
    return frame;
  };
  const consume = (line: string): SseFrame | undefined => {
    if (line === "") return dispatch();
    if (line.startsWith("event:")) eventName = line.slice(6).trimStart() || "message";
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    return undefined;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const frame = consume(line);
      if (frame) yield frame;
    }
  }
  buffer += decoder.decode();
  if (buffer) {
    const frame = consume(buffer);
    if (frame) yield frame;
  }
  const frame = dispatch();
  if (frame) yield frame;
}
