/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IRunningKernel } from './kernelProvider';


// The following declarations are copied from https://github.com/jupyterlab/debugger and show
// the structure of the 3 experimental debug messages that tunnel DAP over the Jupyter protocol.

//----------------------------------------------------------------------------------------------

/**
 * Jupyter message types.
 */
export declare type MessageType = IOPubMessageType | ControlMessageType;

/**
 * The valid Jupyter channel names in a message to a frontend.
 */
export declare type Channel = 'shell' | 'control' | 'iopub' | 'stdin';

/**
 * Kernel message specification.
 *
 * See [Messaging in Jupyter](https://jupyter-client.readthedocs.io/en/latest/messaging.html#general-message-format).
 */
export interface IMessage<MSGTYPE extends MessageType = MessageType> {

	// ...
}

/**
 * Control message types.
 *
 * #### Notes
 * Debug messages are experimental messages that are not in the official
 * kernel message specification. As such, debug message types are *NOT*
 * considered part of the public API, and may change without notice.
 */
export declare type ControlMessageType = 'debug_request' | 'debug_reply';

/**
 * IOPub message types.
 *
 * #### Notes
 * Debug messages are experimental messages that are not in the official
 * kernel message specification. As such, debug message types are *NOT*
 * considered part of the public API, and may change without notice.
 */
export declare type IOPubMessageType = 'clear_output' | 'comm_close' | 'comm_msg' | 'comm_open' | 'display_data' | 'error' | 'execute_input' | 'execute_result' | 'status' | 'stream' | 'update_display_data' | 'debug_event';

/**
 * A kernel message on the `'control'` channel.
 */
export interface IControlMessage<T extends ControlMessageType = ControlMessageType> extends IMessage<T> {
    channel: 'control';
}

/**
 * A kernel message on the `'iopub'` channel.
 */
export interface IIOPubMessage<T extends IOPubMessageType = IOPubMessageType> extends IMessage<T> {
    channel: 'iopub';
}

/**
 * An experimental `'debug_request'` messsage on the `'control'` channel.
 *
 * @hidden
 *
 * #### Notes
 * Debug messages are experimental messages that are not in the official
 * kernel message specification. As such, this function is *NOT* considered
 * part of the public API, and may change without notice.
 */
export interface IDebugRequestMsg extends IControlMessage<'debug_request'> {
    content: {
        seq: number;
        type: 'request';
        command: string;
        arguments?: any;
    };
}

/**
 * An experimental `'debug_reply'` messsage on the `'control'` channel.
 *
 * @hidden
 *
 * #### Notes
 * Debug messages are experimental messages that are not in the official
 * kernel message specification. As such, this is *NOT* considered
 * part of the public API, and may change without notice.
 */
export interface IDebugReplyMsg extends IControlMessage<'debug_reply'> {
    content: {
        seq: number;
        type: 'response';
        request_seq: number;
        success: boolean;
        command: string;
        message?: string;
        body?: any;
    };
}

/**
 * An experimental `'debug_event'` message on the `'iopub'` channel
 *
 * @hidden
 *
 * #### Notes
 * Debug messages are experimental messages that are not in the official
 * kernel message specification. As such, this is *NOT* considered
 * part of the public API, and may change without notice.
 */
export interface IDebugEventMsg extends IIOPubMessage<'debug_event'> {
    content: {
        seq: number;
        type: 'event';
        event: string;
        body?: any;
    };
}

//------------------------------------------------------------------------------------

/**
 * the XeusDebugAdapter needs to be connected to:
 * - Jupyter's debug_request and debug_reply requests sent to the Control channel
 * - Jupyter's debug_event received from the IOPub channel
 */
export class XeusDebugAdapter implements vscode.DebugAdapter {

	private sendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();

	onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this.sendMessage.event;

	constructor(private kernel: IRunningKernel) {
		console.log(`xeus debug adapter`);

		// receive DAP responses from xeus control channel
		kernel.controlConnection.onReceive((reply: IDebugReplyMsg) => {
			this.sendMessage.fire(reply.content);
		});

		// receive DAP events from xeus iopub channel
		kernel.iopubConnection.onReceive((event: IDebugEventMsg) => {
			this.sendMessage.fire(event.content);
		});
	}

	handleMessage(message: DebugProtocol.ProtocolMessage): void {

		// just forward to xeus control channel
		this.kernel.controlConnection.sendRaw('debug_request', message);

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
		console.log('xeus debug adapter: dispose');
	}
}
