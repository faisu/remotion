import { z } from "zod";

const DynamicMode = z.enum(["short", "detailed", "narrated"]);
const SceneLayout = z.enum(["text", "image-left", "image-right", "image-background"]);
const VisualStyle = z.enum(["minimal", "bold", "cinematic"]);

export const MAX_DYNAMIC_SCENES = 12;

const DynamicScene = z.object({
  title: z.string().default("Scene"),
  body: z.string().optional().default(""),
  bullets: z.array(z.string()).max(6).optional().default([]),
  imagePrompt: z.string().optional(),
  imageUrl: z.string().optional(),
  durationInSeconds: z.number().min(1).max(20).optional(),
  layout: SceneLayout.optional().default("text"),
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
});

export const DynamicVideoProps = DynamicVideoInput.transform((input) => {
  const mode = input.mode ?? "short";
  const fallbackSceneDuration = defaultSceneDuration(mode);
  const normalizedScenes = (
    input.scenes.length > 0
      ? input.scenes
      : [
          {
            title: input.title || input.topic || "Dynamic Video",
            body: input.subtitle || "",
            bullets: input.items,
            imagePrompt: input.topic
              ? `Create a cinematic illustration for: ${input.topic}`
              : input.title
                ? `Create an illustration for: ${input.title}`
                : undefined,
            layout: "text" as const,
          },
        ]
  )
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

// ---------------------------------------------------------------------------
// Plan Mode schemas
// ---------------------------------------------------------------------------

const PlanStatus = z.enum(["draft", "approved", "rendering", "done"]);
const AssetStatus = z.enum(["pending", "found", "approved", "failed"]);
const AssetType = z.enum(["image", "reference", "inspiration"]);

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
    scenes: plan.scenes.map((s) => ({
      title: s.title,
      body: s.body,
      bullets: s.bullets,
      layout: s.layout,
      imagePrompt: s.imagePrompt || undefined,
      imageUrl: s.previewImageUrl || undefined,
      durationInSeconds: s.durationInSeconds,
    })),
  };
}
