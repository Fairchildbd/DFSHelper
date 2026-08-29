import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';

export function Glass({
  children,
  radius,
  style,
}: {
  children?: React.ReactNode;
  radius: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme={t.mode}
        style={[{ borderRadius: radius }, style]}
      >
        {children}
      </GlassView>
    );
  }

  const blurs = Platform.OS === 'ios';

  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
      {blurs && (
        <BlurView
          tint={t.blurTint}
          intensity={t.blurIntensity}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: blurs ? t.glassTint : t.bgElevated },
        ]}
        pointerEvents="none"
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.glassBorder,
          },
        ]}
        pointerEvents="none"
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: radius / 2,
          right: radius / 2,
          height: StyleSheet.hairlineWidth,
          backgroundColor: t.glassHighlight,
        }}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}
