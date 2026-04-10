import Anthropic from "@anthropic-ai/sdk";
import {
  DYNAMIC_COMP_NAME,
  DynamicVideoProps,
  type DynamicVideoPropsType,
} from "../../../../types/video-schema";

const LIMITS = {
  MAX_MESSAGES: 20,
  MAX_CHARS_PER_MESSAGE: 4_000,
  MAX_TOTAL_CONTEXT_CHARS: 32_000,
  MAX_TOOL_LOOPS: 3,
} as const;

function trimConversation(messages: ChatMessage[]): ChatMessage[] {
  let trimmed = messages.slice(-LIMITS.MAX_MESSAGES);

  trimmed = trimmed.map((m) => ({
    ...m,
    content:
      m.content.length > LIMITS.MAX_CHARS_PER_MESSAGE
        ? m.content.slice(0, LIMITS.MAX_CHARS_PER_MESSAGE - 12) + " [truncated]"
        : m.content,
  }));

  let totalChars = trimmed.reduce((sum, m) => sum + m.content.length, 0);
  while (totalChars > LIMITS.MAX_TOTAL_CONTEXT_CHARS && trimmed.length > 1) {
    totalChars -= trimmed[0].content.length;
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

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
    "Generate a dynamic animated video with scene-by-scene storytelling using text and AI-generated images.",
  input_schema: {
    type: "object" as const,
    properties: {
      topic: {
        type: "string",
        description: "The topic to explain in the video",
      },
      mode: {
        type: "string",
        enum: ["short", "detailed", "narrated"],
        description:
          "Video depth mode: short (4-6 concise scenes), detailed (8-12 sections), narrated (longer scene paragraphs)",
      },
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
        description: "Legacy optional bullet points for the first scene (max 6)",
      },
      scenes: {
        type: "array",
        description: "Scene list to drive the timeline. Prefer this over items.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            bullets: {
              type: "array",
              items: { type: "string" },
              description: "Key points for this scene",
            },
            imagePrompt: {
              type: "string",
              description:
                "Prompt used to generate a scene image. Keep visual, concrete, and style-aware.",
            },
            imageUrl: {
              type: "string",
              description: "Optional pre-existing image URL to use directly",
            },
            durationInSeconds: {
              type: "number",
              description: "Scene duration in seconds",
            },
            layout: {
              type: "string",
              enum: ["text", "image-left", "image-right", "image-background"],
            },
          },
          required: ["title"],
        },
      },
      style: {
        type: "string",
        enum: ["minimal", "bold", "cinematic"],
        description:
          "Visual style: minimal (clean), bold (high contrast), cinematic (dramatic with glow)",
      },
      durationInSeconds: {
        type: "number",
        description: "Overall video duration in seconds (2-120)",
      },
    },
    required: ["title", "mode"],
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
  input: DynamicVideoPropsType,
  origin: string,
  send: (event: ChatEvent) => void,
): Promise<string> {
  const videoProps = DynamicVideoProps.parse(input);

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

function encodeImagePrompt(prompt: string): string {
  return encodeURIComponent(prompt.trim().replace(/\s+/g, " "));
}

const IMAGE_FETCH_TIMEOUT_MS = 8000;
const MIN_IMAGE_BYTES = 512;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function hasKnownImageSignature(
  bytes: Uint8Array,
  contentType: string
): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) {
    return bytes[0] === 0xff && bytes[1] === 0xd8;
  }
  if (ct.includes("png")) {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  if (ct.includes("webp")) {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  if (ct.includes("gif")) {
    return (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    );
  }
  return false;
}

async function validateRemoteImage(url: string): Promise<void> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed with status ${response.status}`);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`Expected image content-type, got ${contentType || "unknown"}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < MIN_IMAGE_BYTES) {
    throw new Error(`Image payload too small (${bytes.length} bytes)`);
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image payload too large (${bytes.length} bytes)`);
  }
  if (!hasKnownImageSignature(bytes, contentType)) {
    throw new Error(`Image signature mismatch for ${contentType}`);
  }
}

async function generateSceneImage(prompt: string, seed: number): Promise<string> {
  const encodedPrompt = encodeImagePrompt(prompt);
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&model=flux&nologo=true&seed=${seed}&nocache=${Date.now()}`;
  try {
    await validateRemoteImage(pollinationsUrl);
    return pollinationsUrl;
  } catch {
    const picsumUrl = `https://picsum.photos/seed/${seed}-dynamic-scene/1280/720.jpg`;
    await validateRemoteImage(picsumUrl);
    return picsumUrl;
  }
}

function expandScenesByMode(props: DynamicVideoPropsType): DynamicVideoPropsType {
  const minSceneCountByMode = {
    short: 4,
    detailed: 8,
    narrated: 4,
  } as const;
  const target = minSceneCountByMode[props.mode];
  if (props.scenes.length >= target) {
    return props;
  }

  const baseTopic = props.topic || props.title;
  const seedBullets = props.items.length
    ? props.items
    : ["Core idea", "Practical example", "Key takeaway"];

  const generatedScenes = [...props.scenes];
  while (generatedScenes.length < target) {
    const index = generatedScenes.length + 1;
    const seedBullet = seedBullets[(index - 1) % seedBullets.length];
    generatedScenes.push({
      title: `${baseTopic}: Part ${index}`,
      body:
        props.mode === "narrated"
          ? `This segment explains ${seedBullet.toLowerCase()} in the context of ${baseTopic}.`
          : `${seedBullet} for ${baseTopic}.`,
      bullets:
        props.mode === "narrated"
          ? []
          : [`Why it matters`, `What to look for`, `Actionable insight`],
      layout: index % 2 === 0 ? "image-left" : "image-right",
      imagePrompt: `${baseTopic}, ${seedBullet}, cinematic educational illustration`,
      durationInSeconds: props.mode === "detailed" ? 4 : props.mode === "narrated" ? 6 : 3,
    });
  }

  return DynamicVideoProps.parse({ ...props, scenes: generatedScenes });
}

async function attachGeneratedImages(
  props: DynamicVideoPropsType,
  send: (event: ChatEvent) => void,
): Promise<DynamicVideoPropsType> {
  send({
    type: "render_progress",
    phase: "Generating scene images...",
    progress: 0.05,
  });

  const nextScenes: DynamicVideoPropsType["scenes"] = [];
  for (const [index, scene] of props.scenes.entries()) {
    if (scene.imageUrl) {
      nextScenes.push(scene);
      continue;
    }

    if (!scene.imagePrompt) {
      nextScenes.push({ ...scene, layout: "text" });
      continue;
    }

    try {
      const imageUrl = await generateSceneImage(scene.imagePrompt, index + 1);
      nextScenes.push({
        ...scene,
        imageUrl,
        layout: scene.layout === "text" ? "image-background" : scene.layout,
      });
    } catch {
      // Fallback to text-only if image generation fails for this scene.
      nextScenes.push({
        ...scene,
        imageUrl: undefined,
        layout: "text",
      });
    }
  }

  return DynamicVideoProps.parse({
    ...props,
    scenes: nextScenes,
  });
}

export async function POST(req: Request) {
  const { messages: rawMessages }: { messages: ChatMessage[] } = await req.json();
  const messages = trimConversation(rawMessages);

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

      let toolLoopCount = 0;

      while (true) {
        const response = await client.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 4096,
          system: `You are a helpful AI assistant that can chat naturally and also generate dynamic animated videos using Remotion.

When a user asks you to create or generate a video, use the generate_video tool. Be creative with colors, styles, and content.

Always return a scene-based payload:
- mode: short, detailed, or narrated
- scenes: structured scene list for the topic
- each scene should have a focused title, body, and optional bullets
- include imagePrompt for scenes where visuals improve comprehension

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
          toolLoopCount++;
          if (toolLoopCount > LIMITS.MAX_TOOL_LOOPS) {
            send({ type: "text_delta", text: "\n\n(Reached tool call limit for this response.)" });
            break;
          }

          const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );

          apiMessages.push({ role: "assistant", content: response.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const toolUse of toolUseBlocks) {
            if (toolUse.name === "generate_video") {
              const input = toolUse.input as Record<string, unknown>;

              try {
                const normalizedInput = DynamicVideoProps.parse(input);
                const expandedInput = expandScenesByMode(normalizedInput);
                const enrichedInput = await attachGeneratedImages(expandedInput, send);

                send({
                  type: "tool_start",
                  name: "generate_video",
                  input: enrichedInput as unknown as Record<string, unknown>,
                });

                const videoUrl = await runRenderAndStream(enrichedInput, origin, send);
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
