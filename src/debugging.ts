/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as vscode from 'vscode';
import { XeusDebugAdapter } from './xeusDebugAdapter';
import { KernelManager } from './kernelManager';

export class DebuggingManager {

  private sessionMap = new Map<vscode.DebugSession, Debugger>();
  private documentMap = new Map<vscode.NotebookDocument, Debugger>();

  constructor(
    context: vscode.ExtensionContext,
    private kernelManager: KernelManager
  ) {

    // track termination of debug sessions
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(async session => {
      const dbg = this.sessionMap.get(session);
      if (dbg) {
        const doc = dbg.getDocument();
        this.documentMap.delete(doc);
        this.sessionMap.delete(session);
        this.updateDebuggerUI(doc, this.documentMap.has(doc));
      }
    }));

    // track closing of notebooks documents
    vscode.notebook.onDidCloseNotebookDocument(async document => {
      const dbg = this.documentMap.get(document);
      if (dbg) {
        this.documentMap.delete(document);
        await dbg.stop();
      }
    });
  }

  add(session: vscode.DebugSession, dbg: Debugger): void {
    this.sessionMap.set(session, dbg);
  }

  async toggleDebugging(doc: vscode.NotebookDocument) {

    const kernel = await this.kernelManager.getDocumentKernel(doc); // ensure the kernel is running
    if (!kernel) {
      vscode.window.showErrorMessage('Kernel appears to have been stopped');
      return;
    }

    let dbg = this.documentMap.get(doc);
    if (dbg) {
      // we are in debugging mode
      await dbg.stop();
      this.documentMap.delete(doc);
    } else {
      dbg = new Debugger(this, this.kernelManager, doc);
      this.documentMap.set(doc, dbg);
      await dbg.start();
    }

    this.updateDebuggerUI(doc, this.documentMap.has(doc));
  }

  private updateDebuggerUI(doc: vscode.NotebookDocument, showBreakpointsMargin: boolean) {
    for (let cell of doc.cells) {
      if (cell.cellKind === vscode.CellKind.Code) {
        cell.metadata.breakpointMargin = showBreakpointsMargin;
      }
    }
  }
}

class Debugger {

  private debugSession?: Promise<vscode.DebugSession>;

  constructor(
    private debuggerManager: DebuggingManager,
    private kernelManager: KernelManager,
    private document: vscode.NotebookDocument
  ) {
  }

  getDocument() {
    return this.document;
  }

  async start(): Promise<vscode.DebugSession> {

    if (!this.debugSession) {
      this.debugSession = new Promise<vscode.DebugSession>((resolve, reject) => {

        const factoryDisposer = vscode.debug.registerDebugAdapterDescriptorFactory('xeus', {
          createDebugAdapterDescriptor: async session => {

            this.debuggerManager.add(session, this);
            factoryDisposer.dispose();

            const kernel = await this.kernelManager.getDocumentKernelByUri(session.configuration.__document);
            const notebookDocument = this.kernelManager.getDocumentByUri(session.configuration.__document);
            if (kernel && notebookDocument) {
              resolve(session);
              return new vscode.DebugAdapterInlineImplementation(new XeusDebugAdapter(session, notebookDocument, kernel));
            }
            //vscode.window.showErrorMessage('Kernel appears to have been stopped');
            reject(new Error('Kernel appears to have been stopped'));
            return;
          }
        });

        const TerminatListenerDisposer = vscode.debug.onDidTerminateDebugSession(async session => {
          if (session === await this.debugSession) {
            this.debugSession = undefined;
            TerminatListenerDisposer.dispose();
          }
        });

        vscode.debug.startDebugging(undefined, {
          type: 'xeus',
          name: 'xeus debugging',
          request: 'attach',
          __document: this.document.uri.toString(),
        });

        setTimeout(() => {
          reject(new Error('Cannot start debugger within 10 seconds'));
        }, 10000);
      });
    }
    return this.debugSession;
  }

  async stop() {
    const ds = await this.debugSession;
    if (vscode.debug.activeDebugSession === ds) {
      return vscode.commands.executeCommand('workbench.action.debug.stop');
    } else {
      console.log('cannot stop debugger');
    }
  }
}
