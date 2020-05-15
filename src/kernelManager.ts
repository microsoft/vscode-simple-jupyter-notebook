/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { IKernelSpec, KernelProvider, IRunningKernel } from './kernelProvider';
import * as vscode from 'vscode';
import { IDisposable } from './disposable';

export class KernelManager implements IDisposable {
  private activeSpec?: IKernelSpec;
  private activeConns = new Map<vscode.NotebookDocument, Promise<IRunningKernel | undefined>>();

  constructor(
    private readonly provider: KernelProvider,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /**
   * Get a kernel for the given notebook document.
   */
  public async getDocumentKernel(document: vscode.NotebookDocument) {
    const existing = this.activeConns.get(document);
    if (existing) {
      return existing;
    }

    const spec = await this.getActiveSpec();
    if (!spec) {
      return;
    }

    const kernel = this.provider
      .launchKernel(spec)
      .then(
        async (instance): Promise<IRunningKernel | undefined> => {
          // double check in case we stopped or changed kernels
          const current = this.activeConns.get(document);
          if (current === kernel) {
            return instance;
          }

          instance.dispose();
          return current; // undefined or an updated kernel
        },
      )
      .catch(e => {
        vscode.window.showErrorMessage(`Error launching kernel: ${e.stack}`);
        this.activeConns.delete(document);
        return undefined;
      });

    this.activeConns.set(document, kernel);
    return await kernel;
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
    this.activeConns.forEach(c => c.then(k => k?.dispose()));
    this.activeConns.clear();
  }
}
