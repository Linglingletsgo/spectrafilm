/**
 * Pyramid Bloom Simulation
 * 
 * Simulates light scattering in lens and film base (Bloom/Glow).
 * Uses a 6-layer Gaussian pyramid approach for large-radius scattering
 * with manageable CPU performance.
 */

export interface BloomOptions {
  strength: number;    // 0 to 1
  threshold: number;   // Luminance threshold for highlights
  radius: number;      // Master radius scale
  weights?: number[];  // Level weights (6 values)
}

/**
 * Fast Box Blur approximation of Gaussian Blur
 */
function boxBlur(data: Float32Array, width: number, height: number, radius: number) {
  if (radius < 1) return data;
  
  const output = new Float32Array(data.length);
  const size = width * height;
  
  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < width) {
          const idx = (y * width + nx) * 4;
          r += data[idx];
          g += data[idx + 1];
          b += data[idx + 2];
          count++;
        }
      }
      const idx = (y * width + x) * 4;
      output[idx] = r / count;
      output[idx + 1] = g / count;
      output[idx + 2] = b / count;
      output[idx + 3] = data[idx + 3];
    }
  }
  
  // Vertical pass (in-place on output)
  const final = new Float32Array(output.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < height) {
          const idx = (ny * width + x) * 4;
          r += output[idx];
          g += output[idx + 1];
          b += output[idx + 2];
          count++;
        }
      }
      const idx = (y * width + x) * 4;
      final[idx] = r / count;
      final[idx + 1] = g / count;
      final[idx + 2] = b / count;
      final[idx + 3] = output[idx + 3];
    }
  }
  
  return final;
}

/**
 * Downsample image by factor of 2
 */
function downsample(data: Float32Array, width: number, height: number): { data: Float32Array, w: number, h: number } {
  const nw = Math.floor(width / 2);
  const nh = Math.floor(height / 2);
  const output = new Float32Array(nw * nh * 4);
  
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const idx = (y * nw + x) * 4;
      const srcIdx = (y * 2 * width + x * 2) * 4;
      
      // Simple point sampling for speed, could be bilinear
      output[idx]     = data[srcIdx];
      output[idx + 1] = data[srcIdx + 1];
      output[idx + 2] = data[srcIdx + 2];
      output[idx + 3] = data[srcIdx + 3];
    }
  }
  return { data: output, w: nw, h: nh };
}

/**
 * Apply Pyramid Bloom to the entire image buffer
 * 
 * @param linearData - Float32Array of RGBA linear sunlight values
 * @param width - Image width
 * @param height - Image height
 * @param options - Bloom settings
 */
export function applyPyramidBloom(
  linearData: Float32Array,
  width: number,
  height: number,
  options: BloomOptions
): Float32Array {
  const { strength, threshold, radius, weights = [0.1, 0.2, 0.4, 0.8, 1.0, 1.0] } = options;
  if (strength <= 0) return linearData;

  // 1. Extract Highlights
  const highlightData = new Float32Array(linearData.length);
  for (let i = 0; i < linearData.length; i += 4) {
    const r = linearData[i];
    const g = linearData[i + 1];
    const b = linearData[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    
    if (lum > threshold) {
      const boost = (lum - threshold) / (1.0 - threshold);
      highlightData[i]     = r * boost;
      highlightData[i + 1] = g * boost;
      highlightData[i + 2] = b * boost;
      highlightData[i + 3] = 1.0;
    } else {
      highlightData[i] = 0;
      highlightData[i + 1] = 0;
      highlightData[i + 2] = 0;
      highlightData[i + 3] = 0;
    }
  }

  // 2. Create Pyramid
  const levels: any[] = [];
  let current: any = { data: highlightData, w: width, h: height };
  
  for (let l = 0; l < weights.length; l++) {
    // Blur current level
    const blurred = boxBlur(current.data, current.w, current.h, Math.max(1, Math.round(radius * (l + 1))));
    levels.push({ data: blurred, w: current.w, h: current.h });
    
    // Downsample for next level
    if (l < weights.length - 1) {
      current = downsample(current.data, current.w, current.h);
    }
  }

  // 3. Composite back to original size
  const result = new Float32Array(linearData.length);
  result.set(linearData);
  
  for (let l = 0; l < levels.length; l++) {
    const level = levels[l];
    const weight = weights[l] * strength;
    
    const scaleX = level.w / width;
    const scaleY = level.h / height;
    
    for (let y = 0; y < height; y++) {
      const fy = y * scaleY;
      const y0 = Math.floor(fy);
      const y1 = Math.min(level.h - 1, y0 + 1);
      const dy = fy - y0;

      for (let x = 0; x < width; x++) {
        const fx = x * scaleX;
        const x0 = Math.floor(fx);
        const x1 = Math.min(level.w - 1, x0 + 1);
        const dx = fx - x0;

        const idx = (y * width + x) * 4;
        
        // Bilinear interpolation
        const i00 = (y0 * level.w + x0) * 4;
        const i10 = (y0 * level.w + x1) * 4;
        const i01 = (y1 * level.w + x0) * 4;
        const i11 = (y1 * level.w + x1) * 4;

        const w00 = (1 - dx) * (1 - dy);
        const w10 = dx * (1 - dy);
        const w01 = (1 - dx) * dy;
        const w11 = dx * dy;

        result[idx]     += (level.data[i00] * w00 + level.data[i10] * w10 + level.data[i01] * w01 + level.data[i11] * w11) * weight;
        result[idx + 1] += (level.data[i00 + 1] * w00 + level.data[i10 + 1] * w10 + level.data[i01 + 1] * w01 + level.data[i11 + 1] * w11) * weight;
        result[idx + 2] += (level.data[i00 + 2] * w00 + level.data[i10 + 2] * w10 + level.data[i01 + 2] * w01 + level.data[i11 + 2] * w11) * weight;
      }
    }
  }

  return result;
}
