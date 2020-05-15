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
  private static readonly logOperations = false;

  public label = 'Simple Kernel';

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

    const outputStream = await kernel.connection
      .sendAndReceive(wireProtocol.executeRequest(cell.source))
      .pipe(
        takeWhile(msg => msg.header.msg_type !== 'execute_reply', true),
        takeUntil(observeCodeEvent(token.onCancellationRequested)),
      );

    const collectedMessages = outputStream
      .pipe(
        reduce(
          (acc: { type: string; content: unknown }[], msg) => [
            ...acc,
            { type: msg.header.msg_type, content: msg.content },
          ],
          [],
        ),
      )
      .toPromise();

    const kernelOutputs = outputStream
      .pipe(
        reduce((acc: vscode.CellOutput[], msg) => {
          switch (msg.header.msg_type) {
            case 'display_data':
              return [
                ...acc,
                {
                  outputKind: vscode.CellOutputKind.Rich,
                  data: msg.content.data,
                },
              ];
            case 'error':
              return [
                ...acc,
                {
                  outputKind: vscode.CellOutputKind.Error,
                  ...msg.content,
                },
              ];
            case 'stream':
              const prev = acc[acc.length - 1];
              const content = msg.content.text as string;
              if (prev?.outputKind === vscode.CellOutputKind.Text) {
                return [
                  ...acc.slice(0, -1),
                  { outputKind: vscode.CellOutputKind.Text, text: prev.text + content },
                ];
              }

              return [...acc, { outputKind: vscode.CellOutputKind.Text, text: content }];
            default:
              return acc;
          }
        }, []),
      )
      .toPromise();

    cell.outputs = await kernelOutputs;
    if (NotebookKernel.logOperations) {
      cell.outputs.push({
        outputKind: vscode.CellOutputKind.Text,
        text: (await collectedMessages).map(m => JSON.stringify(m)).join('\n'),
      });
    }
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
