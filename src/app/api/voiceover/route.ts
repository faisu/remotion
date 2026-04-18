import { generateVoiceoverWithTimestamps } from "../../../lib/elevenlabs";

/**
 * POST /api/voiceover
 * Body: { text: string; voiceId?: string }
 * Returns: { audioUrl: string; durationMs: number; captions: Array<{text,startMs,endMs}> }
 *
 * Generates a single scene's narration via ElevenLabs with per-word
 * timings and uploads the MP3 to Vercel Blob so the renderer can fetch it.
 *
 * This endpoint is used both:
 *  1. by the plan enrichment pipeline (server → server) when the user
 *     approves a plan with voiceoverText, and
 *  2. optionally by the UI to preview narration before rendering.
 */
export async function POST(req: Request) {
  let body: { text?: string; voiceId?: string };
  try {
    body = (await req.json()) as { text?: string; voiceId?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > 1500) {
    return Response.json(
      { error: "text exceeds 1500-char per-scene limit" },
      { status: 400 }
    );
  }

  try {
    const result = await generateVoiceoverWithTimestamps({
      text,
      voiceId: body.voiceId,
    });
    return Response.json({
      audioUrl: result.audioUrl,
      durationMs: result.durationMs,
      captions: result.captions,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "voiceover failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
