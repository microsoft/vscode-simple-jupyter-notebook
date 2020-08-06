/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IKernelSpec, KernelProvider, IRunningKernel } from './kernelProvider';
import * as vscode from 'vscode';
import { IDisposable } from './disposable';
import { NotebookKernel } from './notebookKernel';

export class KernelManager implements IDisposable, vscode.NotebookKernelProvider {
  private activeSpec?: IKernelSpec;
  private activeConns = new Map<vscode.NotebookDocument, Map<string, NotebookKernel>>();

  constructor(
    private readonly provider: KernelProvider,
    private readonly context: vscode.ExtensionContext,
  ) {
    vscode.notebook.onDidCloseNotebookDocument(document => {
      const kernelCache = this.activeConns.get(document);
      if (!kernelCache) {
        return;
      }

      this.activeConns.delete(document);
      kernelCache.forEach(kernel => kernel.resolve().then(k => k?.dispose()));
    });
  }

  async provideKernels(document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<vscode.NotebookKernel[]> {
    const kernelSpecs = await this.provider.getAvailableKernels();
    const kernelsCache = this.activeConns.get(document) || new Map<string, NotebookKernel>();
    this.activeConns.set(document, kernelsCache);

    return kernelSpecs.map(spec => {
      const specId = `__${spec.id}__${spec.location}`;
      if (kernelsCache.has(specId)) {
        return kernelsCache.get(specId)!;
      }

      const kernel = new NotebookKernel(this.provider, spec);
      kernelsCache.set(specId, kernel);
      return kernel;
    });
  }

  async resolveKernel(kernel: NotebookKernel, document: vscode.NotebookDocument, webview: vscode.NotebookCommunication, token: vscode.CancellationToken): Promise<void> {
    try {
      await kernel.resolve();
    } catch (e) {
      this.activeConns.get(document)?.delete(`__${kernel.kernelSpec.id}__${kernel.kernelSpec.location}`);
    }
  }

  /**
   * Gets the kernel for a notebook document by the document URI.
   */
  public async getDocumentKernelByUri(uri: string) {
    for (const [document, kernel] of this.activeConns.entries()) {
      if (document.uri.toString() === uri) {
        return kernel;
      }
    }

    return undefined;
  }

  /**
   * Gets the notebook document by the document URI.
   */
  public getDocumentByUri(uri: string) {
    for (const [document, kernel] of this.activeConns.entries()) {
      if (document.uri.toString() === uri) {
        return document;
      }
    }

    return undefined;
  }

  /**
   * Get a kernel for the given notebook document.
   */
  public async getDocumentKernel(document: vscode.NotebookDocument): Promise<IRunningKernel | undefined> {
    const editor = [...vscode.notebook.visibleNotebookEditors, vscode.notebook.activeNotebookEditor].find(editor => editor?.document.uri.toString() === document.uri.toString());
    if (editor) {
      return (editor.kernel as NotebookKernel).resolve();
    }
  }

  /**
   * Gets the active spec, if possible.
   */
  public async getActiveSpec() {
    if (this.activeSpec) {
      return this.activeSpec;
    }

    const available = await this.provider.getAvailableKernels();
    if (available.length === 0) {
      vscode.window.showErrorMessage('No Jupyter kernels were found on this machine');
      return;
    }

    const preferredLoc = this.context.globalState.get('preferredKernel');
    const preferred = available.find(k => k.id === preferredLoc);
    if (preferred) {
      return preferred;
    }

    return available[0];
  }

  public async setActive(spec: IKernelSpec) {
    this.closeAllKernels(); // no need to restart, will be done as needed
    this.activeSpec = spec;
    this.context.globalState.get('preferredKernel', spec.id);
  }

  /**
   * @inheritdoc
   */
  public dispose() {
    this.closeAllKernels();
  }

  /**
   * Runs UI to change the actively running kernel.
   */
  public async changeActive() {
    const quickpick = vscode.window.createQuickPick<{
      index: number;
      label: string;
      description: string;
    }>();

    quickpick.busy = true;
    quickpick.show();

    const pickedPromise = new Promise<IKernelSpec | undefined>(resolve => {
      quickpick.onDidHide(() => resolve());
      quickpick.onDidAccept(() => {
        const item = quickpick.selectedItems[0];
        resolve(item ? available[item.index] : undefined);
      });
    });

    const available = await this.provider.getAvailableKernels();

    quickpick.items = available.map((k, i) => ({
      index: i,
      label: `${k.language}: ${k.displayName}`,
      description: k.binary,
    }));

    quickpick.activeItems = quickpick.items.filter(
      a => available[a.index].id === this.activeSpec?.id,
    );

    const picked = await pickedPromise;
    quickpick.dispose();

    if (picked && picked.id !== this.activeSpec?.id) {
      this.setActive(picked);
    }
  }

  /**
   * Closes all running kernels.
   */
  public closeAllKernels() {
    this.activeConns.forEach(c => c.forEach(kernel => kernel.resolve().then(k => k?.dispose())));
    this.activeConns.clear();
  }
}
