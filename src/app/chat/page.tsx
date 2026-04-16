"use client";

import { Player } from "@remotion/player";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BridgeitLogo } from "../../components/BridgeitLogo";
import { DynamicComp } from "../../remotion/DynamicComp";
import {
  DYNAMIC_VIDEO_FPS,
  DYNAMIC_VIDEO_HEIGHT,
  DYNAMIC_VIDEO_WIDTH,
  DynamicVideoProps,
  getDynamicDurationInSeconds,
  VideoPlan,
  type VideoPlanType,
  type PlanSceneType,
} from "../../../types/video-schema";
import type { z } from "zod";

type DynamicProps = z.infer<typeof DynamicVideoProps>;

type RenderState =
  | { status: "idle" }
  | { status: "rendering"; phase: string; progress: number }
  | { status: "done"; url: string; size: number; props: DynamicProps };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  renderState?: RenderState;
  videoProps?: DynamicProps;
  plan?: VideoPlanType;
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

// ---------------------------------------------------------------------------
// Plan templates
// ---------------------------------------------------------------------------

type PlanTemplate = {
  label: string;
  description: string;
  icon: string;
  prompt: string;
};

const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    label: "Tech Explainer",
    description: "Break down a technical concept with clear visuals",
    icon: "cpu",
    prompt:
      "Create a video plan for a tech explainer about how large language models work. Use a minimal style with dark background.",
  },
  {
    label: "Product Launch",
    description: "Announce a product with bold, attention-grabbing scenes",
    icon: "rocket",
    prompt:
      "Create a video plan for a bold product launch announcement for an AI-powered productivity app. High energy, vibrant colors.",
  },
  {
    label: "Educational",
    description: "Teach a topic with structured, narrated scenes",
    icon: "book",
    prompt:
      "Create a video plan for an educational narrated video about the solar system. Cinematic style with space-themed colors.",
  },
  {
    label: "Cinematic Intro",
    description: "Dramatic opening sequence with atmospheric visuals",
    icon: "film",
    prompt:
      "Create a video plan for a short cinematic intro about the deep ocean. Moody blues, dramatic imagery, minimal text.",
  },
  {
    label: "Year in Review",
    description: "Highlight key moments and achievements",
    icon: "calendar",
    prompt:
      "Create a video plan for a detailed year-in-review video covering major AI milestones of 2025. Use bold style with warm colors.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAN_APPROVED_TAG = "[PLAN_APPROVED]";

/** User → API message: preamble + JSON. Parse for readable UI (raw JSON fallback). */
function tryParsePlanApprovedMessage(content: string):
  | { preamble: string; plan: VideoPlanType }
  | { preamble: string; rawFallback: string }
  | null {
  if (!content.startsWith(PLAN_APPROVED_TAG)) return null;
  const afterTag = content.slice(PLAN_APPROVED_TAG.length).trimStart();
  const jsonStart = afterTag.indexOf("{");
  if (jsonStart === -1) {
    return { preamble: afterTag.trim() || "Approved plan", rawFallback: content };
  }
  const preamble = afterTag.slice(0, jsonStart).trim() || "Approved plan";
  const jsonRaw = afterTag.slice(jsonStart);
  try {
    const data: unknown = JSON.parse(jsonRaw);
    const parsed = VideoPlan.safeParse(data);
    if (parsed.success) return { preamble, plan: parsed.data };
    return { preamble, rawFallback: JSON.stringify(data, null, 2) };
  } catch {
    return { preamble, rawFallback: jsonRaw };
  }
}

function appendDeltaWithSpacing(existing: string, incoming: string): string {
  if (!existing || !incoming) return existing + incoming;
  const lastChar = existing[existing.length - 1];
  const firstChar = incoming[0];
  const needsSpace =
    !/\s/.test(lastChar) &&
    !/\s/.test(firstChar) &&
    /[A-Za-z0-9.!?)]/.test(lastChar) &&
    /[A-Za-z0-9(]/.test(firstChar);
  return needsSpace ? `${existing} ${incoming}` : existing + incoming;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function resolveImageUrl(...candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    if (
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("data:image/") ||
      value.startsWith("blob:")
    ) {
      return value;
    }
  }
  return undefined;
}

const STYLE_LABELS: Record<string, string> = {
  minimal: "Minimal",
  bold: "Bold",
  cinematic: "Cinematic",
};

const MODE_LABELS: Record<string, string> = {
  short: "Short",
  detailed: "Detailed",
  narrated: "Narrated",
};

const LAYOUT_OPTIONS: { value: PlanSceneType["layout"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "image-left", label: "Img Left" },
  { value: "image-right", label: "Img Right" },
  { value: "image-background", label: "Img BG" },
];

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  cpu: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  ),
  rocket: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z" />
    </svg>
  ),
  book: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  ),
  film: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
      <line x1="17" y1="17" x2="22" y2="17" />
    </svg>
  ),
  calendar: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
};

const markdownComponents = {
  p: (props: React.ComponentPropsWithoutRef<"p">) => (
    <p className="mb-2 last:mb-0 text-sm leading-relaxed text-white/90" {...props} />
  ),
  strong: (props: React.ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold text-white" {...props} />
  ),
  em: (props: React.ComponentPropsWithoutRef<"em">) => (
    <em className="italic text-white/90" {...props} />
  ),
  ul: (props: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="mb-2 list-disc list-inside space-y-1 text-white/85" {...props} />
  ),
  ol: (props: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="mb-2 list-decimal list-inside space-y-1 text-white/85" {...props} />
  ),
  li: (props: React.ComponentPropsWithoutRef<"li">) => (
    <li className="text-sm leading-relaxed" {...props} />
  ),
  h1: (props: React.ComponentPropsWithoutRef<"h1">) => (
    <h1 className="mt-3 mb-2 text-lg font-semibold text-white" {...props} />
  ),
  h2: (props: React.ComponentPropsWithoutRef<"h2">) => (
    <h2 className="mt-3 mb-2 text-base font-semibold text-white" {...props} />
  ),
  h3: (props: React.ComponentPropsWithoutRef<"h3">) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold text-white" {...props} />
  ),
  hr: () => <hr className="my-3 border-white/15" />,
  blockquote: (props: React.ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote className="my-2 border-l-2 border-indigo-400/60 pl-3 text-white/80" {...props} />
  ),
  table: (props: React.ComponentPropsWithoutRef<"table">) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs text-white/85" {...props} />
    </div>
  ),
  thead: (props: React.ComponentPropsWithoutRef<"thead">) => (
    <thead className="bg-white/10" {...props} />
  ),
  th: (props: React.ComponentPropsWithoutRef<"th">) => (
    <th className="border border-white/15 px-2 py-1 text-left font-semibold text-white" {...props} />
  ),
  td: (props: React.ComponentPropsWithoutRef<"td">) => (
    <td className="border border-white/10 px-2 py-1 align-top text-white/80" {...props} />
  ),
  code: (props: React.ComponentPropsWithoutRef<"code">) => (
    <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-xs text-indigo-200" {...props} />
  ),
};

// ---------------------------------------------------------------------------
// Plan UI Components
// ---------------------------------------------------------------------------

function PlanTimeline({
  scenes,
  accentColor,
}: {
  scenes: PlanSceneType[];
  accentColor: string;
}) {
  const totalDuration = scenes.reduce((s, sc) => s + sc.durationInSeconds, 0);
  if (totalDuration === 0) return null;

  return (
    <div className="flex rounded-full overflow-hidden h-2 bg-white/5">
      {scenes.map((scene, i) => {
        const pct = (scene.durationInSeconds / totalDuration) * 100;
        const opacity = 0.4 + (i / Math.max(scenes.length - 1, 1)) * 0.6;
        return (
          <div
            key={scene.id}
            className="relative group"
            style={{ width: `${pct}%`, backgroundColor: accentColor, opacity }}
            title={`${scene.title} (${scene.durationInSeconds}s)`}
          >
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              {scene.title} - {scene.durationInSeconds}s
            </div>
          </div>
        );
      })}
    </div>
  );
}

type ImageStatus = "ok" | "pending" | "failed" | "no-image";

function PendingImageSlot({
  status,
  prompt,
  compact,
}: {
  status: Exclude<ImageStatus, "ok">;
  prompt: string;
  compact: boolean;
}) {
  return (
    <div
      className={`w-full h-full flex items-center justify-center bg-linear-to-br from-white/4 to-black/20 ${status === "pending" ? "animate-pulse" : ""}`}
    >
      <div className="flex flex-col items-center gap-1 text-center px-2 max-w-full">
        {status === "pending" ? (
          <svg
            width={compact ? 12 : 16}
            height={compact ? 12 : 16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-white/30 animate-spin"
            style={{ animationDuration: "1.6s" }}
          >
            <circle cx="12" cy="12" r="9" strokeDasharray="14 6" />
          </svg>
        ) : status === "failed" ? (
          <svg
            width={compact ? 12 : 16}
            height={compact ? 12 : 16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-red-400/40"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ) : (
          <svg
            width={compact ? 12 : 16}
            height={compact ? 12 : 16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-white/20"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        )}
        <p
          className={`${compact ? "text-[6px]" : "text-[8px]"} text-white/40 leading-tight line-clamp-2`}
        >
          {status === "pending"
            ? "Finding image..."
            : status === "failed"
              ? "Image unavailable"
              : prompt || "No image"}
        </p>
      </div>
    </div>
  );
}

/**
 * A 16:9 DOM mockup of how the scene will look in the final Remotion video.
 * Mirrors DynamicComp/SceneCard layout logic (image-background, image-left,
 * image-right, text) using the plan's color palette, style, and actual copy.
 */
function ScenePreviewMockup({
  scene,
  palette,
  asset,
  style,
  compact = false,
}: {
  scene: PlanSceneType;
  palette: VideoPlanType["colorPalette"];
  asset?: VideoPlanType["assets"][number];
  style: VideoPlanType["style"];
  compact?: boolean;
}) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const imageUrl = resolveImageUrl(
    scene.previewImageUrl,
    asset?.thumbnailUrl,
    asset?.url,
  );
  const imagePrompt = scene.imagePrompt || asset?.prompt || "";
  const hasImage = Boolean(imageUrl) && !imageLoadFailed;

  useEffect(() => {
    setImageLoadFailed(false);
  }, [imageUrl]);

  const wantsImage = scene.layout !== "text";
  const imageStatus: Exclude<ImageStatus, "ok"> = imageLoadFailed || asset?.status === "failed"
    ? "failed"
    : wantsImage && (imagePrompt || asset?.status === "pending")
      ? "pending"
      : "no-image";

  const imageOnLeft = scene.layout === "image-left";
  const imageOnRight = scene.layout === "image-right";
  const imageAsBackground = scene.layout === "image-background";
  const hasSideImage = imageOnLeft || imageOnRight;

  const titleCls = compact ? "text-[9px]" : "text-[12px]";
  const bodyCls = compact ? "text-[6px]" : "text-[8px]";
  const bulletCls = compact ? "text-[5px]" : "text-[7px]";

  const textShadow = imageAsBackground
    ? "0 1px 2px rgba(0,0,0,0.7), 0 0 6px rgba(0,0,0,0.35)"
    : "none";

  const fontWeight = style === "bold" ? 900 : 700;
  const letterSpacing = style === "cinematic" ? "0.02em" : "normal";

  const imageElement = hasImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={imagePrompt || scene.title}
      className="absolute inset-0 w-full h-full object-cover"
      onError={() => setImageLoadFailed(true)}
    />
  ) : (
    <PendingImageSlot status={imageStatus} prompt={imagePrompt} compact={compact} />
  );

  const textContent = (
    <div className={`${imageAsBackground ? "text-center" : "text-left"} max-w-full min-w-0`}>
      <h4
        className={`${titleCls} leading-tight m-0 truncate`}
        style={{
          color: palette.text,
          fontWeight,
          letterSpacing,
          textShadow,
        }}
      >
        {scene.title}
      </h4>
      {scene.body && (
        <p
          className={`${bodyCls} leading-snug mt-1 ${compact ? "line-clamp-2" : "line-clamp-3"}`}
          style={{
            color: palette.text,
            opacity: 0.82,
            textShadow,
          }}
        >
          {scene.body}
        </p>
      )}
      {scene.bullets.length > 0 && !compact && (
        <div className="mt-1.5 space-y-0.5">
          {scene.bullets.slice(0, 3).map((b, i) => (
            <div key={i} className="flex items-center gap-1 min-w-0">
              <div
                className="w-[3px] h-[3px] rounded-full shrink-0"
                style={{ backgroundColor: palette.accent }}
              />
              <span
                className={`${bulletCls} leading-tight truncate`}
                style={{
                  color: palette.text,
                  opacity: 0.78,
                  textShadow,
                }}
              >
                {b}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="relative w-full aspect-video rounded-lg overflow-hidden border border-white/5 shadow-inner"
      style={{ backgroundColor: palette.background }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[2px] z-20 pointer-events-none"
        style={{ background: `linear-gradient(90deg, ${palette.accent}, transparent)` }}
      />

      {style === "cinematic" && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 70% 20%, ${palette.accent}22, transparent 55%)`,
          }}
        />
      )}

      {imageAsBackground ? (
        <>
          <div className="absolute inset-0">{imageElement}</div>
          {hasImage && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  style === "cinematic"
                    ? "linear-gradient(160deg, rgba(0,0,0,0.7), rgba(0,0,0,0.42))"
                    : "linear-gradient(160deg, rgba(0,0,0,0.55), rgba(0,0,0,0.32))",
              }}
            />
          )}
          <div className="relative z-10 h-full flex items-center justify-center px-4">
            {textContent}
          </div>
        </>
      ) : hasSideImage ? (
        <div className={`h-full flex ${imageOnLeft ? "flex-row-reverse" : "flex-row"}`}>
          <div className="flex-1 flex items-center px-3 min-w-0">{textContent}</div>
          <div className="flex-1 relative min-w-0">{imageElement}</div>
        </div>
      ) : (
        <div className="h-full flex items-center justify-center px-4">
          {textContent}
        </div>
      )}

      <div
        className="absolute bottom-1.5 left-2 pointer-events-none"
        style={{
          color: palette.text,
          opacity: 0.35,
          fontSize: compact ? 5 : 7,
          textShadow,
        }}
      >
        {scene.durationInSeconds}s
      </div>
    </div>
  );
}

function LayoutIcon({ layout }: { layout: PlanSceneType["layout"] }) {
  if (layout === "text") {
    return (
      <svg
        width="12"
        height="9"
        viewBox="0 0 22 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="1" y="1" width="20" height="14" rx="1.5" />
        <line x1="5" y1="6" x2="17" y2="6" />
        <line x1="7" y1="10" x2="15" y2="10" />
      </svg>
    );
  }
  if (layout === "image-left") {
    return (
      <svg
        width="12"
        height="9"
        viewBox="0 0 22 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="1" y="1" width="20" height="14" rx="1.5" />
        <rect x="1" y="1" width="10" height="14" fill="currentColor" fillOpacity="0.3" />
        <line x1="13" y1="6" x2="19" y2="6" />
        <line x1="13" y1="10" x2="17" y2="10" />
      </svg>
    );
  }
  if (layout === "image-right") {
    return (
      <svg
        width="12"
        height="9"
        viewBox="0 0 22 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="1" y="1" width="20" height="14" rx="1.5" />
        <rect x="11" y="1" width="10" height="14" fill="currentColor" fillOpacity="0.3" />
        <line x1="3" y1="6" x2="9" y2="6" />
        <line x1="3" y1="10" x2="8" y2="10" />
      </svg>
    );
  }
  return (
    <svg
      width="12"
      height="9"
      viewBox="0 0 22 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="1" y="1" width="20" height="14" rx="1.5" fill="currentColor" fillOpacity="0.3" />
      <line x1="7" y1="8" x2="15" y2="8" />
    </svg>
  );
}

function StatusDot({
  asset,
  hasImage,
  wantsImage,
}: {
  asset?: VideoPlanType["assets"][number];
  hasImage: boolean;
  wantsImage: boolean;
}) {
  if (!wantsImage) return null;

  const state: "found" | "failed" | "pending" | "idle" = hasImage
    ? "found"
    : asset?.status === "failed"
      ? "failed"
      : asset?.status === "pending" || (!asset && wantsImage)
        ? "pending"
        : "idle";

  const color =
    state === "found"
      ? "bg-emerald-400"
      : state === "failed"
        ? "bg-red-400"
        : state === "pending"
          ? "bg-amber-400"
          : "bg-white/20";

  const label =
    state === "found"
      ? "image ready"
      : state === "failed"
        ? "image failed"
        : state === "pending"
          ? "searching"
          : "no image";

  return (
    <span className="flex items-center gap-1 text-[9px] text-white/40">
      <span
        className={`w-1.5 h-1.5 rounded-full ${color} ${state === "pending" ? "animate-pulse" : ""}`}
      />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

function PlanSceneCard({
  scene,
  index,
  asset,
  palette,
  style,
  onUpdate,
  onRemove,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  view,
}: {
  scene: PlanSceneType;
  index: number;
  asset?: VideoPlanType["assets"][number];
  palette: VideoPlanType["colorPalette"];
  style: VideoPlanType["style"];
  onUpdate: (id: string, data: Partial<PlanSceneType>) => void;
  onRemove: (id: string) => void;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  view: "storyboard" | "outline";
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(scene.title);
  const [editBody, setEditBody] = useState(scene.body);
  const [editDuration, setEditDuration] = useState(scene.durationInSeconds);
  const [promptDraft, setPromptDraft] = useState(scene.imagePrompt);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setPromptDraft(scene.imagePrompt);
  }, [scene.imagePrompt]);

  useEffect(() => {
    if (!isEditing) {
      setEditTitle(scene.title);
      setEditBody(scene.body);
      setEditDuration(scene.durationInSeconds);
    }
  }, [isEditing, scene.title, scene.body, scene.durationInSeconds]);

  const commitPrompt = useCallback(() => {
    if (promptDraft !== scene.imagePrompt) {
      onUpdate(scene.id, { imagePrompt: promptDraft });
    }
  }, [promptDraft, scene.id, scene.imagePrompt, onUpdate]);

  const handleSave = () => {
    onUpdate(scene.id, {
      title: editTitle,
      body: editBody,
      durationInSeconds: editDuration,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(scene.title);
    setEditBody(scene.body);
    setEditDuration(scene.durationInSeconds);
    setIsEditing(false);
  };

  const resolvedImageUrl = resolveImageUrl(
    scene.previewImageUrl,
    asset?.thumbnailUrl,
    asset?.url,
  );
  const hasImage = Boolean(resolvedImageUrl);
  const wantsImage = scene.layout !== "text";
  const outline = view === "outline";

  return (
    <div
      draggable={!isEditing}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, index)}
      className={`group rounded-xl border bg-white/3 transition-colors ${
        isDragOver
          ? "border-indigo-400/50 bg-indigo-500/5"
          : "border-white/8 hover:border-white/15"
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className="cursor-grab active:cursor-grabbing text-white/20 hover:text-white/40 transition-colors select-none shrink-0"
            title="Drag to reorder"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="8" cy="4" r="2" />
              <circle cx="16" cy="4" r="2" />
              <circle cx="8" cy="12" r="2" />
              <circle cx="16" cy="12" r="2" />
              <circle cx="8" cy="20" r="2" />
              <circle cx="16" cy="20" r="2" />
            </svg>
          </span>
          <span className="text-[10px] font-bold text-white/40 bg-white/5 rounded px-1.5 py-0.5 shrink-0 tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          {isEditing ? (
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="bg-white/5 border border-white/15 rounded px-2 py-0.5 text-sm text-white outline-none focus:border-indigo-500/50 flex-1 min-w-0"
            />
          ) : (
            <h4 className="text-sm font-medium text-white/90 truncate">{scene.title}</h4>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusDot asset={asset} hasImage={hasImage} wantsImage={wantsImage} />
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="text-white/30 hover:text-white/60 transition-colors p-1 md:opacity-0 md:group-hover:opacity-100"
              title="Edit scene"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          ) : (
            <>
              <button
                onClick={handleSave}
                className="text-green-400/70 hover:text-green-400 transition-colors p-1"
                title="Save"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button
                onClick={handleCancel}
                className="text-white/30 hover:text-white/60 transition-colors p-1"
                title="Cancel"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </>
          )}
          <button
            onClick={() => onRemove(scene.id)}
            className="text-white/20 hover:text-red-400/70 transition-colors p-1 md:opacity-0 md:group-hover:opacity-100"
            title="Remove scene"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-3 pt-3">
        <ScenePreviewMockup
          scene={scene}
          palette={palette}
          asset={asset}
          style={style}
          compact={outline}
        />
      </div>

      <div className="px-3 pt-2.5 pb-3 space-y-2">
        <div className="flex items-center gap-1 flex-wrap">
          <div className="flex items-center gap-1">
            {LAYOUT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onUpdate(scene.id, { layout: opt.value })}
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  scene.layout === opt.value
                    ? "border-indigo-500/50 text-indigo-300 bg-indigo-500/10"
                    : "border-white/8 text-white/40 hover:text-white/60"
                }`}
                title={opt.label}
              >
                <LayoutIcon layout={opt.value} />
                <span className="hidden md:inline">{opt.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <input
              type="range"
              min={1}
              max={20}
              value={scene.durationInSeconds}
              onChange={(e) =>
                onUpdate(scene.id, { durationInSeconds: Number(e.target.value) })
              }
              className="w-16 accent-indigo-500"
              title={`Duration: ${scene.durationInSeconds}s`}
            />
            <span className="text-[10px] text-white/50 tabular-nums w-6 text-right">
              {scene.durationInSeconds}s
            </span>
          </div>
        </div>

        {wantsImage && (
          <div className="flex items-center gap-1.5">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-white/30 shrink-0"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <input
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onBlur={commitPrompt}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              placeholder="Image search prompt..."
              className="flex-1 min-w-0 bg-white/3 border border-white/8 rounded px-2 py-1 text-[11px] text-white/70 placeholder-white/20 outline-none focus:border-indigo-500/40 focus:bg-white/5 transition-colors"
            />
          </div>
        )}

        {isEditing && (
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            placeholder="Scene body text..."
            rows={2}
            className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-xs text-white/80 outline-none focus:border-indigo-500/50 resize-none"
          />
        )}

        {!isEditing && (scene.body || scene.bullets.length > 0) && (
          <div>
            <button
              onClick={() => setShowDetails((s) => !s)}
              className="text-[10px] text-white/35 hover:text-white/55 transition-colors flex items-center gap-1"
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`transition-transform ${showDetails ? "rotate-90" : ""}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {showDetails ? "Hide details" : "Show details"}
            </button>
            {showDetails && (
              <div className="mt-1.5 space-y-1 text-[11px] text-white/55 leading-relaxed">
                {scene.body && <p>{scene.body}</p>}
                {scene.bullets.length > 0 && (
                  <ul className="list-disc list-inside space-y-0.5 text-white/45">
                    {scene.bullets.map((b, i) => (
                      <li key={`${scene.id}-b${i}`}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {scene.notes && (
          <p className="text-[10px] text-indigo-300/50 italic">{scene.notes}</p>
        )}
      </div>
    </div>
  );
}

function PlanArtifact({
  plan,
  onUpdatePlan,
  onApprove,
  onRefine,
  isLoading,
}: {
  plan: VideoPlanType;
  onUpdatePlan: (plan: VideoPlanType) => void;
  onApprove: (plan: VideoPlanType) => void;
  onRefine: (feedback: string) => void;
  isLoading: boolean;
}) {
  const handleSceneUpdate = useCallback(
    async (sceneId: string, data: Partial<PlanSceneType>) => {
      try {
        const res = await fetch("/api/chat/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            plan,
            mutation: { action: "update_scene", sceneId, data },
          }),
        });
        const { plan: updated } = await res.json();
        onUpdatePlan(updated);
      } catch {
        // optimistic: update locally
        const scenes = plan.scenes.map((s) =>
          s.id === sceneId ? { ...s, ...data, id: s.id } : s,
        );
        onUpdatePlan({ ...plan, scenes });
      }
    },
    [plan, onUpdatePlan],
  );

  const handleSceneRemove = useCallback(
    async (sceneId: string) => {
      try {
        const res = await fetch("/api/chat/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            plan,
            mutation: { action: "remove_scene", sceneId },
          }),
        });
        const { plan: updated } = await res.json();
        onUpdatePlan(updated);
      } catch {
        const scenes = plan.scenes.filter((s) => s.id !== sceneId);
        const assets = plan.assets.filter((a) => a.sceneId !== sceneId);
        onUpdatePlan({ ...plan, scenes, assets });
      }
    },
    [plan, onUpdatePlan],
  );

  const handleAddScene = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan,
          mutation: {
            action: "add_scene",
            data: { title: `Scene ${plan.scenes.length + 1}` },
          },
        }),
      });
      const { plan: updated } = await res.json();
      onUpdatePlan(updated);
    } catch {
      // local fallback
      const newScene: PlanSceneType = {
        id: `scene-${Date.now()}`,
        title: `Scene ${plan.scenes.length + 1}`,
        body: "",
        bullets: [],
        layout: "text",
        imagePrompt: "",
        durationInSeconds: plan.mode === "detailed" ? 4 : plan.mode === "narrated" ? 6 : 3,
      };
      onUpdatePlan({ ...plan, scenes: [...plan.scenes, newScene] });
    }
  }, [plan, onUpdatePlan]);

  const handleStyleChange = useCallback(
    async (style: "minimal" | "bold" | "cinematic") => {
      try {
        const res = await fetch("/api/chat/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            plan,
            mutation: { action: "update_globals", data: { style } },
          }),
        });
        const { plan: updated } = await res.json();
        onUpdatePlan(updated);
      } catch {
        onUpdatePlan({ ...plan, style });
      }
    },
    [plan, onUpdatePlan],
  );

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((_e: React.DragEvent, index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === targetIndex) {
        handleDragEnd();
        return;
      }

      const reordered = [...plan.scenes];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      const newIds = reordered.map((s) => s.id);

      handleDragEnd();

      try {
        const res = await fetch("/api/chat/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            plan,
            mutation: { action: "reorder_scenes", sceneIds: newIds },
          }),
        });
        const { plan: updated } = await res.json();
        onUpdatePlan(updated);
      } catch {
        onUpdatePlan({ ...plan, scenes: reordered });
      }
    },
    [dragIndex, plan, onUpdatePlan, handleDragEnd],
  );

  const assetMap = useMemo(() => {
    const map = new Map<string, VideoPlanType["assets"][number]>();
    for (const asset of plan.assets) {
      if (asset.sceneId) map.set(asset.sceneId, asset);
    }
    return map;
  }, [plan.assets]);

  const [view, setView] = useState<"storyboard" | "outline">("storyboard");

  return (
    <div className="mt-3 rounded-xl border border-indigo-500/20 bg-indigo-500/3 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 bg-white/2">
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400 shrink-0">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
            <span className="text-xs font-medium text-indigo-300/80 shrink-0">Storyboard Artifact</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300/60 border border-indigo-500/20 shrink-0">
              {plan.status}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 text-[10px] text-white/40 tabular-nums">
            <span>{plan.scenes.length} scene{plan.scenes.length === 1 ? "" : "s"}</span>
            <span className="text-white/20">·</span>
            <span>{formatDuration(plan.estimatedDuration)}</span>
          </div>
        </div>
        <h3 className="text-sm font-semibold text-white/90">{plan.title}</h3>
        <p className="text-xs text-white/40 mt-0.5">{plan.topic}</p>
      </div>

      {/* Style & Mode badges + Color palette */}
      <div className="px-4 py-2.5 border-b border-white/6 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {(["minimal", "bold", "cinematic"] as const).map((s) => (
            <button
              key={s}
              onClick={() => handleStyleChange(s)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                plan.style === s
                  ? "border-indigo-500/40 text-indigo-300 bg-indigo-500/10"
                  : "border-white/10 text-white/30 hover:text-white/50"
              }`}
            >
              {STYLE_LABELS[s]}
            </button>
          ))}
          <span className="text-white/15">|</span>
          <span className="text-[10px] text-white/40">{MODE_LABELS[plan.mode]}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-4 h-4 rounded border border-white/15"
            style={{ backgroundColor: plan.colorPalette.background }}
            title={`BG: ${plan.colorPalette.background}`}
          />
          <div
            className="w-4 h-4 rounded border border-white/15"
            style={{ backgroundColor: plan.colorPalette.accent }}
            title={`Accent: ${plan.colorPalette.accent}`}
          />
          <div
            className="w-4 h-4 rounded border border-white/15"
            style={{ backgroundColor: plan.colorPalette.text }}
            title={`Text: ${plan.colorPalette.text}`}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 py-2">
        <PlanTimeline scenes={plan.scenes} accentColor={plan.colorPalette.accent} />
      </div>

      {/* View toggle */}
      <div className="px-4 pt-1 pb-2 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-white/25 font-medium">Scenes</p>
        <div className="inline-flex items-center rounded-full border border-white/8 bg-white/3 p-0.5">
          <button
            onClick={() => setView("storyboard")}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full transition-colors ${
              view === "storyboard"
                ? "bg-white/10 text-white/85"
                : "text-white/40 hover:text-white/60"
            }`}
            title="Storyboard view"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            Storyboard
          </button>
          <button
            onClick={() => setView("outline")}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full transition-colors ${
              view === "outline"
                ? "bg-white/10 text-white/85"
                : "text-white/40 hover:text-white/60"
            }`}
            title="Outline view"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Outline
          </button>
        </div>
      </div>

      {/* Scenes */}
      <div
        className={`px-4 pb-2.5 max-h-[640px] overflow-y-auto ${
          view === "storyboard"
            ? "grid grid-cols-1 md:grid-cols-2 gap-2.5"
            : "flex flex-col gap-2.5"
        }`}
      >
        {plan.scenes.map((scene, i) => (
          <PlanSceneCard
            key={scene.id}
            scene={scene}
            index={i}
            asset={assetMap.get(scene.id)}
            palette={plan.colorPalette}
            style={plan.style}
            onUpdate={handleSceneUpdate}
            onRemove={handleSceneRemove}
            isDragOver={dragOverIndex === i && dragIndex !== i}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            view={view}
          />
        ))}
        <button
          onClick={handleAddScene}
          className={`rounded-xl border border-dashed border-white/10 hover:border-white/20 text-white/30 hover:text-white/50 text-xs transition-colors flex items-center justify-center gap-1.5 ${
            view === "storyboard" ? "aspect-video md:aspect-auto md:min-h-32" : "py-2.5 w-full"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Scene
        </button>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-white/8 bg-white/2 flex items-center gap-2">
        <button
          onClick={() => onApprove(plan)}
          disabled={isLoading || plan.scenes.length === 0}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-xs font-medium transition-all"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Generate Video
        </button>
        <button
          onClick={() => onRefine("Please refine this video plan: improve the scenes, make the content more engaging, and suggest better image prompts.")}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 hover:border-white/20 px-3 py-2 text-xs text-white/50 hover:text-white/70 transition-colors disabled:opacity-40"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-indigo-400">
            <path d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z" />
          </svg>
          Ask AI to Refine
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video artifact
// ---------------------------------------------------------------------------

function VideoCard({
  renderState,
  videoProps,
  onTweak,
}: {
  renderState: RenderState;
  videoProps?: DynamicProps;
  onTweak?: (prompt: string) => void;
}) {
  if (renderState.status === "idle") return null;

  const parsedProps = videoProps ?? DynamicVideoProps.parse({});
  const durationInSeconds = getDynamicDurationInSeconds(parsedProps);
  const durationInFrames = Math.round(durationInSeconds * DYNAMIC_VIDEO_FPS);

  const rendering = renderState.status === "rendering";
  const done = renderState.status === "done";

  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-white/10 bg-white/5 shadow-2xl shadow-black/20">
      {/* Hero player */}
      <div className="relative w-full aspect-video bg-black">
        <Player
          component={DynamicComp}
          inputProps={parsedProps}
          durationInFrames={durationInFrames}
          fps={DYNAMIC_VIDEO_FPS}
          compositionHeight={DYNAMIC_VIDEO_HEIGHT}
          compositionWidth={DYNAMIC_VIDEO_WIDTH}
          style={{ width: "100%", height: "100%" }}
          controls
          autoPlay
          loop
        />

        {/* Phase pill overlay while rendering */}
        {rendering && (
          <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 backdrop-blur-md border border-white/10 pl-2 pr-3 py-1 pointer-events-none">
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
            <span className="text-[11px] text-white/85 font-medium">{renderState.phase}</span>
            <span className="text-[10px] text-white/50 tabular-nums">
              {Math.round(renderState.progress * 100)}%
            </span>
          </div>
        )}

        {/* Done badge overlay */}
        {done && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/70 backdrop-blur-md border border-white/10 px-2.5 py-1 pointer-events-none">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-400">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-[11px] text-white/85 font-medium">Ready</span>
          </div>
        )}
      </div>

      {/* Progress bar flush under player while rendering */}
      {rendering && (
        <div className="h-1 bg-black/40">
          <div
            className="h-full bg-indigo-400 transition-all duration-300"
            style={{ width: `${Math.round(renderState.progress * 100)}%` }}
          />
        </div>
      )}

      {/* Metadata + actions */}
      <div className="p-3.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-white/45">
          <span className="rounded-full border border-white/10 px-2 py-0.5">
            {MODE_LABELS[parsedProps.mode] ?? parsedProps.mode}
          </span>
          <span className="rounded-full border border-white/10 px-2 py-0.5">
            {STYLE_LABELS[parsedProps.style] ?? parsedProps.style}
          </span>
          <span className="rounded-full border border-white/10 px-2 py-0.5">
            {parsedProps.scenes.length} scene{parsedProps.scenes.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 tabular-nums">
            {formatDuration(durationInSeconds)}
          </span>
          {done && (
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 text-emerald-300/70 px-2 py-0.5 tabular-nums">
              {formatBytes(renderState.size)}
            </span>
          )}
        </div>

        {done && (
          <div className="flex items-center gap-1.5 ml-auto">
            {onTweak && (
              <button
                onClick={() =>
                  onTweak(
                    `Tweak this video: refine the pacing, polish the imagery, and keep the current story structure.`,
                  )
                }
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/25 text-white/65 hover:text-white/90 transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-indigo-400/80">
                  <path d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z" />
                </svg>
                Tweak
              </button>
            )}
            <a
              href={renderState.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors font-medium"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Download MP4
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function getVideoImprovementSuggestions(
  props: DynamicProps,
): { label: string; prompt: string }[] {
  const suggestions: { label: string; prompt: string }[] = [];
  const topic = props.topic || props.title;

  if (props.style !== "cinematic") {
    suggestions.push({
      label: "Make it cinematic",
      prompt: `Update the video about "${topic}": switch to cinematic style with dramatic colors while keeping the same content`,
    });
  }
  if (props.style !== "bold") {
    suggestions.push({
      label: "Make it bolder",
      prompt: `Update the video about "${topic}": switch to bold style with high-contrast colors while keeping the same content`,
    });
  }
  if (props.scenes.length < 8) {
    suggestions.push({
      label: "Add more scenes",
      prompt: `Update the video about "${topic}": expand to 8+ detailed scenes with more depth on each subtopic`,
    });
  }
  if (props.mode !== "narrated") {
    suggestions.push({
      label: "Switch to narrated",
      prompt: `Update the video about "${topic}": switch to narrated mode with longer, more descriptive scene text`,
    });
  }
  suggestions.push({
    label: "Change color palette",
    prompt: `Update the video about "${topic}": use a completely different color palette while keeping the same content and structure`,
  });
  suggestions.push({
    label: "Improve imagery",
    prompt: `Update the video about "${topic}": enhance all scene image prompts to be more vivid and cinematic, and use image-based layouts`,
  });

  return suggestions.slice(0, 4);
}

function ApprovedPlanReadonly({ plan }: { plan: VideoPlanType }) {
  const assetMap = useMemo(() => {
    const map = new Map<string, VideoPlanType["assets"][number]>();
    for (const asset of plan.assets) {
      if (asset.sceneId) map.set(asset.sceneId, asset);
    }
    return map;
  }, [plan.assets]);

  const [expanded, setExpanded] = useState(false);
  const COLLAPSED_COUNT = 3;
  const hiddenCount = Math.max(0, plan.scenes.length - COLLAPSED_COUNT);
  const visibleScenes = expanded ? plan.scenes : plan.scenes.slice(0, COLLAPSED_COUNT);

  return (
    <div className="mt-2 w-full rounded-xl border border-indigo-500/25 bg-indigo-950/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/8 bg-white/3">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400 shrink-0">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span className="text-xs font-medium text-indigo-200/90 truncate">Approved plan</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 shrink-0">
              {plan.status}
            </span>
          </div>
          <span className="text-[10px] text-white/35 shrink-0 tabular-nums">
            {formatDuration(plan.estimatedDuration)}
          </span>
        </div>
        <h3 className="text-sm font-semibold text-white/95">{plan.title}</h3>
        <p className="text-xs text-white/45 mt-0.5">{plan.topic}</p>
      </div>

      <div className="px-4 py-2 border-b border-white/6 flex flex-wrap items-center gap-2 text-[10px] text-white/45">
        <span className="text-white/55">{STYLE_LABELS[plan.style] ?? plan.style}</span>
        <span className="text-white/20">·</span>
        <span>{MODE_LABELS[plan.mode] ?? plan.mode}</span>
        <span className="text-white/20">·</span>
        <span>{plan.scenes.length} scenes</span>
        <div className="flex items-center gap-1 ml-auto">
          <div
            className="w-3.5 h-3.5 rounded border border-white/15"
            style={{ backgroundColor: plan.colorPalette.background }}
            title={plan.colorPalette.background}
          />
          <div
            className="w-3.5 h-3.5 rounded border border-white/15"
            style={{ backgroundColor: plan.colorPalette.accent }}
            title={plan.colorPalette.accent}
          />
          <div
            className="w-3.5 h-3.5 rounded border border-white/15"
            style={{ backgroundColor: plan.colorPalette.text }}
            title={plan.colorPalette.text}
          />
        </div>
      </div>

      <div className="px-4 py-2">
        <PlanTimeline scenes={plan.scenes} accentColor={plan.colorPalette.accent} />
      </div>

      <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        {visibleScenes.map((scene, i) => (
          <div
            key={scene.id}
            className="rounded-lg border border-white/8 bg-white/3 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-bold text-white/25 tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h4 className="text-xs font-medium text-white/85 truncate">{scene.title}</h4>
              </div>
              <span className="text-[10px] text-white/35 shrink-0 tabular-nums">
                {scene.durationInSeconds}s
              </span>
            </div>
            <div className="px-2.5 pb-2.5">
              <ScenePreviewMockup
                scene={scene}
                palette={plan.colorPalette}
                asset={assetMap.get(scene.id)}
                style={plan.style}
                compact
              />
            </div>
          </div>
        ))}
      </div>

      {hiddenCount > 0 && (
        <div className="px-4 pb-3">
          <button
            onClick={() => setExpanded((s) => !s)}
            className="w-full text-[11px] text-white/40 hover:text-white/65 transition-colors flex items-center justify-center gap-1 py-1.5 rounded-lg border border-white/8 hover:border-white/15"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {expanded ? "Show less" : `Show all ${plan.scenes.length} scenes`}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  isLatest,
  onSendSuggestion,
  onUpdatePlan,
  onApprovePlan,
  isLoading,
}: {
  message: Message;
  isLatest: boolean;
  onSendSuggestion: (text: string) => void;
  onUpdatePlan: (messageId: string, plan: VideoPlanType) => void;
  onApprovePlan: (plan: VideoPlanType) => void;
  isLoading: boolean;
}) {
  const isUser = message.role === "user";
  const planApproved = isUser ? tryParsePlanApprovedMessage(message.content) : null;
  const wideColumn = Boolean(
    message.plan ||
      planApproved ||
      (message.renderState && message.renderState.status !== "idle"),
  );

  const showSuggestions =
    isLatest &&
    !isUser &&
    !isLoading &&
    message.renderState?.status === "done" &&
    message.videoProps;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold ${
          isUser ? "bg-indigo-600 text-white" : "bg-white/10 text-white/70"
        }`}
      >
        {isUser ? "U" : "AI"}
      </div>
      <div
        className={`${wideColumn ? "max-w-[90%]" : "max-w-[75%]"} ${isUser ? "items-end" : "items-start"} flex flex-col w-full min-w-0`}
      >
        {(message.content || !message.plan) && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              isUser
                ? "bg-indigo-600 text-white rounded-tr-sm"
                : "bg-white/10 text-white/90 rounded-tl-sm"
            } ${planApproved ? "w-full" : ""}`}
          >
            {planApproved ? (
              <div>
                <p className="text-white font-medium">Plan approved</p>
                <p className="text-white/85 text-xs mt-1.5 leading-relaxed">{planApproved.preamble}</p>
              </div>
            ) : message.content ? (
              isUser ? (
                <div className="whitespace-pre-wrap wrap-break-word">{message.content}</div>
              ) : (
                <div className="wrap-break-word">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {message.content}
                  </ReactMarkdown>
                </div>
              )
            ) : (
              <span className="flex gap-1 py-0.5">
                <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
            )}
          </div>
        )}

        {planApproved && "plan" in planApproved ? (
          <ApprovedPlanReadonly plan={planApproved.plan} />
        ) : null}

        {planApproved && "rawFallback" in planApproved ? (
          <div className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 p-3 overflow-x-auto">
            <pre className="text-[10px] text-white/55 whitespace-pre-wrap font-mono leading-relaxed wrap-break-word">
              {planApproved.rawFallback}
            </pre>
          </div>
        ) : null}

        {message.plan && message.plan.status === "draft" && (
          <PlanArtifact
            plan={message.plan}
            onUpdatePlan={(updated) => onUpdatePlan(message.id, updated)}
            onApprove={onApprovePlan}
            onRefine={onSendSuggestion}
            isLoading={isLoading}
          />
        )}

        {message.renderState && message.renderState.status !== "idle" && (
          <div className="w-full mt-1">
            <VideoCard
              renderState={message.renderState}
              videoProps={message.videoProps}
              onTweak={onSendSuggestion}
            />
          </div>
        )}

        {showSuggestions && message.videoProps && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {getVideoImprovementSuggestions(message.videoProps).map((s) => (
              <button
                key={s.label}
                onClick={() => onSendSuggestion(s.prompt)}
                className="text-xs px-2.5 py-1 rounded-full border border-indigo-500/30 text-indigo-300 hover:text-indigo-200 hover:border-indigo-400/50 hover:bg-indigo-500/10 transition-all"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat Page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I can help you create dynamic videos using Remotion. Describe what you want and I'll create a plan you can review and edit before generating the video. Pick a template below or tell me what you'd like to create!",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleUpdatePlan = useCallback(
    (messageId: string, plan: VideoPlanType) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, plan } : m)),
      );
    },
    [],
  );

  const sendWithText = useCallback(
    async (text: string) => {
      if (!text || isLoading) return;

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      };

      const assistantId = `assistant-${Date.now()}`;
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setInput("");
      setIsLoading(true);

      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: text });

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });

        if (!response.ok || !response.body) {
          throw new Error("Failed to connect to chat API");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentVideoProps: DynamicProps | undefined;

        const updateAssistant = (updater: (msg: Message) => Message) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? updater(m) : m)),
          );
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6)) as ChatEvent;

            switch (event.type) {
              case "text_delta":
                updateAssistant((m) => ({
                  ...m,
                  content: appendDeltaWithSpacing(m.content, event.text),
                }));
                scrollToBottom();
                break;

              case "plan_created":
              case "plan_updated":
                updateAssistant((m) => ({
                  ...m,
                  plan: event.plan,
                }));
                scrollToBottom();
                break;

              case "tool_start":
                if (event.name === "generate_video") {
                  const parsed = DynamicVideoProps.safeParse(event.input);
                  currentVideoProps = parsed.success
                    ? parsed.data
                    : DynamicVideoProps.parse({
                        title: String(event.input.title ?? "Video"),
                      });

                  updateAssistant((m) => ({
                    ...m,
                    plan: m.plan
                      ? { ...m.plan, status: "rendering" as const }
                      : undefined,
                    videoProps: currentVideoProps,
                    renderState: {
                      status: "rendering",
                      phase: "Starting...",
                      progress: 0,
                    },
                  }));
                  scrollToBottom();
                }
                break;

              case "render_progress":
                updateAssistant((m) => ({
                  ...m,
                  renderState: {
                    status: "rendering",
                    phase: event.phase,
                    progress: event.progress,
                  },
                }));
                break;

              case "render_done":
                updateAssistant((m) => ({
                  ...m,
                  plan: m.plan
                    ? { ...m.plan, status: "done" as const }
                    : undefined,
                  renderState: {
                    status: "done",
                    url: event.url,
                    size: event.size,
                    props: currentVideoProps ?? DynamicVideoProps.parse({}),
                  },
                }));
                scrollToBottom();
                break;

              case "render_error":
                updateAssistant((m) => ({
                  ...m,
                  renderState: { status: "idle" },
                  content:
                    m.content +
                    (m.content ? "\n\n" : "") +
                    `Sorry, there was an error rendering the video: ${event.message}`,
                }));
                break;

              case "error":
                updateAssistant((m) => ({
                  ...m,
                  content: m.content || `Error: ${event.message}`,
                }));
                break;

              case "done":
                break;
            }
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${(err as Error).message}` }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, messages, scrollToBottom],
  );

  const handleApprovePlan = useCallback(
    (plan: VideoPlanType) => {
      const planJson = JSON.stringify(plan);
      sendWithText(
        `[PLAN_APPROVED] Generate the video from this approved plan. Use the generate_video tool with these exact settings:\n${planJson}`,
      );
    },
    [sendWithText],
  );

  const sendMessage = useCallback(() => {
    sendWithText(input.trim());
  }, [input, sendWithText]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const MAX_CONTEXT_CHARS = 32_000;
  const contextUsed = useMemo(
    () =>
      messages
        .filter((m) => m.id !== "welcome")
        .reduce((sum, m) => sum + m.content.length, 0),
    [messages],
  );
  const contextPct = Math.min(
    100,
    Math.round((contextUsed / MAX_CONTEXT_CHARS) * 100),
  );
  const contextWarning = contextPct >= 80;

  return (
    <div className="flex flex-col h-screen bg-[#0f172a] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <BridgeitLogo className="w-8 h-8 shrink-0" />
          <div>
            <h1 className="font-semibold text-sm">
              Bridge<span className="text-indigo-400">it</span>
            </h1>
            <p className="text-xs text-white/40">
              Built with Claude and Remotion
            </p>
          </div>
        </div>
        <a
          href="/"
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          &larr; Back to Studio
        </a>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.map((message, idx) => (
          <MessageBubble
            key={message.id}
            message={message}
            isLatest={idx === messages.length - 1}
            onSendSuggestion={sendWithText}
            onUpdatePlan={handleUpdatePlan}
            onApprovePlan={handleApprovePlan}
            isLoading={isLoading}
          />
        ))}

        {/* Templates + Suggested prompts — only when welcome message */}
        {messages.length === 1 && (
          <div className="space-y-4 mt-4">
            <p className="text-xs text-white/30 font-medium uppercase tracking-wider">
              Quick Start Templates
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {PLAN_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  onClick={() => sendWithText(tpl.prompt)}
                  className="group text-left rounded-xl border border-white/8 bg-white/2 hover:bg-white/5 hover:border-white/15 p-3 transition-all"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-indigo-400/70 group-hover:text-indigo-400 transition-colors">
                      {TEMPLATE_ICONS[tpl.icon]}
                    </span>
                    <span className="text-xs font-medium text-white/70 group-hover:text-white/90 transition-colors">
                      {tpl.label}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/30 leading-relaxed">
                    {tpl.description}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                "Create a bold video about AI advancements",
                "Make a minimal video about quantum computing",
                "Generate a cinematic video about the ocean",
                "Create a tech startup announcement video",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendWithText(prompt)}
                  className="text-xs px-3 py-1.5 rounded-full border border-white/15 text-white/60 hover:text-white/90 hover:border-white/30 transition-all"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-white/10">
        <div className="flex items-end gap-3 bg-white/5 rounded-2xl px-4 py-3 border border-white/10 focus-within:border-indigo-500/50 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your video idea or ask Claude anything..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder-white/30 resize-none outline-none leading-6 max-h-32 overflow-y-auto"
            style={{ minHeight: "24px" }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center shrink-0"
          >
            {isLoading ? (
              <svg
                className="animate-spin"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          <p className="text-xs text-white/20">
            Enter to send &bull; Shift+Enter for new line
          </p>
          <div className="flex items-center gap-2">
            <div className="w-16 bg-white/10 rounded-full h-1 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  contextWarning ? "bg-amber-400" : "bg-white/25"
                }`}
                style={{ width: `${contextPct}%` }}
              />
            </div>
            <span
              className={`text-xs tabular-nums ${
                contextWarning ? "text-amber-400" : "text-white/20"
              }`}
            >
              {contextPct >= 100
                ? "Context full"
                : `${Math.round(contextUsed / 1000)}K / ${MAX_CONTEXT_CHARS / 1000}K`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
