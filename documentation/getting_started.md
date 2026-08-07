# Setup & Development Guide

Follow this guide to set up the development environment, configure dependency paths, run Cadanest locally, and compile production build releases.

---

## 1. System Requirements

- **Operating System:** Windows (required for Solid Edge COM automation and OLE file format scanning).
- **Node.js:** version 18.x or higher.
- **Python:** Python 3.11 (matching the Python runtime compiled into FreeCAD 1.1).
- **FreeCAD:** version 1.1.1.

---

## 2. Dependency Setup

### 2.1 Node.js Dependencies
Clone the repository and install npm packages:
```bash
npm install
```

### 2.2 FreeCAD & Python Environment
Cadanest relies on FreeCAD and Open Cascade (OCC) wrappers to analyze 3D geometry.
There are two ways to resolve these dependencies:

#### Option A: Portable Package (Recommended)
1. Download the portable version of FreeCAD 1.1 for Windows.
2. Extract the folder and rename it to: `FreeCAD_1.1.1-Windows-x86_64-py311`
3. Place this directory directly inside the project root workspace:
   ```text
   Cadanest/
   ├── FreeCAD_1.1.1-Windows-x86_64-py311/
   │   ├── bin/
   │   │   ├── python.exe
   │   │   ├── FreeCAD.exe
   │   │   └── ... (DLLs and libraries)
   ```
4. Cadanest will automatically detect this portable structure and run python scripts using the bundled `bin/python.exe`.

#### Option B: System Installation
1. Install FreeCAD 1.1 to the default system directory: `C:\Program Files\FreeCAD 1.1`.
2. Verify that the files exist under `C:\Program Files\FreeCAD 1.1\bin\`.
3. The background scripts will automatically fall back to this folder if the portable folder is not present.

### 2.3 Required Python Libraries
Install the necessary geometry and parsing libraries in your active Python/FreeCAD environment. If using Option B:
```bash
pip install shapely ezdxf olefile
```
If using Option A, make sure to execute pip commands referencing the portable environment:
```bash
cd FreeCAD_1.1.1-Windows-x86_64-py311/bin
./python.exe -m pip install shapely ezdxf olefile
```

---

## 3. Running the App Locally

Development requires running the Vite dev server and the Electron shell simultaneously.

### Step 1: Start the Web App Server
In the first terminal window, start the frontend compiler:
```bash
npm run dev
```
This boots Vite and serves the React dashboard at `http://localhost:5173`.

### Step 2: Launch Electron Shell
In a second terminal window, run:
```bash
npm run electron
```
This compiles the TypeScript files in `src-electron/` into JavaScript inside `dist-electron/`, and starts the Electron frame targeting `http://localhost:5173`.

---

## 4. Production Packaging & Building

To bundle the application into a distribution:
```bash
npm run build
```
This runs the following steps:
1. Compiles frontend TSX files via Vite: outputs static files to `dist/`.
2. Compiles Electron backend TypeScript files: outputs scripts to `dist-electron/`.

---

## 5. Troubleshooting Common Issues

### 5.1 FreeCAD Import Errors
**Symptom:** IPC returns `Failed to import FreeCAD libraries`.
- **Cause:** Python path resolution could not find the FreeCAD `bin/` folder, or the running Python compiler version does not match FreeCAD's Python binaries (e.g. using Python 3.12 instead of 3.11).
- **Solution:** Verify the path to `FreeCAD_1.1.1-Windows-x86_64-py311` or confirm `C:\Program Files\FreeCAD 1.1` exists. Ensure the executable run by Electron is indeed the Python 3.11 executable included in FreeCAD's installation.

### 5.2 Shapely Installation Fails on Windows
**Symptom:** Errors when compiling shapely or importing geometry modules.
- **Cause:** Shapely requires GEOS C++ libraries, which are sometimes difficult to compile from source on Windows.
- **Solution:** Install using pre-compiled wheels:
  ```bash
  pip install --only-binary :all: shapely
  ```

### 5.3 Siemens Solid Edge OLE COM Timeout
**Symptom:** Batch imports of `.psm` files time out.
- **Cause:** The background Solid Edge COM process is blocked (e.g., waiting for a user prompt, or licensed version is displaying an expiration dialogue).
- **Solution:** Open Solid Edge manually, resolve any alerts or license warnings, and keep the application running in the task manager before launching batch processing in Cadanest.
