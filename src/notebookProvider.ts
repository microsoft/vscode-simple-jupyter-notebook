/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

declare var TextEncoder: any;

// const mjAPI = require('mathjax-node');
// mjAPI.config({
// 	MathJax: {
// 		// traditional MathJax configuration
// 	}
// });
// mjAPI.start();

interface CellStreamOutput {
	output_type: 'stream';
	text: string;
}

interface CellErrorOutput {
	output_type: 'error';
	/**
	 * Exception Name
	 */
	ename: string;
	/**
	 * Exception Value
	 */
	evalue: string;
	/**
	 * Exception call stack
	 */
	traceback: string[];
}

interface CellDisplayOutput {
	output_type: 'display_data' | 'execute_result';
	data: { [key: string]: any };
}

export type RawCellOutput = CellStreamOutput | CellErrorOutput | CellDisplayOutput;

export interface RawCell {
	cell_type: 'markdown' | 'code';
	outputs?: RawCellOutput[];
	source: string[];
	metadata: any;
	execution_count?: number;
}

export class Cell {
	public outputs: vscode.CellOutput[] = [];

	constructor(
		public source: string[],
		public cell_type: 'markdown' | 'code',
		private _outputs: vscode.CellOutput[]
	) {

	}

	containHTML() {
		return this._outputs && this._outputs.some(output => {
			if (output.outputKind === vscode.CellOutputKind.Rich && output.data['text/html']) {
				return true;
			}

			return false;
		});
	}

	insertDependencies(dependency: vscode.CellOutput) {
		this._outputs.unshift(dependency);
	}

	fillInOutputs() {
		if (this._outputs && this.outputs.length !== this._outputs.length) {
			this.outputs = this._outputs;
		}
	}

	outputsFullFilled() {
		return this._outputs && this.outputs.length === this._outputs.length;
	}

	clearOutputs() {
		this.outputs = [];
	}
}

function transformOutputToCore(rawOutput: RawCellOutput): vscode.CellOutput {
	if (rawOutput.output_type === 'execute_result' || rawOutput.output_type === 'display_data') {
		return {
			outputKind: vscode.CellOutputKind.Rich,
			data: rawOutput.data
		} as vscode.CellDisplayOutput;
	} else if (rawOutput.output_type === 'stream') {
		return {
			outputKind: vscode.CellOutputKind.Text,
			text: rawOutput.text
		} as vscode.CellStreamOutput;
	} else {
		return {
			outputKind: vscode.CellOutputKind.Error,
			ename: (<CellErrorOutput>rawOutput).ename,
			evalue: (<CellErrorOutput>rawOutput).evalue,
			traceback: (<CellErrorOutput>rawOutput).traceback
		} as vscode.CellErrorOutput;
	}
}

function transformOutputFromCore(output: vscode.CellOutput): RawCellOutput {
	if (output.outputKind === vscode.CellOutputKind.Text) {
		return {
			output_type: 'stream',
			text: output.text
		};
	} else if (output.outputKind === vscode.CellOutputKind.Error) {
		return {
			output_type: 'error',
			ename: output.ename,
			evalue: output.evalue,
			traceback: output.traceback
		};
	} else {
		return {
			output_type: 'display_data',
			data: output.data
		};
	}
}

export class JupyterNotebook {
	public mapping: Map<number, any> = new Map();
	private preloadScript = false;
	private displayOrders = [
		'application/vnd.*',
		'application/json',
		'application/javascript',
		'text/html',
		'image/svg+xml',
		'text/markdown',
		'image/svg+xml',
		'image/png',
		'image/jpeg',
		'text/plain'
	];
	private nextExecutionOrder = 0;

	constructor(
		private _extensionPath: string,
		public notebookJSON: any,
		private fillOutputs: boolean
	) {
		// editor.document.languages = ['python'];
		// editor.document.displayOrder = this.displayOrders;
		// editor.document.metadata = {
		// };
	}

	resolve(): vscode.NotebookData {
		return {
			languages: ['python'],
			metadata: {
				editable: this.notebookJSON?.metadata?.editable === undefined ? true : this.notebookJSON?.metadata?.editable,
				runnable: this.notebookJSON?.metadata?.runnable === undefined ? true : this.notebookJSON?.metadata?.runnable,
				cellEditable: this.notebookJSON?.metadata?.cellEditable === undefined ? true : this.notebookJSON?.metadata?.cellEditable,
				cellRunnable: this.notebookJSON?.metadata?.cellRunnable === undefined ? true : this.notebookJSON?.metadata?.cellRunnable,
				displayOrder: this.displayOrders,
			},
			cells: this.notebookJSON.cells.map(((raw_cell: RawCell) => {
				let outputs: vscode.CellOutput[] = [];
				if (this.fillOutputs) {
					outputs = raw_cell.outputs?.map(rawOutput => transformOutputToCore(rawOutput)) || [];

					if (!this.preloadScript) {
						let containHTML = this.containHTML(raw_cell);

						if (containHTML) {
							this.preloadScript = true;
							const scriptPathOnDisk = vscode.Uri.file(
								path.join(this._extensionPath, 'dist', 'ipywidgets.js')
							);

							let scriptUri = scriptPathOnDisk.with({ scheme: 'vscode-resource' });

							outputs.unshift(
								{
									outputKind: vscode.CellOutputKind.Rich,
									'data': {
										'text/html': [
											`<script src="${scriptUri}"></script>\n`,
										]
									}
								}
							);
						}
					}
				}

				const executionOrder = typeof raw_cell.execution_count === 'number' ? raw_cell.execution_count : undefined;
				if (typeof executionOrder === 'number') {
					if (executionOrder >= this.nextExecutionOrder) {
						this.nextExecutionOrder = executionOrder + 1;
					}
				}

				const cellEditable = raw_cell.metadata?.editable;
				const runnable = raw_cell.metadata?.runnable;
				const metadata = { editable: cellEditable, runnable: runnable, executionOrder };

				return {
					source: raw_cell.source ? raw_cell.source.join('') : '',
					language: this.notebookJSON?.metadata?.language_info?.name || 'python',
					cellKind: raw_cell.cell_type === 'code' ? vscode.CellKind.Code : vscode.CellKind.Markdown,
					outputs: outputs,
					metadata
				};
			}))
		}
	}

	private getNextExecutionOrder(): number {
		return this.nextExecutionOrder++;
	}

	async execute(document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined) {
		if (cell) {
			const index = document.cells.indexOf(cell);
			let rawCell: RawCell = this.notebookJSON.cells[index];

			if (!this.preloadScript) {
				let containHTML = this.containHTML(rawCell);
				if (containHTML) {
					this.preloadScript = true;
					const scriptPathOnDisk = vscode.Uri.file(
						path.join(this._extensionPath, 'dist', 'ipywidgets.js')
					);

					let scriptUri = scriptPathOnDisk.with({ scheme: 'vscode-resource' });

					rawCell.outputs?.unshift(
						{
							'output_type': 'display_data',
							'data': {
								'text/html': [
									`<script src="${scriptUri}"></script>\n`,
								]
							}
						}
					);
				}
			}
			cell.outputs = rawCell.outputs?.map(rawOutput => transformOutputToCore(rawOutput)) || [];
			const executionOrder = this.getNextExecutionOrder();
			if (cell.metadata) {
				cell.metadata.executionOrder = executionOrder;
			}
		} else {
			if (!this.fillOutputs) {
				for (let i = 0; i < document.cells.length; i++) {
					let cell = document.cells[i];

					let rawCell: RawCell = this.notebookJSON.cells[i];

					if (!this.preloadScript) {
						let containHTML = this.containHTML(rawCell);
						if (containHTML) {
							this.preloadScript = true;
							const scriptPathOnDisk = vscode.Uri.file(
								path.join(this._extensionPath, 'dist', 'ipywidgets.js')
							);

							let scriptUri = scriptPathOnDisk.with({ scheme: 'vscode-resource' });

							rawCell.outputs?.unshift(
								{
									'output_type': 'display_data',
									'data': {
										'text/html': [
											`<script src="${scriptUri}"></script>\n`,
										]
									}
								}
							);
						}
					}
					cell.outputs = rawCell.outputs?.map(rawOutput => transformOutputToCore(rawOutput)) || [];
					const executionOrder = this.getNextExecutionOrder();
					if (cell.metadata) {
						cell.metadata.executionOrder = executionOrder;
					}
				}

				this.fillOutputs = true;
			}
		}
	}

	containHTML(rawCell: RawCell) {
		return rawCell.outputs && rawCell.outputs.some((output: any) => {
			if (output.output_type === 'display_data' && output.data['text/html']) {
				return true;
			}

			return false;
		});
	}
}

async function timeFn(fn: () => Promise<void>): Promise<number> {
	const startTime = Date.now();
	await fn();
	return Date.now() - startTime;
}

// For test
const DELAY_EXECUTION = true;

export class NotebookProvider implements vscode.NotebookContentProvider, vscode.NotebookKernel {
	private _onDidChangeNotebook = new vscode.EventEmitter<vscode.NotebookDocumentEditEvent>();
	onDidChangeNotebook: vscode.Event<vscode.NotebookDocumentEditEvent> = this._onDidChangeNotebook.event;
	private _notebooks: Map<string, JupyterNotebook> = new Map();
	onDidChange: vscode.Event<void> = new vscode.EventEmitter<void>().event;
	label: string = 'Jupyter';
	kernel?: vscode.NotebookKernel;

	constructor(private _extensionPath: string, private fillOutputs: boolean) {
		this.kernel = this;
	}

	async openNotebook(uri: vscode.Uri): Promise<vscode.NotebookData> {
		try {
			let content = await vscode.workspace.fs.readFile(uri);
			let json: any = {};
			try {
				json = JSON.parse(content.toString());
			} catch {
				json = {
					cells: [{
						cell_type: 'markdown',
						source: [
							'# header'
						]
					}]
				};
			}
			let jupyterNotebook = new JupyterNotebook(this._extensionPath, json, this.fillOutputs);
			this._notebooks.set(uri.toString(), jupyterNotebook);
			return jupyterNotebook.resolve();
		} catch {
			throw new Error('Fail to load the document');
		}
	}



	async saveNotebook(document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<void> {
		return this._save(document, document.uri, token);
	}

	saveNotebookAs(targetResource: vscode.Uri, document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<void> {
		return this._save(document, targetResource, token);
	}

	async _save(document: vscode.NotebookDocument, targetResource: vscode.Uri, _token: vscode.CancellationToken): Promise<void> {
		let cells: RawCell[] = [];

		for (let i = 0; i < document.cells.length; i++) {
			let lines = document.cells[i].document.getText().split(/\r|\n|\r\n/g);
			let source = lines.map((value, index) => {
				if (index !== lines.length - 1) {
					return value + '\n';
				} else {
					return value;
				}
			});

			if (document.cells[i].cellKind === vscode.CellKind.Markdown) {
				cells.push({
					source: source,
					metadata: {
						language_info: {
							name: document.cells[i].language || 'markdown'
						}
					},
					cell_type: document.cells[i].cellKind === vscode.CellKind.Markdown ? 'markdown' : 'code'
				});
			} else {
				cells.push({
					source: source,
					metadata: {
						language_info: {
							name: document.cells[i].language || 'markdown'
						}
					},
					cell_type: document.cells[i].cellKind === vscode.CellKind.Markdown ? 'markdown' : 'code',
					outputs: document.cells[i].outputs.map(output => transformOutputFromCore(output)),
					execution_count: document.cells[i].metadata?.executionOrder
				});
			}
		}

		let raw = this._notebooks.get(document.uri.toString());

		if (raw) {
			raw.notebookJSON.cells = cells;
			let content = JSON.stringify(raw.notebookJSON, null, 4);
			await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(content));
		} else {
			let content = JSON.stringify({ cells: cells }, null, 4);
			await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(content));
		}

		return;
	}

	async executeAllCells(document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<void> {
		await this.executeCell(document, undefined, token);
	}

	async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined, token: vscode.CancellationToken): Promise<void> {
		if (cell) {
			cell.metadata.statusMessage = 'Running';
			cell.metadata.runStartTime = Date.now();
			cell.metadata.runState = vscode.NotebookCellRunState.Running;
		}

		const duration = await timeFn(async () => {
			if (DELAY_EXECUTION) {
				return this._executeCellDelayed(document, cell, token);
			}

			const jupyterNotebook = this._notebooks.get(document.uri.toString());
			if (jupyterNotebook) {
				return jupyterNotebook.execute(document, cell);
			}
		});

		if (cell) {
			cell.metadata.lastRunDuration = duration;
			cell.metadata.statusMessage = 'Success'
			cell.metadata.runState = vscode.NotebookCellRunState.Success;
		}
	}

	private async _executeCellDelayed(document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined, token: vscode.CancellationToken): Promise<void> {
		let jupyterNotebook = this._notebooks.get(document.uri.toString());
		return new Promise(async resolve => {
			token.onCancellationRequested(() => {
				resolve();
			});

			await new Promise(resolve => setTimeout(resolve, Math.random() * 2500));
			if (jupyterNotebook && !token.isCancellationRequested) {
				return jupyterNotebook.execute(document, cell).then(resolve);
			}
		});
	}

	async revertNotebook(_document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken): Promise<void> {
		return;
	}

	async backupNotebook(document: vscode.NotebookDocument, context: vscode.NotebookDocumentBackupContext, cancellation: vscode.CancellationToken): Promise<vscode.NotebookDocumentBackup> {
		await this._save(document, context.destination, cancellation);
		const uri = document.uri;

		return {
			id: document.uri.toString(),
			delete: () => {
				vscode.workspace.fs.delete(uri);
			}
		};
	}
}
