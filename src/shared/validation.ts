/**
 * Labels for the SDK's ValidationCode integers (values documented in the SDK
 * typings and docs/SDK_NOTES.md). Used by the HUD's signal-quality chip.
 */
export const VALIDATION_LABELS: Record<number, { name: string; short: string }> = {
  0: { name: 'kOk', short: 'OK' },
  1: { name: 'kNoFaceFound', short: 'No face' },
  2: { name: 'kMultipleFacesFound', short: 'Multiple faces' },
  3: { name: 'kFaceNotCentered', short: 'Center your face' },
  4: { name: 'kFaceSizeOutOfRange', short: 'Distance' },
  5: { name: 'kTooDark', short: 'Too dark' },
  6: { name: 'kTooBright', short: 'Too bright' },
  7: { name: 'kChestNotVisible', short: 'Chest not visible' },
  10: { name: 'kCameraTuning', short: 'Camera tuning' },
  11: { name: 'kFrameRateTooLow', short: 'Low frame rate' },
  12: { name: 'kExcessiveMotion', short: 'Motion' },
  13: { name: 'kFaceTooClose', short: 'Too close' },
  14: { name: 'kFaceTooFar', short: 'Too far' },
  15: { name: 'kFaceTooHigh', short: 'Face too high' },
  16: { name: 'kFaceTooLow', short: 'Face too low' },
  17: { name: 'kFaceNotForward', short: 'Face the camera' },
};

export function validationLabel(code: number): { name: string; short: string } {
  return VALIDATION_LABELS[code] ?? { name: `code ${code}`, short: `code ${code}` };
}
