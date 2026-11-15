import { createContext, useContext } from "react";

/**
 * Whether the phone layout is drawn for a landscape screen (the "Landscape layout" setting):
 * side navigation instead of bottom tabs, grids instead of full-width cards, and music's
 * player beside what is browsed.
 */
export const LandscapeLayoutContext = createContext(false);
export const useLandscapeLayout = (): boolean => useContext(LandscapeLayoutContext);

/** Width of the side navigation rail. */
export const landscapeRailWidth = 92;
/** Narrowest a video card gets in a landscape grid. */
export const landscapeCardMinWidth = 300;

/** Columns of video cards that fit a landscape list this wide. */
export function landscapeColumns(width: number, minWidth = landscapeCardMinWidth): number {
  return Math.max(1, Math.floor(width / minWidth));
}

/** Music's player pane beside the browse list: about two fifths of the space, within limits. */
export function landscapePlayerWidth(width: number): number {
  return Math.round(Math.min(480, Math.max(300, width * 0.4)));
}
