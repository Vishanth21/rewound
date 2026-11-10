export type TranscriptProgress = {
  stage: "fetching" | "chunking" | "embedding" | "done" | "error";
  message: string;
  status?: "chunked" | "indexed";
  cues?: number;
  chunks?: number;
  warning?: string;
  error?: string;
};

export function transcriptProgressResponse(run: (report: (progress: TranscriptProgress) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const report = (progress: TranscriptProgress) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(progress)}\n`));
        } catch {
          // The client may leave the page while ingestion continues.
        }
      };
      void run(report).catch((error) => {
        const message = error instanceof Error ? error.message : "Transcript processing failed.";
        report({ stage: "error", message, error: message });
      }).finally(() => {
        try {
          controller.close();
        } catch {
          // The stream was already cancelled by the client.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
