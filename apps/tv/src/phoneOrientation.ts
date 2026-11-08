export type PhoneOrientation = "landscape" | "portrait" | "sensor";

/** Phones are held in an orientation by a native module on Android only. */
export function setPhoneOrientation(_mode: PhoneOrientation): void {}
