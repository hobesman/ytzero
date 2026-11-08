import { Platform, useWindowDimensions } from "react-native";
import { isCompactWindow } from "./compactLayout";

export function useCompactLayout(): boolean {
  const { width, height } = useWindowDimensions();
  return isCompactWindow(width, height, Platform.isTV);
}
