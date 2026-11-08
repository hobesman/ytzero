import { useCallback, useRef } from "react";
import type { ImageSourcePropType } from "react-native";
import type { YtZeroApi } from "../api";

/**
 * Stable authorized image sources for a list. Reusing one source object per
 * URL keeps memoized cards from re-rendering and images from reloading.
 */
export function useImageSource(api: YtZeroApi): (url: string | null | undefined) => ImageSourcePropType | null {
  const sources = useRef(new Map<string, ImageSourcePropType>());
  return useCallback((url: string | null | undefined) => {
    if (!url) return null;
    let cached = sources.current.get(url);
    if (!cached) { cached = api.thumbnailSource(url) as ImageSourcePropType; sources.current.set(url, cached); }
    return cached;
  }, [api]);
}
