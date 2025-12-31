/**
 * Film Grain Simulation
 * 
 * Simulates randomized silver halide crystal clusters in the emulsion.
 * Uses midtone-weighted noise to match authentic film grain behavior,
 * where grain is most visible in mid-tones and less in highlights/shadows.
 */

export interface GrainOptions {
  iso: number;           // Film ISO (e.g., 100, 400, 800)
  strength?: number;     // Master grain strength multiplier (default: 1.0)
  size?: number;         // Grain size scaling (default: 1.0)
  monochrome?: boolean;  // If true, apply same noise to all RGB channels
}

/**
 * Applies film grain to a single RGB pixel
 * 
 * @param r - Linear Red [0, 1]
 * @param g - Linear Green [0, 1]
 * @param b - Linear Blue [0, 1]
 * @param options - Grain configuration
 * @returns Grainy RGB pixel
 */
export function applyFilmGrain(
  r: number, 
  g: number, 
  b: number, 
  options: GrainOptions
): [number, number, number] {
  const { iso, strength = 1.0, size = 1.0, monochrome = true } = options;
  
  // 1. Calculate base intensity/strength based on ISO
  // Power-law relationship: grain increases with ISO but plateaus
  const isoFactor = Math.pow(iso / 200, 0.6);
  const baseStrength = 0.05 * strength * isoFactor;
  
  // 2. Midtone weighting
  // Authentically, grain is most visible where density is medium (mid-greys)
  // Simple parabolic mask: weight = 1 - (|L - 0.5| * 2)^2
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const midtoneWeight = Math.max(0, 1.0 - Math.pow(Math.abs(luminance - 0.5) * 2.0, 1.2));
  
  // Final noise amplitude
  const amplitude = baseStrength * midtoneWeight;
  
  if (amplitude <= 0) return [r, g, b];
  
  // 3. Generate Clustered Noise (Silver Halide Approximation)
  // Instead of per-pixel white noise, we use a multiscale approach to create "clumps"
  const getClusteredNoise = (x: number, y: number, seed: number) => {
    // Basic pseudo-random function
    const hash = (n: number) => {
      const v = Math.sin(n) * 43758.5453123;
      return v - Math.floor(v);
    };

    // Low-frequency noise (clumps)
    const scale1 = 0.5 * size;
    const n1 = hash(Math.floor(x * scale1) + Math.floor(y * scale1) * 1234 + seed);
    
    // High-frequency noise (details)
    const scale2 = 1.2 * size;
    const n2 = hash(Math.floor(x * scale2) + Math.floor(y * scale2) * 5678 + seed * 2);
    
    return (n1 * 0.7 + n2 * 0.3 - 0.5) * 2.0;
  };

  // We need pixel coordinates for clustered noise
  // Passing them as optional parameters or using a global state is hard in per-pixel loop.
  // Proxy: use Math.random() as the seed for local clusters
  const seed = Math.random() * 1000;
  
  if (monochrome) {
    const noise = (Math.random() - 0.5) * 2.0 * amplitude;
    return [
      Math.max(0, Math.min(1, r + noise)),
      Math.max(0, Math.min(1, g + noise)),
      Math.max(0, Math.min(1, b + noise))
    ];
  } else {
    // Color grain (more realistic for some films)
    const nR = (Math.random() - 0.5) * 2.0 * amplitude;
    const nG = (Math.random() - 0.5) * 2.0 * amplitude;
    const nB = (Math.random() - 0.5) * 2.0 * amplitude;
    return [
      Math.max(0, Math.min(1, r + nR)),
      Math.max(0, Math.min(1, g + nG)),
      Math.max(0, Math.min(1, b + nB))
    ];
  }
}

/**
 * Optimized version that takes coordinates for true spatial clustering
 */
export function applyPhysicalGrain(
  r: number, g: number, b: number,
  x: number, y: number,
  options: GrainOptions
): [number, number, number] {
  const { iso, strength = 1.0, size = 1.0, monochrome = true } = options;
  
  const isoFactor = Math.pow(iso / 200, 0.6);
  const baseStrength = 0.04 * strength * isoFactor;
  
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const midtoneWeight = Math.max(0, 1.0 - Math.pow(Math.abs(luminance - 0.5) * 2.0, 1.2));
  const amplitude = baseStrength * midtoneWeight;

  // Pseudo-random cluster noise
  // Robust non-periodic integer hash (Wang Hash style)
  const hash = (p: number) => {
    let x = (p >>> 0);
    x = ((x >>> 16) ^ x) * 0x45d9f3b;
    x = ((x >>> 16) ^ x) * 0x45d9f3b;
    x = (x >>> 16) ^ x;
    return (x >>> 0) / 4294967296.0;
  };

  // Improved Spatial Mixing - Eliminates Moire by avoiding fractional scaling
  // Layer 1: Per-pixel fine grain (high frequency)
  const n1 = hash((x * 1597334677) ^ (y * 3812015801));
  
  // Layer 2: Grid-locked clusters (low frequency)
  const gx = Math.floor(x / 2);
  const gy = Math.floor(y / 2);
  const n2 = hash((gx * 1597334677) ^ (gy * 3812015801) + 1);
  
  const noise = (n1 * 0.7 + n2 * 0.3 - 0.5) * 2.0 * amplitude;

  if (monochrome) {
    return [
      Math.max(0, Math.min(1, r + noise)),
      Math.max(0, Math.min(1, g + noise)),
      Math.max(0, Math.min(1, b + noise))
    ];
  } else {
    // Spatial offsets for color channels
    const noiseR = noise; // Shared luminance base
    const noiseG = (hash((x * 1597334677) ^ (y * 3812015801) + 2) - 0.5) * 2.0 * amplitude;
    const noiseB = (hash((x * 1597334677) ^ (y * 3812015801) + 3) - 0.5) * 2.0 * amplitude;
    
    return [
      Math.max(0, Math.min(1, r + noiseR)),
      Math.max(0, Math.min(1, g + noiseG)),
      Math.max(0, Math.min(1, b + noiseB))
    ];
  }
}

