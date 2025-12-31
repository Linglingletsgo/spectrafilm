/**
 * Advanced Tone Mapping Algorithms
 * 
 * Implements industry-standard tone mapping curves for HDR to SDR conversion.
 */

export type ToneMappingMode = 'aces' | 'aces_linear' | 'reinhard' | 'simple' | 'linear';

/**
 * ACES Filmic Tone Mapping
 * 
 * Based on Narkowicz 2015 ACES Filmic Curve approximation.
 * Used in Unreal Engine 4, Unity, and many AAA games.
 * 
 * Formula: f(x) = x(a*x + b) / (x(c*x + d) + e)
 * where: a=2.51, b=0.03, c=2.43, d=0.59, e=0.14
 * 
 * Reference: https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
 */
export function acesToneMapping(linear: number): number {
  // Clamp to non-negative (ACES doesn't handle negative values)
  const x = Math.max(linear, 0);
  
  // Narkowicz ACES constants
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  
  // Apply ACES curve
  const numerator = x * (a * x + b);
  const denominator = x * (c * x + d) + e;
  const mapped = numerator / denominator;
  
  // Clamp to [0, 1]
  const clamped = Math.max(0, Math.min(1, mapped));
  
  // sRGB gamma encoding (2.2 approximation)
  return Math.pow(clamped, 1.0 / 2.2);
}

/**
 * ACES Linear Mode (No HDR compression)
 * 
 * Applies ACES AP0 → sRGB color space transform WITHOUT tone mapping.
 * This is lossless in terms of dynamic range compression.
 * 
 * NOTE: Currently simplified - assumes input is already in a similar color space.
 * For true ACES workflow, would need full AP0 → sRGB matrix transform.
 */
export function acesLinearToneMapping(linear: number): number {
  // For now: just clamp and gamma encode (no color space transform needed
  // since our film simulation already outputs in a camera-native space close to sRGB)
  const clamped = Math.max(0, Math.min(1, linear));
  return Math.pow(clamped, 1.0 / 2.2);
}

/**
 * Reinhard Tone Mapping
 * 
 * Classic global tone mapping operator with adjustable white point.
 * 
 * Formula: L_out = L_in / (1 + L_in / L_white)
 * 
 * @param linear - Linear light value [0, ∞)
 * @param whitePoint - Luminance value mapped to white (default: 1.0)
 */
export function reinhardToneMapping(linear: number, whitePoint: number = 1.0): number {
  const mapped = linear / (1.0 + linear / whitePoint);
  return Math.pow(mapped, 1.0 / 2.2);
}

/**
 * Simple Gamma-only Tone Mapping
 * 
 * Direct gamma encoding without HDR compression.
 * For compatibility and comparison.
 */
export function simpleToneMapping(linear: number): number {
  const clamped = Math.max(0, Math.min(1, linear));
  return Math.pow(clamped, 1.0 / 2.2);
}

/**
 * Apply tone mapping based on selected mode
 */
export function applyToneMapping(
  linear: number,
  mode: ToneMappingMode = 'linear',
  whitePoint: number = 1.0
): number {
  switch (mode) {
    case 'aces':
      return acesToneMapping(linear);
    case 'aces_linear':
      return acesLinearToneMapping(linear);
    case 'reinhard':
      return reinhardToneMapping(linear, whitePoint);
    case 'simple':
      return simpleToneMapping(linear);
    case 'linear':
      return simpleToneMapping(linear);  // Same as simple for now
    default:
      return simpleToneMapping(linear);
  }
}
