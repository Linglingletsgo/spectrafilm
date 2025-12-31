/**
 * ACES ADX (Academy Density Exchange) Implementation
 * 
 * Based on ACES specification:
 * - urn:ampas:aces:transformId:v2.0:CSC.Academy.ADX10_to_ACES.a2.v1
 * 
 * Physical Workflow:
 * 1. Density (from film scan) → Channel Independent Density (CID)
 * 2. CID → Relative Log Exposure (via calibrated LUT)
 * 3. Log Exposure → Linear Exposure
 * 4. Linear Exposure → ACES (AP0 color space)
 * 
 * This is the INDUSTRY STANDARD for film scanning.
 */

type Vector3 = [number, number, number];
type Matrix3x3 = number[][];

/**
 * Channel Dependent Density to Channel Independent Density
 * Accounts for film dye inter-image effects
 */
const CDD_TO_CID: Matrix3x3 = [
  [0.75573, 0.05901, 0.16134],
  [0.22197, 0.96928, 0.07406],
  [0.02230, -0.02829, 0.76460]
];

/**
 * Relative Exposure to ACES (AP0 primaries)
 * Derived from spectral measurements
 */
const EXP_TO_ACES: Matrix3x3 = [
  [0.72286, 0.11923, 0.01427],
  [0.12630, 0.76418, 0.08213],
  [0.15084, 0.11659, 0.90359]
];

/**
 * Density to Relative Log Exposure calibration LUT
 * [CID, LogE] pairs
 * Based on Kodak film measurements
 */
const DENSITY_TO_LOG_EXPOSURE_LUT: [number, number][] = [
  [-0.190000000000000, -6.000000000000000],
  [0.010000000000000, -2.721718645000000],
  [0.028000000000000, -2.521718645000000],
  [0.054000000000000, -2.321718645000000],
  [0.095000000000000, -2.121718645000000],
  [0.145000000000000, -1.921718645000000],
  [0.220000000000000, -1.721718645000000],
  [0.300000000000000, -1.521718645000000],
  [0.400000000000000, -1.321718645000000],
  [0.500000000000000, -1.121718645000000],
  [0.600000000000000, -0.926545676714876]
];

const REF_PT = (7120.0 - 1520.0) / 8000.0 * (100.0 / 55.0) - Math.log10(0.18);

/**
 * Matrix-vector multiplication
 */
function multiplyMatrixVector(matrix: Matrix3x3, vec: Vector3): Vector3 {
  return [
    matrix[0][0] * vec[0] + matrix[0][1] * vec[1] + matrix[0][2] * vec[2],
    matrix[1][0] * vec[0] + matrix[1][1] * vec[1] + matrix[1][2] * vec[2],
    matrix[2][0] * vec[0] + matrix[2][1] * vec[1] + matrix[2][2] * vec[2]
  ];
}

/**
 * 1D LUT interpolation
 */
function interpolate1D(lut: [number, number][], x: number): number {
  if (x <= lut[0][0]) return lut[0][1];
  if (x >= lut[lut.length - 1][0]) return lut[lut.length - 1][1];
  
  for (let i = 0; i < lut.length - 1; i++) {
    if (x >= lut[i][0] && x < lut[i + 1][0]) {
      const t = (x - lut[i][0]) / (lut[i + 1][0] - lut[i][0]);
      return lut[i][1] + t * (lut[i + 1][1] - lut[i][1]);
    }
  }
  
  return lut[lut.length - 1][1];
}

/**
 * Convert negative film CMY density to display sRGB
 * Physical approach: Density → Transmittance → Scene Light → sRGB
 * 
 * This bypasses ACES ADX because we're working with theoretical chemical density,
 * not scanner-measured density values.
 */
export function negativeDensityToACES(densityCMY: Vector3): Vector3 {
  const [C, M, Y] = densityCMY;
  
  // Step 1: Density → Transmittance (Beer-Lambert Law)
  // T = 10^(-D)
  const T_cyan = Math.pow(10, -C);
  const T_magenta = Math.pow(10, -M);
  const T_yellow = Math.pow(10, -Y);
  
  // Step 2: CMY Transmittance → RGB Scene Light
  // Negative film: 
  // - Low cyan transmittance (high density) = Dark red in scene = Low R
  // - High cyan transmittance (low density) = Bright red in scene = High R
  //
  // Physical relationship:
  // R_scene ∝ T_cyan (cyan absorbs red)
  // G_scene ∝ T_magenta (magenta absorbs green)
  // B_scene ∝ T_yellow (yellow absorbs blue)
  
  const R_scene = T_cyan;
  const G_scene = T_magenta;
  const B_scene = T_yellow;
  
  // Debug logging
  if (Math.random() < 0.001) {
    console.log('[PHYSICAL DEBUG] CMY Density:', densityCMY.map(v => v.toFixed(3)));
    console.log('[PHYSICAL DEBUG] CMY Transmittance:', [T_cyan, T_magenta, T_yellow].map(v => v.toFixed(3)));
    console.log('[PHYSICAL DEBUG] RGB Scene:', [R_scene, G_scene, B_scene].map(v => v.toFixed(3)));
  }
  
  // Step 3: Return scene-referred linear RGB (similar to ACES concept)
  return [R_scene, G_scene, B_scene];
}

/**
 * Scene-referred linear RGB to sRGB display
 * Standard color management workflow
 */
export function acesToSRGB(sceneRGB: Vector3): Vector3 {
  let [R, G, B] = sceneRGB;
  
  // Simple tone mapping (compress dynamic range)
  R = R / (1 + R);
  G = G / (1 + G);
  B = B / (1 + B);
  
  // Debug
  if (Math.random() < 0.001) {
    console.log('[PHYSICAL DEBUG] After tone mapping:', [R, G, B].map(v => v.toFixed(6)));
  }
  
  // sRGB OETF (gamma encoding)
  const applyGamma = (v: number) => {
    v = Math.max(0, Math.min(1, v));
    return v <= 0.0031308
      ? 12.92 * v
      : 1.055 * Math.pow(v, 1/2.4) - 0.055;
  };
  
  const sRGB: Vector3 = [
    applyGamma(R),
    applyGamma(G),
    applyGamma(B)
  ];
  
  if (Math.random() < 0.001) {
    console.log('[PHYSICAL DEBUG] Final sRGB:', sRGB.map(v => v.toFixed(6)));
    console.log('---');
  }
  
  return sRGB;
}

/**
 * One-shot conversion: Negative CMY Density → Display
 */
export function negativeDensityToDisplay(densityCMY: Vector3): Vector3 {
  const sceneRGB = negativeDensityToACES(densityCMY);
  const srgb = acesToSRGB(sceneRGB);
  return srgb;
}

/**
 * DEPRECATED: Old function for backward compatibility
 */
export function densityToDisplay(density: Vector3): Vector3 {
  return negativeDensityToDisplay(density);
}
