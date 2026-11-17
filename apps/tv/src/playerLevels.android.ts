import { NativeModule, requireOptionalNativeModule } from "expo";
import type { PlayerLevels } from "./playerLevels";

declare class PlayerGesturesModule extends NativeModule {
  getBrightness(): number;
  setBrightness(level: number): Promise<void>;
  resetBrightness(): Promise<void>;
  getVolume(): number;
  setVolume(level: number): void;
}

const native = requireOptionalNativeModule<PlayerGesturesModule>("YtZeroPlayerGestures");

/** This app window's brightness and the media volume, as fractions from 0 to 1 (see the Kotlin source). */
export const playerLevels: PlayerLevels | null = native ? {
  brightness: () => native.getBrightness(),
  setBrightness: (level) => { void native.setBrightness(level).catch(() => {}); },
  resetBrightness: () => { void native.resetBrightness().catch(() => {}); },
  volume: () => native.getVolume(),
  setVolume: (level) => { try { native.setVolume(level); } catch { /* the audio service is gone */ } },
} : null;
