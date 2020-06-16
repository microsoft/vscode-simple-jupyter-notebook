/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as vscode from 'vscode';
import { KernelManager } from './kernelManager';
import { KernelProvider, LocationType } from './kernelProvider';
import { NotebookKernel } from './notebookKernel';
import { DebuggingManager } from './debugging';

export function activate(context: vscode.ExtensionContext) {

  const kernelManager = new KernelManager(
    new KernelProvider(() => [
      ...vscode.workspace
        .getConfiguration('simple-jupyter')
        .get('searchPaths', [])
        .map(path => ({ path, type: LocationType.User })),
      ...KernelProvider.defaultSearchPaths(),
    ]),
    context,
  );

  const debuggerManager = new DebuggingManager(context, kernelManager);

  context.subscriptions.push(
    vscode.notebook.registerNotebookKernel('simple-jupyter-kernel', ['*'], new NotebookKernel(kernelManager)),
    vscode.commands.registerCommand('simple-jupyter-notebook.change-kernel', () =>
      kernelManager.changeActive(),
    ),
    vscode.commands.registerCommand('simple-jupyter-notebook.restart-kernel', () =>
      kernelManager.closeAllKernels(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('simple-jupyter-notebook.toggleDebugging', () => {
      const editor = vscode.notebook.activeNotebookEditor;
      if (editor) {
        debuggerManager.toggleDebugging(editor.document);
      } else {
        vscode.window.showErrorMessage('No active notebook document to debug');
      }
    })
  );
}

// this method is called when your extension is deactivated
export function deactivate() {
  // no-op
}
