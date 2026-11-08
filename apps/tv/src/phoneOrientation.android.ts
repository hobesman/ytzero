import { requireOptionalNativeModule } from "expo";

// Loading the module holds phones and tablets in landscape (see its Kotlin source).
requireOptionalNativeModule("YtZeroPhoneOrientation");
