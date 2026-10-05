// Reading the Server-Sent Events of POST /api/agent in the browser (EventSource only does GET).
// Pure: fed with decoded text chunks, calls `onEvent` with each complete event's JSON.

export function createSseParser(onEvent: (type: string, data: unknown) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let type = "message";
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) type = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length === 0) continue;
      try {
        onEvent(type, JSON.parse(data.join("\n")));
      } catch {
        // A malformed event is skipped; the turn still ends with done or error.
      }
    }
  };
}
