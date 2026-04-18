import { z } from "zod";

const DynamicMode = z.enum(["short", "detailed", "narrated"]);
const SceneLayout = z.enum(["text", "image-left", "image-right", "image-background"]);
const VisualStyle = z.enum(["minimal", "bold", "cinematic"]);

export const TransitionType = z.enum([
  "none",
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "wipe-left",
  "wipe-right",
  "iris",
]);
export type TransitionTypeKind = z.infer<typeof TransitionType>;

export const Emphasis = z.enum(["hook", "point", "conclusion", "transition"]);
export type EmphasisKind = z.infer<typeof Emphasis>;

export const AspectRatio = z.enum(["16:9", "9:16", "1:1"]);
export type AspectRatioKind = z.infer<typeof AspectRatio>;

export const FontFamily = z.enum([
  "Inter",
  "Instrument Serif",
  "Space Grotesk",
  "Geist Mono",
  "Playfair Display",
  "DM Sans",
]);
export type FontFamilyKind = z.infer<typeof FontFamily>;

export const CaptionStyle = z.enum(["none", "tiktok", "subtitle"]);
export type CaptionStyleKind = z.infer<typeof CaptionStyle>;

export const MusicIntensity = z.enum(["low", "medium", "high"]);
export const MusicGenre = z.enum([
  "none",
  "cinematic",
  "upbeat",
  "ambient",
  "corporate",
  "tech",
]);

/**
 * A single word of an ElevenLabs transcript, used to render word-level
 * animated captions. startMs / endMs are absolute times within the scene's
 * own voiceover audio (0 = start of the scene's narration).
 */
const CaptionWord = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
});
export type CaptionWordType = z.infer<typeof CaptionWord>;

export const MAX_DYNAMIC_SCENES = 12;

const DynamicScene = z.object({
  title: z.string().default("Scene"),
  body: z.string().optional().default(""),
  bullets: z.array(z.string()).max(6).optional().default([]),
  imagePrompt: z.string().optional(),
  imageUrl: z.string().optional(),
  durationInSeconds: z.number().min(1).max(20).optional(),
  layout: SceneLayout.optional().default("text"),
  // --- new fields (all optional for backward compatibility) ---
  voiceoverText: z.string().optional(),
  voiceoverUrl: z.string().optional(),
  voiceoverDurationMs: z.number().optional(),
  captions: z.array(CaptionWord).optional().default([]),
  transitionIn: TransitionType.optional().default("fade"),
  emphasis: Emphasis.optional(),
  kenBurns: z
    .enum(["zoom-in", "zoom-out", "pan-left", "pan-right", "none"])
    .optional()
    .default("zoom-in"),
});

const defaultSceneDuration = (mode: z.infer<typeof DynamicMode>) => {
  if (mode === "detailed") return 4;
  if (mode === "narrated") return 6;
  return 3;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const DynamicVideoInput = z.object({
  topic: z.string().optional(),
  mode: DynamicMode.optional().default("short"),
  title: z.string().default("Dynamic Video"),
  subtitle: z.string().optional().default(""),
  backgroundColor: z.string().default("#0f172a"),
  accentColor: z.string().default("#6366f1"),
  textColor: z.string().default("#ffffff"),
  items: z.array(z.string()).optional().default([]),
  scenes: z.array(DynamicScene).max(MAX_DYNAMIC_SCENES).optional().default([]),
  style: VisualStyle.optional().default("minimal"),
  durationInSeconds: z.number().min(2).max(120).optional(),
  // --- new global fields (optional) ---
  fontFamily: FontFamily.optional().default("Inter"),
  aspectRatio: AspectRatio.optional().default("16:9"),
  captionStyle: CaptionStyle.optional().default("tiktok"),
  narration: z
    .object({
      enabled: z.boolean().optional().default(true),
      voiceId: z.string().optional(),
    })
    .optional(),
  music: z
    .object({
      genre: MusicGenre.optional().default("none"),
      intensity: MusicIntensity.optional().default("low"),
      url: z.string().optional(),
      volume: z.number().min(0).max(1).optional().default(0.15),
    })
    .optional(),
});

type ParsedDynamicScene = z.infer<typeof DynamicScene>;

export const DynamicVideoProps = DynamicVideoInput.transform((input) => {
  const mode = input.mode ?? "short";
  const fallbackSceneDuration = defaultSceneDuration(mode);
  const fallbackScene: ParsedDynamicScene = DynamicScene.parse({
    title: input.title || input.topic || "Dynamic Video",
    body: input.subtitle || "",
    bullets: input.items,
    imagePrompt: input.topic
      ? `Create a cinematic illustration for: ${input.topic}`
      : input.title
        ? `Create an illustration for: ${input.title}`
        : undefined,
    layout: "text" as const,
  });
  const scenesSource: ParsedDynamicScene[] =
    input.scenes.length > 0 ? input.scenes : [fallbackScene];
  const normalizedScenes = scenesSource
    .slice(0, MAX_DYNAMIC_SCENES)
    .map((scene, index) => {
      return {
        ...scene,
        title: scene.title || `Scene ${index + 1}`,
        body: scene.body ?? "",
        bullets: (scene.bullets ?? []).slice(0, 6),
        layout: scene.layout ?? "text",
        durationInSeconds: clamp(
          scene.durationInSeconds ?? fallbackSceneDuration,
          1,
          20
        ),
        captions: scene.captions ?? [],
        transitionIn: scene.transitionIn ?? "fade",
        kenBurns: scene.kenBurns ?? "zoom-in",
      };
    });

  const sceneDurationTotal = normalizedScenes.reduce(
    (acc, scene) => acc + (scene.durationInSeconds ?? fallbackSceneDuration),
    0
  );
  const normalizedDuration = clamp(
    input.durationInSeconds ?? sceneDurationTotal,
    2,
    120
  );

  return {
    topic: input.topic ?? input.title,
    mode,
    title: input.title,
    subtitle: input.subtitle ?? "",
    backgroundColor: input.backgroundColor,
    accentColor: input.accentColor,
    textColor: input.textColor,
    items: (input.items ?? []).slice(0, 6),
    scenes: normalizedScenes,
    style: input.style ?? "minimal",
    durationInSeconds: normalizedDuration,
    fontFamily: input.fontFamily ?? "Inter",
    aspectRatio: input.aspectRatio ?? "16:9",
    captionStyle: input.captionStyle ?? "tiktok",
    narration: input.narration ?? { enabled: true, voiceId: undefined },
    music: input.music ?? { genre: "none", intensity: "low", volume: 0.15 },
  };
});

export type DynamicVideoPropsType = z.infer<typeof DynamicVideoProps>;

export const getDynamicDurationInSeconds = (props: DynamicVideoPropsType) => {
  const sceneDuration = props.scenes.reduce(
    (acc, scene) => acc + (scene.durationInSeconds ?? defaultSceneDuration(props.mode)),
    0
  );
  return clamp(props.durationInSeconds || sceneDuration, 2, 120);
};

export const DYNAMIC_COMP_NAME = "DynamicComp";
export const DYNAMIC_VIDEO_FPS = 30;
export const DYNAMIC_VIDEO_WIDTH = 1280;
export const DYNAMIC_VIDEO_HEIGHT = 720;

/**
 * Resolve the pixel dimensions for a given aspect ratio. Keeps the longer
 * edge at 1280 so renders stay fast and consistent.
 */
export const resolveAspectRatio = (
  aspect: AspectRatioKind
): { width: number; height: number } => {
  if (aspect === "9:16") return { width: 720, height: 1280 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: DYNAMIC_VIDEO_WIDTH, height: DYNAMIC_VIDEO_HEIGHT };
};

// ---------------------------------------------------------------------------
// Plan Mode schemas
// ---------------------------------------------------------------------------

const PlanStatus = z.enum(["draft", "approved", "rendering", "done"]);
const AssetStatus = z.enum(["pending", "found", "approved", "failed"]);
const AssetType = z.enum(["image", "reference", "inspiration", "voiceover", "music"]);

export const PlanScene = z.object({
  id: z.string(),
  title: z.string().default("Scene"),
  body: z.string().default(""),
  bullets: z.array(z.string()).max(6).default([]),
  layout: SceneLayout.default("text"),
  imagePrompt: z.string().default(""),
  previewImageUrl: z.string().optional(),
  durationInSeconds: z.number().min(1).max(20).default(3),
  notes: z.string().optional(),
  // --- new scene fields ---
  voiceoverText: z.string().optional(),
  voiceoverUrl: z.string().optional(),
  voiceoverDurationMs: z.number().optional(),
  captions: z.array(CaptionWord).optional(),
  transitionIn: TransitionType.optional(),
  emphasis: Emphasis.optional(),
  kenBurns: z
    .enum(["zoom-in", "zoom-out", "pan-left", "pan-right", "none"])
    .optional(),
});

export type PlanSceneType = z.infer<typeof PlanScene>;

export const PlanAsset = z.object({
  id: z.string(),
  type: AssetType.default("image"),
  prompt: z.string(),
  url: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  source: z.string().default("pending"),
  sceneId: z.string().optional(),
  status: AssetStatus.default("pending"),
});

export type PlanAssetType = z.infer<typeof PlanAsset>;

export const VideoPlan = z.object({
  id: z.string(),
  status: PlanStatus.default("draft"),
  title: z.string(),
  topic: z.string(),
  style: VisualStyle.default("minimal"),
  mode: DynamicMode.default("short"),
  colorPalette: z.object({
    background: z.string().default("#0f172a"),
    accent: z.string().default("#6366f1"),
    text: z.string().default("#ffffff"),
  }),
  estimatedDuration: z.number().default(0),
  scenes: z.array(PlanScene).max(MAX_DYNAMIC_SCENES).default([]),
  assets: z.array(PlanAsset).default([]),
  // --- new global plan fields ---
  fontFamily: FontFamily.optional(),
  aspectRatio: AspectRatio.optional(),
  captionStyle: CaptionStyle.optional(),
  narration: z
    .object({
      enabled: z.boolean().optional(),
      voiceId: z.string().optional(),
    })
    .optional(),
  music: z
    .object({
      genre: MusicGenre.optional(),
      intensity: MusicIntensity.optional(),
      url: z.string().optional(),
      volume: z.number().optional(),
    })
    .optional(),
});

export type VideoPlanType = z.infer<typeof VideoPlan>;

export function videoPlanToDynamicProps(plan: VideoPlanType): z.input<typeof DynamicVideoInput> {
  return {
    topic: plan.topic,
    mode: plan.mode,
    title: plan.title,
    subtitle: "",
    backgroundColor: plan.colorPalette.background,
    accentColor: plan.colorPalette.accent,
    textColor: plan.colorPalette.text,
    items: [],
    style: plan.style,
    durationInSeconds: plan.estimatedDuration || undefined,
    fontFamily: plan.fontFamily,
    aspectRatio: plan.aspectRatio,
    captionStyle: plan.captionStyle,
    narration: plan.narration,
    music: plan.music,
    scenes: plan.scenes.map((s) => ({
      title: s.title,
      body: s.body,
      bullets: s.bullets,
      layout: s.layout,
      imagePrompt: s.imagePrompt || undefined,
      imageUrl: s.previewImageUrl || undefined,
      durationInSeconds: s.durationInSeconds,
      voiceoverText: s.voiceoverText,
      voiceoverUrl: s.voiceoverUrl,
      voiceoverDurationMs: s.voiceoverDurationMs,
      captions: s.captions,
      transitionIn: s.transitionIn,
      emphasis: s.emphasis,
      kenBurns: s.kenBurns,
    })),
  };
}
