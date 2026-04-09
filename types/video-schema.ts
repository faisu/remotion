import { z } from "zod";

export const DynamicVideoProps = z.object({
  title: z.string().default("Dynamic Video"),
  subtitle: z.string().optional().default(""),
  backgroundColor: z.string().default("#0f172a"),
  accentColor: z.string().default("#6366f1"),
  textColor: z.string().default("#ffffff"),
  items: z.array(z.string()).default([]),
  style: z.enum(["minimal", "bold", "cinematic"]).default("minimal"),
  durationInSeconds: z.number().min(2).max(30).default(6),
});

export type DynamicVideoPropsType = z.infer<typeof DynamicVideoProps>;

export const DYNAMIC_COMP_NAME = "DynamicComp";
export const DYNAMIC_VIDEO_FPS = 30;
export const DYNAMIC_VIDEO_WIDTH = 1280;
export const DYNAMIC_VIDEO_HEIGHT = 720;
