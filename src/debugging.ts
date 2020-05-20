/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as vscode from 'vscode';
import { KernelManager } from './kernelManager';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IRunningKernel } from './kernelProvider';
import { debugRequest, debugResponse, MessageType, JupyterMessage, DebugMessage } from './messaging';
import { filter, tap } from 'rxjs/operators';
import { Subscription } from 'rxjs';


export class DebuggingManager {

  private docsToSessions = new Map<vscode.NotebookDocument, Promise<vscode.DebugSession>>();

  public constructor(
    context: vscode.ExtensionContext,
    private kernelManager: KernelManager
  ) {

    // track termination of debug sessions
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(async session => {
      for (const [doc, ses] of this.docsToSessions.entries()) {
        if (session === await ses) {
          this.docsToSessions.delete(doc);
          this.updateDebuggerUI(doc, false);
          break;
        }
      }
    }));

    // track closing of notebooks documents
    vscode.notebook.onDidCloseNotebookDocument(async document => {
      const session = await this.docsToSessions.get(document);
      if (session) {
        this.docsToSessions.delete(document);
        await this.stop(session);
      }
    });
  }

  public async toggleDebugging(doc: vscode.NotebookDocument) {

    let session = this.docsToSessions.get(doc);
    if (session) {
      // we are in debugging mode
      this.docsToSessions.delete(doc);
      await this.stop(await session);
    } else {
      session = this.startDebugSession(doc);
      this.docsToSessions.set(doc, session);
      await this.kernelManager.getDocumentKernel(doc); // ensure the kernel is running
      await session;
    }
    this.updateDebuggerUI(doc, this.docsToSessions.has(doc));
  }

  //---- private

  private async startDebugSession(doc: vscode.NotebookDocument): Promise<vscode.DebugSession> {

    return new Promise<vscode.DebugSession>((resolve, reject) => {

      const timer = setTimeout(() => {
        reject(new Error('Cannot start debugger within 10 seconds'));
      }, 10000);

      const factoryDisposer = vscode.debug.registerDebugAdapterDescriptorFactory('xeus', {
        createDebugAdapterDescriptor: async session => {

          factoryDisposer.dispose();

          const kernel = await this.kernelManager.getDocumentKernelByUri(session.configuration.__document);
          const notebookDocument = this.kernelManager.getDocumentByUri(session.configuration.__document);
          if (kernel && notebookDocument) {
            clearTimeout(timer);
            resolve(session);
            return new vscode.DebugAdapterInlineImplementation(new XeusDebugAdapter(session, notebookDocument, kernel));
          }
          clearTimeout(timer);
          reject(new Error('Kernel appears to have been stopped'));
          return;
        }
      });

      vscode.debug.startDebugging(undefined, {
        type: 'xeus',
        name: 'xeus debugging',
        request: 'attach',
        __document: doc.uri.toString(),
      });
    });
  }

  private stop(session: vscode.DebugSession) {
    if (vscode.debug.activeDebugSession === session) {
      return vscode.commands.executeCommand('workbench.action.debug.stop');
    } else {
      console.log('cannot stop debugger');
    }
  }

  private updateDebuggerUI(doc: vscode.NotebookDocument, showBreakpointsMargin: boolean) {
    for (let cell of doc.cells) {
      if (cell.cellKind === vscode.CellKind.Code) {
        cell.metadata.breakpointMargin = showBreakpointsMargin;
      }
    }
  }
}

//---- debug adapter for Jupyter debug protocol

const debugEvents: ReadonlySet<MessageType> = new Set([
  'debug_request',
  'debug_reply',
  'debug_event',
]);

const isDebugMessage = (msg: JupyterMessage): msg is DebugMessage =>
  debugEvents.has(msg.header.msg_type);

/**
 * the XeusDebugAdapter delegates the DAP protocol to the xeus kernel
 * via Jupyter's experimental debug_request, debug_reply, debug_event messages.
 */
class XeusDebugAdapter implements vscode.DebugAdapter {

  private readonly fileToCell = new Map<string, string>();
  private readonly cellToFile = new Map<string, string>();
  private readonly sendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  private readonly messageListener: Subscription;

  onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.sendMessage.event;

  constructor(
    private session: vscode.DebugSession,
    private notebookDocument: vscode.NotebookDocument,
    private readonly kernel: IRunningKernel
  ) {
    this.messageListener = this.kernel.connection.messages
      .pipe(
        filter(isDebugMessage),
        //tap(msg => console.log('<- recv', msg.content)),
      )
      .subscribe(evt => {

        // map Sources from Xeus to VS Code
        visitSources(evt.content, s => {
          if (s && s.path) {
            const p = this.fileToCell.get(s.path);
            if (p) {
              s.path = p;
            }
          }
        });

        this.sendMessage.fire(evt.content);
      });
  }

  async handleMessage(message: DebugProtocol.ProtocolMessage) {
    // console.log('-> send', message);

    // intercept 'setBreakpoints' request
    if (message.type === 'request' && (<any>message).command === 'setBreakpoints') {
      const args = (<any>message).arguments;
      if (args.source && args.source.path && args.source.path.indexOf('vscode-notebook-cell:') === 0) {
        await this.dumpCell(args.source.path);
      }
    }

    // map Source paths from VS Code to Xeus
    visitSources(message, s => {
      if (s && s.path) {
        const p = this.cellToFile.get(s.path);
        if (p) {
          s.path = p;
        }
      }
    });

    if (message.type === 'request') {
      this.kernel.connection.sendRaw(debugRequest(message as DebugProtocol.Request));
    } else if (message.type === 'response') {
      // responses of reverse requests
      this.kernel.connection.sendRaw(debugResponse(message as DebugProtocol.Response));
    } else {
      // cannot send via iopub, no way to handle events even if they existed
      console.assert(false, `Unknown message type to send ${message.type}`);
    }
  }

  dispose() {
    this.messageListener.unsubscribe();
  }

  /**
   * Dump content of given cell into a tmp file and return path to file.
   */
  private async dumpCell(uri: string): Promise<string | undefined> {
    //if (!this.cellToFile.has(uri)) {
      const cell = this.notebookDocument.cells.find(c => c.uri.toString() === uri);
      if (cell) {
        try {
          const response = await this.session.customRequest('dumpCell', { code: cell.source });
          this.fileToCell.set(response.sourcePath, cell.uri.toString());
          this.cellToFile.set(cell.uri.toString(), response.sourcePath);
          return response.sourcePath;
        } catch (err) {
          console.log(err);
        }
      }
    //}
  }
}

// this vistor could be moved into the DAP npm module (it must be kept in sync with the DAP spec)
function visitSources(msg: DebugProtocol.ProtocolMessage, sourceHook: (source: DebugProtocol.Source | undefined) => void): void {

  switch (msg.type) {
    case 'event':
      const event = <DebugProtocol.Event>msg;
      switch (event.event) {
        case 'output':
          sourceHook((<DebugProtocol.OutputEvent>event).body.source);
          break;
        case 'loadedSource':
          sourceHook((<DebugProtocol.LoadedSourceEvent>event).body.source);
          break;
        case 'breakpoint':
          sourceHook((<DebugProtocol.BreakpointEvent>event).body.breakpoint.source);
          break;
        default:
          break;
      }
      break;
    case 'request':
      const request = <DebugProtocol.Request>msg;
      switch (request.command) {
        case 'setBreakpoints':
          sourceHook((<DebugProtocol.SetBreakpointsArguments>request.arguments).source);
          break;
        case 'breakpointLocations':
          sourceHook((<DebugProtocol.BreakpointLocationsArguments>request.arguments).source);
          break;
        case 'source':
          sourceHook((<DebugProtocol.SourceArguments>request.arguments).source);
          break;
        case 'gotoTargets':
          sourceHook((<DebugProtocol.GotoTargetsArguments>request.arguments).source);
          break;
        case 'launchVSCode':
          //request.arguments.args.forEach(arg => fixSourcePath(arg));
          break;
        default:
          break;
      }
      break;
    case 'response':
      const response = <DebugProtocol.Response>msg;
      if (response.success && response.body) {
        switch (response.command) {
          case 'stackTrace':
            (<DebugProtocol.StackTraceResponse>response).body.stackFrames.forEach(frame => sourceHook(frame.source));
            break;
          case 'loadedSources':
            (<DebugProtocol.LoadedSourcesResponse>response).body.sources.forEach(source => sourceHook(source));
            break;
          case 'scopes':
            (<DebugProtocol.ScopesResponse>response).body.scopes.forEach(scope => sourceHook(scope.source));
            break;
          case 'setFunctionBreakpoints':
            (<DebugProtocol.SetFunctionBreakpointsResponse>response).body.breakpoints.forEach(bp => sourceHook(bp.source));
            break;
          case 'setBreakpoints':
            (<DebugProtocol.SetBreakpointsResponse>response).body.breakpoints.forEach(bp => sourceHook(bp.source));
            break;
          default:
            break;
        }
      }
      break;
  }
}
