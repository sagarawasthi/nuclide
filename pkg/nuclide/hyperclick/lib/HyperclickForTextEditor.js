'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {HyperclickSuggestion} from '../../hyperclick-interfaces';

import type Hyperclick from './Hyperclick';
import type {TimingTracker} from '../../analytics';

import {trackTiming, startTracking} from '../../analytics';
import getWordTextAndRange from './get-word-text-and-range';
import invariant from 'assert';

/**
 * Construct this object to enable Hyperclick in a text editor.
 * Call `dispose` to disable the feature.
 */
export default class HyperclickForTextEditor {
  _textEditor: atom$TextEditor;
  _textEditorView: atom$TextEditorElement;
  _hyperclick: Hyperclick;
  _lastMouseEvent: ?MouseEvent;
  _lastPosition: ?atom$Point;
  _lastSuggestionAtMousePromise: ?Promise<HyperclickSuggestion>;
  _lastSuggestionAtMouse: ?HyperclickSuggestion;
  _navigationMarkers: ?Array<atom$Marker>;
  _lastWordRange: ?atom$Range;
  _onMouseMove: (event: MouseEvent) => void;
  _onMouseDown: (event: MouseEvent) => void;
  _onKeyDown: (event: SyntheticKeyboardEvent) => void;
  _onKeyUp: (event: SyntheticKeyboardEvent) => void;
  _commandSubscription: atom$Disposable;
  _isDestroyed: boolean;
  _loadingTracker: ?TimingTracker;

  constructor(textEditor: atom$TextEditor, hyperclick: Hyperclick) {
    this._textEditor = textEditor;
    this._textEditorView = atom.views.getView(textEditor);

    this._hyperclick = hyperclick;

    this._lastMouseEvent = null;
    this._lastPosition = null;
    // We store the original promise that we use to retrieve the last suggestion
    // so callers can also await it to know when it's available.
    this._lastSuggestionAtMousePromise = null;
    // We store the last suggestion since we must await it immediately anyway.
    this._lastSuggestionAtMouse = null;
    this._navigationMarkers = null;

    this._lastWordRange = null;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._textEditorView.addEventListener('mousemove', this._onMouseMove);
    this._onMouseDown = this._onMouseDown.bind(this);
    const {component} = this._textEditorView;
    invariant(component);
    component.linesComponent.getDomNode().addEventListener('mousedown', this._onMouseDown);

    this._onKeyDown = this._onKeyDown.bind(this);
    this._textEditorView.addEventListener('keydown', this._onKeyDown);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._textEditorView.addEventListener('keyup', this._onKeyUp);

    this._commandSubscription = atom.commands.add(this._textEditorView, {
      'hyperclick:confirm-cursor': () => this._confirmSuggestionAtCursor(),
    });

    this._isDestroyed = false;
    this._loadingTracker = null;
  }

  _confirmSuggestion(suggestion: HyperclickSuggestion): void {
    if (Array.isArray(suggestion.callback) && suggestion.callback.length > 0) {
      this._hyperclick.showSuggestionList(this._textEditor, suggestion);
    } else {
      invariant(typeof suggestion.callback === 'function');
      suggestion.callback();
    }
  }

  _onMouseMove(event: MouseEvent): void {
    if (this._isLoading()) {
      // Show the loading cursor.
      this._textEditorView.classList.add('hyperclick-loading');
    }

    // We save the last `MouseEvent` so the user can trigger Hyperclick by
    // pressing the key without moving the mouse again. We only save the
    // relevant properties to prevent retaining a reference to the event.
    this._lastMouseEvent = ({
      clientX: event.clientX,
      clientY: event.clientY,
    }: any);


    // Don't fetch suggestions if the mouse is still in the same 'word', where
    // 'word' is a whitespace-delimited group of characters.
    //
    // If the last suggestion had multiple ranges, we have no choice but to
    // fetch suggestions because the new word might be between those ranges.
    // This should be ok because it will reuse that last suggestion until the
    // mouse moves off of it.
    const lastSuggestionIsNotMultiRange = !this._lastSuggestionAtMouse ||
        !Array.isArray(this._lastSuggestionAtMouse.range);
    if (this._isMouseAtLastWordRange() && lastSuggestionIsNotMultiRange) {
      return;
    }
    const {range} = getWordTextAndRange(this._textEditor, this._getMousePositionAsBufferPosition());
    this._lastWordRange = range;

    if (this._isHyperclickEvent(event)) {
      // Clear the suggestion if the mouse moved out of the range.
      if (!this._isMouseAtLastSuggestion()) {
        this._clearSuggestion();
      }
      this._setSuggestionForLastMouseEvent();
    } else {
      this._clearSuggestion();
    }
  }

  _onMouseDown(event: MouseEvent): void {
    if (!this._isHyperclickEvent(event)) {
      return;
    }

    if (this._lastSuggestionAtMouse) {
      this._confirmSuggestion(this._lastSuggestionAtMouse);
      // Prevent the <meta-click> event from adding another cursor.
      event.stopPropagation();
    }

    this._clearSuggestion();
  }

  _onKeyDown(event: SyntheticKeyboardEvent): void {
    // Show the suggestion at the last known mouse position.
    if (this._isHyperclickEvent(event)) {
      this._setSuggestionForLastMouseEvent();
    }
  }

  _onKeyUp(event: SyntheticKeyboardEvent): void {
    if (!this._isHyperclickEvent(event)) {
      this._clearSuggestion();
    }
  }

  /**
   * Returns a `Promise` that's resolved when the latest suggestion's available.
   */
  getSuggestionAtMouse(): Promise<?HyperclickSuggestion> {
    return this._lastSuggestionAtMousePromise || Promise.resolve(null);
  }

  async _setSuggestionForLastMouseEvent(): Promise<void> {
    if (!this._lastMouseEvent) {
      return;
    }

    const position = this._getMousePositionAsBufferPosition();

    if (this._lastSuggestionAtMouse != null) {
      const {range} = this._lastSuggestionAtMouse;
      invariant(range, 'Hyperclick result must have a valid Range');
      if (this._isPositionInRange(position, range)) {
        return;
      }
    }
    // this._lastSuggestionAtMouse will only be set if hyperclick returned a promise that
    // resolved to a non-null value. So, in order to not ask hyperclick for the same thing
    // again and again which will be anyway null, we check if the mouse position has changed.
    if (this._lastPosition && position.compare(this._lastPosition) === 0) {
      return;
    }

    this._loadingTracker = startTracking('hyperclick-loading');

    try {
      this._lastPosition = position;
      this._lastSuggestionAtMousePromise =
          this._hyperclick.getSuggestion(this._textEditor, position);
      this._lastSuggestionAtMouse = await this._lastSuggestionAtMousePromise;
      if (this._isDestroyed) {
        return;
      }
      if (this._lastSuggestionAtMouse && this._isMouseAtLastSuggestion()) {
        // Add the hyperclick markers if there's a new suggestion and it's under the mouse.
        this._updateNavigationMarkers(this._lastSuggestionAtMouse.range);
      } else {
        // Remove all the markers if we've finished loading and there's no suggestion.
        this._updateNavigationMarkers(null);
      }
      if (this._loadingTracker != null) {
        this._loadingTracker.onSuccess();
      }
    } catch (e) {
      if (this._loadingTracker != null) {
        this._loadingTracker.onError(e);
      }
    } finally {
      this._doneLoading();
    }
  }

  _getMousePositionAsBufferPosition(): atom$Point {
    const {component} = this._textEditorView;
    invariant(component);
    invariant(this._lastMouseEvent);
    const screenPosition = component.screenPositionForMouseEvent(this._lastMouseEvent);
    return this._textEditor.bufferPositionForScreenPosition(screenPosition);
  }

  _isMouseAtLastSuggestion(): boolean {
    if (!this._lastSuggestionAtMouse) {
      return false;
    }
    const {range} = this._lastSuggestionAtMouse;
    invariant(range, 'Hyperclick result must have a valid Range');
    return this._isPositionInRange(this._getMousePositionAsBufferPosition(), range);
  }

  _isMouseAtLastWordRange(): boolean {
    const lastWordRange = this._lastWordRange;
    if (lastWordRange == null) {
      return false;
    }
    return this._isPositionInRange(this._getMousePositionAsBufferPosition(), lastWordRange);
  }

  _isPositionInRange(position: atom$Point, range: atom$Range | Array<atom$Range>): boolean {
    return (Array.isArray(range)
        ? range.some(r => r.containsPoint(position))
        : range.containsPoint(position));
  }

  _clearSuggestion(): void {
    this._doneLoading();
    this._lastSuggestionAtMousePromise = null;
    this._lastSuggestionAtMouse = null;
    this._updateNavigationMarkers(null);
  }

  @trackTiming('hyperclick:confirm-cursor')
  async _confirmSuggestionAtCursor(): Promise<void> {
    const suggestion = await this._hyperclick.getSuggestion(
        this._textEditor,
        this._textEditor.getCursorBufferPosition());
    if (suggestion) {
      this._confirmSuggestion(suggestion);
    }
  }

  /**
   * Add markers for the given range(s), or clears them if `ranges` is null.
   */
  _updateNavigationMarkers(range: ? (atom$Range | Array<atom$Range>)): void {
    if (this._navigationMarkers) {
      this._navigationMarkers.forEach(marker => marker.destroy());
      this._navigationMarkers = null;
    }

    // Only change the cursor to a pointer if there is a suggestion ready.
    if (range == null) {
      this._textEditorView.classList.remove('hyperclick');
      return;
    }

    this._textEditorView.classList.add('hyperclick');
    const ranges = Array.isArray(range) ? range : [range];
    this._navigationMarkers = ranges.map(markerRange => {
      const marker = this._textEditor.markBufferRange(markerRange, {invalidate: 'never'});
      this._textEditor.decorateMarker(
        marker,
        {type: 'highlight', class: 'hyperclick'},
      );
      return marker;
    });
  }

  /**
   * Returns whether an event should be handled by hyperclick or not.
   */
  _isHyperclickEvent(event: SyntheticKeyboardEvent | MouseEvent): boolean {
    // If the user is pressing either the meta/ctrl key or the alt key.
    return process.platform === 'darwin' ? event.metaKey : event.ctrlKey;
  }

  _isLoading(): boolean {
    return this._loadingTracker != null;
  }

  _doneLoading(): void {
    this._loadingTracker = null;
    this._textEditorView.classList.remove('hyperclick-loading');
  }

  dispose() {
    this._isDestroyed = true;
    this._clearSuggestion();
    this._textEditorView.removeEventListener('mousemove', this._onMouseMove);
    this._textEditorView.removeEventListener('mousedown', this._onMouseDown);
    this._textEditorView.removeEventListener('keydown', this._onKeyDown);
    this._textEditorView.removeEventListener('keyup', this._onKeyUp);
    this._commandSubscription.dispose();
  }
}
