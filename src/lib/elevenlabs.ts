import { put } from "@vercel/blob";
import {
  elevenLabsTranscriptToCaptions,
  type ElevenLabsTranscript,
  type ElevenLabsTranscriptWord,
} from "@remotion/elevenlabs";
import type { Caption } from "@remotion/captions";
import type { CaptionWordType } from "../../types/video-schema";

const ELEVEN_API_BASE = "https://api.elevenlabs.io";
const TTS_TIMEOUT_MS = 45_000;

// Rachel — a pleasant, neutral default voice. User can override per-plan.
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export type VoiceoverResult = {
  audioUrl: string;
  durationMs: number;
  captions: CaptionWordType[]; // word-level, ready for rendering
  rawCaptions: Caption[]; // the @remotion/captions shape (for TikTok-style pages)
};

export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

type ElevenLabsCharacterAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

type ElevenLabsTtsResponse = {
  audio_base64: string;
  alignment: ElevenLabsCharacterAlignment | null;
  normalized_alignment: ElevenLabsCharacterAlignment | null;
};

/**
 * Collapse ElevenLabs' character-level alignment into word-level timings.
 * ElevenLabs' `/v1/text-to-speech/{voice}/with-timestamps` endpoint returns
 * per-character start/end times; we convert that into ElevenLabsTranscriptWord
 * shapes so we can feed them through @remotion/elevenlabs' official helper.
 */
function alignmentToWords(
  alignment: ElevenLabsCharacterAlignment
): ElevenLabsTranscriptWord[] {
  const words: ElevenLabsTranscriptWord[] = [];
  let buffer = "";
  let wordStart: number | null = null;
  let wordEnd = 0;

  const flush = (type: ElevenLabsTranscriptWord["type"], text: string) => {
    if (!text) return;
    if (wordStart === null) return;
    words.push({
      text,
      start: wordStart,
      end: wordEnd,
      type,
      logprob: 0,
    });
    buffer = "";
    wordStart = null;
  };

  for (let i = 0; i < alignment.characters.length; i += 1) {
    const ch = alignment.characters[i];
    const start = alignment.character_start_times_seconds[i] ?? 0;
    const end = alignment.character_end_times_seconds[i] ?? start;
    const isWordChar = /[\p{L}\p{N}'’-]/u.test(ch);

    if (isWordChar) {
      if (wordStart === null) wordStart = start;
      wordEnd = end;
      buffer += ch;
    } else {
      flush("word", buffer);
      // emit a short spacing entry so downstream consumers can honour pauses
      if (/\s/.test(ch)) {
        words.push({
          text: ch,
          start,
          end,
          type: "spacing",
          logprob: 0,
        });
      } else if (ch) {
        // punctuation — attach to next flush by merging with prior word text
        if (words.length > 0 && words[words.length - 1].type === "word") {
          words[words.length - 1].text += ch;
          words[words.length - 1].end = end;
        }
      }
    }
  }

  flush("word", buffer);
  return words;
}

/**
 * Convert ElevenLabs char-level alignment → our portable per-word captions
 * (start/end in ms). Uses @remotion/elevenlabs' helper for compatibility
 * with @remotion/captions' TikTok-style renderer.
 */
function captionsFromAlignment(
  alignment: ElevenLabsCharacterAlignment,
  text: string
): { rawCaptions: Caption[]; words: CaptionWordType[] } {
  const transcript: ElevenLabsTranscript = {
    language_code: "en",
    language_probability: 1,
    text,
    words: alignmentToWords(alignment),
    transcription_id: "inline",
  };
  const { captions } = elevenLabsTranscriptToCaptions({ transcript });
  const words: CaptionWordType[] = captions.map((c) => ({
    text: c.text,
    startMs: c.startMs,
    endMs: c.endMs,
  }));
  return { rawCaptions: captions, words };
}

function base64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

/**
 * Call ElevenLabs TTS with per-character timestamps. Uses the /with-timestamps
 * endpoint so we get both audio and exact timings in a single round-trip.
 */
export async function generateVoiceoverWithTimestamps({
  text,
  voiceId,
  modelId = "eleven_multilingual_v2",
}: {
  text: string;
  voiceId?: string;
  modelId?: string;
}): Promise<VoiceoverResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is not configured. Add it to .env.local and restart."
    );
  }

  const resolvedVoice = voiceId?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;
  const url = `${ELEVEN_API_BASE}/v1/text-to-speech/${resolvedVoice}/with-timestamps`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.75,
        style: 0.2,
        use_speaker_boost: true,
      },
      output_format: "mp3_44100_128",
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs TTS failed (${response.status}): ${errText.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as ElevenLabsTtsResponse;
  const alignment = data.normalized_alignment ?? data.alignment;
  if (!data.audio_base64) {
    throw new Error("ElevenLabs returned no audio payload");
  }

  const audioBuffer = base64ToBuffer(data.audio_base64);

  // Upload to Vercel Blob so the Remotion renderer (running in a
  // bundler sandbox) can fetch it over HTTPS.
  const blob = await put(
    `voiceovers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`,
    audioBuffer,
    {
      access: "public",
      contentType: "audio/mpeg",
    }
  );

  let rawCaptions: Caption[] = [];
  let words: CaptionWordType[] = [];
  if (alignment) {
    const result = captionsFromAlignment(alignment, text);
    rawCaptions = result.rawCaptions;
    words = result.words;
  }

  const durationMs = alignment
    ? Math.round(
        (alignment.character_end_times_seconds[
          alignment.character_end_times_seconds.length - 1
        ] ?? 0) * 1000
      )
    : // Rough fallback: 150 WPM ~ 400ms/word, ~5 chars/word => ~80ms/char
      Math.max(1000, Math.round(text.length * 70));

  return {
    audioUrl: blob.url,
    durationMs,
    captions: words,
    rawCaptions,
  };
}
