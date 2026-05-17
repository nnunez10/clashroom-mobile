// components/clashbot/ClashVerdictOverlay.tsx
//
// Full-screen verdict moment overlay for Quick Verify.
// Appears when verification completes, auto-dismisses after 2.6s or on tap.
// Animated with React Native Animated (not Reanimated).

import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type VerdictWord =
  | "RIGHT"
  | "WRONG"
  | "TOO EARLY"
  | "UNCLEAR"
  | "NO SOURCES"
  | "CHECKING"
  | "CHECK";

type ClashVerdictOverlayProps = {
  visible: boolean;
  verdict: VerdictWord;
  reactionLine: string;
  claimText: string;
  onClose: () => void;
};

function getGradient(verdict: VerdictWord): [string, string] {
  switch (verdict) {
    case "RIGHT":     return ["#16a34a", "#22c55e"];
    case "WRONG":     return ["#7f1d1d", "#dc2626"];
    case "TOO EARLY": return ["#92400e", "#f59e0b"];
    case "UNCLEAR":   return ["#4c1d95", "#7c3aed"];
    default:          return ["#0f172a", "#1e293b"];
  }
}

function getDisplayText(verdict: VerdictWord): string {
  switch (verdict) {
    case "RIGHT":     return "YOU'RE RIGHT";
    case "WRONG":     return "THAT'S WRONG";
    case "TOO EARLY": return "TOO EARLY";
    case "UNCLEAR":   return "UNCLEAR";
    case "NO SOURCES": return "NO SOURCES";
    default:          return verdict;
  }
}

function triggerHaptic(verdict: VerdictWord) {
  switch (verdict) {
    case "RIGHT":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case "WRONG":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
    case "TOO EARLY":
    case "UNCLEAR":
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    default:
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
  }
}

export default function ClashVerdictOverlay({
  visible,
  verdict,
  reactionLine,
  claimText,
  onClose,
}: ClashVerdictOverlayProps) {
  const opacity   = useRef(new Animated.Value(0)).current;
  const scale     = useRef(new Animated.Value(0.9)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const shake     = useRef(new Animated.Value(0)).current;

  // White flash
  const flashOpacity = useRef(new Animated.Value(0)).current;

  // Continuous background glow pulse
  const glowOpacity = useRef(new Animated.Value(0.03)).current;

  const dismissTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glowAnimation = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!visible) {
      glowAnimation.current?.stop();
      return;
    }

    // Reset values
    opacity.setValue(0);
    scale.setValue(0.9);
    translateY.setValue(20);
    shake.setValue(0);
    flashOpacity.setValue(0);
    glowOpacity.setValue(0.03);

    // Haptic feedback
    triggerHaptic(verdict);

    // Entry flash: 0 → 0.25 → 0 over ~180ms
    Animated.sequence([
      Animated.timing(flashOpacity, {
        toValue: 0.25,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(flashOpacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();

    // Entrance: fade + overshoot scale + upward slide
    const entrance = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.05,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 140,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }),
    ]);

    if (verdict === "WRONG") {
      Animated.sequence([
        entrance,
        Animated.sequence([
          Animated.timing(shake, { toValue:  11, duration: 35, useNativeDriver: true }),
          Animated.timing(shake, { toValue: -11, duration: 35, useNativeDriver: true }),
          Animated.timing(shake, { toValue:   8, duration: 35, useNativeDriver: true }),
          Animated.timing(shake, { toValue:  -8, duration: 35, useNativeDriver: true }),
          Animated.timing(shake, { toValue:   4, duration: 35, useNativeDriver: true }),
          Animated.timing(shake, { toValue:   0, duration: 35, useNativeDriver: true }),
        ]),
      ]).start();
    } else if (verdict === "RIGHT") {
      Animated.sequence([
        entrance,
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.04, duration: 300, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1,    duration: 300, useNativeDriver: true }),
        ]),
      ]).start();
    } else {
      entrance.start();
    }

    // Continuous glow pulse (runs until cleanup)
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, {
          toValue: 0.10,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.03,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );
    glowAnimation.current = glow;
    glow.start();

    // Auto-dismiss
    dismissTimer.current = setTimeout(onClose, 2600);

    return () => {
      if (dismissTimer.current !== null) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      glowAnimation.current?.stop();
      opacity.stopAnimation();
      scale.stopAnimation();
      translateY.stopAnimation();
      shake.stopAnimation();
      flashOpacity.stopAnimation();
      glowOpacity.stopAnimation();
    };
  }, [visible, verdict]);

  if (!visible) return null;

  const [colorA, colorB] = getGradient(verdict);
  const displayText = getDisplayText(verdict);

  return (
    <Pressable style={styles.overlay} onPress={onClose}>
      {/* Base gradient */}
      <LinearGradient
        colors={[colorA, colorB]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Radial-style glow energy layer */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glowLayer,
          { opacity: glowOpacity },
        ]}
      />

      {/* Entry flash */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          styles.flashLayer,
          { opacity: flashOpacity },
        ]}
      />

      {/* Main content */}
      <Animated.View
        style={[
          styles.content,
          {
            opacity,
            transform: [
              { scale },
              { translateX: shake },
              { translateY },
            ],
          },
        ]}
      >
        <Text style={styles.verdictText}>{displayText}</Text>
        <Text style={styles.reactionText}>{reactionLine}</Text>
        <Text style={styles.claimText} numberOfLines={4}>
          {claimText}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    alignItems: "center",
    justifyContent: "center",
  },

  glowLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#ffffff",
    // Simulate a center-weighted radial glow by being full-screen white at low opacity.
    // The gradient behind it provides the shape; this layer pulses over it.
  },

  flashLayer: {
    backgroundColor: "#ffffff",
  },

  content: {
    alignItems: "center",
    paddingHorizontal: 32,
    width: "100%",
  },

  verdictText: {
    fontSize: 58,
    fontWeight: "900",
    color: "#ffffff",
    letterSpacing: 4,
    textAlign: "center",
    lineHeight: 66,
    textShadowColor: "rgba(0,0,0,0.28)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },

  reactionText: {
    fontSize: 22,
    fontWeight: "800",
    color: "rgba(255,255,255,0.92)",
    textAlign: "center",
    marginTop: 14,
    lineHeight: 28,
    textShadowColor: "rgba(0,0,0,0.18)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  claimText: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.62)",
    textAlign: "center",
    marginTop: 18,
    lineHeight: 22,
    maxWidth: 320,
  },
});
