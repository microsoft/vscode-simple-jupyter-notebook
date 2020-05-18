/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as getPort from 'get-port';
import * as crypto from 'crypto';
import * as zmq from 'zeromq';
import { promises as fs } from 'fs';
import { promiseMap } from './util';
import * as wireProtocol from '@nteract/messaging/lib/wire-protocol';
import { join } from 'path';
import { tmpdir } from 'os';
import { IDisposable } from './disposable';
import { Subject, Observable, from } from 'rxjs';
import { ignoreElements, concat, filter } from 'rxjs/operators';
import { JupyterMessageHeader, TypedJupyerMessage } from './messaging';
import { MessageType as OriginalMessageType } from '@nteract/messaging';

/* Interacting with the Python interface that likes lots of snake_cases: */
/* eslint-disable @typescript-eslint/camelcase */

interface ISockets {
  key: string;
  signatureScheme: string;
  heartbeat: { port: number; socket: zmq.Push };
  control: { port: number; socket: zmq.Dealer };
  shell: { port: number; socket: zmq.Dealer };
  stdin: { port: number; socket: zmq.Dealer };
  iopub: { port: number; socket: zmq.Subscriber };
}

type SendChannel = 'control' | 'shell' | 'stdin';
type ReceiveChannel = 'control' | 'shell' | 'stdin' | 'iopub';

export type IOChannel = SendChannel | ReceiveChannel;

const fromRawMessage = <MT extends OriginalMessageType, C = unknown>(
  channel: IOChannel,
  rawMessage: wireProtocol.RawJupyterMessage<MT, C>,
): TypedJupyerMessage =>
  (({
    ...rawMessage,
    channel,
    buffers: rawMessage.buffers ? Buffer.concat(rawMessage.buffers) : undefined,
  } as unknown) as TypedJupyerMessage);

const toRawMessage = (rawMessage: TypedJupyerMessage): wireProtocol.RawJupyterMessage => {
  return {
    ...rawMessage,
    header: rawMessage.header as JupyterMessageHeader<never>,
    parent_header: rawMessage.parent_header as JupyterMessageHeader<OriginalMessageType>,
    buffers: rawMessage.buffers ? [Buffer.from(rawMessage.buffers)] : [],
    idents: [],
  };
};

export class Connection implements IDisposable {
  public readonly messages = new Subject<TypedJupyerMessage>();

  /**
   * Establishes a new Connection listening in ports and with a connection
   * file ready to pass to a kernel.
   */
  public static async create() {
    const routingId = crypto.randomBytes(8).toString('hex');
    const sockets: ISockets = await promiseMap({
      key: crypto.randomBytes(32).toString('hex'),
      signatureScheme: 'hmac-sha256',
      control: createSocket(new zmq.Dealer({ routingId })),
      heartbeat: createSocket(new zmq.Push()),
      iopub: createSocket(new zmq.Subscriber()),
      shell: createSocket(new zmq.Dealer({ routingId })),
      stdin: createSocket(new zmq.Dealer({ routingId })),
    });

    sockets.iopub.socket.subscribe();

    const cnx = new Connection(sockets, await createConnectionFile(sockets));
    cnx.processSocketMessages('control', sockets.control.socket);
    cnx.processSocketMessages('iopub', sockets.iopub.socket);
    cnx.processSocketMessages('shell', sockets.shell.socket);
    cnx.processSocketMessages('stdin', sockets.stdin.socket);
    return cnx;
  }

  protected constructor(
    private readonly sockets: ISockets,
    public readonly connectionFile: string,
  ) {}

  private async processSocketMessages(
    channel: ReceiveChannel,
    socket: zmq.Dealer | zmq.Subscriber,
  ) {
    for await (const msg of socket) {
      const message = wireProtocol.decode(msg, this.sockets.key, this.sockets.signatureScheme);
      this.messages.next(fromRawMessage(channel, message));
    }
  }

  /**
   * Sends the message and returns a string of followup messages received
   * in response to it.
   */
  public sendAndReceive(message: TypedJupyerMessage): Observable<TypedJupyerMessage> {
    return from(this.sendRaw(message)).pipe(
      ignoreElements(),
      concat(this.messages),
      filter(msg => msg.parent_header?.msg_id === message.header.msg_id),
    );
  }

  /**
   * Sends a raw Jupyter kernel message.
   */
  public sendRaw(message: TypedJupyerMessage) {
    const data = wireProtocol.encode(
      toRawMessage(message),
      this.sockets.key,
      this.sockets.signatureScheme,
    );
    return this.sockets[message.channel as SendChannel].socket.send(data);
  }

  /**
   * Frees unmanaged resources.
   */
  public dispose() {
    this.sockets.control.socket.close();
    this.sockets.heartbeat.socket.close();
    this.sockets.iopub.socket.close();
    this.sockets.shell.socket.close();
    this.sockets.stdin.socket.close();
    fs.unlink(this.connectionFile).catch(() => {
      /* it's a temp file, just ignore */
    });
  }
}

async function createConnectionFile(sockets: ISockets, host = '127.0.0.1'): Promise<string> {
  const contents = JSON.stringify({
    control_port: sockets.control.port,
    shell_port: sockets.shell.port,
    hb_port: sockets.heartbeat.port,
    stdin_port: sockets.stdin.port,
    iopub_port: sockets.iopub.port,
    transport: 'tcp',
    ip: host,
    signature_scheme: sockets.signatureScheme,
    key: sockets.key,
  });

  const fname = join(tmpdir(), `xues-notebook-cnf-${crypto.randomBytes(8).toString('hex')}.json`);
  await fs.writeFile(fname, contents);
  return fname;
}

async function createSocket<T extends zmq.Socket>(socket: T): Promise<{ socket: T; port: number }> {
  const port = await getPort();
  socket.connect(`tcp://127.0.0.1:${port}`);
  return { port, socket };
}
