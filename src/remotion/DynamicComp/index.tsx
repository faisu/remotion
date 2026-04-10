import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";
import {
  DynamicVideoProps,
  type DynamicVideoPropsType,
} from "../../../types/video-schema";

type Props = z.infer<typeof DynamicVideoProps>;

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

const AnimatedBullet: React.FC<{
  text: string;
  delay: number;
  accentColor: string;
  textColor: string;
  compact: boolean;
}> = ({ text, delay, accentColor, textColor, compact }) => {
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
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontWeight: 400,
        }}
      >
        {text}
      </span>
    </div>
  );
};

const SceneCard: React.FC<{
  scene: DynamicVideoPropsType["scenes"][number];
  style: DynamicVideoPropsType["style"];
  mode: DynamicVideoPropsType["mode"];
  accentColor: string;
  textColor: string;
  subtitle?: string;
}> = ({ scene, style, mode, accentColor, textColor, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const introFrames = Math.max(10, Math.round(fps * 0.35));
  const outroStart = Math.max(introFrames + 1, durationInFrames - Math.round(fps * 0.45));
  const sceneOpacity = interpolate(
    frame,
    [0, introFrames, outroStart, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const bgProgress = interpolate(frame, [0, fps], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });

  const titleProgress = spring({
    fps,
    frame,
    config: { damping: 80, stiffness: 120 },
    delay: 8,
    durationInFrames: 30,
  });

  const titleY = interpolate(titleProgress, [0, 1], [40, 0]);
  const titleOpacity = interpolate(titleProgress, [0, 1], [0, 1]);

  const bodyProgress = spring({
    fps,
    frame,
    config: { damping: 80, stiffness: 100 },
    delay: 18,
    durationInFrames: 25,
  });
  const bodyOpacity = interpolate(bodyProgress, [0, 1], [0, 1]);
  const bodyY = interpolate(bodyProgress, [0, 1], [16, 0]);
  const titleSize = mode === "short" ? 64 : mode === "detailed" ? 52 : 48;
  const compact = mode !== "narrated";
  const usesImage = Boolean(scene.imageUrl);
  const imageOnLeft = scene.layout === "image-left";
  const imageAsBackground = scene.layout === "image-background";

  return (
    <AbsoluteFill
      style={{
        opacity: sceneOpacity,
        overflow: "hidden",
      }}
    >
      {usesImage && imageAsBackground && (
        <>
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
                fontFamily: "system-ui, -apple-system, sans-serif",
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
                  fontFamily: "system-ui, -apple-system, sans-serif",
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
                    delay={28 + i * 8}
                    accentColor={accentColor}
                    textColor={textColor}
                    compact={compact}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const DynamicComp: React.FC<Props> = ({
  title,
  subtitle,
  mode,
  scenes,
  backgroundColor,
  accentColor,
  textColor,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bgRgb = hexToRgb(backgroundColor);
  const accentRgb = hexToRgb(accentColor);
  const introOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

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

  let currentFrom = 0;
  const sceneTimings = scenes.map((scene) => {
    const duration = Math.max(1, Math.round((scene.durationInSeconds ?? 3) * fps));
    const from = currentFrom;
    currentFrom += duration;
    return { from, duration, scene };
  });

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

      {sceneTimings.map(({ from, duration, scene }, index) => (
        <Sequence key={`${index}-${scene.title}`} from={from} durationInFrames={duration}>
          <SceneCard
            scene={scene}
            style={style}
            mode={mode}
            accentColor={accentColor}
            textColor={textColor}
            subtitle={index === 0 ? subtitle : undefined}
          />
        </Sequence>
      ))}

      <div
        style={{
          position: "absolute",
          bottom: 26,
          left: 36,
          color: textColor,
          opacity: 0.45,
          fontSize: 18,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};
