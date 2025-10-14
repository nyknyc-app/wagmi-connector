/**
 * Configurable logger for NYKNYC connector
 * Respects developmentMode flag to control verbose logging
 */
export class Logger {
  private readonly prefix = '[NYKNYC]'
  
  constructor(private readonly enabled: boolean = false) {}

  /**
   * Log informational messages (only in development mode)
   */
  log(...args: any[]): void {
    if (this.enabled) {
      console.log(this.prefix, ...args)
    }
  }

  /**
   * Log warning messages (always shown)
   */
  warn(...args: any[]): void {
    console.warn(this.prefix, ...args)
  }

  /**
   * Log error messages (always shown)
   */
  error(...args: any[]): void {
    console.error(this.prefix, ...args)
  }

  /**
   * Log debug messages with additional context (only in development mode)
   */
  debug(context: string, ...args: any[]): void {
    if (this.enabled) {
      console.log(`${this.prefix} [${context}]`, ...args)
    }
  }
}
