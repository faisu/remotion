/**
 * Font loading — MUST happen at module level (not inside a component) so
 * Remotion can wait for fonts before the first frame renders. See:
 * https://www.remotion.dev/docs/google-fonts/load-font
 *
 * Each export returns { fontFamily } — pass that string directly to the
 * `fontFamily` CSS property; it already includes a fallback stack.
 */
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadInstrumentSerif } from "@remotion/google-fonts/InstrumentSerif";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadPlayfairDisplay } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadDMSans } from "@remotion/google-fonts/DMSans";
import type { FontFamilyKind } from "../../types/video-schema";

// Load only the weights we actually use in the composition. Each extra
// weight means more download bytes before the first frame can render.
const inter = loadInter("normal", {
  weights: ["400", "500", "700", "900"],
  subsets: ["latin"],
});
const instrumentSerif = loadInstrumentSerif("normal", {
  weights: ["400"],
  subsets: ["latin"],
});
const spaceGrotesk = loadSpaceGrotesk("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});
const playfairDisplay = loadPlayfairDisplay("normal", {
  weights: ["400", "700", "900"],
  subsets: ["latin"],
});
const dmSans = loadDMSans("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});

const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const FONT_STACKS: Record<FontFamilyKind, string> = {
  Inter: inter.fontFamily,
  "Instrument Serif": instrumentSerif.fontFamily,
  "Space Grotesk": spaceGrotesk.fontFamily,
  "Playfair Display": playfairDisplay.fontFamily,
  "DM Sans": dmSans.fontFamily,
  // Geist Mono isn't bundled with @remotion/google-fonts yet — fall back to
  // the system monospace stack so it still renders something pleasant.
  "Geist Mono": MONO_FALLBACK,
};

export function resolveFontFamily(name: FontFamilyKind | undefined): string {
  return FONT_STACKS[name ?? "Inter"] ?? FONT_STACKS.Inter;
}
