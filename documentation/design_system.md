# CADANEST — UI Design System & Styling Guide

This document specifies the UI visual aesthetic, color palette, design tokens, and component styling rules enforced across CADANEST.

---

## 1. Visual Aesthetics & Philosophy

CADANEST adheres to a **sleek, high-contrast industrial CAD/CAM dark design theme** inspired by professional engineering software (Siemens Solid Edge, Bystronic BySoft, Trumpf TruTops).

### Key Styling Directives
1. **High Contrast & Readability**: Dark canvas backgrounds with crisp, high-contrast borders and clear typography.
2. **Backdrop Blur Toolbar Elements**: Canvas controls and overlay toolbars use glassmorphism backdrop blur (`bg-industrial-darker/95 backdrop-blur-md border border-industrial-border`).
3. **PBR Metal Alloy Color Rendering**: 3D materials dynamically map alloy strings to realistic PBR metallic hex colors.
4. **Non-Overlapping Controls**: 2D and 3D viewport controls are anchored with fixed dimensions (`h-7 w-7` buttons) to avoid obscuring canvas elements.

---

## 2. Color Palette & Design Tokens

```css
:root {
  --color-industrial-darkest: #0B0E14;
  --color-industrial-darker:  #121722;
  --color-industrial-dark:    #1A202C;
  --color-industrial-border:  #2D3748;
  --color-industrial-text:    #E2E8F0;
  --color-industrial-muted:   #A0AEC0;
  --color-accent-blue:        #3182CE;
  --color-accent-cyan:        #00B5D8;
  --color-accent-amber:       #D69E2E;
  --color-accent-green:       #38A169;
}
```

---

## 3. Metal Alloy PBR Color Mappings (`Model3DViewer.tsx`)

| Alloy Category | Color Hex | Metalness | Roughness |
| :--- | :--- | :--- | :--- |
| **Steel / Mild Steel** | `#8A9BA8` | 0.85 | 0.35 |
| **Stainless Steel (304/316)** | `#D0D7DE` | 0.95 | 0.20 |
| **Aluminum (1060/5052/6061)** | `#E2E8F0` | 0.70 | 0.40 |
| **Copper** | `#B87333` | 0.90 | 0.30 |
| **Brass** | `#E5C158` | 0.90 | 0.25 |
