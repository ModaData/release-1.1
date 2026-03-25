// File 2: lib/replicate-client.js — Browser-side Replicate Helper

/**
 * Calls Replicate through our /api/replicate proxy.
 * Creates a prediction, then polls until complete.
 *
 * @param {string} version - Replicate model version hash
 * @param {object} input - Model input parameters
 * @param {function} onStatus - Optional status callback
 * @returns {Promise} - Model output
 */
export async function runReplicate(version, input, onStatus) {
  // 1. Create prediction
  onStatus?.("Starting prediction...");

  const createRes = await fetch("/api/replicate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, input }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    // BUG FIX: was missing template literal backticks
    throw new Error(
      err.error || `Failed to create prediction: ${createRes.status}`
    );
  }

  const prediction = await createRes.json();

  // If Replicate returned result immediately (warm model + Prefer: wait)
  if (prediction.status === "succeeded") {
    return prediction.output;
  }
  if (prediction.status === "failed") {
    throw new Error(prediction.error || "Prediction failed immediately");
  }

  // 2. Poll for completion
  const maxAttempts = 150; // 5 minutes at 2s intervals
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    onStatus?.(`Processing... (${i * 2}s)`);

    const pollRes = await fetch(`/api/replicate?id=${prediction.id}`);
    if (!pollRes.ok) continue;

    const result = await pollRes.json();

    if (result.status === "succeeded") {
      return result.output;
    }
    if (result.status === "failed" || result.status === "canceled") {
      throw new Error(result.error || "Prediction failed");
    }
  }

  throw new Error("Prediction timed out after 5 minutes");
}
