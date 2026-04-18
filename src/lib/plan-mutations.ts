import type { PlanSceneType, VideoPlanType } from "../../types/video-schema";

export type PlanAction =
  | { action: "update_scene"; sceneId: string; data: Partial<PlanSceneType> }
  | { action: "reorder_scenes"; sceneIds: string[] }
  | { action: "remove_scene"; sceneId: string }
  | { action: "add_scene"; data: Partial<PlanSceneType> }
  | {
      action: "update_globals";
      data: Partial<
        Pick<
          VideoPlanType,
          | "style"
          | "mode"
          | "title"
          | "colorPalette"
          | "fontFamily"
          | "aspectRatio"
          | "captionStyle"
          | "narration"
          | "music"
        >
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
        notes: mutation.data.notes,
        voiceoverText: mutation.data.voiceoverText,
        transitionIn: mutation.data.transitionIn ?? "fade",
        emphasis: mutation.data.emphasis,
        kenBurns: mutation.data.kenBurns ?? "zoom-in",
      };

      const scenes = [...plan.scenes, newScene];
      const nextAssets = [...plan.assets];
      if (newScene.imagePrompt) {
        nextAssets.push({
          id: `asset-${newId}`,
          type: "image" as const,
          prompt: newScene.imagePrompt,
          source: "pending",
          sceneId: newId,
          status: "pending" as const,
        });
      }
      if (newScene.voiceoverText) {
        nextAssets.push({
          id: `voice-${newId}`,
          type: "voiceover" as const,
          prompt: newScene.voiceoverText,
          source: "pending",
          sceneId: newId,
          status: "pending" as const,
        });
      }

      return recalcDuration({ ...plan, scenes, assets: nextAssets });
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
      if (mutation.data.fontFamily) {
        updatedPlan.fontFamily = mutation.data.fontFamily;
      }
      if (mutation.data.aspectRatio) {
        updatedPlan.aspectRatio = mutation.data.aspectRatio;
      }
      if (mutation.data.captionStyle) {
        updatedPlan.captionStyle = mutation.data.captionStyle;
      }
      if (mutation.data.narration) {
        updatedPlan.narration = {
          ...updatedPlan.narration,
          ...mutation.data.narration,
        };
      }
      if (mutation.data.music) {
        updatedPlan.music = {
          ...updatedPlan.music,
          ...mutation.data.music,
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
