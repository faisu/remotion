import Anthropic from "@anthropic-ai/sdk";
import { DYNAMIC_COMP_NAME } from "../../../../types/video-schema";

const missingApiKeyMessage =
  "Missing ANTHROPIC_API_KEY. Add it to .env.local and restart the dev server.";

const authFailureMessage =
  "Anthropic authentication failed. Check ANTHROPIC_API_KEY in .env.local and restart the dev server.";

function createAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(missingApiKeyMessage);
  }

  return new Anthropic({ apiKey });
}

function getChatErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error ? error.message : "Unknown chat server error";

  if (rawMessage.includes("Could not resolve authentication method")) {
    return authFailureMessage;
  }

  return rawMessage;
}

const generateVideoTool: Anthropic.Tool = {
  name: "generate_video",
  description:
    "Generate a dynamic animated video using Remotion. Use this when the user asks to create, generate, or make a video. Returns a URL to the rendered MP4 video.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description: "Main title text displayed prominently in the video",
      },
      subtitle: {
        type: "string",
        description: "Subtitle or description text below the title",
      },
      backgroundColor: {
        type: "string",
        description:
          "Background color as a hex code (e.g., #0f172a for dark, #ffffff for white)",
      },
      accentColor: {
        type: "string",
        description: "Accent/highlight color as a hex code (e.g., #6366f1 for indigo)",
      },
      textColor: {
        type: "string",
        description: "Text color as a hex code (e.g., #ffffff for white, #1e293b for dark)",
      },
      items: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of bullet points or key facts to display (max 6)",
      },
      style: {
        type: "string",
        enum: ["minimal", "bold", "cinematic"],
        description:
          "Visual style: minimal (clean), bold (high contrast), cinematic (dramatic with glow)",
      },
      durationInSeconds: {
        type: "number",
        description: "Video duration in seconds (2-30, default 6)",
      },
    },
    required: ["title"],
  },
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "render_progress"; phase: string; progress: number }
  | { type: "render_done"; url: string; size: number }
  | { type: "render_error"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

function formatSSE(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function runRenderAndStream(
  input: Record<string, unknown>,
  origin: string,
  send: (event: ChatEvent) => void,
): Promise<string> {
  const videoProps = {
    title: input.title ?? "Generated Video",
    subtitle: input.subtitle ?? "",
    backgroundColor: input.backgroundColor ?? "#0f172a",
    accentColor: input.accentColor ?? "#6366f1",
    textColor: input.textColor ?? "#ffffff",
    items: input.items ?? [],
    style: input.style ?? "minimal",
    durationInSeconds: input.durationInSeconds ?? 6,
  };

  const response = await fetch(`${origin}/api/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      compositionId: DYNAMIC_COMP_NAME,
      inputProps: videoProps,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Render API failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let videoUrl = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6);
      const msg = JSON.parse(json) as {
        type: string;
        phase?: string;
        progress?: number;
        url?: string;
        size?: number;
        message?: string;
      };

      if (msg.type === "phase") {
        send({
          type: "render_progress",
          phase: msg.phase ?? "",
          progress: msg.progress ?? 0,
        });
      } else if (msg.type === "done" && msg.url) {
        videoUrl = msg.url;
        send({ type: "render_done", url: msg.url, size: msg.size ?? 0 });
      } else if (msg.type === "error") {
        send({ type: "render_error", message: msg.message ?? "Unknown error" });
        throw new Error(msg.message ?? "Render failed");
      }
    }
  }

  return videoUrl;
}

export async function POST(req: Request) {
  const { messages }: { messages: ChatMessage[] } = await req.json();

  const origin = new URL(req.url).origin;

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = (event: ChatEvent) => {
    writer.write(encoder.encode(formatSSE(event)));
  };

  const run = async () => {
    try {
      const client = createAnthropicClient();
      const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Agentic loop
      while (true) {
        const response = await client.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 4096,
          system: `You are a helpful AI assistant that can chat naturally and also generate dynamic animated videos using Remotion.

When a user asks you to create or generate a video, use the generate_video tool. Be creative with colors, styles, and content.

For colors, use harmonious combinations. Some ideas:
- Dark tech: backgroundColor=#0f172a, accentColor=#6366f1, textColor=#ffffff
- Warm sunset: backgroundColor=#1a0a00, accentColor=#f97316, textColor=#fef3c7
- Ocean: backgroundColor=#0c1445, accentColor=#06b6d4, textColor=#e0f7ff
- Nature: backgroundColor=#052e16, accentColor=#22c55e, textColor=#dcfce7
- Minimal light: backgroundColor=#ffffff, accentColor=#6366f1, textColor=#0f172a

After generating a video, tell the user it's ready and describe what was created.`,
          tools: [generateVideoTool],
          messages: apiMessages,
        });

        // Stream text content
        for (const block of response.content) {
          if (block.type === "text" && block.text) {
            send({ type: "text_delta", text: block.text });
          }
        }

        if (response.stop_reason === "end_turn") {
          break;
        }

        if (response.stop_reason === "tool_use") {
          const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );

          // Add assistant turn
          apiMessages.push({ role: "assistant", content: response.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const toolUse of toolUseBlocks) {
            if (toolUse.name === "generate_video") {
              const input = toolUse.input as Record<string, unknown>;
              send({ type: "tool_start", name: "generate_video", input });

              try {
                const videoUrl = await runRenderAndStream(input, origin, send);
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: `Video generated successfully! URL: ${videoUrl}`,
                });
              } catch (err) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: `Error generating video: ${(err as Error).message}`,
                  is_error: true,
                });
              }
            } else {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Unknown tool: ${toolUse.name}`,
                is_error: true,
              });
            }
          }

          apiMessages.push({ role: "user", content: toolResults });
          continue;
        }

        break;
      }

      send({ type: "done" });
    } catch (err) {
      send({ type: "error", message: getChatErrorMessage(err) });
    } finally {
      await writer.close();
    }
  };

  run();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
