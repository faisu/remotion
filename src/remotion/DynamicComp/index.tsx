import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  TransitionSeries,
  linearTiming,
  springTiming,
  type TransitionPresentation,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { iris } from "@remotion/transitions/iris";
import { none } from "@remotion/transitions/none";
import {
  createTikTokStyleCaptions,
  type Caption,
  type TikTokPage,
} from "@remotion/captions";
import { z } from "zod";
import {
  DynamicVideoProps,
  type DynamicVideoPropsType,
} from "../../../types/video-schema";
import { resolveFontFamily } from "../fonts";

type Props = z.infer<typeof DynamicVideoProps>;

type SceneType = DynamicVideoPropsType["scenes"][number];

const hexToRgb = (hex: string): { r: number; g: number; b: number; valid: boolean } => {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) {
    return { r: 15, g: 23, b: 42, valid: false };
  }
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const valid = !isNaN(r) && !isNaN(g) && !isNaN(b);
  return { r: valid ? r : 15, g: valid ? g : 23, b: valid ? b : 42, valid };
};

// ---------------------------------------------------------------------------
// Ken Burns — cheap but effective "camera move" on still images.
// ---------------------------------------------------------------------------

type KenBurnsKind = NonNullable<SceneType["kenBurns"]>;

function useKenBurnsStyle(
  kind: KenBurnsKind,
  durationInFrames: number
): React.CSSProperties {
  const frame = useCurrentFrame();
  const t = Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames)));

  if (kind === "none") {
    return { transform: "none" };
  }

  // All moves are intentionally subtle — roughly 6-10% scale + small pan.
  switch (kind) {
    case "zoom-in": {
      const scale = 1 + t * 0.08;
      return { transform: `scale(${scale})` };
    }
    case "zoom-out": {
      const scale = 1.1 - t * 0.08;
      return { transform: `scale(${scale})` };
    }
    case "pan-left": {
      const x = interpolate(t, [0, 1], [4, -4]);
      return { transform: `scale(1.08) translateX(${x}%)` };
    }
    case "pan-right": {
      const x = interpolate(t, [0, 1], [-4, 4]);
      return { transform: `scale(1.08) translateX(${x}%)` };
    }
    default:
      return { transform: "scale(1.04)" };
  }
}

// ---------------------------------------------------------------------------
// TikTok-style captions — synced to the scene's voiceover.
// Scene-local time (0 = scene start) is computed from useCurrentFrame()
// because each scene is rendered inside its own <Sequence>.
// ---------------------------------------------------------------------------

const TikTokCaptionsLayer: React.FC<{
  captions: Array<{ text: string; startMs: number; endMs: number }>;
  accentColor: string;
  textColor: string;
  fontFamily: string;
}> = ({ captions, accentColor, textColor, fontFamily }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1000;

  const remotionCaptions: Caption[] = captions.map((c) => ({
    text: c.text,
    startMs: c.startMs,
    endMs: c.endMs,
    timestampMs: null,
    confidence: null,
  }));

  const { pages } = createTikTokStyleCaptions({
    captions: remotionCaptions,
    combineTokensWithinMilliseconds: 1200,
  });

  const activePage: TikTokPage | undefined = pages.find(
    (p) => currentMs >= p.startMs && currentMs <= p.startMs + p.durationMs
  );

  if (!activePage) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "12%",
        display: "flex",
        justifyContent: "center",
        padding: "0 8%",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0 14px",
          fontFamily,
          fontWeight: 800,
          fontSize: 52,
          letterSpacing: "-0.01em",
          lineHeight: 1.15,
          color: textColor,
          textShadow:
            "0 4px 18px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.8)",
          textAlign: "center",
        }}
      >
        {activePage.tokens.map((tok, i) => {
          const isActive = currentMs >= tok.fromMs && currentMs <= tok.toMs;
          return (
            <span
              key={`${tok.text}-${i}-${tok.fromMs}`}
              style={{
                color: isActive ? accentColor : textColor,
                transform: isActive ? "translateY(-2px) scale(1.04)" : "none",
                transition: "transform 80ms ease-out",
              }}
            >
              {tok.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Scene card
// ---------------------------------------------------------------------------

const SceneCard: React.FC<{
  scene: SceneType;
  style: DynamicVideoPropsType["style"];
  mode: DynamicVideoPropsType["mode"];
  accentColor: string;
  textColor: string;
  subtitle?: string;
  fontFamily: string;
  captionStyle: DynamicVideoPropsType["captionStyle"];
}> = ({
  scene,
  style,
  mode,
  accentColor,
  textColor,
  subtitle,
  fontFamily,
  captionStyle,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  // No opacity fade-in/out here — <TransitionSeries> handles scene-to-scene
  // blending. We only animate the interior elements now.

  const bgProgress = interpolate(frame, [0, fps], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });

  const titleProgress = spring({
    fps,
    frame,
    config: { damping: 80, stiffness: 120 },
    delay: 4,
    durationInFrames: 30,
  });

  const titleY = interpolate(titleProgress, [0, 1], [40, 0]);
  const titleOpacity = interpolate(titleProgress, [0, 1], [0, 1]);

  const bodyProgress = spring({
    fps,
    frame,
    config: { damping: 80, stiffness: 100 },
    delay: 12,
    durationInFrames: 25,
  });
  const bodyOpacity = interpolate(bodyProgress, [0, 1], [0, 1]);
  const bodyY = interpolate(bodyProgress, [0, 1], [16, 0]);
  const titleSize = mode === "short" ? 64 : mode === "detailed" ? 52 : 48;
  const compact = mode !== "narrated";
  const usesImage = Boolean(scene.imageUrl);
  const imageOnLeft = scene.layout === "image-left";
  const imageAsBackground = scene.layout === "image-background";
  const kenBurnsStyle = useKenBurnsStyle(scene.kenBurns ?? "zoom-in", durationInFrames);
  const showCaptions =
    captionStyle === "tiktok" &&
    scene.captions &&
    scene.captions.length > 0;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {usesImage && imageAsBackground && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              ...kenBurnsStyle,
              willChange: "transform",
            }}
          >
            <Img
              src={scene.imageUrl ?? ""}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.35 + bgProgress * 0.15,
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                style === "cinematic"
                  ? "linear-gradient(160deg, rgba(0,0,0,0.7), rgba(0,0,0,0.42))"
                  : "linear-gradient(160deg, rgba(0,0,0,0.58), rgba(0,0,0,0.36))",
            }}
          />
        </>
      )}

      <AbsoluteFill
        style={{
          justifyContent: "center",
          padding: "0 86px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection:
              usesImage && !imageAsBackground
                ? imageOnLeft
                  ? "row-reverse"
                  : "row"
                : "column",
            alignItems: "center",
            gap: 28,
          }}
        >
          {usesImage && !imageAsBackground && (
            <div
              style={{
                flex: 1,
                height: 420,
                borderRadius: 24,
                overflow: "hidden",
                border: `1px solid ${accentColor}33`,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  ...kenBurnsStyle,
                  willChange: "transform",
                }}
              >
                <Img
                  src={scene.imageUrl ?? ""}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </div>
            </div>
          )}

          <div
            style={{
              flex: usesImage && !imageAsBackground ? 1 : undefined,
              transform: `translateY(${titleY}px)`,
              opacity: titleOpacity,
            }}
          >
            <h1
              style={{
                fontSize: titleSize,
                fontWeight: style === "bold" ? 900 : 700,
                color: textColor,
                margin: 0,
                lineHeight: 1.1,
                fontFamily,
                letterSpacing: style === "cinematic" ? "0.02em" : "normal",
              }}
            >
              {scene.title}
            </h1>

            {(subtitle || scene.body) && (
              <p
                style={{
                  margin: "16px 0 0",
                  color: textColor,
                  opacity: 0.84,
                  lineHeight: mode === "narrated" ? 1.42 : 1.32,
                  fontSize: mode === "narrated" ? 30 : 26,
                  transform: `translateY(${bodyY}px)`,
                  fontFamily,
                }}
              >
                {scene.body || subtitle}
              </p>
            )}

            {scene.bullets.length > 0 && (
              <div style={{ marginTop: 24, opacity: bodyOpacity }}>
                {scene.bullets.map((item, i) => (
                  <AnimatedBullet
                    key={i}
                    text={item}
                    delay={18 + i * 8}
                    accentColor={accentColor}
                    textColor={textColor}
                    compact={compact}
                    fontFamily={fontFamily}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </AbsoluteFill>

      {/* Per-scene voiceover */}
      {scene.voiceoverUrl ? (
        <Audio src={scene.voiceoverUrl} />
      ) : null}

      {/* TikTok-style word-synced captions, rendered on top of everything */}
      {showCaptions && scene.captions ? (
        <TikTokCaptionsLayer
          captions={scene.captions}
          accentColor={accentColor}
          textColor={textColor}
          fontFamily={fontFamily}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const AnimatedBullet: React.FC<{
  text: string;
  delay: number;
  accentColor: string;
  textColor: string;
  compact: boolean;
  fontFamily: string;
}> = ({ text, delay, accentColor, textColor, compact, fontFamily }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    fps,
    frame,
    config: { damping: 60, stiffness: 200 },
    delay,
    durationInFrames: 20,
  });

  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const translateX = interpolate(progress, [0, 1], [-30, 0]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 10 : 12,
        opacity,
        transform: `translateX(${translateX}px)`,
        marginBottom: compact ? 8 : 12,
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: accentColor,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: compact ? 20 : 24,
          color: textColor,
          opacity: 0.85,
          fontFamily,
          fontWeight: 400,
        }}
      >
        {text}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Transition plumbing
// ---------------------------------------------------------------------------

function presentationFor(
  transition: NonNullable<SceneType["transitionIn"]>,
  width: number,
  height: number
): TransitionPresentation<Record<string, unknown>> {
  switch (transition) {
    case "none":
      return none() as TransitionPresentation<Record<string, unknown>>;
    case "fade":
      return fade() as TransitionPresentation<Record<string, unknown>>;
    case "slide-left":
      return slide({ direction: "from-right" }) as TransitionPresentation<
        Record<string, unknown>
      >;
    case "slide-right":
      return slide({ direction: "from-left" }) as TransitionPresentation<
        Record<string, unknown>
      >;
    case "slide-up":
      return slide({ direction: "from-bottom" }) as TransitionPresentation<
        Record<string, unknown>
      >;
    case "slide-down":
      return slide({ direction: "from-top" }) as TransitionPresentation<
        Record<string, unknown>
      >;
    case "wipe-left":
      return wipe({ direction: "from-right" }) as TransitionPresentation<
        Record<string, unknown>
      >;
    case "wipe-right":
      return wipe({ direction: "from-left" }) as TransitionPresentation<
        Record<string, unknown>
      >;
    case "iris":
      return iris({ width, height }) as unknown as TransitionPresentation<
        Record<string, unknown>
      >;
    default:
      return fade() as TransitionPresentation<Record<string, unknown>>;
  }
}

const TRANSITION_FRAMES = 14;

// ---------------------------------------------------------------------------
// Root composition
// ---------------------------------------------------------------------------

export const DynamicComp: React.FC<Props> = ({
  title,
  subtitle,
  mode,
  scenes,
  backgroundColor,
  accentColor,
  textColor,
  style,
  fontFamily,
  captionStyle,
  music,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const bgRgb = hexToRgb(backgroundColor);
  const accentRgb = hexToRgb(accentColor);
  const introOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const resolvedFont = resolveFontFamily(fontFamily);

  const backgroundStyle = (() => {
    if (style === "bold") {
      const darken = (c: number) => Math.max(0, c - 40);
      return {
        background: `linear-gradient(135deg, rgb(${bgRgb.r},${bgRgb.g},${bgRgb.b}) 0%, rgb(${darken(bgRgb.r)},${darken(bgRgb.g)},${Math.min(255, bgRgb.b + 30)}) 100%)`,
      };
    }
    if (style === "cinematic") {
      return {
        background: `radial-gradient(ellipse at 50% 50%, rgb(${Math.min(255, bgRgb.r + 20)},${Math.min(255, bgRgb.g + 20)},${Math.min(255, bgRgb.b + 20)}) 0%, rgb(${bgRgb.r},${bgRgb.g},${bgRgb.b}) 70%)`,
      };
    }
    if (!bgRgb.valid) {
      return { backgroundColor: "#0f172a" };
    }
    return { backgroundColor };
  })();

  return (
    <AbsoluteFill style={{ ...backgroundStyle, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          background: `linear-gradient(90deg, ${accentColor}, transparent)`,
          opacity: introOpacity,
        }}
      />

      {style === "cinematic" && (
        <>
          <div
            style={{
              position: "absolute",
              width: 600,
              height: 600,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0.09) 0%, transparent 70%)`,
              top: -200,
              right: -100,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 360,
              height: 360,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0.06) 0%, transparent 70%)`,
              bottom: -80,
              left: -40,
            }}
          />
        </>
      )}

      {/* Global music bed (quiet, behind narration). */}
      {music?.url ? (
        <Audio src={music.url} volume={music.volume ?? 0.15} loop />
      ) : null}

      {/* Scenes with real transitions instead of hard cuts. */}
      <TransitionSeries>
        {scenes.flatMap((scene, index) => {
          const duration = Math.max(
            1,
            Math.round((scene.durationInSeconds ?? 3) * fps)
          );
          const transitionKind = scene.transitionIn ?? "fade";
          const renderTransition = index > 0 && transitionKind !== "none";
          const sceneKey = `${index}-${scene.title}`;

          const children: React.ReactNode[] = [];

          if (renderTransition) {
            children.push(
              <TransitionSeries.Transition
                key={`transition-${sceneKey}`}
                presentation={presentationFor(transitionKind, width, height)}
                timing={
                  transitionKind === "fade"
                    ? linearTiming({ durationInFrames: TRANSITION_FRAMES })
                    : springTiming({
                        durationInFrames: TRANSITION_FRAMES,
                        config: { damping: 200 },
                      })
                }
              />
            );
          }

          children.push(
            <TransitionSeries.Sequence
              key={`scene-${sceneKey}`}
              durationInFrames={duration}
            >
              <SceneCard
                scene={scene}
                style={style}
                mode={mode}
                accentColor={accentColor}
                textColor={textColor}
                subtitle={index === 0 ? subtitle : undefined}
                fontFamily={resolvedFont}
                captionStyle={captionStyle}
              />
            </TransitionSeries.Sequence>
          );

          return children;
        })}
      </TransitionSeries>

      <div
        style={{
          position: "absolute",
          bottom: 26,
          left: 36,
          color: textColor,
          opacity: 0.45,
          fontSize: 18,
          fontFamily: resolvedFont,
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

// Keep a legacy export name available so anything importing Sequence from
// this module doesn't break. Harmless no-op re-export.
export { Sequence };
