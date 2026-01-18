/**
 * Validation Service - Wraps review-validation.ts for chunk validation
 *
 * Validates that chunks made actual code changes and that builds pass
 * before sending to review.
 */

import { validateChunkCompletion, type ValidationResult } from '../review-validation';

export { type ValidationResult } from '../review-validation';

export interface ValidationOptions {
  skipBuild?: boolean;
  buildTimeout?: number;
}

export class ValidationService {
  /**
   * Validate chunk completion
   * - Check files changed
   * - Run build
   * - Return auto-fail if no changes or build failed
   */
  async validate(
    chunkId: string,
    workingDir: string,
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    console.log(`[Validation] Validating chunk ${chunkId} in ${workingDir}`);

    const result = await validateChunkCompletion(workingDir, chunkId, {
      skipBuild: options.skipBuild,
      buildTimeout: options.buildTimeout,
    });

    if (result.autoFail) {
      console.log(`[Validation] Auto-fail for chunk ${chunkId}: ${result.autoFail.reason}`);
    } else if (result.success) {
      console.log(`[Validation] Chunk ${chunkId} validated: ${result.filesChanged} files changed`);
    }

    return result;
  }
}

export const validationService = new ValidationService();
