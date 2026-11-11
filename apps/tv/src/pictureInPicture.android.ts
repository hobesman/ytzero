import { NativeModule, requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

declare class PictureInPictureModule extends NativeModule<{ onDismiss: () => void }> {}

const native = requireOptionalNativeModule<PictureInPictureModule>("YtZeroPictureInPicture");

/**
 * Phones move a playing video into a floating window over other apps when the viewer
 * leaves the app (Android 12 and later). Televisions keep playing in the background.
 */
export const leavesIntoPictureInPicture = !Platform.isTV;

/** Calls `listener` when the viewer closes the picture-in-picture window (see the module's Kotlin source). */
export function onPictureInPictureDismiss(listener: () => void): () => void {
  const subscription = native?.addListener("onDismiss", listener);
  return () => subscription?.remove();
}
