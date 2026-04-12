import type { PlanSceneType, VideoPlanType } from "../../types/video-schema";

export type PlanAction =
  | { action: "update_scene"; sceneId: string; data: Partial<PlanSceneType> }
  | { action: "reorder_scenes"; sceneIds: string[] }
  | { action: "remove_scene"; sceneId: string }
  | { action: "add_scene"; data: Partial<PlanSceneType> }
  | {
      action: "update_globals";
      data: Partial<
        Pick<VideoPlanType, "style" | "mode" | "title" | "colorPalette">
      >;
    }
  | { action: "refresh_asset"; sceneId: string };

type ApplyPlanMutationOptions = {
  fetchThumbnailForPrompt?: (prompt: string, seed?: number) => Promise<string | null>;
};

function recalcDuration(plan: VideoPlanType): VideoPlanType {
  const estimatedDuration = plan.scenes.reduce(
    (sum, scene) => sum + scene.durationInSeconds,
    0,
  );
  return { ...plan, estimatedDuration };
}

export async function applyPlanMutation(
  plan: VideoPlanType,
  mutation: PlanAction,
  options: ApplyPlanMutationOptions = {},
): Promise<VideoPlanType> {
  switch (mutation.action) {
    case "update_scene": {
      const scenes = plan.scenes.map((scene) =>
        scene.id === mutation.sceneId
          ? { ...scene, ...mutation.data, id: scene.id }
          : scene,
      );
      return recalcDuration({ ...plan, scenes });
    }

    case "reorder_scenes": {
      const sceneById = new Map(plan.scenes.map((scene) => [scene.id, scene]));
      const reordered = mutation.sceneIds
        .map((sceneId) => sceneById.get(sceneId))
        .filter((scene): scene is PlanSceneType => Boolean(scene));
      return recalcDuration({ ...plan, scenes: reordered });
    }

    case "remove_scene": {
      const scenes = plan.scenes.filter((scene) => scene.id !== mutation.sceneId);
      const assets = plan.assets.filter((asset) => asset.sceneId !== mutation.sceneId);
      return recalcDuration({ ...plan, scenes, assets });
    }

    case "add_scene": {
      const newId = `scene-${Date.now()}`;
      const defaultDuration =
        plan.mode === "detailed" ? 4 : plan.mode === "narrated" ? 6 : 3;

      const newScene: PlanSceneType = {
        id: newId,
        title: mutation.data.title || `Scene ${plan.scenes.length + 1}`,
        body: mutation.data.body || "",
        bullets: mutation.data.bullets || [],
        layout: mutation.data.layout || "text",
        imagePrompt: mutation.data.imagePrompt || "",
        durationInSeconds: mutation.data.durationInSeconds || defaultDuration,
      };

      const scenes = [...plan.scenes, newScene];
      const assets = newScene.imagePrompt
        ? [
            ...plan.assets,
            {
              id: `asset-${newId}`,
              type: "image" as const,
              prompt: newScene.imagePrompt,
              source: "pending",
              sceneId: newId,
              status: "pending" as const,
            },
          ]
        : plan.assets;

      return recalcDuration({ ...plan, scenes, assets });
    }

    case "update_globals": {
      const updatedPlan = { ...plan };
      if (mutation.data.style) updatedPlan.style = mutation.data.style;
      if (mutation.data.mode) updatedPlan.mode = mutation.data.mode;
      if (mutation.data.title) updatedPlan.title = mutation.data.title;
      if (mutation.data.colorPalette) {
        updatedPlan.colorPalette = {
          ...updatedPlan.colorPalette,
          ...mutation.data.colorPalette,
        };
      }
      return recalcDuration(updatedPlan);
    }

    case "refresh_asset": {
      const scene = plan.scenes.find((s) => s.id === mutation.sceneId);
      if (!scene?.imagePrompt || !options.fetchThumbnailForPrompt) {
        return plan;
      }

      const sceneIndex = plan.scenes.findIndex((s) => s.id === mutation.sceneId);
      const thumbUrl = await options.fetchThumbnailForPrompt(
        scene.imagePrompt,
        sceneIndex + 1,
      );
      const scenes = plan.scenes.map((s) =>
        s.id === mutation.sceneId
          ? { ...s, previewImageUrl: thumbUrl || s.previewImageUrl }
          : s,
      );
      const assets = plan.assets.map((asset) =>
        asset.sceneId === mutation.sceneId
          ? {
              ...asset,
              thumbnailUrl: thumbUrl || asset.thumbnailUrl,
              status: thumbUrl ? ("found" as const) : ("failed" as const),
              source: thumbUrl ? "brave" : asset.source,
            }
          : asset,
      );
      return { ...plan, scenes, assets };
    }

    default:
      return plan;
  }
}
