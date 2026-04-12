import {
  VideoPlan,
  type VideoPlanType,
} from "../../../../../types/video-schema";
import {
  isBraveSearchConfigured,
  braveImageSearch,
} from "../../../../lib/brave-search";
import {
  applyPlanMutation,
  type PlanAction,
} from "../../../../lib/plan-mutations";

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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlanMutationRequest;
    const parsed = VideoPlan.parse(body.plan);
    const updated = await applyPlanMutation(parsed, body.mutation, {
      fetchThumbnailForPrompt,
    });
    return Response.json({ plan: updated });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
