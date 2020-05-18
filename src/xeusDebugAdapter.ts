/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IRunningKernel } from './kernelProvider';
import {
  debugRequest,
  debugResponse,
  MessageType,
  JupyterMessage,
  DebugMessage,
} from './messaging';
import { filter, tap } from 'rxjs/operators';

const debugEvents: ReadonlySet<MessageType> = new Set([
  'debug_request',
  'debug_reply',
  'debug_event',
]);

const isDebugMessage = (msg: JupyterMessage): msg is DebugMessage =>
  debugEvents.has(msg.header.msg_type);

/**
 * the XeusDebugAdapter needs to be connected to:
 * - Jupyter's debug_request and debug_reply requests sent to the Control channel
 * - Jupyter's debug_event received from the IOPub channel
 */
export class XeusDebugAdapter implements vscode.DebugAdapter {
  private readonly sendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  private readonly messageListener = this.kernel.connection.messages
    .pipe(
      filter(isDebugMessage),
      tap(msg => console.log('<- recv', msg)),
    )
    .subscribe(evt => this.sendMessage.fire(evt.content));

  onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.sendMessage.event;

  constructor(private readonly kernel: IRunningKernel) {}

  handleMessage(message: DebugProtocol.ProtocolMessage): void {
    console.log('-> send', message);
    if (message.type === 'request') {
      this.kernel.connection.sendRaw(debugRequest(message as DebugProtocol.Request));
    } else if (message.type === 'response') {
      this.kernel.connection.sendRaw(debugResponse(message as DebugProtocol.Response));
    } else {
      // cannot send via iopub, no way to handle events even if they existed
      console.assert(false, `Unknown message type to send ${message.type}`);
    }

    /*
			// here we will tweak source paths in the messages to map between VS Code cell uris and xeus cells
			// ...

			// normal inline handler
			switch (message.type) {
			case 'request':
				const request = <DebugProtocol.Request>message;
				const response: DebugProtocol.Response = {
					type: 'response',
					seq: this._seq++,
					success: true,
					request_seq: request.seq,
					command: request.command
				};
				switch (request.command) {
					case 'initialize':
						break;
					case 'disconnect':
						break;
					// many more requests needs to be handled here...
					default:
						break;
				}
				this.sendMessage.fire(response);
				break;

			case 'response':
				this._sendDebugMessage(message);
				break;

			case 'event':
				this._sendDebugMessage(message);
				break;
			}
		*/
  }

  dispose() {
    this.messageListener.unsubscribe();
  }
}
