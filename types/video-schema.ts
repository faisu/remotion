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
