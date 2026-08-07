# CADANEST — Engineering Rules & Development Constraints

This document outlines the coding standards, structural rules, and validation guidelines enforced across the CADANEST codebase.

---

## 1. Zero-Regression & Accuracy Rule

- All mathematical calculations for bend allowances, neutral axis offsets, setbacks, and $K$-factors must maintain exact alignment with OpenCASCADE B-Rep analytical calculations.
- Unfolded flat pattern bounding dimensions must maintain **0.00 mm** error margin against reference DXFs.
- Hole cutout counts and coordinates must match 100% without dropped holes or distorted arcs.

---

## 2. IPC Communication Guidelines

- The Python daemon (`backend/daemon.py`) must operate continuously over stdio using line-delimited JSON-RPC messages.
- Subprocesses should NEVER be launched per operation; all CAD requests must route through the warm stdio IPC daemon connection.
- Requests must include strict timeout handling in Electron main process (`main.ts`).

---

## 3. UI/UX Rules

- UI controls (sliders, drop-downs, toggles) must never trigger heavy auto-unfolding or re-nesting automatically. Parameter changes update state, requiring explicit user confirmation (**FLATTEN / UNFOLD MODEL** or **Start Nesting Solver**).
- Modals (Advanced Settings, Precision Calibration Solver, Assembly Tree) must be frameless, centered, and visually aligned with the industrial dark theme tokens.
- Canvas controls must feature backdrop blur and high-contrast icon sizing (`h-7 w-7`).
