/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import { KernelManager } from './kernelManager';
import * as wireProtocol from '@nteract/messaging';
import { takeUntil, takeWhile, reduce } from 'rxjs/operators';
import { observeCodeEvent } from './util';

/**
 * An ultra-minimal sample provider that lets the user type in JSON, and then
 * outputs JSON cells. Doesn't read files or save anything.
 */
export class NotebookKernel implements vscode.NotebookKernel {
  constructor(private readonly kernels: KernelManager) {}

  /**
   * @inheritdoc
   */
  public async executeCell(
    document: vscode.NotebookDocument,
    cell: vscode.NotebookCell,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (cell?.language !== 'python') {
      return;
    }

    const kernel = await this.kernels.getDocumentKernel(document);
    if (!kernel || token.isCancellationRequested) {
      return;
    }

    const output = await kernel.connection
      .sendAndReceive(wireProtocol.executeRequest(cell.source))
      .pipe(
        takeWhile(msg => msg.header.msg_type !== 'execute_reply', true),
        takeUntil(observeCodeEvent(token.onCancellationRequested)),
        reduce((acc, msg) => `${acc + msg.header.msg_type}:${JSON.stringify(msg.content)}\n`, ''),
      )
      .toPromise();

    cell.outputs = [
      {
        outputKind: vscode.CellOutputKind.Text,
        text: output,
      },
    ];
  }

  /**
   * @inheritdoc
   */
  public async executeAllCells(
    document: vscode.NotebookDocument,
    token: vscode.CancellationToken,
  ): Promise<void> {
    for (const cell of document.cells) {
      if (token.isCancellationRequested) {
        break;
      }

      await this.executeCell(document, cell, token);
    }
  }
}
