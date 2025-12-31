
import os
import sys
import csv
import json
import argparse
import numpy as np
from pathlib import Path
from opt_einsum import contract

# Add agx-emulsion to path
current_dir = os.path.dirname(os.path.abspath(__file__))
agx_path = os.path.join(current_dir, '../data/agx-emulsion')
sys.path.append(agx_path)

# Mock OpenImageIO
from unittest.mock import MagicMock
sys.modules['OpenImageIO'] = MagicMock()

try:
    import colour
    from agx_emulsion.config import SPECTRAL_SHAPE
    from agx_emulsion.model.illuminants import standard_illuminant
    # We use Mallett2019 basis for pre-computation as it's standard-ish
    MALLETT2019_BASIS = colour.recovery.MSDS_BASIS_FUNCTIONS_sRGB_MALLETT2019.copy().align(SPECTRAL_SHAPE)
except ImportError as e:
    print(f"Failed to import agx modules: {e}")
    sys.exit(1)

def compute_rgb_to_raw_matrix(log_sensitivity_files):
    # Load sensitivity
    # We need to interpolate log_sensitivity to SPECTRAL_SHAPE
    wavelengths = SPECTRAL_SHAPE.wavelengths
    sensitivities = [] # R, G, B
    
    for channel in ['r', 'g', 'b']:
        filepath = log_sensitivity_files[channel]
        if not os.path.exists(filepath):
            return np.eye(3).tolist() # Fallback
            
        data = []
        with open(filepath, 'r') as f:
            reader = csv.reader(f)
            for row in reader:
                try: 
                    data.append([float(row[0]), float(row[1])])
                except: continue
        data = np.array(data)
        
        # Interp to standard wavelengths
        # log sensitivity -> sensitivity = 10^log
        interp_func = np.interp(wavelengths, data[:,0], data[:,1], left=-100, right=-100)
        sens = 10**interp_func
        sens = np.nan_to_num(sens)
        sensitivities.append(sens)
        
    sensitivity_matrix = np.stack(sensitivities, axis=1) # [WL, 3]

    # Compute Matrix
    # Matrix M such that Raw = RGB * M
    # M_ck = sum_lambda (Basis_c(lambda) * Illuminant(lambda) * Sensitivity_k(lambda))
    
    illuminant = standard_illuminant('D65')[:] # Standard Camera Illuminant?
    # Usually we want the matrix to be 'valid' for a reference. 
    # agx uses D65 or D55 as reference usually. Let's use D65.
    
    basis = MALLETT2019_BASIS.values # [WL, 3]
    
    # M[c, k] = sum( basis[wl, c] * illuminant[wl] * sensitivity[wl, k] )
    # contract 'wc, w, wk -> ck'
    M = contract('wc, w, wk -> ck', basis, illuminant, sensitivity_matrix)
    
    # Normalize? 
    # agx normalizes so midgray (0.184) gives correct exposure. 
    # But usually the matrix itself is what matters. 
    # Let's keep raw matrix. The simulation engine can normalize exposure gain.
    
    return M.tolist()


def load_dye_density(film_dir):
    # We need to load C, M, Y, Min, Mid and interpolate them to SPECTRAL_SHAPE
    wavelengths = SPECTRAL_SHAPE.wavelengths
    
    # Define primary locations
    c_path = os.path.join(film_dir, 'dye_density_c.csv')
    
    # Generic Donor Path (fallback)
    # Use Vision3 500T as generic donor if local dyes missing
    # (Assuming we are in .../data/film/negative/STOCK )
    # donor_dir = .../kodak_vision3_500t
    parent_dir = os.path.dirname(film_dir)
    donor_dir = os.path.join(parent_dir, 'kodak_vision3_500t')
    
    use_donor = False
    if not os.path.exists(c_path):
        if os.path.exists(donor_dir):
            use_donor = True
            # print(f"  Using donor dyes from {os.path.basename(donor_dir)}")
        else:
            # print("  No donor found, using mid/mono approximation")
            pass

    dye_data_cmy = []
    
    # Load C, M, Y
    for chan in ['c', 'm', 'y']:
        path = os.path.join(film_dir, f'dye_density_{chan}.csv')
        if use_donor:
             path = os.path.join(donor_dir, f'dye_density_{chan}.csv')
        
        if os.path.exists(path):
            raw = []
            with open(path, 'r') as f:
                for row in csv.reader(f):
                    try: raw.append([float(row[0]), float(row[1])])
                    except: continue
            raw = np.array(raw)
            # Interp with CLAMPING (left=raw[0], right=raw[-1])
            # np.interp uses left/right for bounds.
            interp = np.interp(wavelengths, raw[:,0], raw[:,1], left=raw[0,1], right=raw[-1,1])
            dye_data_cmy.append(interp)
        else:
            # Fallback to mid if even donor fails or for weird reasons
            mid_path = os.path.join(film_dir, 'dye_density_mid.csv')
            if os.path.exists(mid_path):
               raw = []
               with open(mid_path, 'r') as f:
                   for row in csv.reader(f):
                       try: raw.append([float(x) for x in row])
                       except: continue
               raw = np.array(raw)
               # Use 2nd col (val) for all
               val_col = 1
               if raw.shape[1] >= 4: val_col = {'c':1, 'm':2, 'y':3}[chan]
               
               interp = np.interp(wavelengths, raw[:,0], raw[:,val_col], left=raw[0,val_col], right=raw[-1,val_col])
               dye_data_cmy.append(interp)
            else:
               dye_data_cmy.append(np.zeros_like(wavelengths))

    # Load Base / Min Density
    # Usually 'dye_density_min.csv'
    # If using donor for dyes, should we use donor for base? 
    # Usually Base is specific to stock (acetate/polyester base color).
    # Try local min, then donor min.
    
    min_path = os.path.join(film_dir, 'dye_density_min.csv')
    if not os.path.exists(min_path) and use_donor:
        min_path = os.path.join(donor_dir, 'dye_density_min.csv')
        
    dye_data_base = np.zeros_like(wavelengths)
    if os.path.exists(min_path):
       raw = []
       with open(min_path, 'r') as f:
            for row in csv.reader(f):
                try: raw.append([float(row[0]), float(row[1])])
                except: continue
       raw = np.array(raw)
       dye_data_base = np.interp(wavelengths, raw[:,0], raw[:,1], left=raw[0,1], right=raw[-1,1])

    # Combine
    combined = []
    for i in range(len(wavelengths)):
        row = [wavelengths[i]]
        # C, M, Y
        for d in dye_data_cmy:
            row.append(d[i])
        # Base
        row.append(dye_data_base[i])
        combined.append(row)
        
    return combined

def create_profile_skeleton(slug, film_dir):
    name = slug.replace('_', ' ').title()
    manufacturer = 'Unknown'
    if 'kodak' in slug: manufacturer = 'Kodak'
    elif 'fuji' in slug: manufacturer = 'Fujifilm'
    elif 'ilford' in slug: manufacturer = 'Ilford'

    iso = 100
    if '400' in slug: iso = 400
    elif '800' in slug: iso = 800
    elif '160' in slug: iso = 160
    elif '50' in slug: iso = 50

    process = 'C-41'
    if 'ilford' in slug or 'tmax' in slug or 'tri-x' in slug: process = 'BW'
    
    # Matrix Calc
    log_sens_files = {
        'r': os.path.join(film_dir, 'log_sensitivity_r.csv'),
        'g': os.path.join(film_dir, 'log_sensitivity_g.csv'),
        'b': os.path.join(film_dir, 'log_sensitivity_b.csv')
    }
    rgb_to_raw = compute_rgb_to_raw_matrix(log_sens_files)
    
    # Dye Density
    dye_density = load_dye_density(film_dir)
    
    return {
      "id": slug,
      "meta": {
        "name": name,
        "manufacturer": manufacturer,
        "process": process,
        "iso": iso
      },
      "physics": {
        "rgb_to_raw_matrix": rgb_to_raw,
        "dye_density": dye_density
      },
      "sensitometry": { "red": [], "green": [], "blue": [] },
      "spectral": { "red": [], "green": [], "blue": [] }
    }

def read_csv_points(filepath):
    points = []
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, 'r') as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) >= 2:
                    try:
                        x = float(row[0].strip())
                        y = float(row[1].strip())
                        points.append({"x": x, "y": y})
                    except ValueError:
                        continue
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
    return points

def process_film_dir(film_dir, output_dir):
    slug = os.path.basename(film_dir)
    profile = create_profile_skeleton(slug, film_dir)

    # Sensitometry
    profile['sensitometry']['red'] = read_csv_points(os.path.join(film_dir, 'density_curve_r.csv'))
    profile['sensitometry']['green'] = read_csv_points(os.path.join(film_dir, 'density_curve_g.csv'))
    profile['sensitometry']['blue'] = read_csv_points(os.path.join(film_dir, 'density_curve_b.csv'))

    # Spectral
    profile['spectral']['red'] = read_csv_points(os.path.join(film_dir, 'log_sensitivity_r.csv'))
    profile['spectral']['green'] = read_csv_points(os.path.join(film_dir, 'log_sensitivity_g.csv'))
    profile['spectral']['blue'] = read_csv_points(os.path.join(film_dir, 'log_sensitivity_b.csv'))
    
    has_sens = len(profile['sensitometry']['red']) > 0
    
    if has_sens:
        output_file = os.path.join(output_dir, f"{slug}.json")
        with open(output_file, 'w') as f:
            json.dump(profile, f, indent=2)
        print(f"Imported {slug} with Physics Data")
    else:
        print(f"Skipping {slug}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", help="Path to agx-emulsion data/film directory")
    parser.add_argument("--output", default="public/profiles", help="Output directory for JSON profiles")
    args = parser.parse_args()

    if not os.path.exists(args.output):
        os.makedirs(args.output)

    for root, dirs, files in os.walk(args.input_dir):
        if any(f.endswith('density_curve_r.csv') for f in files):
            process_film_dir(root, args.output)
