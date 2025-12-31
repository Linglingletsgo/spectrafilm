'use client';

import { useState, useEffect, useRef } from 'react';
import { SimulationEngine } from '@/lib/simulation/engine';
import { FilmProfile } from '@/lib/types';
// @ts-ignore
import UTIF from 'utif';
import { LibRaw } from 'libraw-mini';
import { applyToneMapping } from '@/lib/simulation/tonemapping';
import { applyDyeCoupling, applyDyeCouplingToDensity, getDyeCouplingMatrix, IDENTITY_MATRIX } from '@/lib/simulation/dye-coupling';
import { applyPhysicalGrain } from '@/lib/simulation/grain';
import { applyRedHalation } from '@/lib/simulation/halation';
import { applyPyramidBloom } from '@/lib/simulation/bloom';


export default function Workbench() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [profile, setProfile] = useState<FilmProfile | null>(null);
  const [profileId, setProfileId] = useState<string>(''); // New state for selected profile ID
  const [exposure, setExposure] = useState<number>(0);
  const [bloomStrength, setBloomStrength] = useState<number>(0.12);
  const [preserveExposure, setPreserveExposure] = useState<boolean>(true);
  const [useAutoExposure, setUseAutoExposure] = useState<boolean>(true);
  const [processing, setProcessing] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [profilesList, setProfilesList] = useState<string[]>([]);

  // We need to keep the raw file too for cleaner loading
  const [imageFile, setImageFile] = useState<File | null>(null);

  useEffect(() => {
    // Load list of available profiles
    fetch('/profiles/index.json')
      .then(res => res.json())
      .then((list: string[]) => {
          setProfilesList(list);
          if (list.length > 0 && !profileId) { // Use profileId here
              setProfileId(list[0]); // Set the first profile as default
          }
      })
      .catch(e => {
          console.error("Failed to load profiles index:", e);
          setProfilesList(['kodak_portra_400']);
          if (!profileId) {
              setProfileId('kodak_portra_400');
          }
      });
  }, []);

  // Effect to load profile data when profileId changes
  useEffect(() => {
      async function loadProfileData(id: string) {
          if (!id) {
              setProfile(null);
              return;
          }
          try {
              const res = await fetch(`/profiles/${id}.json`);
              if (!res.ok) throw new Error("Failed to load profile");
              const data: FilmProfile = await res.json();
              setProfile(data);
          } catch (e) {
              console.error(e);
              setProfile(null);
          }
      }
      loadProfileData(profileId);
  }, [profileId]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

     setImageFile(file);
    
    // Preview
    // Note: RAW previews are usually small thumbnails, but we use the main reader for UI feedback
    const reader = new FileReader();
    reader.onload = (evt) => {
      setImageSrc(evt.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  async function processImage() {
     if (!canvasRef.current || !imageFile || !profile) return;
     
     setProcessing(true);
     
     try {
         let width = 0;
         let height = 0;
         let pixelData: Float32Array; 

         const ext = imageFile.name.split('.').pop()?.toLowerCase();
         // Supported RAW formats
         if (!['arw', 'cr2', 'nef', 'dng', 'raf', 'orf'].includes(ext || '')) {
             throw new Error("Only RAW formats (ARW, CR2, NEF, DNG, RAF, ORF) are supported.");
         }

         const buffer = await imageFile.arrayBuffer();
         
         console.log("[DEBUG] Initializing LibRaw WASM...");
         const libraw = await new LibRaw();
         
         try {
             console.log("[DEBUG] Opening RAW file...");
             const openResult = await libraw.open(buffer, {
                 gamma: [1.0, 1.0], // Force linear output
                 no_auto_bright: 1, // Disable auto-brightness to preserve physical response
                 use_camera_wb: 1  // Use camera white balance as starting point
             });
             
             if (openResult !== 0 && openResult !== undefined && openResult !== null) {
                  throw new Error("LibRaw open failed with code: " + openResult);
             }
             
             console.log("[DEBUG] Decoding image data (getimage)...");
             const memImg = await libraw.getimage((progress: number, msg: string) => {
                 console.log(`[LIBRAW PROGRESS] ${progress}%: ${msg}`);
             });
             
             if (!memImg || !memImg.data) {
                 console.error("[ERROR] LibRaw returned empty image data.");
                 throw new Error("LibRaw failed to decode image. Please check if the file is a valid and supported RAW format.");
             }
             
             width = memImg.width;
             height = memImg.height;
             
             const rawData = memImg.data;
             const totalPixels = width * height;
             
             pixelData = new Float32Array(totalPixels * 4);
             
             for (let i = 0; i < totalPixels; i++) {
                 const idx = i * 4;
                 pixelData[idx]     = rawData[idx] / 255.0;     
                 pixelData[idx + 1] = rawData[idx + 1] / 255.0; 
                 pixelData[idx + 2] = rawData[idx + 2] / 255.0; 
                 pixelData[idx + 3] = 1.0;                       
             }
         } finally {
             console.log("[DEBUG] Closing LibRaw instance...");
             libraw.close();
         }

         // Setup Canvas for Output
         const ctx = canvasRef.current!.getContext('2d');
         canvasRef.current!.width = width;
         canvasRef.current!.height = height;

         // Log User Options
          console.log(`\n========== SIMULATION OPTIONS ==========`);
          console.log(`Profile:        ${profile.meta?.name} (${profile.id})`);
          console.log(`Exposure (EV):  ${exposure.toFixed(2)}`);
          console.log(`Bloom:          ${bloomStrength.toFixed(2)}`);
          console.log(`Preserve Exp:   ${preserveExposure ? "ON" : "OFF"}`);
          console.log(`Auto-AE:        ${useAutoExposure ? "ON (Gray 25%)" : "OFF"}`);
          console.log(`========================================\n`);

          const engine = new SimulationEngine(profile);
          const filmType = engine.getFilmType();
          const isBW = filmType === 'bw_negative';
          const outputBuffer = new Uint8ClampedArray(width * height * 4);

         // Get dye coupling matrix (optional)
         const dyeMatrix = profile.physics?.dye_coupling_matrix || getDyeCouplingMatrix(profile.id);
         
         // Get tone mapping mode
         const toneMode = profile.rendering?.tone_mapping || 'linear';  // Default: lossless
         const useACES = toneMode === 'aces';
         const useLinear = toneMode === 'linear';

         console.log(`[INFO] Tone mapping mode: ${toneMode}`);
         
         // [NEW] Auto-Exposure Calculation (Scene Luminance Analysis)
         let autoExposureBias = 0.0;
         if (useAutoExposure) {
             let logLuxSum = 0;
             const epsilon = 0.0001;
             // Stride for performance (sample every 100th pixel)
             const stride = 100 * 4;
             let count = 0;
             
             for (let i = 0; i < pixelData.length; i += stride) {
                 const r = pixelData[i];
                 const g = pixelData[i+1];
                 const b = pixelData[i+2];
                 // Rec. 709 Luminance weights
                 const lux = r * 0.2126 + g * 0.7152 + b * 0.0722;
                 // Use log-average (Geometric Mean) for better perceptional mapping
                 logLuxSum += Math.log(Math.max(epsilon, lux));
                 count++;
             }
             
             const logAvgLux = Math.exp(logLuxSum / count);
             const targetLux = 0.25; // Brighter modern baseline (up from 0.18)
             
             if (logAvgLux > epsilon) {
                 autoExposureBias = Math.log2(targetLux / logAvgLux);
                 console.log(`[AUTO EXPOSURE] Log-Avg Lux: ${logAvgLux.toFixed(4)}, Bias: ${autoExposureBias.toFixed(2)} EV`);
             }
         }
         
         const totalExposure = exposure + autoExposureBias;

         // Saturation statistics
         let inputSatSum = 0, outputSatSum = 0;
         let satAfterExpose = 0, satAfterDevelop = 0, satAfterScan = 0, satAfterInvert = 0;
         let pixelCount = 0;
         
         // Sample RGB values for debugging
         const samplePixels = [];
         const sampleInterval = Math.floor(pixelData.length / (4 * 5)); // 5 samples
         
         // Helper: Calculate saturation in HSV
         const getSaturation = (r: number, g: number, b: number): number => {
             const max = Math.max(r, g, b);
             const min = Math.min(r, g, b);
             if (max === 0) return 0;
             return (max - min) / max;
         };
         
         // Helper: Boost saturation to restore color lost in invert() stage
         // Uses HSL color space for perceptually uniform saturation adjustment
         const boostSaturation = (r: number, g: number, b: number, factor: number): [number, number, number] => {
             // RGB to HSL conversion
             const max = Math.max(r, g, b);
             const min = Math.min(r, g, b);
             const l = (max + min) / 2;
             
             if (max === min) {
                 // Achromatic - no saturation to boost
                 return [r, g, b];
             }
             
             const d = max - min;
             let s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
             let h = 0;
             
             if (max === r) {
                 h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
             } else if (max === g) {
                 h = ((b - r) / d + 2) / 6;
             } else {
                 h = ((r - g) / d + 4) / 6;
             }
             
             // Boost saturation
             s = Math.min(1, s * factor);
             
             // HSL to RGB conversion
             const hue2rgb = (p: number, q: number, t: number): number => {
                 if (t < 0) t += 1;
                 if (t > 1) t -= 1;
                 if (t < 1/6) return p + (q - p) * 6 * t;
                 if (t < 1/2) return q;
                 if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                 return p;
             };
             
             if (s === 0) {
                 return [l, l, l];
             }
             
             const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
             const p = 2 * l - q;
             
             return [
                 hue2rgb(p, q, h + 1/3),
                 hue2rgb(p, q, h),
                 hue2rgb(p, q, h - 1/3)
             ];
         };
         
         // First pass: collect density statistics per channel for Auto-Levels
         const densitiesR: number[] = [];
         const densitiesG: number[] = [];
         const densitiesB: number[] = [];
         
         for (let i = 0; i < pixelData.length; i += 4) {
             const r = Math.pow(pixelData[i], 2.2);
             const g = Math.pow(pixelData[i+1], 2.2);
             const b = Math.pow(pixelData[i+2], 2.2);
             
             // Stage 1: Input (scene linear)
             const inputSat = getSaturation(r, g, b);
             inputSatSum += inputSat;
             
             // Stage 2: After exposure (log space)
             const logExp = engine.expose([r, g, b], totalExposure);
             
             // Stage 3: After development (CMY density)
             const cmyDensity = engine.develop(logExp);
             satAfterDevelop += getSaturation(cmyDensity[0], cmyDensity[1], cmyDensity[2]);
             
             // Stage 4: After scan (RGB transmittance)
             const scanned = engine.scan(cmyDensity);
             satAfterScan += getSaturation(scanned[0], scanned[1], scanned[2]);
             
             // Stage 5: Conditional inversion based on film type
             let finalDensity: [number, number, number];
             const filmTypeFirstPass = engine.getFilmType();
             
             if (filmTypeFirstPass === 'reversal') {
                 // Reversal film: use scanned transmittance directly
                 finalDensity = scanned;
                 satAfterInvert += getSaturation(scanned[0], scanned[1], scanned[2]);
             } else {
                 // Negative film: invert to positive density
                 const inverted = engine.invert(scanned);
                 satAfterInvert += getSaturation(inverted[0], inverted[1], inverted[2]);
                 
                 if (dyeMatrix !== IDENTITY_MATRIX) {
                     finalDensity = applyDyeCouplingToDensity(inverted, dyeMatrix);
                 } else {
                     finalDensity = inverted;
                 }
             }
             
             // Collect per-channel densities
             densitiesR.push(finalDensity[0]);
             densitiesG.push(finalDensity[1]);
             densitiesB.push(finalDensity[2]);
             
             pixelCount++;
             
             // Collect samples
             if (i % sampleInterval === 0 && samplePixels.length < 5) {
                 samplePixels.push({
                     input: [r, g, b],
                     scanned: scanned,
                     inverted: finalDensity,  // Use finalDensity (which may or may not be inverted)
                     baseResponse: engine.baseResponse
                 });
             }

         }
         
         // Adaptive normalization: Independent Auto-Levels per channel
         // This fixes the saturation loss caused by the Orange Mask compressing Blue/Green contrast
         densitiesR.sort((a, b) => a - b);
         densitiesG.sort((a, b) => a - b);
         densitiesB.sort((a, b) => a - b);
         
         let rangeR, rangeG, rangeB;
         
         if (preserveExposure) {
             if (filmType === 'reversal') {
                 // Reversal film: Transmittance is already positive. 
                 // We use a fixed [0, 1] range without subtrative offsetting.
                 rangeR = { min: 0.0, max: 1.0, scale: 1.0 };
                 rangeG = { min: 0.0, max: 1.0, scale: 1.0 };
                 rangeB = { min: 0.0, max: 1.0, scale: 1.0 };
                 console.log(`[PRESERVE EXPOSURE] Reversal Mode: Fixed [0, 1] range`);
             } else {
                 // [NEW] Subtractive Color Balance for Fixed Exposure
                 // Cinema films (ECN-2) often have dense masks that result in offsets.
                 // We align the "black base" (0.5th percentile) to 0 density while keeping a fixed 2.7 range.
                 const idxLow = Math.floor(densitiesR.length * 0.005);
                 
                 const offsetR = densitiesR[idxLow] || 0.0;
                 const offsetG = densitiesG[idxLow] || 0.0;
                 const offsetB = densitiesB[idxLow] || 0.0;

                 const FIXED_MAX = 2.7; // Standard "Paper White" density
                 const fixedScale = 1.0 / FIXED_MAX;
                 
                 rangeR = { min: offsetR, max: offsetR + FIXED_MAX, scale: fixedScale };
                 rangeG = { min: offsetG, max: offsetG + FIXED_MAX, scale: fixedScale };
                 rangeB = { min: offsetB, max: offsetB + FIXED_MAX, scale: fixedScale };
                 
                 console.log(`[PRESERVE EXPOSURE] Subtractive Balance (Black Point): [${offsetR.toFixed(3)}, ${offsetG.toFixed(3)}, ${offsetB.toFixed(3)}]`);
             }
         } else {
             // Adaptive Auto-Levels
             // Percentiles (looser for simple/aces, absolute for linear)
             const pHigh = useLinear ? 1.0 : 0.995;
             const pLow = useLinear ? 0.0 : 0.005;
             
             const idxHigh = Math.floor(densitiesR.length * pHigh) - 1;
             const idxLow = Math.floor(densitiesR.length * pLow);
             
             // Calculate per-channel range
             const getRange = (arr: number[]) => {
                 const min = arr[idxLow] || 0;
                 const max = arr[idxHigh] || 3.0;
                 const range = max - min;
                 return { min, max, scale: range > 0.001 ? 1.0 / range : 1.0 };
             };
             
             rangeR = getRange(densitiesR);
             rangeG = getRange(densitiesG);
             rangeB = getRange(densitiesB);
             
             console.log(`[AUTO LEVELS] R: ${rangeR.min.toFixed(3)}-${rangeR.max.toFixed(3)} (x${rangeR.scale.toFixed(2)})`);
             console.log(`[AUTO LEVELS] G: ${rangeG.min.toFixed(3)}-${rangeG.max.toFixed(3)} (x${rangeG.scale.toFixed(2)})`);
             console.log(`[AUTO LEVELS] B: ${rangeB.min.toFixed(3)}-${rangeB.max.toFixed(3)} (x${rangeB.scale.toFixed(2)})`);
         }
         // Calculate adaptive saturation restoration factor
         // Goal: compensate for saturation loss so final output ≈ input saturation
         const avgInputSatFirstPass = inputSatSum / pixelCount;
         const avgAfterInvertFirstPass = satAfterInvert / pixelCount;
         
         // Factor = input / afterInvert, with safety bounds
         // Multiply by additional compensation factor (1.5) to account for gamma encoding losses
         const rawFactor = avgAfterInvertFirstPass > 0.001 
             ? avgInputSatFirstPass / avgAfterInvertFirstPass 
             : 1.0;
         const SATURATION_RESTORE_FACTOR = Math.min(Math.max(rawFactor * 1.5, 1.0), 5.0);
         
         console.log(`[SATURATION] Auto-calculated factor: ${SATURATION_RESTORE_FACTOR.toFixed(2)} (raw: ${rawFactor.toFixed(2)})`);
         
         
         // Second pass: Render to Linear Buffer
         const linearBuffer = new Float32Array(pixelData.length);
         
         for (let i = 0; i < pixelData.length; i += 4) {
             const r = Math.pow(pixelData[i], 2.2);
             const g = Math.pow(pixelData[i+1], 2.2);
             const b = Math.pow(pixelData[i+2], 2.2);
             
             // Full film simulation pipeline
             // Use totalExposure (User + Auto)
             const res = engine.processPixel([r, g, b], totalExposure);
             
             // Conditional processing based on film type
             let processed: [number, number, number];
             
             if (filmType === 'reversal') {
                 // Reversal film: Transmittance IS proper positive image
                 processed = res;
             } else {
                 // Negative film (Color & B/W): Needs inversion
                 processed = engine.invert(res);
             }
             
             // CMY Dye Coupling 
             // - Skip for Reversal (no masking/coupling usually modeled this way)
             // - Skip for B&W (silver density only, no color dyes)
             if (!isBW && filmType !== 'reversal' && dyeMatrix !== IDENTITY_MATRIX) {
                 processed = applyDyeCouplingToDensity(processed, dyeMatrix);
             }

             // Red Halation Simulation (mainly for Color Negative)
             let R_h = processed[0], G_h = processed[1], B_h = processed[2];
             
             if (!isBW && filmType !== 'reversal') {
                 [R_h, G_h, B_h] = applyRedHalation(processed[0], processed[1], processed[2], {
                     strength: 0.15,
                     radius: 1.5
                 });
             }
             
             // Per-Channel Adaptive normalization (Auto-Contrast / Auto-White-Balance)
             linearBuffer[i]   = (R_h - rangeR.min) * rangeR.scale;
             linearBuffer[i+1] = (G_h - rangeG.min) * rangeG.scale;
             linearBuffer[i+2] = (B_h - rangeB.min) * rangeB.scale;
             linearBuffer[i+3] = 1.0;
         }

         // [NEW] Phase 1: Pyramid Bloom (applied in linear space)
         const bloomedBuffer = applyPyramidBloom(linearBuffer, width, height, {
             strength: bloomStrength,
             threshold: 0.65,
             radius: 2.0
         });

         // Third pass: Final display encoding
         for (let i = 0; i < pixelData.length; i += 4) {
             let R_linear = bloomedBuffer[i];
             let G_linear = bloomedBuffer[i+1];
             let B_linear = bloomedBuffer[i+2];

             // Display encoding
             let R_display, G_display, B_display;
             
             if (useLinear) {
                 R_display = Math.pow(Math.max(0, Math.min(1, R_linear)), 1/2.2);
                 G_display = Math.pow(Math.max(0, Math.min(1, G_linear)), 1/2.2);
                 B_display = Math.pow(Math.max(0, Math.min(1, B_linear)), 1/2.2);
             } else if (useACES) {
                 R_display = applyToneMapping(R_linear, 'aces');
                 G_display = applyToneMapping(G_linear, 'aces');
                 B_display = applyToneMapping(B_linear, 'aces');
             } else {
                 R_display = Math.pow(Math.max(0, Math.min(1, R_linear)), 1/2.2);
                 G_display = Math.pow(Math.max(0, Math.min(1, G_linear)), 1/2.2);
                 B_display = Math.pow(Math.max(0, Math.min(1, B_linear)), 1/2.2);
             }
             
             // Saturation restoration
             // SKIP for B&W (keep it grayscale)
             let R_final = R_display, G_final = G_display, B_final = B_display;
             
             if (!isBW) {
                 [R_final, G_final, B_final] = boostSaturation(R_display, G_display, B_display, SATURATION_RESTORE_FACTOR);
             } else {
                 // Force strict grayscale for B&W in case of slight drift
                 const luma = R_display * 0.299 + G_display * 0.587 + B_display * 0.114;
                 R_final = luma;
                 G_final = luma;
                 B_final = luma;
             }

             // [NEW] Phase 4: Film Grain (Physical Clusters)
             // Apply after display encoding because grain generator expects perceptual values for midtone targeting
             const pixelIdx = i / 4;
             const px = pixelIdx % width;
             const py = Math.floor(pixelIdx / width);
             
             [R_final, G_final, B_final] = applyPhysicalGrain(
                 R_final, G_final, B_final, 
                 px, py, 
                 {
                     iso: profile.meta?.iso || 100,
                     monochrome: isBW // Enforce mono grain for BW film
                 }
             );

             // Output saturation
             outputSatSum += getSaturation(R_final, G_final, B_final);
             
             // Dithering (breaks up quantization banding and subtle diagonal contour lines)
             const dither = (Math.random() - 0.5) / 255.0;
             outputBuffer[i]   = Math.max(0, Math.min(255, (R_final + dither) * 255));
             outputBuffer[i+1] = Math.max(0, Math.min(255, (G_final + dither) * 255));
             outputBuffer[i+2] = Math.max(0, Math.min(255, (B_final + dither) * 255));
             outputBuffer[i+3] = 255;
         }
         
         // Report saturation statistics
         const avgInputSat = inputSatSum / pixelCount;
         const avgOutputSat = outputSatSum / pixelCount;
         const avgAfterDevelop = satAfterDevelop / pixelCount;
         const avgAfterScan = satAfterScan / pixelCount;
         const avgAfterInvert = satAfterInvert / pixelCount;
         
         const totalLoss = ((avgInputSat - avgOutputSat) / avgInputSat * 100).toFixed(1);
         
         console.log(`\n========== SATURATION ANALYSIS ==========`);
         console.log(`Input (Scene):        ${(avgInputSat * 100).toFixed(1)}%`);
         console.log(`After Development:    ${(avgAfterDevelop * 100).toFixed(1)}% (${((avgAfterDevelop - avgInputSat) / avgInputSat * 100).toFixed(1)}%)`);
         console.log(`After Scan:           ${(avgAfterScan * 100).toFixed(1)}% (${((avgAfterScan - avgInputSat) / avgInputSat * 100).toFixed(1)}%)`);
         console.log(`After Invert:         ${(avgAfterInvert * 100).toFixed(1)}% (${((avgAfterInvert - avgInputSat) / avgInputSat * 100).toFixed(1)}%)`);
         console.log(`Final Output:         ${(avgOutputSat * 100).toFixed(1)}% (${totalLoss}%) [Auto-restored]`);
         console.log(`\n[REFERENCE] Normal range: 5-15% loss for modern film`);
         console.log(`[INFO] Auto saturation factor: ${SATURATION_RESTORE_FACTOR.toFixed(2)} (raw: ${rawFactor.toFixed(2)})`);
         console.log(`==========================================\n`);
         
         // Output sample pixel values
         console.log(`\n========== SAMPLE PIXEL VALUES ==========`);
         samplePixels.forEach((sample, idx) => {
             console.log(`Sample ${idx + 1}:`);
             console.log(`  Input:        [${sample.input.map(v => v.toFixed(3)).join(', ')}]`);
             console.log(`  Scanned:      [${sample.scanned.map(v => v.toFixed(3)).join(', ')}]`);
             console.log(`  Inverted:     [${sample.inverted.map(v => v.toFixed(3)).join(', ')}]`);
             console.log(`  BaseResponse: [${sample.baseResponse.map(v => v.toFixed(3)).join(', ')}]`);
         });
         console.log(`==========================================\n`);

         
         const newImageData = new ImageData(outputBuffer, width, height);
         ctx!.putImageData(newImageData, 0, 0);
         
     } catch (e) {
         console.error("Processing failed:", e);
         alert("Error during processing: " + (e as Error).message);
     } finally {
         setProcessing(false);
     }
  }

     const downloadTiff = () => {
         if (!canvasRef.current || !profile) return;
         
         const canvas = canvasRef.current;
         const ctx = canvas.getContext('2d');
         if (!ctx) return;
         
         const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
         const rgba = imageData.data;
         
         // Convert RGBA to TIFF using UTIF
         // rgba is Uint8ClampedArray, UTIF.encodeImage expects ArrayBuffer
         const buffer = rgba.buffer;
         const tiffBytes = UTIF.encodeImage(buffer, canvas.width, canvas.height);
         const blob = new Blob([tiffBytes], { type: 'image/tiff' });
         
         // Professional naming: SpectraFilm_[Profile]_[EV]EV_[Timestamp].tif
         const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
         const evString = exposure >= 0 ? `+${exposure.toFixed(1)}` : `${exposure.toFixed(1)}`;
         const filename = `SpectraFilm_${profile.id}_${evString}EV_${timestamp}.tif`;
         
         const link = document.createElement('a');
         link.href = URL.createObjectURL(blob);
         link.download = filename;
         link.click();
     };

   return (
    <div className="min-h-screen bg-white text-black p-8 font-serif">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12">
        {/* Controls */}
        <div className="space-y-8">
             <header className="mb-12">
               <h1 className="text-4xl font-bold tracking-tight mb-2">SPECTRA FILM</h1>
               <p className="text-gray-500 italic">Advanced Physical Simulation Lab</p>
             </header>

             <div title="上传 RAW 图像进行胶片模拟 (ARW, CR2, NEF, DNG, RAF, ORF)">
                <label className="block text-sm font-medium mb-2 uppercase tracking-widest text-gray-400">1. Input RAW Image</label>
                <input 
                  type="file" 
                  accept=".dng,.arw,.cr2,.nef,.raf,.orf"
                  onChange={handleFileUpload}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-black file:text-white hover:file:bg-gray-800"
                />
             </div>

             <div title="选择胶片预设，包含彩色负片、反转片、电影胶片及黑白胶片">
                <label className="block text-sm font-medium mb-2 uppercase tracking-widest text-gray-400">2. Film Profile</label>
                <select 
                  value={profileId} 
                  onChange={(e) => setProfileId(e.target.value)}
                  className="w-full p-2 border rounded bg-white"
                >
                   <optgroup label="🎞️ Color Negative (C-41)">
                       {profilesList.filter(id => 
                           !id.includes('provia') && 
                           !id.includes('velvia') && 
                           !id.includes('ektachrome') &&
                           !id.includes('vision3') &&
                           !id.includes('tri-x') &&
                           !id.includes('hp5') &&
                           !id.includes('tmax') &&
                           !id.includes('bw')
                       ).map(id => <option key={id} value={id}>{id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
                   </optgroup>
                   <optgroup label="📷 Reversal / Slide (E-6)">
                       {profilesList.filter(id => 
                           id.includes('provia') || 
                           id.includes('velvia') || 
                           id.includes('ektachrome')
                       ).map(id => <option key={id} value={id}>{id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
                   </optgroup>
                   <optgroup label="🎬 Cinema (ECN-2)">
                       {profilesList.filter(id => id.includes('vision3')).map(id => <option key={id} value={id}>{id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
                   </optgroup>
                   <optgroup label="⚪ Black & White (B&W)">
                       {profilesList.filter(id => 
                           id.includes('tri-x') || 
                           id.includes('hp5') || 
                           id.includes('tmax') || 
                           id.includes('bw')
                       ).map(id => <option key={id} value={id}>{id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
                   </optgroup>
               </select>
            </div>
                        <div title="手动调整曝光补偿 (EV)">
                <label className="block text-sm font-medium mb-2 uppercase tracking-widest text-gray-400">3. Exposure (EV)</label>
                <input 
                  type="range" min="-3" max="3" step="0.5" 
                  value={exposure} 
                  onChange={(e) => setExposure(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between items-center text-xs text-gray-500 mt-1">
                    <span>{exposure} EV (Manual)</span>
                    <label className="flex items-center space-x-1 cursor-pointer" title="基于 25% 灰度目标自动优化场景亮度">
                        <input 
                            type="checkbox" 
                            checked={useAutoExposure} 
                            onChange={(e) => setUseAutoExposure(e.target.checked)}
                        />
                        <span>Auto-Expose (Gray 25%)</span>
                    </label>
                </div>
            </div>

            <div title="模拟高光溢出效果（金字塔模糊算法）">
                <label className="block text-sm font-medium mb-2 uppercase tracking-widest text-gray-400">4. Bloom Strength</label>
                <input 
                  type="range" min="0" max="0.5" step="0.01" 
                  value={bloomStrength} 
                  onChange={(e) => setBloomStrength(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="text-right text-xs text-gray-500">{(bloomStrength * 100).toFixed(0)}%</div>
            </div>

            <div className="flex items-center gap-2" title="禁用自动增益，使用物理正确的减量色彩平衡，适合追求真实胶片扫描效果">
                <input 
                  type="checkbox" 
                  id="preserveExposure"
                  checked={preserveExposure} 
                  onChange={(e) => setPreserveExposure(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="preserveExposure" className="text-sm font-medium uppercase tracking-widest text-gray-400">Preserve Original Exposure</label>
            </div>
                      <button 
              onClick={processImage}
              disabled={!imageSrc || !profile || processing}
              className="w-full bg-black text-white py-3 rounded hover:bg-gray-800 disabled:opacity-50 font-bold tracking-widest"
              title="开始物理胶片显影与扫描模拟"
            >
              {processing ? 'DEVELOPING...' : 'DEVELOP & SCAN'}
            </button>

            {imageSrc && !processing && (
                <button 
                    onClick={downloadTiff}
                    className="w-full bg-white text-black py-3 rounded border border-black hover:bg-gray-100 font-bold tracking-widest mt-4"
                    title="下载无损 TIFF 格式文件，保留最大位深与细节"
                >
                    DOWNLOAD LOSSLESS (TIFF)
                </button>
            )}
         </div>

        {/* Viewport */}
        <div className="md:col-span-2 flex flex-col min-h-0">
             <div className="flex-grow border-2 border-dashed border-gray-200 rounded-lg min-h-[500px] max-h-[85vh] flex items-center justify-center bg-gray-900 shadow-inner overflow-hidden p-4">
                     {imageSrc ? (
                         <div className="w-full h-full flex items-center justify-center">
                            <canvas 
                                ref={canvasRef} 
                                className="shadow-2xl"
                                style={{ 
                                    display: 'block', 
                                    maxWidth: '100%', 
                                    maxHeight: '100%', 
                                    width: 'auto', 
                                    height: 'auto' 
                                }} 
                            />
                         </div>
                     ) : (
                     <div className="text-gray-400">Preview Area (RAW Only)</div>
                 )}
             </div>
             <p className="text-center text-xs text-gray-400 font-sans italic mt-2">
                Note: Preview is scaled for display. Exported TIFF will retain original resolution.
             </p>
        </div>
      </div>
    </div>
  );
}
