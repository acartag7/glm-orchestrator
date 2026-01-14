import fs from 'fs';

export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathValidationError';
  }
}

export function validateWorkingDirectory(dir: string): void {
  const blockedPrefixes = ['/etc', '/var', '/usr', '/bin', '/sbin', '/System', '/Library', '/private'];
  
  for (const prefix of blockedPrefixes) {
    if (dir.startsWith(prefix)) {
      throw new PathValidationError(`Working directory cannot be in ${prefix}`);
    }
  }

  if (!fs.existsSync(dir)) {
    throw new PathValidationError(`Directory does not exist: ${dir}`);
  }

  if (!fs.statSync(dir).isDirectory()) {
    throw new PathValidationError(`Path is not a directory: ${dir}`);
  }
}

export function validateFilePath(path: string): void {
  if (path.includes('..')) {
    throw new PathValidationError(`Path traversal not allowed: ${path}`);
  }
}
