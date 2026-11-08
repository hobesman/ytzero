import { NativeModule, requireOptionalNativeModule } from "expo";

export type PhoneOrientation = "landscape" | "portrait" | "sensor";

declare class PhoneOrientationModule extends NativeModule {
  setMode(mode: PhoneOrientation): Promise<void>;
}

// Loading the module holds phones and tablets in landscape (see its Kotlin source).
const native = requireOptionalNativeModule<PhoneOrientationModule>("YtZeroPhoneOrientation");

export function setPhoneOrientation(mode: PhoneOrientation): void {
  void native?.setMode(mode).catch(() => {});
}
