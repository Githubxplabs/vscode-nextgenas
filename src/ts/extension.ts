/*
Copyright 2016 Bowler Hat LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
import {findSDK, findJava} from "./flexjs-utils";
import * as child_process from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as portfinder from "portfinder";
import * as vscode from "vscode";
import {LanguageClient, LanguageClientOptions, SettingMonitor,
	ServerOptions, StreamInfo, ErrorHandler, ErrorAction, CloseAction} from "vscode-languageclient";
import { Message } from "vscode-jsonrpc";

const MISSING_SDK_ERROR = "Could not locate Apache FlexJS SDK. Configure nextgenas.flexjssdk, add to $PATH, or set $FLEX_HOME.";
const MISSING_JAVA_ERROR = "Could not locate java in $JAVA_HOME or $PATH";
let savedChild: child_process.ChildProcess;
let savedContext: vscode.ExtensionContext;
let flexHome: string;
let javaExecutablePath: string;
let killed = false;
portfinder.basePort = 55282;

export function activate(context: vscode.ExtensionContext)
{
	savedContext = context;
	flexHome = findSDK();
	javaExecutablePath = findJava();
	vscode.workspace.onDidChangeConfiguration((event) =>
	{
		let newFlexHome = findSDK();
		if(flexHome != newFlexHome)
		{
			flexHome = newFlexHome;
			if(savedChild)
			{
				killed = true;
				//we are killing the process on purpose, so we don't care
				//about these events anymore
				savedChild.removeListener("exit", childExitListener);
				savedChild.removeListener("error", childErrorListener);
				savedChild.kill();
				savedChild = null;
			}
			startClient();
		}
	});
	vscode.commands.registerCommand("nextgenas.createASConfigTaskRunner", () =>
	{
		let vscodePath = path.resolve(vscode.workspace.rootPath, ".vscode/");
		let tasksPath = path.resolve(vscodePath, "tasks.json");
		vscode.workspace.openTextDocument(tasksPath).then((document: vscode.TextDocument) =>
		{
			//if it already exists, just open it. do nothing else.
			//even if it doesn't run asconfigc.
			vscode.window.showTextDocument(document);
		},
		() =>
		{
			let tasks = "{\n\t// See https://go.microsoft.com/fwlink/?LinkId=733558\n\t// for the documentation about the tasks.json format\n\t\"version\": \"0.1.0\",\n\t\"command\": \"asconfigc\",\n\t\"isShellCommand\": true,\n\t\"args\": [\n\t\t//\"--flexHome=path/to/sdk\"\n\t],\n\t\"showOutput\": \"always\"\n}";
			if(!fs.existsSync(vscodePath))
			{
				//on Windows, if the directory isn't created first, writing the
				//file will fail
				fs.mkdirSync(vscodePath);
			}
			fs.writeFileSync(tasksPath, tasks,
			{
				encoding: "utf8"
			});
			vscode.workspace.openTextDocument(tasksPath).then((document: vscode.TextDocument) =>
			{
				vscode.window.showTextDocument(document);
			}, () =>
			{
				vscode.window.showErrorMessage("Failed to create tasks.json for asconfigc.");
			});
		});
	});
	vscode.commands.registerTextEditorCommand("nextgenas.addImport", (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, qualifiedName: string) =>
	{
		if(!qualifiedName)
		{
			return;
		}
		let document = textEditor.document;
		let text = document.getText();
		let regExp = /^(\s*)import [\w\.]+/gm;
		let matches;
		let currentMatches;
		do
		{
			currentMatches = regExp.exec(text);
			if(currentMatches)
			{
				matches = currentMatches;
			}
		}
		while(currentMatches);
		let indent = "";
		let lineBreaks = "\n";
		let position: vscode.Position;
		if(matches)
		{
			position = document.positionAt(matches.index);
			indent = matches[1];
			position = new vscode.Position(position.line + 1, 0);
		}
		else //no existing imports
		{
			regExp = /^package( [\w\.]+)*\s*{[\r\n]+(\s*)/g;
			matches = regExp.exec(text);
			if(!matches)
			{
				return;
			}
			position = document.positionAt(regExp.lastIndex);
			indent = matches[2];
			lineBreaks += "\n"; //add an extra line break
			position = new vscode.Position(position.line, 0);
		}
		let textToInsert = indent + "import " + qualifiedName + ";" + lineBreaks;
		edit.insert(position, textToInsert);
	});

	startClient();
}

export function deactivate()
{
	 savedContext = null;
}

function childExitListener(code)
{
	console.info("Child process exited", code);
	if(code === 0)
	{
		return;
	}
	vscode.window.showErrorMessage("NextGen ActionScript extension exited with error code " + code);
}

function childErrorListener(error)
{
	vscode.window.showErrorMessage("Failed to start NextGen ActionScript extension.");
	console.error("Error connecting to child process.");
	console.error(error);
}

class CustomErrorHandler implements ErrorHandler
{
	private restarts: number[];

	constructor(private name: string)
	{
		this.restarts = [];
	}

	error(error: Error, message: Message, count): ErrorAction
	{
		//this is simply the default behavior
		if(count && count <= 3)
		{
			return ErrorAction.Continue;
		}
		return ErrorAction.Shutdown;
	}
	closed(): CloseAction
	{
		if(killed)
		{
			//we killed the process on purpose, so we will attempt to restart manually
			killed = false;
			return CloseAction.DoNotRestart;
		}
		if(!flexHome)
		{
			//if we can't find the SDK, we can't start the process
			vscode.window.showErrorMessage(MISSING_SDK_ERROR);
			return CloseAction.DoNotRestart;
		}
		if(!javaExecutablePath)
		{
			//if we can't find java, we can't restart the process
			vscode.window.showErrorMessage(MISSING_JAVA_ERROR);
			return CloseAction.DoNotRestart;
		}

		//this is the default behavior. the code above handles a special case
		//where we need to kill the process and restart it, but we don't want
		//that to be detected below.
		this.restarts.push(Date.now());
		if (this.restarts.length < 5)
		{
			return CloseAction.Restart;
		}
		else
		{
			let diff = this.restarts[this.restarts.length - 1] - this.restarts[0];
			if(diff <= 3 * 60 * 1000)
			{
				vscode.window.showErrorMessage(`The ${this.name} server crashed 5 times in the last 3 minutes. The server will not be restarted.`);
				return CloseAction.DoNotRestart;
			}
			else
			{
				this.restarts.shift();
				return CloseAction.Restart;
			}
		}
	}
}

function createLanguageServer(): Promise<StreamInfo>
{
	return new Promise((resolve, reject) =>
	{
		//immediately reject if flexjs or java cannot be found
		if(!flexHome)
		{
			reject(MISSING_SDK_ERROR);
			return;
		}
		if(!javaExecutablePath)
		{ 
			reject(MISSING_JAVA_ERROR);
			return;
		}
		portfinder.getPort((err, port) =>
		{
			let cpDelimiter = ":";
			if(process.platform === "win32")
			{
				cpDelimiter = ";";
			}
			let args =
			[
				"-cp",
				//the following jars are included with the language server
				path.resolve(savedContext.extensionPath, "target", "*") + cpDelimiter +
				path.resolve(savedContext.extensionPath, "target", "lib", "*") + cpDelimiter +
				//the following jars come from apache flexjs
				path.resolve(flexHome, "lib", "compiler.jar") + cpDelimiter +
				path.resolve(flexHome, "js", "lib", "jsc.jar"),
				//the language server communicates with vscode on this port
				"-Dnextgeas.vscode.port=" + port,
				"com.nextgenactionscript.vscode.Main",
			];
			//failed assertions in the compiler will crash the extension,
			//so this should not be enabled by default, even for debugging
			/*if(typeof global.v8debug === "object")
			{
				//enable java assertions when debugging extension
				args.unshift("-ea");
			}*/
			
			let server = net.createServer(socket =>
			{
				resolve(
				{
					reader: socket,
					writer: socket
				});
			});
			server.listen(port, () =>
			{
				let options =
				{
					cwd: vscode.workspace.rootPath
				};
				
				// Start the child java process
				savedChild = child_process.spawn(javaExecutablePath, args, options);
				savedChild.on("error", childErrorListener);
				savedChild.on("exit", childExitListener);
				if(savedChild.stdout)
				{
					savedChild.stdout.on("data", (data: Buffer) =>
					{
						console.log(data.toString("utf8"));
					});
				}
				if(savedChild.stderr)
				{
					savedChild.stderr.on("data", (data: Buffer) =>
					{
						console.error(data.toString("utf8"));
					});
				}
			});
		});
	});
}

function startClient()
{
	if(!savedContext)
	{
		//something very bad happened!
		return;
	}
	if(!flexHome)
	{
		vscode.window.showErrorMessage(MISSING_SDK_ERROR);
		return;
	}
	if(!javaExecutablePath)
	{ 
		vscode.window.showErrorMessage(MISSING_JAVA_ERROR);
		return;
	}

	let clientOptions: LanguageClientOptions =
	{
		documentSelector:
		[
			"nextgenas",
			"xml"
		],
		synchronize:
		{
			//the server will be notified when these files change
			fileEvents:
			[
				vscode.workspace.createFileSystemWatcher("**/asconfig.json"),
				vscode.workspace.createFileSystemWatcher("**/*.as"),
				vscode.workspace.createFileSystemWatcher("**/*.mxml"),
			]
		},
		errorHandler: new CustomErrorHandler("NextGen ActionScript")
	};
	vscode.languages.setLanguageConfiguration("nextgenas",
	{
		"onEnterRules":
		[
			{
				beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
				afterText: /^\s*\*\/$/,
				action:
				{
					indentAction: vscode.IndentAction.IndentOutdent,
					appendText: " * "
				}
			},
		]
	});
	let client = new LanguageClient("nextgenas", "NextGen ActionScript Language Server", createLanguageServer, clientOptions);
	let disposable = client.start();
	savedContext.subscriptions.push(disposable);
}