import {
  VideoPlan,
  type VideoPlanType,
  type PlanSceneType,
} from "../../../../../types/video-schema";
import {
  isBraveSearchConfigured,
  braveImageSearch,
} from "../../../../lib/brave-search";

type PlanAction =
  | { action: "update_scene"; sceneId: string; data: Partial<PlanSceneType> }
  | { action: "reorder_scenes"; sceneIds: string[] }
  | { action: "remove_scene"; sceneId: string }
  | { action: "add_scene"; data: Partial<PlanSceneType> }
  | { action: "update_globals"; data: Partial<Pick<VideoPlanType, "style" | "mode" | "title" | "colorPalette">> }
  | { action: "refresh_asset"; sceneId: string };

type PlanMutationRequest = {
  plan: VideoPlanType;
  mutation: PlanAction;
};

async function fetchThumbnailForPrompt(prompt: string, seed = 1): Promise<string | null> {
  if (!prompt) return null;

  if (isBraveSearchConfigured()) {
    try {
      const results = await braveImageSearch(prompt, 3);
      for (const img of results) {
        if (img.thumbnail || img.url) return img.thumbnail || img.url;
      }
    } catch {
      // fall through
    }
  }

  const encoded = encodeURIComponent(prompt.trim().replace(/\s+/g, " "));
  const pollUrl = `https://image.pollinations.ai/prompt/${encoded}?width=320&height=180&model=flux&nologo=true&seed=${seed}`;
  try {
    const res = await fetch(pollUrl, { method: "HEAD", signal: AbortSignal.timeout(5000), redirect: "follow" });
    if (res.ok) return pollUrl;
  } catch {
    // fall through
  }

  return `https://picsum.photos/seed/${seed}-thumb/320/180`;
}

function recalcDuration(plan: VideoPlanType): VideoPlanType {
  const dur = plan.scenes.reduce((s, sc) => s + sc.durationInSeconds, 0);
  return { ...plan, estimatedDuration: dur };
}

function applyMutation(plan: VideoPlanType, mutation: PlanAction): Promise<VideoPlanType> {
  switch (mutation.action) {
    case "update_scene": {
      const scenes = plan.scenes.map((s) =>
        s.id === mutation.sceneId ? { ...s, ...mutation.data, id: s.id } : s,
      );
      return Promise.resolve(recalcDuration({ ...plan, scenes }));
    }

    case "reorder_scenes": {
      const sceneMap = new Map(plan.scenes.map((s) => [s.id, s]));
      const reordered = mutation.sceneIds
        .map((id) => sceneMap.get(id))
        .filter((s): s is PlanSceneType => Boolean(s));
      return Promise.resolve(recalcDuration({ ...plan, scenes: reordered }));
    }

    case "remove_scene": {
      const scenes = plan.scenes.filter((s) => s.id !== mutation.sceneId);
      const assets = plan.assets.filter((a) => a.sceneId !== mutation.sceneId);
      return Promise.resolve(recalcDuration({ ...plan, scenes, assets }));
    }

    case "add_scene": {
      const newId = `scene-${Date.now()}`;
      const defaultDuration =
        plan.mode === "detailed" ? 4 : plan.mode === "narrated" ? 6 : 3;
      const scene: PlanSceneType = {
        id: newId,
        title: mutation.data.title || `Scene ${plan.scenes.length + 1}`,
        body: mutation.data.body || "",
        bullets: mutation.data.bullets || [],
        layout: mutation.data.layout || "text",
        imagePrompt: mutation.data.imagePrompt || "",
        durationInSeconds: mutation.data.durationInSeconds || defaultDuration,
      };
      const scenes = [...plan.scenes, scene];
      const assets = scene.imagePrompt
        ? [
            ...plan.assets,
            {
              id: `asset-${newId}`,
              type: "image" as const,
              prompt: scene.imagePrompt,
              source: "pending",
              sceneId: newId,
              status: "pending" as const,
            },
          ]
        : plan.assets;
      return Promise.resolve(recalcDuration({ ...plan, scenes, assets }));
    }

    case "update_globals": {
      const updated = { ...plan };
      if (mutation.data.style) updated.style = mutation.data.style;
      if (mutation.data.mode) updated.mode = mutation.data.mode;
      if (mutation.data.title) updated.title = mutation.data.title;
      if (mutation.data.colorPalette) {
        updated.colorPalette = { ...updated.colorPalette, ...mutation.data.colorPalette };
      }
      return Promise.resolve(recalcDuration(updated));
    }

    case "refresh_asset": {
      return (async () => {
        const scene = plan.scenes.find((s) => s.id === mutation.sceneId);
        if (!scene?.imagePrompt) return plan;

        const sceneIndex = plan.scenes.findIndex((s) => s.id === mutation.sceneId);
        const thumbUrl = await fetchThumbnailForPrompt(scene.imagePrompt, sceneIndex + 1);
        const scenes = plan.scenes.map((s) =>
          s.id === mutation.sceneId
            ? { ...s, previewImageUrl: thumbUrl || s.previewImageUrl }
            : s,
        );
        const assets = plan.assets.map((a) =>
          a.sceneId === mutation.sceneId
            ? {
                ...a,
                thumbnailUrl: thumbUrl || a.thumbnailUrl,
                status: thumbUrl ? ("found" as const) : ("failed" as const),
                source: thumbUrl ? "brave" : a.source,
              }
            : a,
        );
        return { ...plan, scenes, assets };
      })();
    }

    default:
      return Promise.resolve(plan);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlanMutationRequest;
    const parsed = VideoPlan.parse(body.plan);
    const updated = await applyMutation(parsed, body.mutation);
    return Response.json({ plan: updated });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
