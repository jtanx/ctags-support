'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
let Promise = require('bluebird');
let ctags = require('ctags');
let es = require('event-stream');
let path = require('path');
let fs = require('fs');
let STATE_KEY = "ctagsSupport";
let navigationHistory = [];

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    //restore previous history
    restoreWorkspaceState(context,STATE_KEY,(val)=>{
        try{
            let savedState = JSON.parse(val);
            if(savedState.navigationHistory){
                navigationHistory = JSON.parse(val).navigationHistory;
            }
        }catch(e){
            console.log(e);
        }
    });
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "ctags-support" is now active!');

    // The commandId parameter must match the command field in package.json
    let disposableFindTags = vscode.commands.registerCommand('extension.findCTags', () => {
         console.log("Read .tag file from:"+path.join(vscode.workspace.rootPath,'.tags'));
         searchTags(context);
    });

    let disposableShowNavigationHistory = vscode.commands.registerCommand('extension.showNavigationHistory', () => {

        vscode.window.showQuickPick(navigationHistory).then(val=> {
            navigateToDefinition(val.filePath,val.pattern.slice(1, -1));//Should remove the first '/' and last '/' character
        });

    });

    let disposableClearAllNavigationHistory = vscode.commands.registerCommand('extension.clearAllNavigationHistory', () => {

        navigationHistory = [];

    });

    let disposableClearOneNavigationHistory = vscode.commands.registerCommand('extension.clearOneNavigationHistory', () => {

        vscode.window.showQuickPick(navigationHistory).then(val=> {
            navigationHistory = navigationHistory.filter((h:any) => {

                return h.filePath!==val.filePath && h.pattern!==val.pattern;

            });
            //navigateToDefinition(val.filePath,val.pattern.slice(1, -1));//Should remove the first '/' and last '/' character
        });

    });

    context.subscriptions.push(disposableFindTags);
    context.subscriptions.push(disposableShowNavigationHistory);
    context.subscriptions.push(disposableClearAllNavigationHistory);
    context.subscriptions.push(disposableClearOneNavigationHistory);
}

function searchTags(context: vscode.ExtensionContext) {
    let editor = getEditor();
    let query = getSelectedText(editor);

    ctags.findTags(path.join(vscode.workspace.rootPath,'.tags'), query, (error, tags=[]) =>{

            let displayFiles = tags.map((tag)=>{
                return {
                    description: "",
                    label: path.basename(tag.file)+" - "+tag.pattern.replace(/^\/?\^?(.*?)\$?\/?$/g, '$1'),
                    detail: tag.file,
                    filePath: path.join(vscode.workspace.rootPath,tag.file),
                    lineNumber:tag.lineNumber,
                    pattern:tag.pattern};
            });

            //Case 1. Only one tag founded
            if(displayFiles.length === 1){
                recordHistory(displayFiles[0]);
                saveWorkspaceState(context,STATE_KEY,{navigationHistory:navigationHistory});
                navigateToDefinition(displayFiles[0].filePath,displayFiles[0].pattern.slice(1, -1));//Should remove the first '/' and last '/' character
            //Case 2. Many tags founded
            }else  if(displayFiles.length > 0){
                vscode.window.showQuickPick(displayFiles).then(val=> {
                    recordHistory(val);
                    saveWorkspaceState(context,STATE_KEY,{navigationHistory:navigationHistory});
                    navigateToDefinition(val.filePath,val.pattern.slice(1, -1));//Should remove the first '/' and last '/' character
                });
             //Case 3. No tags founded
            }else{
                vscode.window.showInformationMessage('No related tags is founded for the "'+query+'"');
            }

        });


}

function recordHistory(visistedFile:any) {
    let isRecorded = false;
    if(navigationHistory.length < 20){
        navigationHistory.map((val)=>{
            //if the filePath was already in the Histroy, we will ignore it.
            if( val.filePath ===  visistedFile.filePath && val.pattern === visistedFile.pattern){
                isRecorded = true;
            }
        });
        if(!isRecorded){
            navigationHistory.push(visistedFile);
        }
    }else{
        navigationHistory.splice(1);
        navigationHistory.push(visistedFile);
    }

    //save to the session
    let savedState = {
        navigationHistory:navigationHistory
    }

}

function navigateToDefinition(filePath:string,pattern:string) {
    vscode.workspace.openTextDocument(filePath).then(d=> {
        vscode.window.showTextDocument(d).then(textEditor=>{
            findLineNumber(fs.createReadStream(d.fileName),pattern).then(lineNumber => {
                console.log("Going to", lineNumber)
                goToLine(lineNumber);
            })
            .catch(err => {
                console.error(err)
            });
        });
    });
}

function getEditor(): vscode.TextEditor {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    return editor;
}

function getSelectedText(editor: vscode.TextEditor) {
    let selection = editor.selection;
    let text = editor.document.getText(selection).trim();
    if (!text) {
        let range = editor.document.getWordRangeAtPosition(selection.active);
        text = editor.document.getText(range);
    }
    return text;
}

function findLineNumber(stream, reg: string) {
  let lineNumber = 0;
  let found = false;

  console.log("Attempting match for", reg)

  let matchWhole = false
  if (reg.startsWith("^")) {
    reg = reg.substring(1, reg.length)
  } else {
    console.error("Unsupported pattern '" + reg + "'")
  }

  if (reg.endsWith("$")) {
    reg = reg.substring(0, reg.length - 1)
    matchWhole = true
  }

  return new Promise((resolve, reject) => {
    stream
    .pipe(es.split())
    .pipe(es.mapSync(line => {
      stream.pause()
      if (!found) {
        lineNumber += 1
        if ((matchWhole && line === reg) || line.startsWith(reg)) {
          found = true
          console.log("Found", reg, "at", lineNumber)
          stream.destroy()
          resolve(lineNumber)
        }
      }
      stream.resume()
    })
    .on('end', () => {
      // EOF not found
      resolve(0)
    })
    .on('error', err => {
      reject(err)
    }))
  })
}

function goToLine(line: number) {
    if (!line) return
    let line = line-1;
    let newSelection = new vscode.Selection(line, 0, line, 0);
    vscode.window.activeTextEditor.selection = newSelection;
    vscode.window.activeTextEditor.revealRange(newSelection, vscode.TextEditorRevealType.InCenter);
}

function saveWorkspaceState(context : vscode.ExtensionContext, key: string,value:any): void {
    context.workspaceState.update(key, JSON.stringify(value));
}

function restoreWorkspaceState(context : vscode.ExtensionContext, key: string,callback:Function): void {
    callback(context.workspaceState.get(key,''));
}

// this method is called when your extension is deactivated
export function deactivate() {
}