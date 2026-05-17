import { NativeModules, Platform } from "react-native";

export function enterPiP(): void {
  console.log("[PiP] enterPiP called", {
    platform: Platform.OS,
    hasModule: !!NativeModules?.PiPModule,
    hasMethod: !!NativeModules?.PiPModule?.enterPiP,
  });

  if (Platform.OS !== "android") {
    console.log("[PiP] Not android, skipping");
    return;
  }

  if (!NativeModules?.PiPModule?.enterPiP) {
    console.log("[PiP] Native PiPModule.enterPiP missing");
    return;
  }

  NativeModules.PiPModule.enterPiP();
}
