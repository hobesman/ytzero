export type PhoneOrientation = "landscape" | "portrait" | "sensor";

/** Phones are held in an orientation by a native module on Android only. */
export function setPhoneOrientation(_mode: PhoneOrientation): void {}

/** Hiding the system bars for a fullscreen video is Android-only. */
export function setPhoneImmersive(_on: boolean): void {}
