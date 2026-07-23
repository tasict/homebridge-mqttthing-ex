// Validation display mapping: wraps the model-driven validateThingConfig()
// into the summary shape the UI renders (list badge and editor warnings).
// Validation results never block saving.
import type { ThingConfig } from '../../../src/config.js';
import { validateThingConfig } from '../../../src/model/validate.js';

export interface ValidationSummary {
  errors: string[];
  warnings: string[];
  /** Total number of findings (list badge count; 0 renders no badge). */
  total: number;
}

export function summarizeConfig(config: ThingConfig): ValidationSummary {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof config.name !== 'string' || config.name.trim() === '') {
    errors.push('accessory has no name');
  }
  try {
    const result = validateThingConfig(config);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  } catch (e) {
    errors.push(`validation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { errors, warnings, total: errors.length + warnings.length };
}
