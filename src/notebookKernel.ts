/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import { takeUntil, takeWhile, reduce, filter } from 'rxjs/operators';
import { observeCodeEvent } from './util';
import { executeRequest, isMessageType } from './messaging';
import { IKernelSpec, KernelProvider, IRunningKernel } from './kernelProvider';
import { Subject } from 'rxjs';

/**
 * An ultra-minimal sample provider that lets the user type in JSON, and then
 * outputs JSON cells. Doesn't read files or save anything.
 */
export class NotebookKernel implements vscode.NotebookKernel {
  private static readonly logOperations = false;

  public id?: string;
  public label: string;
  public description: string;
  public isPreferred: boolean;
  private _resolveKernel?: Promise<IRunningKernel | undefined>;
  private _requestCancellation = new Subject<{ document?: vscode.NotebookDocument; cell?: vscode.NotebookCell }>()

  constructor(
    private readonly provider: KernelProvider,
    readonly kernelSpec: IKernelSpec
  ) {
    this.id = kernelSpec.id;
    this.label = kernelSpec.displayName;
    this.description = `${kernelSpec.location} (${kernelSpec.binary})`;
    this.isPreferred = false;
  }

  async resolve() {
    if (this._resolveKernel) {
      return this._resolveKernel;
    }

    this._resolveKernel = this.provider
      .launchKernel(this.kernelSpec)
      .then(
        async (instance): Promise<IRunningKernel | undefined> => {
          return instance; // undefined or an updated kernel
        },
      )
      .catch(e => {
        vscode.window.showErrorMessage(`Error launching kernel: ${e.stack}`);
        return undefined;
      });

    return this._resolveKernel;
  }

  /**
   * @inheritdoc
   */
  public async executeCell(
    document: vscode.NotebookDocument,
    cell: vscode.NotebookCell
  ) {
    await this._executeCell(document, cell);
  }

  private async _executeCell(
    document: vscode.NotebookDocument,
    cell: vscode.NotebookCell
  ): Promise<void> {
    if (cell?.language !== 'python') {
      return;
    }

    const kernel = await this.resolve();
    if (!kernel) {
      return;
    }

    cell.metadata.runState = vscode.NotebookCellRunState.Running;

    const outputStream = kernel.connection.sendAndReceive(executeRequest(cell.document.getText())).pipe(
      takeWhile(msg => msg.header.msg_type !== 'execute_reply', true),
      takeUntil(this._requestCancellation.pipe(filter(r => r.document === document || r.cell === cell)))
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
          if (isMessageType('execute_result', msg)) {
            return [
              ...acc,
              {
                outputKind: vscode.CellOutputKind.Rich,
                data: msg.content.data
              }
            ]
          }
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
    cell.metadata.runState = vscode.NotebookCellRunState.Success;
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
    document: vscode.NotebookDocument
  ): Promise<void> {
    for (const cell of document.cells) {
      await this._executeCell(document, cell);
    }
  }

  cancelCellExecution(document: vscode.NotebookDocument, cell: vscode.NotebookCell) {
    this._requestCancellation.next({ document, cell });
  }

  cancelAllCellsExecution(document: vscode.NotebookDocument) {
    this._requestCancellation.next({ document });
  }
}
