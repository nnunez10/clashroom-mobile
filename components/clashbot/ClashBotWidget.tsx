// components/clashbot/ClashBotWidget.tsx

import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo } from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ClashBotTone = "unverified" | "checking" | "verified" | "disputed";

type ClashBotWidgetProps = {
  tone?: ClashBotTone;
  subtitle?: string;
  activeCount?: number;
  onPress?: () => void;
  size?: number;
  initialSide?: "left" | "right";
  margin?: number;
  style?: StyleProp<ViewStyle>;
};

function clamp(value: number, min: number, max: number) {
  "worklet";
  return Math.max(min, Math.min(value, max));
}

export default function ClashBotWidget({
  tone = "unverified",
  subtitle,
  activeCount = 0,
  onPress,
  size = 64,
  initialSide = "right",
  margin = 14,
  style,
}: ClashBotWidgetProps) {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();

  const bounds = useMemo(() => {
    const minX = margin;
    const maxX = Math.max(margin, SCREEN_W - size - margin);
    const minY = margin + insets.top;
    const maxY = Math.max(minY, SCREEN_H - size - margin - insets.bottom);
    return { minX, maxX, minY, maxY };
  }, [SCREEN_W, SCREEN_H, insets.bottom, insets.top, margin, size]);

  const startX = initialSide === "left" ? bounds.minX : bounds.maxX;
  const startY = Math.max(bounds.minY, Math.min(SCREEN_H * 0.6, bounds.maxY));

  const x = useSharedValue(startX);
  const y = useSharedValue(startY);

  const startXRef = useSharedValue(startX);
  const startYRef = useSharedValue(startY);

  const scale = useSharedValue(1);
  const glow = useSharedValue(0);
  const pulse = useSharedValue(0);

  const minX = useSharedValue(bounds.minX);
  const maxX = useSharedValue(bounds.maxX);
  const minY = useSharedValue(bounds.minY);
  const maxY = useSharedValue(bounds.maxY);

  useDerivedValue(() => {
    minX.value = bounds.minX;
    maxX.value = bounds.maxX;
    minY.value = bounds.minY;
    maxY.value = bounds.maxY;

    x.value = clamp(x.value, minX.value, maxX.value);
    y.value = clamp(y.value, minY.value, maxY.value);
  });

  const gradientColors: readonly [string, string] =
    tone === "checking"
      ? ["#F5A623", "#FFDD55"]
      : tone === "verified"
      ? ["#24E6B8", "#1DD7A8"]
      : tone === "disputed"
      ? ["#FF4D4D", "#B31237"]
      : ["#24E6B8", "#26C6FF"];

  const glowColors: readonly [string, string] =
    tone === "disputed"
      ? ["rgba(255,77,77,0.30)", "rgba(179,18,55,0.16)"]
      : ["rgba(65,255,188,0.35)", "rgba(44,222,255,0.18)"];

  const toneDot = {
    unverified: "rgba(255,255,255,0.55)",
    checking: "rgba(245,166,35,1)",
    verified: "rgba(36,230,184,1)",
    disputed: "rgba(255,77,77,1)",
  }[tone];

  const toneLabel =
    tone === "checking"
      ? "Checking..."
      : tone === "verified"
      ? "Receipts ready"
      : tone === "disputed"
      ? "Disputed"
      : subtitle?.trim() || "Tap to verify";

  useEffect(() => {
    if (tone === "checking") {
      pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
    } else if (tone === "verified") {
      pulse.value = withRepeat(withTiming(1, { duration: 1200 }), -1, true);
    } else {
      pulse.value = withTiming(0, { duration: 150 });
    }
  }, [tone, pulse]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      startXRef.value = x.value;
      startYRef.value = y.value;
      scale.value = withTiming(1.03, { duration: 120 });
      glow.value = withTiming(1, { duration: 120 });
    })
    .onUpdate((evt) => {
      const nextX = startXRef.value + evt.translationX;
      const nextY = startYRef.value + evt.translationY;
      x.value = clamp(nextX, minX.value, maxX.value);
      y.value = clamp(nextY, minY.value, maxY.value);
    })
    .onEnd((evt) => {
      const projectedX = x.value + evt.velocityX * 0.04;
      const projectedY = y.value + evt.velocityY * 0.04;

      const clampedX = clamp(projectedX, minX.value, maxX.value);
      const clampedY = clamp(projectedY, minY.value, maxY.value);

      const midpoint = SCREEN_W / 2;
      const targetX = clampedX < midpoint ? minX.value : maxX.value;

      x.value = withSpring(targetX, { damping: 16, stiffness: 220, mass: 0.6 });
      y.value = withSpring(clampedY, { damping: 18, stiffness: 210, mass: 0.7 });

      glow.value = withTiming(0, { duration: 180 });
      scale.value = withTiming(1, { duration: 180 });
    })
    .onFinalize(() => {
      scale.value = withTiming(1, { duration: 140 });
      glow.value = withTiming(0, { duration: 140 });
    });

  const tap = Gesture.Tap()
    .maxDuration(220)
    .onStart(() => {
      scale.value = withTiming(0.97, { duration: 80 });
    })
    .onEnd(() => {
      scale.value = withTiming(1, { duration: 110 });
      if (onPress) runOnJS(onPress)();
    });

  const composed = Gesture.Simultaneous(pan, tap);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
    };
  });

  const glowStyle = useAnimatedStyle(() => {
    const extra =
      tone === "checking" ? 0.35 * pulse.value : tone === "verified" ? 0.18 * pulse.value : 0;

    return { opacity: glow.value + extra };
  });

  const showPill = !!toneLabel;
  const showCount = activeCount > 0;

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[styles.container, { width: size, height: size }, animatedStyle, style]}
      >
        <Animated.View style={[styles.glowWrap, glowStyle]} pointerEvents="none">
          <LinearGradient
            colors={glowColors}
            start={{ x: 0.1, y: 0.1 }}
            end={{ x: 0.9, y: 0.9 }}
            style={[
              styles.glow,
              { width: size + 18, height: size + 18, borderRadius: (size + 18) / 2 },
            ]}
          />
        </Animated.View>

        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.bubble, { width: size, height: size, borderRadius: size / 2 }]}
        >
          <Text style={styles.bolt}>⚡</Text>
          <Animated.View style={[styles.toneDot, { backgroundColor: toneDot }]} />
        </LinearGradient>

        {showCount && (
          <View style={styles.countBadge} pointerEvents="none">
            <Text style={styles.countBadgeText}>{activeCount}</Text>
          </View>
        )}

        {showPill && (
          <Animated.View
            style={[
              styles.statusPill,
              tone === "checking"
                ? styles.statusPillChecking
                : tone === "verified"
                ? styles.statusPillVerified
                : tone === "disputed"
                ? styles.statusPillDisputed
                : styles.statusPillDefault,
            ]}
            pointerEvents="none"
          >
            <Text style={styles.statusPillText} numberOfLines={1}>
              {toneLabel}
            </Text>
          </Animated.View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  bubble: {
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  bolt: {
    fontSize: 22,
    color: "white",
    fontWeight: "900",
  },
  glowWrap: {
    position: "absolute",
    left: -9,
    top: -9,
  },
  glow: {},
  toneDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 12,
    height: 12,
    borderRadius: 6,
  },

  countBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7, 17, 23, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  countBadgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "900",
  },

  statusPill: {
    position: "absolute",
    right: 72,
    top: 18,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    maxWidth: 138,
    borderWidth: 1,
  },
  statusPillDefault: {
    backgroundColor: "rgba(7, 17, 23, 0.88)",
    borderColor: "rgba(255,255,255,0.14)",
  },
  statusPillChecking: {
    backgroundColor: "rgba(7, 17, 23, 0.92)",
    borderColor: "rgba(245,166,35,0.35)",
  },
  statusPillVerified: {
    backgroundColor: "rgba(7, 17, 23, 0.92)",
    borderColor: "rgba(36,230,184,0.35)",
  },
  statusPillDisputed: {
    backgroundColor: "rgba(7, 17, 23, 0.92)",
    borderColor: "rgba(255,77,77,0.30)",
  },
  statusPillText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 11,
    fontWeight: "900",
  },
});