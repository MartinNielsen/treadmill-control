// Pure FTMS helpers for inclination support (no DOM, no Bluetooth).

export const FEATURE_TARGET_INCLINATION_BIT = 1; // Target Setting Features bit 1
export const INCLINE_PRESETS_PERCENT = [0, 2, 4, 6, 8];

// Fitness Machine Feature (0x2ACC): uint32 machine features + uint32 target setting features.
export function parseFitnessMachineFeature(dv) {
  if (!dv || dv.byteLength < 8) return null;
  const machineFeatures = dv.getUint32(0, true);
  const targetSettings = dv.getUint32(4, true);
  return {
    machineFeatures,
    targetSettings,
    inclinationSupported: (machineFeatures & (1 << 3)) !== 0,
    targetInclinationSupported: (targetSettings & (1 << FEATURE_TARGET_INCLINATION_BIT)) !== 0
  };
}

// Supported Inclination Range (0x2AD5): sint16 min, sint16 max, uint16 step, all 0.1 %.
export function parseInclinationRange(dv) {
  if (!dv || dv.byteLength < 6) return null;
  const min = dv.getInt16(0, true) / 10;
  const max = dv.getInt16(2, true) / 10;
  const step = dv.getUint16(4, true) / 10;
  if (!(max > min) || !(step > 0)) return null;
  return { min, max, step };
}

// Clamp to range and snap to the step grid starting at min.
export function clampIncline(value, { min, max, step }) {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.max(min, Math.min(max, value));
  const steps = Math.round((clamped - min) / step);
  const snapped = Math.min(max, min + steps * step);
  return Math.round(snapped * 10) / 10;
}

// Encode a Set Target Inclination parameter: sint16 in 0.1 % units, little endian.
export function encodeInclineParameter(percent) {
  const raw = Math.round(percent * 10);
  if (raw < -32768 || raw > 32767) throw new RangeError('Incline out of sint16 range');
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, raw, true);
  return bytes;
}

// Read the inclination field (flag bit 3) from a Treadmill Data (0x2ACD) notification.
// Returns null when not present or when the value is "not available" (0x7FFF).
export function readTreadmillIncline(dv) {
  if (!dv || dv.byteLength < 2) return null;
  const flags = dv.getUint16(0, true);
  if ((flags & (1 << 3)) === 0) return null;
  let offset = 2;
  if ((flags & 1) === 0) offset += 2; // instantaneous speed (present when bit 0 is clear)
  if (flags & (1 << 1)) offset += 2;  // average speed
  if (flags & (1 << 2)) offset += 3;  // total distance
  if (offset + 2 > dv.byteLength) return null;
  const raw = dv.getInt16(offset, true);
  if (raw === 0x7fff) return null;
  return raw / 10;
}

export function presetsWithinRange(range, presets = INCLINE_PRESETS_PERCENT) {
  const values = presets.map((p) => clampIncline(p, range));
  return [...new Set(values)];
}

// Elevation gain (m) for one distance step: only positive incline climbs.
// Ignores missing/negative/implausible distance jumps (e.g. counter resets).
export const MAX_DISTANCE_STEP_METERS = 100;
export function elevationGainIncrement(previousDistance, distance, inclinePercent) {
  if (!Number.isFinite(previousDistance) || !Number.isFinite(distance)) return 0;
  const delta = distance - previousDistance;
  if (!(delta > 0) || delta > MAX_DISTANCE_STEP_METERS) return 0;
  if (!Number.isFinite(inclinePercent) || inclinePercent <= 0) return 0;
  return delta * inclinePercent / 100;
}

export function sessionElevationGain(session) {
  const value = session?.elevationGainMeters;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Incline to restore when a session is continued, or null when nothing should be sent.
export function resumeInclineTarget(session, range) {
  if (!session || !range) return null;
  const stored = session.lastInclinePercent;
  if (stored === null || stored === undefined || !Number.isFinite(stored)) return null;
  return clampIncline(stored, range);
}
