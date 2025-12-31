
import fs from 'fs';
import path from 'path';
import { SimulationEngine } from './engine';
import { FilmProfile } from '../types';

const profilePath = path.join(process.cwd(), 'data/profiles/kodak_portra_400.json');

try {
    const rawData = fs.readFileSync(profilePath, 'utf-8');
    const profile: FilmProfile = JSON.parse(rawData);
    
    console.log(`Loaded Profile: ${profile.meta.name}`);
    
    const engine = new SimulationEngine(profile);
    
    // Test Pixel: Middle Gray
    const inputRGB: [number, number, number] = [0.18, 0.18, 0.18];
    console.log(`Input RGB: ${inputRGB}`);
    
    const outputRGB = engine.processPixel(inputRGB, 0); // 0 EV
    const positive0 = engine.invert(outputRGB);
    console.log(`Scan RGB (0 EV): ${outputRGB.map(v => v.toFixed(8))}`);
    console.log(`Positive Density (0 EV): ${positive0.map(v => v.toFixed(4))}`);
    
    const outputRGB_plus1 = engine.processPixel(inputRGB, 1); // +1 EV
    const positive1 = engine.invert(outputRGB_plus1);
    console.log(`Scan RGB (+1 EV): ${outputRGB_plus1.map(v => v.toFixed(8))}`);
    console.log(`Positive Density (+1 EV): ${positive1.map(v => v.toFixed(4))}`);

} catch (e) {
    console.error("Error running simulation:", e);
}
