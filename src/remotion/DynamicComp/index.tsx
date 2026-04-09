import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { z } from "zod";
import { DynamicVideoProps } from "../../../types/video-schema";

type Props = z.infer<typeof DynamicVideoProps>;

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return { r: isNaN(r) ? 15 : r, g: isNaN(g) ? 23 : g, b: isNaN(b) ? 42 : b };
};

const AnimatedItem: React.FC<{
  text: string;
  delay: number;
  accentColor: string;
  textColor: string;
}> = ({ text, delay, accentColor, textColor }) => {
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
        gap: 12,
        opacity,
        transform: `translateX(${translateX}px)`,
        marginBottom: 12,
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
          fontSize: 24,
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

export const DynamicComp: React.FC<Props> = ({
  title,
  subtitle,
  backgroundColor,
  accentColor,
  textColor,
  items,
  style,
  durationInSeconds,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Fade out near end
  const fadeOutStart = durationInFrames - fps * 0.6;
  const globalOpacity = interpolate(
    frame,
    [0, 10, fadeOutStart, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Background gradient animation
  const bgProgress = interpolate(frame, [0, fps * 1.5], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });

  // Title animation
  const titleProgress = spring({
    fps,
    frame,
    config: { damping: 80, stiffness: 120 },
    delay: 8,
    durationInFrames: 30,
  });

  const titleY = interpolate(titleProgress, [0, 1], [50, 0]);
  const titleOpacity = interpolate(titleProgress, [0, 1], [0, 1]);

  // Subtitle animation
  const subtitleProgress = spring({
    fps,
    frame,
    config: { damping: 80, stiffness: 100 },
    delay: 20,
    durationInFrames: 25,
  });

  const subtitleOpacity = interpolate(subtitleProgress, [0, 1], [0, 1]);
  const subtitleY = interpolate(subtitleProgress, [0, 1], [20, 0]);

  // Accent line animation
  const lineProgress = spring({
    fps,
    frame,
    config: { damping: 100, stiffness: 150 },
    delay: 15,
    durationInFrames: 20,
  });
  const lineWidth = interpolate(lineProgress, [0, 1], [0, 80]);

  // Parse colors
  const accentRgb = hexToRgb(accentColor);
  const bgRgb = hexToRgb(backgroundColor);

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
    return { backgroundColor };
  })();

  const titleSize = style === "bold" ? 90 : style === "cinematic" ? 80 : 72;
  const itemStartDelay = 35;

  return (
    <AbsoluteFill style={{ ...backgroundStyle, overflow: "hidden" }}>
      {/* Decorative background elements */}
      {style === "cinematic" && (
        <>
          <div
            style={{
              position: "absolute",
              width: 600,
              height: 600,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${0.08 * bgProgress}) 0%, transparent 70%)`,
              top: -200,
              right: -100,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 400,
              height: 400,
              borderRadius: "50%",
              background: `radial-gradient(circle, rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${0.05 * bgProgress}) 0%, transparent 70%)`,
              bottom: -100,
              left: -50,
            }}
          />
        </>
      )}

      {/* Top accent bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          background: `linear-gradient(90deg, ${accentColor}, transparent)`,
          opacity: bgProgress,
        }}
      />

      {/* Main content */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          padding: "0 100px",
          opacity: globalOpacity,
        }}
      >
        {/* Title */}
        <div
          style={{
            transform: `translateY(${titleY}px)`,
            opacity: titleOpacity,
            marginBottom: subtitle ? 16 : 24,
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
            {title}
          </h1>

          {/* Accent underline */}
          <div
            style={{
              marginTop: 12,
              height: 4,
              width: lineWidth,
              backgroundColor: accentColor,
              borderRadius: 2,
            }}
          />
        </div>

        {/* Subtitle */}
        {subtitle && (
          <div
            style={{
              transform: `translateY(${subtitleY}px)`,
              opacity: subtitleOpacity,
              marginBottom: items.length > 0 ? 40 : 0,
            }}
          >
            <p
              style={{
                fontSize: 28,
                color: textColor,
                opacity: 0.7,
                margin: 0,
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontWeight: 400,
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </p>
          </div>
        )}

        {/* Items list */}
        {items.length > 0 && (
          <div style={{ marginTop: subtitle ? 0 : 8 }}>
            {items.slice(0, 6).map((item, i) => (
              <AnimatedItem
                key={i}
                text={item}
                delay={itemStartDelay + i * 12}
                accentColor={accentColor}
                textColor={textColor}
              />
            ))}
          </div>
        )}
      </AbsoluteFill>

      {/* Bottom decoration */}
      <div
        style={{
          position: "absolute",
          bottom: 32,
          right: 60,
          opacity: subtitleOpacity * 0.4,
          display: "flex",
          gap: 6,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: accentColor,
              opacity: 1 - i * 0.25,
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
