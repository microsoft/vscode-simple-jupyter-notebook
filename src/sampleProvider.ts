import * as vscode from 'vscode';
import { NotebookKernel } from './notebookKernel';

export class SampleProvider extends NotebookKernel implements vscode.NotebookContentProvider {
  public readonly onDidChangeNotebook = new vscode.EventEmitter<vscode.NotebookDocumentEditEvent>()
    .event;

  /**
   * @inheritdoc
   */
  public async openNotebook(uri: vscode.Uri): Promise<vscode.NotebookData> {
    try {
      const contents = await vscode.workspace.fs.readFile(uri);
      const json = JSON.parse(Buffer.from(contents).toString('utf8'));
      return {
        cells: [
          json.cells.map((cell: { source: string }) => ({
            cellKind: vscode.CellKind.Code,
            source: cell.source,
            language: 'python',
            outputs: [],
            metadata: {},
          })),
        ],
        languages: ['python'],
        metadata: {},
      };
    } catch {
      return {
        cells: [
          {
            cellKind: vscode.CellKind.Code,
            source: 'print("hello world!")',
            language: 'python',
            outputs: [],
            metadata: {},
          },
        ],
        languages: ['python'],
        metadata: {},
      };
    }
  }

  /**
   * @inheritdoc
   */
  public async saveNotebook(): Promise<void> {
    return Promise.resolve(); // not implemented
  }

  /**
   * @inheritdoc
   */
  public async saveNotebookAs(): Promise<void> {
    return Promise.resolve(); // not implemented
  }
}
