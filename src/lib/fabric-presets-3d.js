// File: lib/fabric-presets-3d.js
// Three.js PBR material presets — mirrors blender-backend/scripts/swap_fabric.py
// Used for client-side real-time material preview

export const FABRIC_PRESETS_3D = {
  cotton: {
    label: "Cotton",
    color: "#d9d4cc",
    roughness: 0.85,
    metalness: 0.0,
    opacity: 1.0,
  },
  denim: {
    label: "Denim",
    color: "#263873",
    roughness: 0.9,
    metalness: 0.0,
    opacity: 1.0,
  },
  silk: {
    label: "Silk",
    color: "#ebe0d9",
    roughness: 0.25,
    metalness: 0.05,
    opacity: 1.0,
  },
  leather: {
    label: "Leather",
    color: "#2e1a0f",
    roughness: 0.55,
    metalness: 0.1,
    opacity: 1.0,
  },
  spandex: {
    label: "Spandex",
    color: "#0d0d0d",
    roughness: 0.3,
    metalness: 0.05,
    opacity: 1.0,
  },
  linen: {
    label: "Linen",
    color: "#e0d9c7",
    roughness: 0.92,
    metalness: 0.0,
    opacity: 1.0,
  },
  velvet: {
    label: "Velvet",
    color: "#400d1a",
    roughness: 0.95,
    metalness: 0.0,
    opacity: 1.0,
  },
  wool: {
    label: "Wool",
    color: "#8c806b",
    roughness: 0.95,
    metalness: 0.0,
    opacity: 1.0,
  },
  satin: {
    label: "Satin",
    color: "#e8ddd3",
    roughness: 0.15,
    metalness: 0.08,
    opacity: 1.0,
  },
  chiffon: {
    label: "Chiffon",
    color: "#f5efe8",
    roughness: 0.4,
    metalness: 0.0,
    opacity: 0.85,
  },
};

/**
 * Apply a fabric preset to a Three.js MeshStandardMaterial.
 * @param {THREE.MeshStandardMaterial} material
 * @param {string} presetId - key from FABRIC_PRESETS_3D
 * @param {THREE} THREE - Three.js module reference
 */
export function applyFabricPresetToMaterial(material, presetId, THREE) {
  const preset = FABRIC_PRESETS_3D[presetId];
  if (!preset || !material) return;

  material.color = new THREE.Color(preset.color);
  material.roughness = preset.roughness;
  material.metalness = preset.metalness;
  material.opacity = preset.opacity;
  material.transparent = preset.opacity < 1;
  material.needsUpdate = true;
}

/**
 * Get all preset IDs as an array.
 */
export function getFabricPresetIds() {
  return Object.keys(FABRIC_PRESETS_3D);
}
