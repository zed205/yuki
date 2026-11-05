declare module 'better-sqlite3' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement<T = any> {
    get(...params: any[]): T | undefined;
    all(...params: any[]): T[];
    run(...params: any[]): RunResult;
    raw(): this;
    pluck(toggle?: boolean): this;
    expand(toggle?: boolean): this;
  }

  interface Database {
    prepare<T = any>(sql: string): Statement<T>;
    pragma<T>(statement: string, options?: any): T;
    exec(sql: string): void;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    close(): void;
    readonly: boolean;
    readonly name: string;
  }

  class Database {
    constructor(path: string, options?: any);
    prepare<T = any>(sql: string): Statement<T>;
    pragma(statement: string, options?: any): any;
    exec(sql: string): void;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    close(): void;
    readonly: boolean;
    readonly name: string;
  }

  namespace Database {
    export type Database = Database;
    export type Statement<T = any> = Statement<T>;
    export type RunResult = RunResult;
  }

  export type Statement<T = any> = Statement<T>;
  export type RunResult = RunResult;

  export = Database;
}
