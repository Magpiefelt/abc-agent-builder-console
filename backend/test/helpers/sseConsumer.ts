/**
 * SSE consumer used by integration tests.
 *
 * Supertest .post(...).expect(200) buffers the whole body before returning,
 * which doesn't work for an event stream that's still being written. We instead
 * call .end() ourselves and feed the streaming text into this parser.
 *
 * Filters out heartbeat comments (": heartbeat") and returns typed events.
 * Exposes awaitEvent for event-driven barriers — never use setTimeout.
 */

export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

export class SSECollector {
  readonly events: SSEEvent[] = [];
  private waiters: Array<{ predicate: (e: SSEEvent) => boolean; resolve: (e: SSEEvent) => void; reject: (err: Error) => void }> = [];
  private closed = false;
  private closedReason: string | null = null;

  feed(chunk: string): void {
    if (this.closed) return;
    const lines = chunk.split("\n");
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line) continue;
      if (line.startsWith(":")) continue; // heartbeat / comment
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      let event: SSEEvent;
      try {
        event = JSON.parse(jsonStr) as SSEEvent;
      } catch {
        continue;
      }
      this.events.push(event);
      this.notifyWaiters(event);
    }
  }

  close(reason = "stream-closed"): void {
    this.closed = true;
    this.closedReason = reason;
    const err = new Error(`SSE stream closed (${reason}) before predicate matched.`);
    for (const w of this.waiters) w.reject(err);
    this.waiters = [];
  }

  isClosed(): boolean {
    return this.closed;
  }

  private notifyWaiters(event: SSEEvent): void {
    const remaining: typeof this.waiters = [];
    for (const w of this.waiters) {
      if (w.predicate(event)) {
        w.resolve(event);
      } else {
        remaining.push(w);
      }
    }
    this.waiters = remaining;
  }

  /**
   * Wait for the next event that matches the predicate. Resolves with the event,
   * or rejects if the stream closes first / the timeout elapses.
   */
  awaitEvent(predicate: (e: SSEEvent) => boolean, timeoutMs = 10_000): Promise<SSEEvent> {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);
    if (this.closed) {
      return Promise.reject(new Error(`SSE stream already closed (${this.closedReason}).`));
    }
    return new Promise<SSEEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== entry);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for SSE event.`));
      }, timeoutMs);
      const entry = {
        predicate,
        resolve: (e: SSEEvent) => {
          clearTimeout(timer);
          resolve(e);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      this.waiters.push(entry);
    });
  }

  /** True if events.map(e => e.type) contains the listed types in order (with arbitrary events between). */
  hasSubsequence(types: string[]): boolean {
    let cursor = 0;
    for (const event of this.events) {
      if (event.type === types[cursor]) cursor++;
      if (cursor === types.length) return true;
    }
    return cursor === types.length;
  }

  byType(type: string): SSEEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

/**
 * Drive an Express app via http and collect SSE events.
 * Returns a collector and a promise that resolves when the stream ends.
 */
export async function consumeSSE(
  app: import("express").Express,
  method: "POST" | "GET",
  path: string,
  body?: Record<string, unknown>
): Promise<{ collector: SSECollector; status: number; closed: Promise<void> }> {
  // Lazily import http + supertest types to avoid pulling them into prod bundles
  const http = await import("node:http");
  const server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind ephemeral port for SSE consumer.");
  }
  const port = address.port;

  const collector = new SSECollector();
  let status = 0;

  const closed = new Promise<void>((resolve, reject) => {
    const reqOptions: import("node:http").RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        ...(body ? { "Content-Length": Buffer.byteLength(JSON.stringify(body)) } : {}),
      },
    };

    const clientReq = http.request(reqOptions, (clientRes) => {
      status = clientRes.statusCode || 0;
      clientRes.setEncoding("utf8");
      clientRes.on("data", (chunk: string) => collector.feed(chunk));
      clientRes.on("end", () => {
        collector.close("end");
        server.close(() => resolve());
      });
      clientRes.on("error", (err) => {
        collector.close("error");
        server.close(() => reject(err));
      });
    });

    clientReq.on("error", (err) => {
      collector.close("error");
      server.close(() => reject(err));
    });

    if (body) clientReq.write(JSON.stringify(body));
    clientReq.end();
  });

  // Give the request a moment to send headers so callers can read `status`.
  // We resolve once the response has been seen; for SSE the headers arrive
  // before the body ends, so we expose status via a getter.
  return {
    collector,
    get status() {
      return status;
    },
    closed,
  } as unknown as { collector: SSECollector; status: number; closed: Promise<void> };
}
