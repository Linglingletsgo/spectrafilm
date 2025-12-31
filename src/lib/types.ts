
export interface Point {
  x: number; // LogH or Pixel X
  y: number; // Density or Pixel Y
}

export interface CurveData {
  r: Point[]; // Red/Cyan
  g: Point[]; // Green/Magenta
  b: Point[]; // Blue/Yellow
}

export interface FilmProfileDraft {
  id: string; // filename without ext
  page: number;
  bbox: [number, number, number, number]; // x, y, w, h
  chart_type?: string; 
  ocr_text_snippet?: string;
  curves: CurveData;
  status: 'draft' | 'approved' | 'rejected';
}

// --- Final Standard Schema ---

export interface FilmProfile {
  id: string;
  meta: {
    name: string;
    manufacturer: string;
    process: 'C-41' | 'BW' | 'E-6' | 'ECN-2';
    iso: number;
    film_type?: 'negative' | 'reversal' | 'bw_negative';  // Optional, auto-inferred if missing
  };
  physics: {
    structure: 'cubic' | 't-grain' | 'mixed';
    rms?: number;
    resolution?: {
      high: number;
      low: number;
    };
    rgb_to_raw_matrix?: number[][]; // 3x3 matrix
    dye_density?: number[][]; // [WL, C, M, Y, Min, Mid] or similar
    dye_coupling_matrix?: number[]; // 3x3 row-major [m11,m12,m13,m21,m22,m23,m31,m32,m33]
  };
  sensitometry: {
    red: Point[];
    green: Point[];
    blue: Point[];
    gamma_ref?: number;
  };
  spectral: {
    red: Point[];
    green: Point[];
    blue: Point[];
  };
  reciprocity?: {
    schwarzschild_p: number;
    limit_low: number;
  };
  rendering?: {
    tone_mapping?: 'aces' | 'reinhard' | 'simple';
    white_point?: number; // For Reinhard
  };
}
