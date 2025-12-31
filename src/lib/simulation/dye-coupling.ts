/**
 * CMY Dye Coupling Simulation
 * 
 * Simulates chemical crosstalk between cyan, magenta, and yellow dye layers
 * in color negative film. Based on density-space matrix transformation.
 * 
 * Physical Background:
 * - Color film doesn't record RGB directly
 * - Chemical reactions produce CMY dyes:
 *   - Cyan dye absorbs red light
 *   - Magenta dye absorbs green light
 *   - Yellow dye absorbs blue light
 * - Dye formation in one layer affects spectral absorption in others (crosstalk)
 */

export type Vector3 = [number, number, number];

/**
 * Apply CMY dye coupling directly to density values
 * 
 * @param densities - [Dr, Dg, Db] density values
 * @param matrix - 3×3 row-major crosstalk matrix
 * @returns Coupled density values
 */
export function applyDyeCouplingToDensity(
  densities: Vector3,
  matrix: number[]
): Vector3 {
  const [dr, dg, db] = densities;
  return [
    matrix[0] * dr + matrix[1] * dg + matrix[2] * db,
    matrix[3] * dr + matrix[4] * dg + matrix[5] * db,
    matrix[6] * dr + matrix[7] * dg + matrix[8] * db
  ];
}

/**
 * Apply CMY dye coupling using density-space matrix transformation
 * (Transmittance version)
 */
export function applyDyeCoupling(
  rgb: Vector3,
  matrix: number[]
): Vector3 {
  if (matrix.length !== 9) {
    throw new Error('Dye coupling matrix must have 9 elements (3×3)');
  }
  
  const [r, g, b] = rgb;
  const epsilon = 1e-6; // Avoid log(0)
  
  // Step 1: Convert transmittance to density
  const dr = -Math.log10(Math.max(r, epsilon));
  const dg = -Math.log10(Math.max(g, epsilon));
  const db = -Math.log10(Math.max(b, epsilon));
  
  // Step 2: Apply matrix
  const densities_new = applyDyeCouplingToDensity([dr, dg, db], matrix);
  
  // Step 3: Convert density back to transmittance
  return [
    Math.pow(10, -densities_new[0]),
    Math.pow(10, -densities_new[1]),
    Math.pow(10, -densities_new[2])
  ];
}

/**
 * Identity matrix (no crosstalk)
 */
export const IDENTITY_MATRIX: number[] = [
  1.0, 0.0, 0.0,
  0.0, 1.0, 0.0,
  0.0, 0.0, 1.0
];

/**
 * Example crosstalk matrices for common films
 * 
 * Diagonal values (1.0): self-density preservation
 * Off-diagonal values (0.02-0.08): crosstalk strength
 * 
 * Note: These are approximations based on spectral analysis.
 * Actual values should be calibrated from film datasheets.
 */
export const DYE_COUPLING_PRESETS: Record<string, number[]> = {
  // Modern films with minimal crosstalk
  'kodak_portra': [
    1.0,  0.05, 0.02,
    0.03, 1.0,  0.04,
    0.01, 0.02, 1.0
  ],
  
  // Fuji films tend to have slightly more magenta-yellow interaction
  'fuji_pro_400h': [
    1.0,  0.04, 0.02,
    0.05, 1.0,  0.06,
    0.02, 0.03, 1.0
  ],
  
  // Vintage films (e.g., Kodachrome) had more pronounced crosstalk
  'kodachrome_64': [
    1.0,  0.08, 0.05,
    0.07, 1.0,  0.09,
    0.04, 0.06, 1.0
  ],
  
  // Vision3 modern cinema film (minimal crosstalk)
  'kodak_vision3': [
    1.0,  0.03, 0.01,
    0.02, 1.0,  0.03,
    0.01, 0.01, 1.0
  ]
};

/**
 * Get dye coupling matrix for a film preset
 */
export function getDyeCouplingMatrix(presetName: string): number[] {
  return DYE_COUPLING_PRESETS[presetName] || IDENTITY_MATRIX;
}
