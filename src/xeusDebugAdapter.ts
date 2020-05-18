/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';

/**
 * the XeusDebugAdapter needs to be connected to:
 * - Jupyter's debug_request and debug_reply requests sent to the Control channel
 * - Jupyter's debug_event received from the IOPub channel
 */
export class XeusDebugAdapter implements vscode.DebugAdapter {

	private sendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
	private sequence = 1;

	onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.sendMessage.event;

	constructor(session: vscode.DebugSession) {
		console.log('xeus debug adapter');
	}

	handleMessage(message: DebugProtocol.ProtocolMessage): void {
		switch (message.type) {
			case 'request':
				const request = <DebugProtocol.Request>message;
				const response: DebugProtocol.Response = {
					type: 'response',
					seq: this.sequence++,
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
				break;
			case 'event':
				break;
		}
	}

	dispose() {
		console.log('xeus debug adapter: dispose');
	}
}
