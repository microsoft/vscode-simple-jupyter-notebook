/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { ChildProcessWithoutNullStreams } from 'child_process';
import { ReplaySubject, Subject } from 'rxjs';
import * as split from 'split2';
import { IDisposable, DisposableList, toDisposable } from './disposable';

export class KernelProcess implements IDisposable {
  /**
   * Subject that emits when a line is received from the child stdout.
   */
  public readonly stdout = new Subject<string>();

  /**
   * Subject that emits when a line is received from the child stderr.
   */
  public readonly stderr = new Subject<string>();

  /**
   * Subject that emits when the child process exits with an error or silently.
   */
  public readonly exit = new ReplaySubject<Error | undefined>(1);

  private killed = false;

  constructor(private readonly cp: ChildProcessWithoutNullStreams) {
    cp.stderr.pipe(split()).on('data', line => this.stderr.next(line));
    cp.stdout.pipe(split()).on('data', line => this.stderr.next(line));
    cp.on('error', err => this.exit.next(err));
    cp.on('exit', code =>
      this.exit.next(
        code && !this.killed ? new Error(`Kernel exited with code ${code}`) : undefined,
      ),
    );
  }

  /**
   * Pipes stdout/err additionally to the current process, for testing.
   */
  public connectToProcessStdio(): IDisposable {
    return new DisposableList([
      toDisposable(this.stderr.subscribe(line => process.stderr.write(`kernel stderr> ${line}\n`))),
      toDisposable(this.stdout.subscribe(line => process.stdout.write(`kernel stdout> ${line}\n`))),
      toDisposable(
        this.exit.subscribe(err => (err ? console.error(err.stack) : `Kernel exited gracefully`)),
      ),
    ]);
  }

  /**
   * @inheritdoc
   */
  public dispose() {
    this.killed = true;
    this.cp.kill();
  }
}
