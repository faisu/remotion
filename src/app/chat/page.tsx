"use client";

import { Player } from "@remotion/player";
import { useCallback, useMemo, useRef, useState } from "react";
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

function SceneAssetPreview({
  scene,
  asset,
}: {
  scene: PlanSceneType;
  asset?: VideoPlanType["assets"][number];
}) {
  const imageUrl = scene.previewImageUrl || asset?.thumbnailUrl;
  const status = asset?.status ?? (scene.imagePrompt ? "pending" : undefined);
  if (!scene.imagePrompt && !imageUrl) return null;

  return (
    <div className="mt-2 rounded-lg overflow-hidden bg-white/5 border border-white/8 relative">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={scene.imagePrompt || scene.title}
          className="w-full h-24 object-cover"
        />
      ) : (
        <div className="w-full h-24 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/15">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
      )}
      {status && (
        <span
          className={`absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur-sm ${
            status === "found"
              ? "bg-green-500/20 text-green-300/80"
              : status === "failed"
                ? "bg-red-500/20 text-red-300/80"
                : "bg-white/10 text-white/40"
          }`}
        >
          {status}
        </span>
      )}
      {scene.imagePrompt && (
        <div className="px-2 py-1 border-t border-white/6">
          <p className="text-[9px] text-white/30 truncate">{scene.imagePrompt}</p>
        </div>
      )}
    </div>
  );
}

function PlanSceneCard({
  scene,
  index,
  asset,
  onUpdate,
  onRemove,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  scene: PlanSceneType;
  index: number;
  asset?: VideoPlanType["assets"][number];
  onUpdate: (id: string, data: Partial<PlanSceneType>) => void;
  onRemove: (id: string) => void;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(scene.title);
  const [editBody, setEditBody] = useState(scene.body);
  const [editPrompt, setEditPrompt] = useState(scene.imagePrompt);
  const [editDuration, setEditDuration] = useState(scene.durationInSeconds);

  const handleSave = () => {
    onUpdate(scene.id, {
      title: editTitle,
      body: editBody,
      imagePrompt: editPrompt,
      durationInSeconds: editDuration,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(scene.title);
    setEditBody(scene.body);
    setEditPrompt(scene.imagePrompt);
    setEditDuration(scene.durationInSeconds);
    setIsEditing(false);
  };

  return (
    <div
      draggable={!isEditing}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, index)}
      className={`rounded-xl border bg-white/3 p-4 transition-colors ${
        isDragOver
          ? "border-indigo-400/50 bg-indigo-500/5"
          : "border-white/8 hover:border-white/15"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {/* Drag handle */}
          <span className="cursor-grab active:cursor-grabbing text-white/20 hover:text-white/40 transition-colors select-none">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="8" cy="4" r="2" />
              <circle cx="16" cy="4" r="2" />
              <circle cx="8" cy="12" r="2" />
              <circle cx="16" cy="12" r="2" />
              <circle cx="8" cy="20" r="2" />
              <circle cx="16" cy="20" r="2" />
            </svg>
          </span>
          <span className="text-[10px] font-bold text-white/30 bg-white/5 rounded px-1.5 py-0.5">
            {String(index + 1).padStart(2, "0")}
          </span>
          {isEditing ? (
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="bg-white/5 border border-white/15 rounded px-2 py-0.5 text-sm text-white outline-none focus:border-indigo-500/50"
            />
          ) : (
            <h4 className="text-sm font-medium text-white/90">{scene.title}</h4>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="text-white/30 hover:text-white/60 transition-colors p-1"
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
            className="text-white/20 hover:text-red-400/70 transition-colors p-1"
            title="Remove scene"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-2 mt-2">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            placeholder="Scene body text..."
            rows={2}
            className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-xs text-white/80 outline-none focus:border-indigo-500/50 resize-none"
          />
          <div className="flex gap-2">
            <input
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="Image search prompt..."
              className="flex-1 bg-white/5 border border-white/15 rounded px-2 py-1 text-xs text-white/70 outline-none focus:border-indigo-500/50"
            />
            <div className="flex items-center gap-1">
              <input
                type="range"
                min={1}
                max={20}
                value={editDuration}
                onChange={(e) => setEditDuration(Number(e.target.value))}
                className="w-16 accent-indigo-500"
              />
              <span className="text-[10px] text-white/40 w-6">{editDuration}s</span>
            </div>
          </div>
          <div className="flex gap-1">
            {LAYOUT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() =>
                  onUpdate(scene.id, { layout: opt.value })
                }
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  scene.layout === opt.value
                    ? "border-indigo-500/50 text-indigo-300 bg-indigo-500/10"
                    : "border-white/10 text-white/40 hover:text-white/60"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {scene.body && (
            <p className="text-xs text-white/50 leading-relaxed mb-2">{scene.body}</p>
          )}
          <div className="flex items-center gap-3 text-[10px] text-white/30">
            <span>{scene.layout}</span>
            <span>{scene.durationInSeconds}s</span>
          </div>
          <SceneAssetPreview scene={scene} asset={asset} />
          {scene.notes && (
            <p className="mt-1.5 text-[10px] text-indigo-300/50 italic">{scene.notes}</p>
          )}
        </>
      )}
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

  return (
    <div className="mt-3 rounded-xl border border-indigo-500/20 bg-indigo-500/3 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 bg-white/2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
            </svg>
            <span className="text-xs font-medium text-indigo-300/80">Video Plan</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300/60 border border-indigo-500/20">
              {plan.status}
            </span>
          </div>
          <span className="text-[10px] text-white/30">
            {formatDuration(plan.estimatedDuration)}
          </span>
        </div>
        <h3 className="text-sm font-semibold text-white/90">{plan.title}</h3>
        <p className="text-xs text-white/40 mt-0.5">{plan.topic}</p>
      </div>

      {/* Style & Mode badges + Color palette */}
      <div className="px-4 py-2.5 border-b border-white/6 flex items-center justify-between">
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

      {/* Scenes */}
      <div className="px-4 py-2 space-y-2 max-h-[500px] overflow-y-auto">
        {plan.scenes.map((scene, i) => (
          <PlanSceneCard
            key={scene.id}
            scene={scene}
            index={i}
            asset={assetMap.get(scene.id)}
            onUpdate={handleSceneUpdate}
            onRemove={handleSceneRemove}
            isDragOver={dragOverIndex === i && dragIndex !== i}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
          />
        ))}
        <button
          onClick={handleAddScene}
          className="w-full rounded-xl border border-dashed border-white/10 hover:border-white/20 text-white/30 hover:text-white/50 text-xs py-2.5 transition-colors flex items-center justify-center gap-1.5"
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
// Video + Progress components (unchanged from original)
// ---------------------------------------------------------------------------

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-full bg-indigo-400 rounded-full transition-all duration-300"
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
    </div>
  );
}

function VideoCard({
  renderState,
  videoProps,
}: {
  renderState: RenderState;
  videoProps?: DynamicProps;
}) {
  if (renderState.status === "idle") return null;

  const parsedProps = videoProps ?? DynamicVideoProps.parse({});
  const durationInFrames = Math.round(
    getDynamicDurationInSeconds(parsedProps) * DYNAMIC_VIDEO_FPS,
  );

  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-white/10 bg-white/5">
      {renderState.status === "rendering" && (
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
            <span className="text-sm text-white/70">{renderState.phase}</span>
            <span className="text-xs text-white/40 ml-auto">
              {Math.round(renderState.progress * 100)}%
            </span>
          </div>
          <ProgressBar progress={renderState.progress} />
          <div className="mt-3 rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-xs text-white/60 bg-black/20 border-b border-white/10">
              Mode: <span className="text-white/85">{parsedProps.mode}</span> &bull; Scenes:{" "}
              <span className="text-white/85">{parsedProps.scenes.length}</span>
            </div>
            <Player
              component={DynamicComp}
              inputProps={parsedProps}
              durationInFrames={durationInFrames}
              fps={DYNAMIC_VIDEO_FPS}
              compositionHeight={DYNAMIC_VIDEO_HEIGHT}
              compositionWidth={DYNAMIC_VIDEO_WIDTH}
              style={{ width: "100%" }}
              controls
              autoPlay
              loop
            />
          </div>
        </div>
      )}

      {renderState.status === "done" && (
        <div className="p-4">
          <div className="rounded-lg overflow-hidden mb-3">
            <div className="px-3 py-2 text-xs text-white/60 bg-black/20 border-b border-white/10">
              Mode: <span className="text-white/85">{parsedProps.mode}</span> &bull; Scenes:{" "}
              <span className="text-white/85">{parsedProps.scenes.length}</span>
            </div>
            <Player
              component={DynamicComp}
              inputProps={parsedProps}
              durationInFrames={durationInFrames}
              fps={DYNAMIC_VIDEO_FPS}
              compositionHeight={DYNAMIC_VIDEO_HEIGHT}
              compositionWidth={DYNAMIC_VIDEO_WIDTH}
              style={{ width: "100%" }}
              controls
              autoPlay
              loop
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full" />
              <span className="text-sm text-white/70">
                Rendered &bull; {formatBytes(renderState.size)}
              </span>
            </div>
            <a
              href={renderState.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
            >
              Download MP4
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            </a>
          </div>
        </div>
      )}
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
          <span className="text-[10px] text-white/35 shrink-0">
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

      <div className="px-4 pb-3 space-y-2 max-h-[min(420px,50vh)] overflow-y-auto">
        {plan.scenes.map((scene, i) => (
          <div
            key={scene.id}
            className="rounded-lg border border-white/8 bg-white/3 p-3"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-bold text-white/25">{String(i + 1).padStart(2, "0")}</span>
                <h4 className="text-xs font-medium text-white/85 truncate">{scene.title}</h4>
              </div>
              <span className="text-[10px] text-white/35 shrink-0">
                {scene.durationInSeconds}s · {scene.layout}
              </span>
            </div>
            {scene.body ? (
              <p className="text-[11px] text-white/55 leading-relaxed">{scene.body}</p>
            ) : null}
            {scene.bullets?.length ? (
              <ul className="mt-1.5 list-disc list-inside text-[10px] text-white/40 space-y-0.5">
                {scene.bullets.map((b, j) => (
                  <li key={`${scene.id}-b${j}`}>{b}</li>
                ))}
              </ul>
            ) : null}
            <SceneAssetPreview scene={scene} asset={assetMap.get(scene.id)} />
          </div>
        ))}
      </div>
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
  const wideColumn = Boolean(message.plan || planApproved);

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
              <div className="whitespace-pre-wrap wrap-break-word">{message.content}</div>
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
          <div className="w-full max-w-lg mt-1">
            <VideoCard
              renderState={message.renderState}
              videoProps={message.videoProps}
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
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold text-sm">Remotion Chat</h1>
            <p className="text-xs text-white/40">
              Powered by Claude + Remotion
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
