import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
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
  onPress?: () => void;
  size?: number;
  initialSide?: "left" | "right";
  margin?: number;
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

function clamp(value: number, min: number, max: number) {
  "worklet";
  return Math.max(min, Math.min(value, max));
}

export default function ClashBotWidget({
  tone = "unverified",
  subtitle = "Tap to open verification overlay",
  onPress,
  size = 64,
  initialSide = "right",
  margin = 14,
}: ClashBotWidgetProps) {
  const insets = useSafeAreaInsets();

  const bounds = useMemo(() => {
    const minX = margin;
    const maxX = SCREEN_W - size - margin;
    const minY = margin + insets.top;
    const maxY = SCREEN_H - size - margin - insets.bottom;
    return { minX, maxX, minY, maxY };
  }, [insets.bottom, insets.top, margin, size]);

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
  }, [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY]);

  const gradientColors =
    tone === "checking"
      ? ["#F5A623", "#FFDD55"]
      : tone === "verified"
      ? ["#24E6B8", "#24E6B8"]
      : tone === "disputed"
      ? ["#FF4D4D", "#B31237"]
      : ["#24E6B8", "#26C6FF"];

  const toneDot = {
    unverified: "rgba(255,255,255,0.55)",
    checking: "rgba(245,166,35,1)",
    verified: "rgba(36,230,184,1)",
    disputed: "rgba(255,77,77,1)",
  }[tone];

  useEffect(() => {
    if (tone === "checking") {
      pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
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
    const extra = tone === "checking" ? 0.35 * pulse.value : 0;
    return { opacity: glow.value + extra };
  });

  return (
    <GestureDetector gesture={composed}>
      {/* Width/height explicitly set so touch bounds stay tight */}
      <Animated.View style={[styles.container, { width: size, height: size }, animatedStyle]}>
        <Animated.View style={[styles.glowWrap, glowStyle]} pointerEvents="none">
          <LinearGradient
            colors={["rgba(65,255,188,0.35)", "rgba(44,222,255,0.18)"]}
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
          <View style={[styles.toneDot, { backgroundColor: toneDot }]} />
        </LinearGradient>

        {/* Label is outside the bubble but pointerEvents none so it never blocks taps */}
        <View style={styles.labelWrap} pointerEvents="none">
          <Text style={styles.labelTitle}>{tone === "checking" ? "ClashBot (Checking)" : "ClashBot"}</Text>
          <Text style={styles.labelSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { position: "absolute", left: 0, top: 0 },
  bubble: {
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  bolt: { fontSize: 22, color: "white", fontWeight: "900" },
  glowWrap: { position: "absolute", left: -9, top: -9 },
  glow: {},
  toneDot: { position: "absolute", top: 10, right: 10, width: 12, height: 12, borderRadius: 6 },

  labelWrap: {
    position: "absolute",
    left: -78,
    bottom: -44,
    width: 220,
    alignItems: "center",
  },
  labelTitle: { color: "white", fontWeight: "800", fontSize: 12 },
  labelSubtitle: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 },
});