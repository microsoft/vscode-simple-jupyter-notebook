/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as vscode from 'vscode';
// import { NotebookKernel } from './notebookKernel';
import { KernelManager } from './kernelManager';
import { KernelProvider } from './kernelProvider';
import { SampleProvider } from './sampleProvider';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const kernelManager = new KernelManager(new KernelProvider(), context);

  context.subscriptions.push(
    vscode.notebook.registerNotebookContentProvider(
      'simple-jupyter-notebook',
      new SampleProvider(kernelManager),
    ),
    // vscode.notebook.registerNotebookKernel(
    //   'simple-jupyter-kernel',
    //   ['*'],
    //   new NotebookKernel(kernelManager),
    // ),
    vscode.commands.registerCommand('simple-jupyter-notebook.change-kernel', () =>
      kernelManager.changeActive(),
    ),
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}
