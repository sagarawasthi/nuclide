'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {BusySignalMessage} from '../../busy-signal-interfaces';
import type {NuclideUri} from '../../remote-uri';

import {Disposable, CompositeDisposable} from 'atom';

import {Subject} from 'rx';
import invariant from 'assert';

import {promises} from '../../commons';
const {isPromise} = promises;

export type MessageDisplayOptions = {
  onlyForFile: NuclideUri,
};

export class BusySignalProviderBase {
  messages: Subject<BusySignalMessage>;
  _nextId: number;
  constructor() {
    this.messages = new Subject();
    this._nextId = 0;
  }

  /**
   * Displays the message until the returned disposable is disposed
   */
  displayMessage(message: string, options?: MessageDisplayOptions): atom$IDisposable {
    if (options == null || options.onlyForFile == null) {
      return this._displayMessage(message);
    }

    let displayedDisposable = null;
    const disposeDisplayed = () => {
      if (displayedDisposable != null) {
        displayedDisposable.dispose();
        displayedDisposable = null;
      }
    };
    return new CompositeDisposable(
      atom.workspace.observeActivePaneItem(item => {
        if (item != null &&
            typeof item.getPath === 'function' &&
            item.getPath() === options.onlyForFile) {
          if (displayedDisposable == null) {
            displayedDisposable = this._displayMessage(message);
          }
        } else {
          disposeDisplayed();
        }
      }),
      // We can't add displayedDisposable directly because its value may change.
      new Disposable(disposeDisplayed)
    );
  }

  _displayMessage(message: string): atom$Disposable {
    const {busy, done} = this._nextMessagePair(message);
    this.messages.onNext(busy);
    return new Disposable(() => {
      this.messages.onNext(done);
    });
  }

  _nextMessagePair(message: string): {busy: BusySignalMessage, done: BusySignalMessage} {
    const busy = {
      status: 'busy',
      id: this._nextId,
      message,
    };
    const done = {
      status: 'done',
      id: this._nextId,
    };
    this._nextId++;
    return {busy, done};
  }

  /**
   * Publishes a 'busy' message with the given string. Marks it as done when the
   * promise returned by the given function is resolved or rejected.
   *
   * Used to indicate that some work is ongoing while the given asynchronous
   * function executes.
   */
  reportBusy<T>(message: string, f: () => Promise<T>, options?: MessageDisplayOptions): Promise<T> {
    const messageRemover = this.displayMessage(message, options);
    const removeMessage = messageRemover.dispose.bind(messageRemover);
    try {
      const returnValue = f();
      invariant(isPromise(returnValue));
      returnValue.then(removeMessage, removeMessage);
      return returnValue;
    } catch (e) {
      removeMessage();
      throw e;
    }
  }
}
