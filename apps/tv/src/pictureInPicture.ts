/** Picture in picture over other apps is Android phones only; tvOS keeps its own AVKit behaviour. */
export const leavesIntoPictureInPicture = false;

export function onPictureInPictureDismiss(_listener: () => void): () => void {
  return () => {};
}
