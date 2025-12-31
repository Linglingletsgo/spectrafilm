
import { FilmProfile, Point } from '../types';
import colorConstants from './data/color_constants.json';

// --- Types ---
type Matrix3x3 = number[][];
type Vector3 = [number, number, number];

// --- Math Utils ---

function multiplyMatrixVector(m: Matrix3x3, v: Vector3): Vector3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ];
}

function interpolate(x: number, points: Point[]): number {
  if (points.length === 0) return 0;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;

  for (let i = 0; i < points.length - 1; i++) {
    if (x >= points[i].x && x < points[i+1].x) {
      const t = (x - points[i].x) / (points[i+1].x - points[i].x);
      return points[i].y + t * (points[i+1].y - points[i].y);
    }
  }
  return points[points.length - 1].y;
}


// --- Physics Engine ---

export class SimulationEngine {
  private profile: FilmProfile;
  private sensitivityMatrix: Matrix3x3; // RGB -> Raw Matrix
  private dyeDensity: number[][]; // [WL, C, M, Y, Min, Mid]
  private wavelengths: number[];
  private illuminantD50: number[]; 
  private cmfx: number[];
  private cmfy: number[];
  private cmfz: number[];

  private filmType: 'negative' | 'reversal' | 'bw_negative';

  private normalizationScale: Vector3;
  private dMin: Vector3; // The minimum density (Base Fog + Mask) from Curves
  private sensitivityOffsets: Vector3; // Alignment for neutral midtones
  public baseResponse: Vector3; // The RGB response of unexposed film (Base Fog)

  constructor(profile: FilmProfile) {
    this.profile = profile;
    
    // Fallback if matrix missing
    this.sensitivityMatrix = profile.physics.rgb_to_raw_matrix || [
      [1,0,0], [0,1,0], [0,0,1]
    ];
    
    this.dyeDensity = profile.physics.dye_density || [];
    
    // Load constants
    this.wavelengths = colorConstants.wavelengths;
    this.illuminantD50 = colorConstants.illuminants.D50;
    
    // CMF
    this.cmfx = colorConstants.cmfs.map(v => v[0]);
    this.cmfy = colorConstants.cmfs.map(v => v[1]);
    this.cmfz = colorConstants.cmfs.map(v => v[2]);

    // Helpers
    const getMinY = (pts: Point[]) => Math.min(...pts.map(p => p.y));

    // --- Channel Sensitivity Alignment ---
    // Film layers often have different "speeds".
    // We want a neutral scene input [0.18] to produce a neutral mid-tone density.
    const findMidpointShift = (points: Point[], target: number) => {
        let low = -4, high = 4;
        const dMinVal = getMinY(points);
        // Slope check: Positive for negatives, Negative for reversal
        const slope = points[points.length-1].y - points[0].y;
        
        for (let i = 0; i < 15; i++) {
            const mid = (low + high) / 2;
            const analyticalDensity = interpolate(mid, points) - dMinVal;
            if (analyticalDensity < target) {
                 if (slope > 0) low = mid; else high = mid;
            } else {
                 if (slope > 0) high = mid; else low = mid;
            }
        }
        return (low + high) / 2;
    };

    const targetMid = 1.0; 
    const midR = findMidpointShift(profile.sensitometry.red, targetMid);
    const midG = findMidpointShift(profile.sensitometry.green, targetMid);
    const midB = findMidpointShift(profile.sensitometry.blue, targetMid);
    
    this.sensitivityOffsets = [0, midG - midR, midB - midR];
    console.log(`[ENGINE] Sensitivity Balance Offsets (EV): [${this.sensitivityOffsets.map(v => v.toFixed(3)).join(', ')}]`);

    // --- Normalization Scale ---
    // We want Input RGB [1,1,1] (White) -> Raw ~ 1.0 (Log = 0)
    const whiteVec: Vector3 = [1, 1, 1];
    const rawWhite = multiplyMatrixVector(this.sensitivityMatrix, whiteVec);
    this.normalizationScale = [
        1.0 / (rawWhite[0] || 1),
        1.0 / (rawWhite[1] || 1),
        1.0 / (rawWhite[2] || 1)
    ];

    // --- dMin Extraction ---
    this.dMin = [
        getMinY(profile.sensitometry.red),
        getMinY(profile.sensitometry.green),
        getMinY(profile.sensitometry.blue)
    ];

    // Determine Film Type EARLY for baseResponse calculation
    this.filmType = this.inferFilmType();

    // --- Base Response (0 Exposure) ---
    // Represents Orange Mask (Negative) or clear highlights (Reversal)
    const zeroExp: Vector3 = [0,0,0];
    const logExpZero = this.expose(zeroExp, -20);
    const densityZero = this.develop(logExpZero); 
    let computedBase = this.scan(densityZero);
    
    const MIN_VALID_BASE = 0.01; 
    const isSlideFilm = this.filmType === 'reversal';
    
    const defaultBase: Vector3 = isSlideFilm 
        ? [0.9, 0.9, 0.9]
        : [0.4, 0.15, 0.08];
    
    if (computedBase[0] < MIN_VALID_BASE || computedBase[1] < MIN_VALID_BASE || computedBase[2] < MIN_VALID_BASE) {
        console.warn(`[ENGINE] BaseResponse too low (${computedBase.map(v => v.toFixed(4)).join(', ')}). Using defaults.`);
        this.baseResponse = defaultBase;
    } else {
        this.baseResponse = computedBase.map(v => Math.max(1e-6, v)) as Vector3;
    }

    console.log(`[ENGINE] Film type: ${this.filmType}`);
  }

  private inferFilmType(): 'negative' | 'reversal' | 'bw_negative' {
    if (this.profile.meta?.film_type) return this.profile.meta.film_type;
    const process = this.profile.meta?.process?.toLowerCase();
    const id = this.profile.id?.toLowerCase() || '';
    if (process === 'e-6' || id.includes('provia') || id.includes('velvia') || id.includes('ektachrome')) return 'reversal';
    if (process === 'bw' || id.includes('tri-x') || id.includes('hp5') || id.includes('tmax')) return 'bw_negative';
    return 'negative';
  }

  public getFilmType(): 'negative' | 'reversal' | 'bw_negative' {
    return this.filmType;
  }

  public expose(rgb: Vector3, exposureCompEv: number = 0): Vector3 {
     const exposureScale = Math.pow(2, exposureCompEv);
     const m = this.sensitivityMatrix;
     let rawR = rgb[0] * m[0][0] + rgb[1] * m[1][0] + rgb[2] * m[2][0];
     let rawG = rgb[0] * m[0][1] + rgb[1] * m[1][1] + rgb[2] * m[2][1];
     let rawB = rgb[0] * m[0][2] + rgb[1] * m[1][2] + rgb[2] * m[2][2];
     
     rawR *= this.normalizationScale[0] * Math.pow(10, this.sensitivityOffsets[0]) * exposureScale;
     rawG *= this.normalizationScale[1] * Math.pow(10, this.sensitivityOffsets[1]) * exposureScale;
     rawB *= this.normalizationScale[2] * Math.pow(10, this.sensitivityOffsets[2]) * exposureScale;
     
     return [
         Math.log10(Math.max(1e-6, rawR)),
         Math.log10(Math.max(1e-6, rawG)),
         Math.log10(Math.max(1e-6, rawB))
     ];
  }

  public develop(logExp: Vector3): Vector3 {
      const c = interpolate(logExp[0], this.profile.sensitometry.red) - this.dMin[0];
      const m = interpolate(logExp[1], this.profile.sensitometry.green) - this.dMin[1];
      const y = interpolate(logExp[2], this.profile.sensitometry.blue) - this.dMin[2];
      return [Math.max(0, c), Math.max(0, m), Math.max(0, y)];
  }
  
  public scan(densityCMY: Vector3): Vector3 {
      const [C, M, Y] = densityCMY;
      if (this.dyeDensity.length === 0) {
          return [Math.pow(10, -C), Math.pow(10, -M), Math.pow(10, -Y)];
      }

      let R_trans = 0, G_trans = 0, B_trans = 0;
      let N_r = 0, N_g = 0, N_b = 0;
      const sigma = 20;

      for (let i = 0; i < this.wavelengths.length; i++) {
          const lambda = this.wavelengths[i];
          const dye = this.dyeDensity[i]; 
          let dC = 0, dM = 0, dY = 0, dBase = 0;
          if (dye.length >= 5) { dC = dye[1]; dM = dye[2]; dY = dye[3]; dBase = dye[4]; }
          else if (dye.length >= 4) { dC = dye[1]; dM = dye[2]; dY = dye[3]; }
          else if (dye.length === 2) { dC = dye[1]; dM = dye[1]; dY = dye[1]; }

          const totalDensity = C * dC + M * dM + Y * dY + dBase;
          const transmittance = Math.pow(10, -totalDensity);
          
          const sB = Math.exp( -0.5 * Math.pow((lambda - 440)/sigma, 2) );
          const sG = Math.exp( -0.5 * Math.pow((lambda - 540)/sigma, 2) );
          const sR = Math.exp( -0.5 * Math.pow((lambda - 650)/sigma, 2) ); 
          
          R_trans += transmittance * sR; G_trans += transmittance * sG; B_trans += transmittance * sB;
          N_r += sR; N_g += sG; N_b += sB;
      }
      return [R_trans / (N_r || 1), G_trans / (N_g || 1), B_trans / (N_b || 1)];
  }
  
  public invert(scannedRGB: Vector3, gamma: number = 1.0): Vector3 {
      const normR = scannedRGB[0] / Math.max(1e-9, this.baseResponse[0]);
      const normG = scannedRGB[1] / Math.max(1e-9, this.baseResponse[1]);
      const normB = scannedRGB[2] / Math.max(1e-9, this.baseResponse[2]);
      return [
          -Math.log10(Math.max(1e-9, normR)) * gamma,
          -Math.log10(Math.max(1e-9, normG)) * gamma,
          -Math.log10(Math.max(1e-9, normB)) * gamma
      ];
  }

  public processPixel(rgb: Vector3, exposureCompEv: number = 0): Vector3 {
      const logExp = this.expose(rgb, exposureCompEv);
      const density = this.develop(logExp);
      return this.scan(density);
  }
}
