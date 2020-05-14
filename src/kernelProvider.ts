/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { homedir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';
import { exists, uniqueBy } from './util';
import { Connection } from './connection';
import { spawn } from 'child_process';
import { KernelProcess } from './kernelProcess';
import { IDisposable } from './disposable';

export interface IKernelSpec {
  id: string;
  location: string;
  locationType: LocationType;
  binary: string;
  argv: ReadonlyArray<string>;
  displayName: string;
  language: string;
  iconDataUri?: string;
}

export const enum LocationType {
  Global,
  User,
}

export interface IRunningKernel extends IDisposable {
  connection: Connection;
  process: KernelProcess;
}

export class KernelProvider {
  /**
   * Returns a rougly prioritized list of available
   * kernels available on the system.
   */
  public async getAvailableKernels() {
    // Search paths from Jupyer docs + what I observed on Conda
    // @see https://jupyter-client.readthedocs.io/en/stable/kernels.html
    const searchPaths: { type: LocationType; path: string }[] = [];
    if (process.env.CONDA_PREFIX) {
      searchPaths.push(
        { type: LocationType.User, path: join(process.env.CONDA_PREFIX, 'share/jupyter/kernels') },
        {
          type: LocationType.User,
          path: join(process.env.CONDA_PREFIX, 'local/share/jupyter/kernels'),
        },
      );
    }

    if (process.platform === 'win32') {
      searchPaths.push(
        { type: LocationType.User, path: `${process.env.APPDATA}\\jupyter\\kernels` },
        { type: LocationType.Global, path: `${process.env.PROGRAMDATA}\\jupyter\\kernels` },
      );
    } else {
      searchPaths.push(
        { type: LocationType.User, path: `${homedir()}/Library/Jupyter/kernels` },
        { type: LocationType.User, path: `${homedir()}/.local/share/jupyter/kernels` },
        { type: LocationType.User, path: `/opt/conda/share/jupyter/kernels` },
        { type: LocationType.User, path: `/opt/conda/local/share/jupyter/kernels` },
        { type: LocationType.Global, path: '/usr/share/jupyter/kernels' },
        { type: LocationType.Global, path: '/usr/local/share/jupyter/kernels' },
      );
    }

    // In each folder, there can be subdirectories that contain the `kernel.json`
    // and logo. Extract and return those.
    let specs: Promise<IKernelSpec>[] = [];
    for (const { path, type } of searchPaths) {
      let kernels: string[];
      try {
        kernels = await fs.readdir(path);
      } catch {
        continue;
      }

      specs = specs.concat(
        kernels.map(async kernel => {
          const jsonPath = join(path, kernel, 'kernel.json');
          const iconPath = join(path, kernel, 'logo-64x64.png');
          const rawSpec = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
          return {
            id: [path, ...rawSpec.argv, rawSpec.language].join(' '),
            location: path,
            locationType: type,
            binary: rawSpec.argv[0],
            argv: rawSpec.argv.slice(1),
            displayName: rawSpec.display_name,
            language: rawSpec.language,
            iconDataUri: (await exists(iconPath))
              ? `image/png;base64,${await fs.readFile(iconPath, 'base64')}`
              : undefined,
          };
        }),
      );
    }

    return uniqueBy(await Promise.all(specs), spec => spec.id);
  }

  /**
   * Launches the given kernel specification.
   */
  public async launchKernel(spec: IKernelSpec): Promise<IRunningKernel> {
    const connection = await Connection.create();
    const process = new KernelProcess(
      spawn(
        spec.binary,
        spec.argv.map(arg => arg.replace('{connection_file}', connection.connectionFile)),
        { stdio: 'pipe' },
      ),
    );

    return {
      connection,
      process,
      dispose: () => {
        connection.dispose();
        process.dispose();
      },
    };
  }
}
