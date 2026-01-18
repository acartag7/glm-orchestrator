/**
 * Opencode Manager Service - Manages the opencode server process lifecycle
 *
 * Handles auto-start, health checks, and auto-restart of the opencode server.
 * This is a singleton service that runs server-side only.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface OpencodeStatus {
  running: boolean;
  pid?: number;
  port: number;
  startedAt?: number;
  lastHealthCheck?: number;
  error?: string;
}

export interface OpencodeManagerConfig {
  port: number;
  healthCheckInterval: number;
  startTimeout: number;
  restartDelay: number;
  maxRestartAttempts: number;
}

const DEFAULT_CONFIG: OpencodeManagerConfig = {
  port: 4096,
  healthCheckInterval: 5000,
  startTimeout: 10000,
  restartDelay: 2000,
  maxRestartAttempts: 3,
};

export class OpencodeManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: OpencodeStatus;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private restartAttempts: number = 0;
  private config: OpencodeManagerConfig;
  private isShuttingDown: boolean = false;

  constructor(config?: Partial<OpencodeManagerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.status = { running: false, port: this.config.port };
  }

  /**
   * Start opencode server if not running
   */
  async start(): Promise<{ success: boolean; error?: string }> {
    // Check if already running
    if (await this.checkHealth()) {
      this.status.running = true;
      console.log('[OpencodeManager] Server already running');
      return { success: true };
    }

    return new Promise((resolve) => {
      try {
        console.log('[OpencodeManager] Starting opencode server...');

        // Spawn opencode process
        this.process = spawn('opencode', [], {
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        this.status.pid = this.process.pid;

        // Handle stdout/stderr
        this.process.stdout?.on('data', (data) => {
          console.log('[OpencodeManager] stdout:', data.toString().trim());
        });

        this.process.stderr?.on('data', (data) => {
          console.error('[OpencodeManager] stderr:', data.toString().trim());
        });

        // Handle process events
        this.process.on('error', (err) => {
          console.error('[OpencodeManager] Process error:', err.message);
          this.status.running = false;
          this.status.error = err.message;
          this.process = null;
          this.emit('error', err);
          resolve({ success: false, error: err.message });
        });

        this.process.on('exit', (code) => {
          console.log(`[OpencodeManager] Process exited with code ${code}`);
          this.status.running = false;
          this.process = null;
          this.emit('exit', code);

          // Auto-restart if unexpected exit and not shutting down
          if (!this.isShuttingDown && code !== 0 && this.restartAttempts < this.config.maxRestartAttempts) {
            this.scheduleRestart();
          }
        });

        // Wait for health check
        const startTime = Date.now();
        const checkReady = async () => {
          if (Date.now() - startTime > this.config.startTimeout) {
            const timeoutError = 'Startup timeout - opencode may not be installed or failed to start';
            console.error('[OpencodeManager] Startup timeout');

            // Clean up orphaned process
            if (this.process) {
              try {
                this.process.kill();
              } catch {
                // Ignore kill errors
              }
              this.process = null;
            }
            this.status.running = false;
            this.status.error = timeoutError;
            this.emit('error', new Error(timeoutError));

            resolve({ success: false, error: timeoutError });
            return;
          }

          if (await this.checkHealth()) {
            this.status.running = true;
            this.status.startedAt = Date.now();
            this.status.error = undefined;
            this.restartAttempts = 0;
            this.isShuttingDown = false; // Allow auto-restart on future crashes
            console.log('[OpencodeManager] Server started successfully');
            this.emit('start');
            resolve({ success: true });
          } else {
            setTimeout(checkReady, 500);
          }
        };

        // Initial delay for server to bind port
        setTimeout(checkReady, 1000);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[OpencodeManager] Failed to spawn process:', message);
        resolve({ success: false, error: message });
      }
    });
  }

  /**
   * Stop opencode server gracefully
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.stopHealthMonitor();

    if (!this.process) {
      console.log('[OpencodeManager] No process to stop');
      return;
    }

    const proc = this.process;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill after 5 seconds
        if (proc && !proc.killed) {
          console.log('[OpencodeManager] Force killing process');
          proc.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      proc.once('exit', () => {
        clearTimeout(timeout);
        this.status.running = false;
        this.process = null;
        console.log('[OpencodeManager] Server stopped');
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      console.log('[OpencodeManager] Sending SIGTERM');
      proc.kill('SIGTERM');
    });
  }

  /**
   * Restart opencode server
   */
  async restart(): Promise<{ success: boolean; error?: string }> {
    console.log('[OpencodeManager] Restarting server...');
    await this.stop();
    this.isShuttingDown = false;
    this.restartAttempts = 0;
    return this.start();
  }

  /**
   * Check if opencode is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`http://localhost:${this.config.port}/sessions`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      this.status.lastHealthCheck = Date.now();
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get current status
   */
  getStatus(): OpencodeStatus {
    return { ...this.status };
  }

  /**
   * Start continuous health monitoring
   */
  startHealthMonitor(): void {
    if (this.healthCheckTimer) {
      return;
    }

    console.log('[OpencodeManager] Starting health monitor');

    this.healthCheckTimer = setInterval(async () => {
      const healthy = await this.checkHealth();

      if (!healthy && this.status.running) {
        console.warn('[OpencodeManager] Health check failed, server may have crashed');
        this.status.running = false;
        this.emit('unhealthy');

        // Try to restart if not already shutting down
        if (!this.isShuttingDown && this.restartAttempts < this.config.maxRestartAttempts) {
          this.scheduleRestart();
        }
      } else if (healthy && !this.status.running) {
        // Server came back online externally
        this.status.running = true;
        this.status.error = undefined;
        console.log('[OpencodeManager] Server back online');
        this.emit('healthy');
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitor(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('[OpencodeManager] Stopped health monitor');
    }
  }

  /**
   * Schedule a restart attempt
   */
  private scheduleRestart(): void {
    this.restartAttempts++;
    console.log(`[OpencodeManager] Scheduling restart attempt ${this.restartAttempts}/${this.config.maxRestartAttempts}`);

    setTimeout(async () => {
      const result = await this.start();
      if (!result.success) {
        console.error(`[OpencodeManager] Restart failed: ${result.error}`);
        this.emit('restart_failed', this.restartAttempts);

        if (this.restartAttempts >= this.config.maxRestartAttempts) {
          this.status.error = `Failed to restart after ${this.config.maxRestartAttempts} attempts`;
          this.emit('max_restarts_reached');
        }
      } else {
        console.log('[OpencodeManager] Restart successful');
        this.emit('restart_success');
      }
    }, this.config.restartDelay);
  }
}

// Singleton instance
export const opencodeManager = new OpencodeManager();
