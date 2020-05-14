/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { KernelProvider } from './kernelProvider';
import * as wireProtocol from '@nteract/messaging';

(async () => {
  const kernelProvider = new KernelProvider();
  const kernels = await kernelProvider.getAvailableKernels();
  const spec = kernels.find(k => k.displayName === 'xpython') || kernels[0];
  console.log(
    `Found kernels: ${kernels.map(k => k.displayName).join(', ')}. Using ${spec?.displayName}`,
  );

  const launched = await kernelProvider.launchKernel(spec);
  launched.process.connectToProcessStdio();
  // launched.connection.messages.subscribe((message) => console.log('read message', message));

  launched.connection
    .sendAndReceive(wireProtocol.executeRequest('print("hello, world!")'))
    .subscribe(result => console.log('result', result.header.msg_type, result.content));
})();
