import { Composition } from "remotion";
import {
  COMP_NAME,
  defaultMyCompProps,
  DURATION_IN_FRAMES,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "../../types/constants";
import {
  DYNAMIC_COMP_NAME,
  DYNAMIC_VIDEO_FPS,
  DYNAMIC_VIDEO_HEIGHT,
  DYNAMIC_VIDEO_WIDTH,
  DynamicVideoProps,
} from "../../types/video-schema";
import { DynamicComp } from "./DynamicComp";
import { Main } from "./MyComp/Main";
import { NextLogo } from "./MyComp/NextLogo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id={COMP_NAME}
        component={Main}
        durationInFrames={DURATION_IN_FRAMES}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        defaultProps={defaultMyCompProps}
      />
      <Composition
        id="NextLogo"
        component={NextLogo}
        durationInFrames={300}
        fps={30}
        width={140}
        height={140}
        defaultProps={{
          outProgress: 0,
        }}
      />
      <Composition
        id={DYNAMIC_COMP_NAME}
        component={DynamicComp}
        durationInFrames={180}
        fps={DYNAMIC_VIDEO_FPS}
        width={DYNAMIC_VIDEO_WIDTH}
        height={DYNAMIC_VIDEO_HEIGHT}
        defaultProps={DynamicVideoProps.parse({})}
        calculateMetadata={async ({ props }) => {
          const durationInSeconds = props.durationInSeconds ?? 6;
          return {
            durationInFrames: Math.round(durationInSeconds * DYNAMIC_VIDEO_FPS),
          };
        }}
      />
    </>
  );
};
