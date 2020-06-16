/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import { KernelManager } from './kernelManager';
import { takeUntil, takeWhile, reduce } from 'rxjs/operators';
import { observeCodeEvent } from './util';
import { executeRequest, isMessageType } from './messaging';

/**
 * An ultra-minimal sample provider that lets the user type in JSON, and then
 * outputs JSON cells. Doesn't read files or save anything.
 */
export class NotebookKernel implements vscode.NotebookKernel {
  private static readonly logOperations = false;

  public label = 'Simple Kernel';

  constructor(private readonly kernels: KernelManager) { }

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

    const outputStream = kernel.connection.sendAndReceive(executeRequest(cell.document.getText())).pipe(
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
        reduce((acc: vscode.CellOutput[], msg): vscode.CellOutput[] => {
          if (isMessageType('display_data', msg)) {
            return [
              ...acc,
              {
                outputKind: vscode.CellOutputKind.Rich,
                data: msg.content.data,
              },
            ];
          } else if (isMessageType('error', msg)) {
            return [
              ...acc,
              {
                outputKind: vscode.CellOutputKind.Error,
                ...msg.content,
              },
            ];
          } else if (isMessageType('stream', msg)) {
            const content = msg.content.text as string;
            if (acc.length > 0) {
              const prev = acc[acc.length - 1];
              if (prev?.outputKind === vscode.CellOutputKind.Text) {
                return [
                  ...acc.slice(0, -1),
                  { outputKind: vscode.CellOutputKind.Text, text: prev.text + content },
                ];
              }
            } else {
              return [
                { outputKind: vscode.CellOutputKind.Text, text: content },
              ];
            }
          }

          return acc;
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
