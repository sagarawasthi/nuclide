'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

const {CompositeDisposable} = require('atom');
let logger = null;

function getLogger() {
  return logger || (logger = require('../../logging').getLogger());
}

class FileWatcher {

  _editor: TextEditor;
  _subscriptions: CompositeDisposable;

  constructor(editor: TextEditor) {
    this._editor = editor;
    this._subscriptions = new CompositeDisposable();
    if (this._editor == null) {
      getLogger().warn('No editor instance on this._editor');
      return;
    }
    this._subscriptions.add(this._editor.onDidConflict(() => {
      if (this._shouldPromptToReload()) {
        getLogger().info('Conflict at file: ' + this._editor.getPath());
        this._promptReload();
      }
    }));
  }

  _shouldPromptToReload(): boolean {
    return this._editor.getBuffer().isInConflict();
  }

  async _promptReload(): Promise {
    const {getPath, basename} = require('../../remote-uri');

    const filePath = this._editor.getPath();
    const encoding = this._editor.getEncoding();
    const fileName = basename(filePath);
    const choice = atom.confirm({
      message: fileName + ' has changed on disk.',
      buttons: ['Reload', 'Compare', 'Ignore'],
    });
    if (choice === 2) {
      return;
    }
    if (choice === 0) {
      const buffer = this._editor.getBuffer();
      if (buffer) {
        buffer.reload();
      }
      return;
    }

    const {getFileSystemServiceByNuclideUri} = require('../../client');

    // Load the file contents locally or remotely.
    const localFilePath = getPath(filePath);
    const filesystemContents = (await getFileSystemServiceByNuclideUri(filePath).
      readFile(localFilePath)).toString(encoding);

    // Open a right split pane to compare the contents.
    // TODO: We can use the diff-view here when ready.
    const splitEditor = await atom.workspace.open(null, {split: 'right'});

    splitEditor.insertText(filesystemContents);
    splitEditor.setGrammar(this._editor.getGrammar());
  }

  destroy() {
    if (!this._subscriptions) {
      return;
    }
    this._subscriptions.dispose();
    this._subscriptions = null;
  };
}

module.exports = FileWatcher;
