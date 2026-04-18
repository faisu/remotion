import Anthropic from "@anthropic-ai/sdk";
import {
  braveWebSearch,
  isBraveSearchConfigured,
  braveImageSearch,
} from "../../../lib/brave-search";
import {
  DYNAMIC_COMP_NAME,
  DynamicVideoProps,
  type DynamicVideoPropsType,
  VideoPlan,
  videoPlanToDynamicProps,
  type VideoPlanType,
} from "../../../../types/video-schema";
import {
  applyPlanMutation,
  type PlanAction,
} from "../../../lib/plan-mutations";
import {
  generateVoiceoverWithTimestamps,
  isElevenLabsConfigured,
} from "../../../lib/elevenlabs";

const LIMITS = {
  MAX_MESSAGES: 20,
  MAX_CHARS_PER_MESSAGE: 4_000,
  MAX_TOTAL_CONTEXT_CHARS: 32_000,
  MAX_TOOL_LOOPS: 10,
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
    "Generate a dynamic animated video with scene-by-scene storytelling using text, AI-generated images, per-scene narration, Ken Burns camera moves, scene transitions, and on-screen captions. Prefer create_video_plan first for review; use this only if the user says to skip planning or explicitly approves.",
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
      fontFamily: {
        type: "string",
        enum: [
          "Inter",
          "Instrument Serif",
          "Space Grotesk",
          "Geist Mono",
          "Playfair Display",
          "DM Sans",
        ],
        description:
          "Global font family used for titles, body, and captions. Pick to match vibe: Inter/DM Sans (neutral/tech), Instrument Serif/Playfair Display (editorial/cinematic), Space Grotesk (product), Geist Mono (developer).",
      },
      aspectRatio: {
        type: "string",
        enum: ["16:9", "9:16", "1:1"],
        description:
          "Video aspect ratio. 16:9 for YouTube/landscape, 9:16 for Reels/Shorts/TikTok, 1:1 for feed posts.",
      },
      captionStyle: {
        type: "string",
        enum: ["none", "tiktok", "subtitle"],
        description:
          "How narration is shown on-screen. 'tiktok' = word-by-word pop captions (best for 9:16). 'subtitle' = traditional bottom subtitles. 'none' = no captions.",
      },
      voiceId: {
        type: "string",
        description:
          "Optional ElevenLabs voice_id for narration. Omit unless the user has chosen a voice. Defaults to Rachel (warm female).",
      },
      musicGenre: {
        type: "string",
        enum: ["none", "cinematic", "upbeat", "ambient", "corporate", "tech"],
        description: "Background music mood. 'none' disables music.",
      },
      musicIntensity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Relative loudness of the music bed under narration.",
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
            voiceoverText: {
              type: "string",
              description:
                "Conversational narration for this scene (~15-40 words; ~150 wpm pacing). Make durationInSeconds long enough to fit.",
            },
            imagePrompt: {
              type: "string",
              description:
                "Search query used to find a scene image. Write as a web image search query, e.g. 'solar panel farm aerial view' or 'DNA double helix 3D render'. Avoid words like 'illustration' or 'cinematic'.",
            },
            imageUrl: {
              type: "string",
              description:
                "Optional pre-existing image URL to use directly. For approved storyboard renders, this must be copied from the matching scene previewImageUrl.",
            },
            durationInSeconds: {
              type: "number",
              description: "Scene duration in seconds",
            },
            layout: {
              type: "string",
              enum: ["text", "image-left", "image-right", "image-background"],
              description:
                "Scene layout. Prefer 'image-background' when voiceoverText is set so the image + captions carry the scene.",
            },
            transitionIn: {
              type: "string",
              enum: [
                "none",
                "fade",
                "slide-left",
                "slide-right",
                "slide-up",
                "slide-down",
                "wipe-left",
                "wipe-right",
                "iris",
              ],
              description:
                "Transition INTO this scene. First scene should be 'none'. 'fade' is the safe default; 'iris' for reveals, 'wipe' for energetic cuts.",
            },
            kenBurns: {
              type: "string",
              enum: ["zoom-in", "zoom-out", "pan-left", "pan-right", "none"],
              description:
                "Subtle camera move applied to the scene image.",
            },
            emphasis: {
              type: "string",
              enum: ["hook", "point", "conclusion", "transition"],
              description: "Narrative role of this scene.",
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

const webSearchTool: Anthropic.Tool = {
  name: "web_search",
  description:
    "Search the web for current information about a topic. Use this to research facts, recent events, or gather context before generating a video.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The search query to look up on the web",
      },
    },
    required: ["query"],
  },
};

const createVideoPlanTool: Anthropic.Tool = {
  name: "create_video_plan",
  description:
    "Create a video plan (storyboard) for the user to review before rendering. The plan includes scenes, style, colors, image prompts, per-scene voiceover text, scene transitions, and a global font + caption style. The user can edit the plan and then approve it to generate the video. Always use this tool FIRST when the user asks for a video — do NOT call generate_video directly unless the user explicitly says to skip planning or approves an existing plan.",
  input_schema: {
    type: "object" as const,
    properties: {
      topic: {
        type: "string",
        description: "The topic of the video",
      },
      title: {
        type: "string",
        description: "Main title text displayed in the video",
      },
      mode: {
        type: "string",
        enum: ["short", "detailed", "narrated"],
        description:
          "Video depth mode: short (4-6 scenes), detailed (8-12 scenes), narrated (longer paragraphs)",
      },
      style: {
        type: "string",
        enum: ["minimal", "bold", "cinematic"],
        description:
          "Visual style: minimal (clean), bold (high contrast), cinematic (dramatic)",
      },
      backgroundColor: {
        type: "string",
        description: "Background color hex code",
      },
      accentColor: {
        type: "string",
        description: "Accent/highlight color hex code",
      },
      textColor: {
        type: "string",
        description: "Text color hex code",
      },
      fontFamily: {
        type: "string",
        enum: [
          "Inter",
          "Instrument Serif",
          "Space Grotesk",
          "Geist Mono",
          "Playfair Display",
          "DM Sans",
        ],
        description:
          "Google Font used for titles, body, and captions. Match vibe: Inter/DM Sans for neutral/tech, Instrument Serif/Playfair Display for editorial/cinematic, Space Grotesk for product, Geist Mono for developer tools.",
      },
      aspectRatio: {
        type: "string",
        enum: ["16:9", "9:16", "1:1"],
        description:
          "Video aspect ratio. 16:9 for YouTube/landscape, 9:16 for Reels/Shorts/TikTok, 1:1 for feed posts.",
      },
      captionStyle: {
        type: "string",
        enum: ["none", "tiktok", "subtitle"],
        description:
          "How narration is shown on screen. 'tiktok' = word-by-word big pop-in captions (best for short-form). 'subtitle' = traditional bottom subtitles. 'none' = no captions. Pick 'tiktok' by default when there is a voiceover and aspect ratio is 9:16.",
      },
      voiceId: {
        type: "string",
        description:
          "Optional ElevenLabs voice_id. Omit unless the user has specified a voice. Examples: '21m00Tcm4TlvDq8ikWAM' (Rachel, warm female), 'ErXwobaYiN019PkySvjV' (Antoni, warm male), 'VR6AewLTigWG4xSOukaG' (Arnold, deep male).",
      },
      musicGenre: {
        type: "string",
        enum: ["none", "cinematic", "upbeat", "ambient", "corporate", "tech"],
        description:
          "Mood for the background music bed. 'none' disables music. Pick based on content tone, not just the topic.",
      },
      musicIntensity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Relative loudness/drive of the music under narration.",
      },
      scenes: {
        type: "array",
        description:
          "Planned scene list for the storyboard. Aim for 4-6 scenes for short, 8-12 for detailed. Each scene should stand on its own as a ~3-8 second clip.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Scene title (on-screen, terse, max ~8 words)" },
            body: {
              type: "string",
              description:
                "Supporting on-screen text (one line). Leave short — the voiceover does the heavy lifting. Can be empty if voiceoverText is set.",
            },
            bullets: {
              type: "array",
              items: { type: "string" },
              description:
                "Key points for this scene, max 6. Only include for bullet-heavy layouts; leave empty when the scene has a voiceover to avoid double-reading.",
            },
            voiceoverText: {
              type: "string",
              description:
                "What the narrator will say during this scene, in a natural conversational register (different from the terse on-screen title/bullets). Write as flowing sentences, ~15-40 words per scene. Pace is ~150 words/minute, so a 6-second scene fits ~15 words. Set durationInSeconds long enough to accommodate the voiceover.",
            },
            imagePrompt: {
              type: "string",
              description:
                "Search query for the scene image. Write as a web image search query with concrete visual nouns (e.g. 'aerial view of Tokyo skyline at sunset'). Avoid style words like 'illustration' or 'cinematic'.",
            },
            layout: {
              type: "string",
              enum: ["text", "image-left", "image-right", "image-background"],
              description:
                "Scene layout. 'image-background' is best when voiceover is present; lets the image + captions dominate.",
            },
            transitionIn: {
              type: "string",
              enum: [
                "none",
                "fade",
                "slide-left",
                "slide-right",
                "slide-up",
                "slide-down",
                "wipe-left",
                "wipe-right",
                "iris",
              ],
              description:
                "Transition INTO this scene from the previous one. First scene should usually be 'none'. Use 'fade' or 'slide-left' for most story beats, 'iris' for conclusion/reveal moments, 'wipe' for energetic moments.",
            },
            kenBurns: {
              type: "string",
              enum: ["zoom-in", "zoom-out", "pan-left", "pan-right", "none"],
              description:
                "Subtle camera move applied to the scene's image. 'zoom-in' for intros and beats, 'zoom-out' for reveals, pans to give lateral energy.",
            },
            emphasis: {
              type: "string",
              enum: ["hook", "point", "conclusion", "transition"],
              description:
                "What role this scene plays narratively. First scene is usually 'hook', last is 'conclusion'.",
            },
            durationInSeconds: {
              type: "number",
              description:
                "Scene duration in seconds. Must fit voiceoverText at ~150 wpm; if narrated, prefer >= (word_count / 2.5) seconds.",
            },
            notes: {
              type: "string",
              description: "Optional notes about this scene's purpose or reasoning",
            },
          },
          required: ["title"],
        },
      },
    },
    required: ["title", "topic", "mode"],
  },
};

const editVideoPlanTool: Anthropic.Tool = {
  name: "edit_video_plan",
  description:
    "Apply a mutation to an existing storyboard artifact (video plan) and return the updated plan for user review before rendering.",
  input_schema: {
    type: "object" as const,
    properties: {
      plan: {
        type: "object",
        description:
          "The current full VideoPlan JSON to mutate. Use the most recent plan from the conversation.",
      },
      action: {
        type: "string",
        enum: [
          "update_scene",
          "reorder_scenes",
          "remove_scene",
          "add_scene",
          "update_globals",
          "refresh_asset",
        ],
      },
      sceneId: {
        type: "string",
        description: "Scene id for update_scene, remove_scene, or refresh_asset.",
      },
      sceneIds: {
        type: "array",
        items: { type: "string" },
        description: "Ordered scene ids for reorder_scenes.",
      },
      data: {
        type: "object",
        description:
          "Patch payload for update_scene, add_scene, or update_globals depending on action.",
      },
    },
    required: ["plan", "action"],
  },
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "plan_created"; plan: VideoPlanType }
  | { type: "plan_updated"; plan: VideoPlanType }
  | { type: "render_progress"; phase: string; progress: number }
  | { type: "render_done"; url: string; size: number }
  | { type: "render_error"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

const PLAN_APPROVED_TAG = "[PLAN_APPROVED]";

function getApprovedPlanFromContent(content: string): VideoPlanType | null {
  if (!content.startsWith(PLAN_APPROVED_TAG)) return null;
  const afterTag = content.slice(PLAN_APPROVED_TAG.length).trimStart();
  const jsonStart = afterTag.indexOf("{");
  if (jsonStart === -1) return null;

  try {
    const data = JSON.parse(afterTag.slice(jsonStart)) as unknown;
    const parsed = VideoPlan.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function getLastApprovedPlan(messages: ChatMessage[]): VideoPlanType | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") continue;
    const parsed = getApprovedPlanFromContent(messages[i].content);
    if (parsed) return parsed;
  }
  return null;
}

function parseEditAction(input: Record<string, unknown>): PlanAction {
  const action = String(input.action);

  switch (action) {
    case "update_scene": {
      const sceneId = String(input.sceneId || "");
      if (!sceneId) throw new Error("update_scene requires sceneId");
      return {
        action,
        sceneId,
        data: ((input.data as Record<string, unknown> | undefined) ?? {}) as PlanAction extends {
          action: "update_scene";
          data: infer T;
        }
          ? T
          : never,
      };
    }
    case "reorder_scenes": {
      const sceneIds = Array.isArray(input.sceneIds)
        ? input.sceneIds.map((id) => String(id))
        : [];
      if (!sceneIds.length) throw new Error("reorder_scenes requires sceneIds");
      return { action, sceneIds };
    }
    case "remove_scene": {
      const sceneId = String(input.sceneId || "");
      if (!sceneId) throw new Error("remove_scene requires sceneId");
      return { action, sceneId };
    }
    case "add_scene": {
      return {
        action,
        data: ((input.data as Record<string, unknown> | undefined) ?? {}) as PlanAction extends {
          action: "add_scene";
          data: infer T;
        }
          ? T
          : never,
      };
    }
    case "update_globals": {
      return {
        action,
        data: ((input.data as Record<string, unknown> | undefined) ?? {}) as PlanAction extends {
          action: "update_globals";
          data: infer T;
        }
          ? T
          : never,
      };
    }
    case "refresh_asset": {
      const sceneId = String(input.sceneId || "");
      if (!sceneId) throw new Error("refresh_asset requires sceneId");
      return { action, sceneId };
    }
    default:
      throw new Error(`Unsupported edit action: ${action}`);
  }
}

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

async function validateImageHead(url: string): Promise<void> {
  const res = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(5000),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HEAD failed: ${res.status}`);
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.startsWith("image/")) {
    throw new Error(`Not an image: ${ct}`);
  }
}

function toSearchQuery(prompt: string): string {
  return prompt
    .replace(/\b(cinematic|illustration|educational|artistic|dramatic|style-aware|abstract)\b/gi, "")
    .replace(/,\s*,/g, ",")
    .replace(/^\s*,|,\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function tryBraveImageSearch(prompt: string): Promise<string | null> {
  if (!isBraveSearchConfigured()) return null;
  const query = toSearchQuery(prompt);
  try {
    const results = await braveImageSearch(query, 10);
    for (const img of results) {
      try {
        await validateImageHead(img.url);
        return img.url;
      } catch {
        if (img.thumbnail) {
          try {
            await validateImageHead(img.thumbnail);
            return img.thumbnail;
          } catch {
            // thumbnail also failed
          }
        }
        continue;
      }
    }
  } catch {
    // Brave search itself failed; fall through
  }
  return null;
}

async function generateSceneImage(prompt: string, seed: number): Promise<string> {
  const braveUrl = await tryBraveImageSearch(prompt);
  if (braveUrl) return braveUrl;

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

async function fetchThumbnailUrl(prompt: string, seed = 1): Promise<string | null> {
  if (isBraveSearchConfigured()) {
    const query = toSearchQuery(prompt);
    try {
      const results = await braveImageSearch(query, 3);
      for (const img of results) {
        const url = img.thumbnail || img.url;
        if (url) {
          try {
            await validateImageHead(url);
            return url;
          } catch {
            continue;
          }
        }
      }
    } catch {
      // fall through
    }
  }

  const encoded = encodeImagePrompt(prompt);
  const pollUrl = `https://image.pollinations.ai/prompt/${encoded}?width=320&height=180&model=flux&nologo=true&seed=${seed}`;
  try {
    await validateImageHead(pollUrl);
    return pollUrl;
  } catch {
    // fall through
  }

  return `https://picsum.photos/seed/${seed}-thumb/320/180`;
}

function buildVideoPlan(
  input: Record<string, unknown>,
): VideoPlanType {
  const planId = `plan-${Date.now()}`;
  const mode = (input.mode as string) || "short";
  const style = (input.style as string) || "minimal";
  const defaultDuration =
    mode === "detailed" ? 4 : mode === "narrated" ? 6 : 3;

  const rawScenes = (input.scenes as Array<Record<string, unknown>>) || [];
  const scenes = rawScenes.map((s, i) => ({
    id: `scene-${i}`,
    title: (s.title as string) || `Scene ${i + 1}`,
    body: (s.body as string) || "",
    bullets: ((s.bullets as string[]) || []).slice(0, 6),
    layout: (s.layout as "text" | "image-left" | "image-right" | "image-background") || "text",
    imagePrompt: (s.imagePrompt as string) || "",
    durationInSeconds: (s.durationInSeconds as number) || defaultDuration,
    notes: (s.notes as string) || undefined,
    voiceoverText: (s.voiceoverText as string) || undefined,
    transitionIn: (s.transitionIn as
      | "fade"
      | "slide-left"
      | "slide-right"
      | "slide-up"
      | "slide-down"
      | "wipe-left"
      | "wipe-right"
      | "iris"
      | "none"
      | undefined) || (i === 0 ? "none" : "fade"),
    emphasis: (s.emphasis as "hook" | "point" | "conclusion" | "transition" | undefined) || undefined,
    kenBurns: (s.kenBurns as
      | "zoom-in"
      | "zoom-out"
      | "pan-left"
      | "pan-right"
      | "none"
      | undefined) || "zoom-in",
  }));

  const estimatedDuration = scenes.reduce(
    (sum, s) => sum + s.durationInSeconds,
    0,
  );

  const imageAssets = scenes
    .filter((s) => s.imagePrompt)
    .map((s) => ({
      id: `asset-${s.id}`,
      type: "image" as const,
      prompt: s.imagePrompt,
      source: "pending",
      sceneId: s.id,
      status: "pending" as const,
    }));

  const voiceoverAssets = scenes
    .filter((s) => s.voiceoverText)
    .map((s) => ({
      id: `voice-${s.id}`,
      type: "voiceover" as const,
      prompt: s.voiceoverText!,
      source: "pending",
      sceneId: s.id,
      status: "pending" as const,
    }));

  return VideoPlan.parse({
    id: planId,
    status: "draft",
    title: (input.title as string) || "Video",
    topic: (input.topic as string) || (input.title as string) || "Video",
    style,
    mode,
    colorPalette: {
      background: (input.backgroundColor as string) || "#0f172a",
      accent: (input.accentColor as string) || "#6366f1",
      text: (input.textColor as string) || "#ffffff",
    },
    estimatedDuration,
    scenes,
    assets: [...imageAssets, ...voiceoverAssets],
    fontFamily: (input.fontFamily as
      | "Inter"
      | "Instrument Serif"
      | "Space Grotesk"
      | "Geist Mono"
      | "Playfair Display"
      | "DM Sans"
      | undefined) || "Inter",
    aspectRatio: (input.aspectRatio as "16:9" | "9:16" | "1:1" | undefined) || "16:9",
    captionStyle: (input.captionStyle as "none" | "tiktok" | "subtitle" | undefined) || "tiktok",
    narration: {
      enabled: (input.narrationEnabled as boolean | undefined) ?? true,
      voiceId: (input.voiceId as string | undefined) || undefined,
    },
    music: {
      genre: (input.musicGenre as
        | "none"
        | "cinematic"
        | "upbeat"
        | "ambient"
        | "corporate"
        | "tech"
        | undefined) || "none",
      intensity: (input.musicIntensity as "low" | "medium" | "high" | undefined) || "low",
      volume: 0.15,
    },
  });
}

async function attachThumbnailsToPlan(
  plan: VideoPlanType,
  send: (event: ChatEvent) => void,
): Promise<VideoPlanType> {
  send({
    type: "text_delta",
    text: "",
  });

  const updatedScenes = [...plan.scenes];
  const updatedAssets = [...plan.assets];

  const thumbnailPromises = plan.scenes.map(async (scene, index) => {
    if (!scene.imagePrompt) return;
    try {
      const thumbUrl = await fetchThumbnailUrl(scene.imagePrompt, index + 1);
      if (thumbUrl) {
        updatedScenes[index] = { ...scene, previewImageUrl: thumbUrl };
        const assetIdx = updatedAssets.findIndex(
          (a) => a.sceneId === scene.id,
        );
        const source = isBraveSearchConfigured() ? "brave" : "generated";
        if (assetIdx >= 0) {
          updatedAssets[assetIdx] = {
            ...updatedAssets[assetIdx],
            thumbnailUrl: thumbUrl,
            status: "found",
            source,
          };
        }
      }
    } catch {
      // leave as pending
    }
  });

  await Promise.allSettled(thumbnailPromises);

  return { ...plan, scenes: updatedScenes, assets: updatedAssets };
}

/**
 * Generate voiceover audio + word-level captions for every scene whose
 * `voiceoverText` is set. Uploads audio to Vercel Blob and stores URLs in
 * the scene so the renderer can use them. Runs scenes in parallel to keep
 * wall-clock time low.
 */
async function attachVoiceoversToProps(
  props: DynamicVideoPropsType,
  send: (event: ChatEvent) => void,
): Promise<DynamicVideoPropsType> {
  if (!isElevenLabsConfigured()) return props;
  if (props.narration && props.narration.enabled === false) return props;

  const scenesNeedingVoiceover = props.scenes.filter((s) => s.voiceoverText);
  if (scenesNeedingVoiceover.length === 0) return props;

  send({
    type: "render_progress",
    phase: `Generating narration for ${scenesNeedingVoiceover.length} scene(s)...`,
    progress: 0.02,
  });

  const voiceId = props.narration?.voiceId;

  const results = await Promise.allSettled(
    props.scenes.map(async (scene) => {
      if (!scene.voiceoverText) return scene;
      try {
        const result = await generateVoiceoverWithTimestamps({
          text: scene.voiceoverText,
          voiceId,
        });
        // Lengthen the scene if the narration overruns its planned duration
        // so we don't clip audio. Cap at 20s per schema constraint.
        const minDurationSeconds = result.durationMs / 1000 + 0.4;
        const nextDuration = Math.min(
          20,
          Math.max(scene.durationInSeconds ?? 3, minDurationSeconds),
        );
        return {
          ...scene,
          voiceoverUrl: result.audioUrl,
          voiceoverDurationMs: result.durationMs,
          captions: result.captions,
          durationInSeconds: nextDuration,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "voiceover error";
        send({
          type: "render_progress",
          phase: `Narration failed for "${scene.title}": ${message}`,
          progress: 0.03,
        });
        return scene;
      }
    }),
  );

  const nextScenes = results.map((r, i) =>
    r.status === "fulfilled" ? r.value : props.scenes[i],
  );

  return DynamicVideoProps.parse({
    ...props,
    scenes: nextScenes,
  });
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
      imagePrompt: `${baseTopic} ${seedBullet} high quality photo`,
      durationInSeconds: props.mode === "detailed" ? 4 : props.mode === "narrated" ? 6 : 3,
      captions: [],
      transitionIn: index === 1 && generatedScenes.length === 0 ? "none" : "fade",
      kenBurns: "zoom-in",
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
    phase: isBraveSearchConfigured()
      ? "Searching for scene images..."
      : "Generating scene images...",
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
      const approvedPlan = getLastApprovedPlan(messages);
      if (approvedPlan) {
        const approvedInput = DynamicVideoProps.parse(
          videoPlanToDynamicProps(approvedPlan),
        );
        const withImages = await attachGeneratedImages(approvedInput, send);
        const enrichedInput = await attachVoiceoversToProps(withImages, send);
        send({
          type: "tool_start",
          name: "generate_video",
          input: enrichedInput as unknown as Record<string, unknown>,
        });
        await runRenderAndStream(enrichedInput, origin, send);
        send({
          type: "text_delta",
          text: "Video generated from your approved storyboard.",
        });
        send({ type: "done" });
        return;
      }

      const client = createAnthropicClient();
      const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let toolLoopCount = 0;

      while (true) {
        const stream = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: `You are a helpful AI assistant that can chat naturally and also direct short, cinematic videos using Remotion. Think of yourself less as a slide-builder and more as a creative director: every scene should have a clear role, a narration, a strong image, and an intentional camera move / transition.

VIDEO CREATION WORKFLOW — THREE PHASES:
1. PLAN PHASE: When a user asks to create a video, ALWAYS call create_video_plan FIRST. This creates a storyboard the user can review, edit, and approve before rendering.
2. ARTIFACT EDIT PHASE: If the user asks to modify scenes, images, order, timing, style, colors, narration, transitions, or captions, call edit_video_plan to mutate the existing storyboard.
3. RENDER PHASE: Only call generate_video when the user explicitly approves a plan (e.g. "looks good, generate it", "render it", "go ahead") or when the message contains "[PLAN_APPROVED]". If the user says "skip planning" or "just generate it", you may call generate_video directly.

WHEN BUILDING A PLAN — DO ALL OF THE FOLLOWING:

Scene count & pacing
- short=4-6 scenes, detailed=8-12, narrated=4-6.
- Each scene should stand on its own as a ~3-8 second clip.
- Scene duration MUST accommodate voiceoverText at ~150 wpm (≈ 2.5 words / second). If a scene's narration is 15 words, the scene needs at least 6 seconds.

Narration (voiceoverText)
- Write a natural conversational line for every scene in voiceoverText — this is what ElevenLabs will speak. It is DIFFERENT from the on-screen title/body (which should stay terse).
- Keep it ~15-40 words per scene. Use contractions, active voice, and one clear idea per scene.
- First scene's narration is the HOOK: pull attention in 1 sentence. Last scene is the CONCLUSION: include a takeaway or call to reflect.
- If narration is set, prefer layout "image-background" so captions + image carry the scene, and avoid bullets (they'd double-read).

Imagery (imagePrompt)
- Write each imagePrompt as a concrete web image search query with visual nouns. Good: "aerial view of Tokyo skyline at sunset", "macro photo of honeybee on lavender". Bad: "cinematic illustration of technology".
- Prefer variety across scenes (wide → medium → close, or outside → inside → detail) to avoid monotony.

Camera moves (kenBurns) — pick per scene, don't leave them all the same
- "zoom-in" for establishing and emotional beats.
- "zoom-out" for reveals and conclusions.
- "pan-left" / "pan-right" for lateral motion, comparisons, or traveling energy.
- "none" when the image is already dynamic or text-heavy.

Transitions (transitionIn) — first scene MUST be "none"
- "fade" is the safe default — use it for most story beats.
- "slide-left" / "slide-right" for sequential progression ("next", "then").
- "slide-up" / "slide-down" for stacking ideas or upward momentum.
- "wipe-left" / "wipe-right" for energetic cuts, lists, or quick beats.
- "iris" for reveals, conclusions, or "here's the twist" moments.
- Vary them — don't use the same transition 6 times in a row.

Emphasis (emphasis) — label each scene's narrative role
- First scene: "hook". Middle scenes: "point" or "transition". Last scene: "conclusion".

Global style
- fontFamily: Inter/DM Sans for neutral or tech, Instrument Serif/Playfair Display for editorial or cinematic, Space Grotesk for product, Geist Mono for dev tools.
- aspectRatio: 16:9 for YouTube/landscape, 9:16 for Reels/Shorts/TikTok, 1:1 for feed posts. Ask (or infer) before committing.
- captionStyle: default to "tiktok" when aspectRatio is 9:16 and narration is on. Use "subtitle" for long-form 16:9. Use "none" only if the user wants silent/pure-visual.
- musicGenre + musicIntensity: pick to match tone ("cinematic"+"medium" for dramatic, "upbeat"+"high" for energetic, "ambient"+"low" for calm/explanatory). Default to "none" unless content clearly benefits.

Color palette ideas
- Dark tech: backgroundColor=#0f172a, accentColor=#6366f1, textColor=#ffffff
- Warm sunset: backgroundColor=#1a0a00, accentColor=#f97316, textColor=#fef3c7
- Ocean: backgroundColor=#0c1445, accentColor=#06b6d4, textColor=#e0f7ff
- Nature: backgroundColor=#052e16, accentColor=#22c55e, textColor=#dcfce7
- Minimal light: backgroundColor=#ffffff, accentColor=#6366f1, textColor=#0f172a
${isBraveSearchConfigured() ? "\nYou have access to a web_search tool. Use it to research factual topics, recent events, or any subject where up-to-date information would improve the video. Search before creating a plan when the topic benefits from current data.\n" : ""}
AFTER CREATING A PLAN
- Run a quick plan check and ask 1-2 clarifying questions only when key constraints are genuinely ambiguous (audience, tone, required facts, branding, aspect ratio). Do NOT push for approval until the user answers or says to proceed.

WHEN RENDERING FROM AN APPROVED PLAN
- Preserve image parity: for each scene pass imageUrl from that scene's previewImageUrl.
- Voiceover + captions are generated automatically from each scene's voiceoverText — you don't need to add them manually.

AFTER EDITING A PLAN
- Summarize what changed in one or two sentences and ask whether to keep refining or approve.

AFTER GENERATING A VIDEO
- Tell the user it's ready and describe what was created (tone, structure, standout beats).`,
          tools: [
            createVideoPlanTool,
            editVideoPlanTool,
            generateVideoTool,
            ...(isBraveSearchConfigured() ? [webSearchTool] : []),
          ],
          messages: apiMessages,
        });

        // Forward token-level text deltas to the client as they arrive
        // from the model — this is what makes responses appear live.
        stream.on("text", (delta) => {
          if (delta) send({ type: "text_delta", text: delta });
        });

        const response = await stream.finalMessage();

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
            if (toolUse.name === "create_video_plan") {
              const input = toolUse.input as Record<string, unknown>;
              try {
                const plan = buildVideoPlan(input);
                const enrichedPlan = await attachThumbnailsToPlan(plan, send);
                send({ type: "plan_created", plan: enrichedPlan });
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: `Video plan created successfully with ${enrichedPlan.scenes.length} scenes. The user can now review, edit, and approve the plan to generate the video.`,
                });
              } catch (err) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: `Error creating plan: ${(err as Error).message}`,
                  is_error: true,
                });
              }
            } else if (toolUse.name === "edit_video_plan") {
              const input = toolUse.input as Record<string, unknown>;
              try {
                const parsedPlan = VideoPlan.parse(input.plan);
                const mutation = parseEditAction(input);
                const updatedPlan = await applyPlanMutation(parsedPlan, mutation, {
                  fetchThumbnailForPrompt: fetchThumbnailUrl,
                });
                send({ type: "plan_updated", plan: updatedPlan });
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: `Plan updated successfully. It now has ${updatedPlan.scenes.length} scenes and is ready for review or approval.`,
                });
              } catch (err) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: `Error editing plan: ${(err as Error).message}`,
                  is_error: true,
                });
              }
            } else if (toolUse.name === "generate_video") {
              const input = toolUse.input as Record<string, unknown>;

              try {
                const normalizedInput = DynamicVideoProps.parse(input);
                const expandedInput = expandScenesByMode(normalizedInput);
                const withImages = await attachGeneratedImages(expandedInput, send);
                const enrichedInput = await attachVoiceoversToProps(withImages, send);

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
            } else if (toolUse.name === "web_search") {
              const { query } = toolUse.input as { query: string };
              try {
                const results = await braveWebSearch(query);
                const formatted = results
                  .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`)
                  .join("\n\n");
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: formatted || "No results found.",
                });
              } catch (err) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: `Web search failed: ${(err as Error).message}`,
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
