'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import invariant from 'assert';
import type {ProcessOutputDataHandlers} from '../../../process/output-store/lib/types';
import type {Dispatcher} from 'flux';
import {scriptSafeSpawnAndObserveOutput} from '../../../commons';
import ExecutorServer from '../../../react-native-node-executor';
import {Emitter} from 'atom';
import type {Disposable} from 'atom';
import React from 'react-for-atom';
import ReactNativeServerPanel from './ReactNativeServerPanel';
import ReactNativeServerActions from './ReactNativeServerActions';

export default class ReactNativeServerManager {

  _actions: ReactNativeServerActions;
  _dispatcher: Dispatcher;
  _emitter: Emitter;
  _processRunner: ?Object;
  _nodeExecutorServer: ?ExecutorServer;

  constructor(dispatcher: Dispatcher, actions: ReactNativeServerActions) {
    this._actions = actions;
    this._dispatcher = dispatcher;
    this._emitter = new Emitter();
    this._setupActions();
  }

  dispose() {
    this._stopServer();
    if (this._nodeExecutorServer) {
      this._nodeExecutorServer.close();
    }
  }

  subscribe(callback: () => void): Disposable {
    return this._emitter.on('change', callback);
  }

  isServerRunning(): boolean {
    return !!this._processRunner;
  }

  _setupActions() {
    this._dispatcher.register(action => {
      switch (action.actionType) {
        case ReactNativeServerActions.ActionType.START_NODE_EXECUTOR_SERVER:
          this._startNodeExecutorServer();
          break;
        case ReactNativeServerActions.ActionType.START_SERVER:
          this._startServer(action.serverCommand);
          break;
        case ReactNativeServerActions.ActionType.STOP_SERVER:
          this._stopServer();
          break;
        case ReactNativeServerActions.ActionType.RESTART_SERVER:
          this._stopServer();
          atom.workspace.destroyActivePaneItem();
          this._startServer(action.serverCommand);
          break;
      }
    });
  }

  _stopServer() {
    this._processRunner && this._processRunner.dispose();
    this._processRunner = null;
    this._emitter.emit('change');
  }

  async _startServer(serverCommand: string): Promise<void> {
    let processRunner = this._processRunner;
    if (processRunner == null) {
      processRunner = await this._createProcessRunner(serverCommand);
      if (processRunner == null) {
        return;
      }
      this._processRunner = processRunner;
      this._emitter.emit('change');
    }
    invariant(processRunner);
    processRunner.run();
  }

  async _createProcessRunner(serverCommand: string): Promise<?Object> {
    const getRunCommandInNewPane = require('../../../process/output');
    const {runCommandInNewPane, disposable} = getRunCommandInNewPane();

    const runProcessWithHandlers = (dataHandlerOptions: ProcessOutputDataHandlers) => {
      const {stdout, stderr, error, exit} = dataHandlerOptions;
      invariant(serverCommand);
      const observable = scriptSafeSpawnAndObserveOutput(serverCommand);
      const onNext = (data: {stdout: string} | {stderr: string}) => {
        if (data.stdout) {
          stdout(data.stdout);
        } else {
          stderr(data.stderr);
        }
      };
      const onError = (data: string) => {
        error(new Error(data));
        exit(1);
        disposable.dispose();
      };
      const onExit = () => {
        exit(0);
        disposable.dispose();
      };
      const subscription = observable.subscribe(onNext, onError, onExit);

      return Promise.resolve({
        kill() {
          subscription.dispose();
          disposable.dispose();
        },
      });
    };

    const {ProcessOutputStore} = require('../../../process/output-store');
    const processOutputStore = new ProcessOutputStore(runProcessWithHandlers);

    const panel =
      <ReactNativeServerPanel
        actions={this._actions}
        store={this}
        serverCommand={serverCommand}
      />;

    let isOutputPaneOpen = false;
    let paneSubscription;

    // We don't want to call getRunCommandInNewPane() multiple times because it has unwanted
    // side effects. So, we cache the output of runCommandInNewPane function and use the same
    // instance of runCommandInNewPane to re-open output pane for the same server process.
    return {
      run: async () => {
        if (isOutputPaneOpen) {
          return;
        }
        const textEditor = await runCommandInNewPane({
          tabTitle: 'React Native Server',
          processOutputStore,
          processOutputViewTopElement: panel,
        });
        isOutputPaneOpen = true;

        paneSubscription = atom.workspace.onDidDestroyPaneItem(event => {
          if (event.item === textEditor) {
            isOutputPaneOpen = false;
            invariant(paneSubscription);
            paneSubscription.dispose();
            paneSubscription = null;
          }
        });
      },

      dispose: () => {
        processOutputStore && processOutputStore.stopProcess();
        paneSubscription && paneSubscription.dispose();
      },
    };
  }

  async _attachNodeDebugger(pid: number): Promise<void> {
    atom.commands.dispatch(atom.views.getView(atom.workspace), 'nuclide-debugger:show');
    const debuggerService = await require('../../../service-hub-plus')
      .consumeFirstProvider('nuclide-debugger.remote');
    debuggerService.debugNode(pid);
  }

  _startNodeExecutorServer() {
    if (!this._nodeExecutorServer) {
      this._nodeExecutorServer = new ExecutorServer(8090);
      this._nodeExecutorServer.onDidEvalApplicationScript(this._attachNodeDebugger.bind(this));
    }
  }
}
